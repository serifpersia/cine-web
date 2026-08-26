const express = require('express');
const NodeCache = require('node-cache');
const path = require('path');
const freekeys = require('freekeys');
const zlib = require('zlib');

const app = express();
const cache = new NodeCache();
const port = 3001;
const TMDB_BASE = 'https://api.themoviedb.org/3';
let tmdbApiKey = process.env.TMDB_API_KEY || '';

async function ensureTmdbKey() {
    if (tmdbApiKey) return tmdbApiKey;
    try {
        const keys = await freekeys();
        tmdbApiKey = keys.tmdb_key;
    } catch (e) {
        console.warn('[TMDB] Failed to fetch free API key:', e.message);
    }
    if (!tmdbApiKey) {
        tmdbApiKey = '9e7096a7575623aa30c66e9cc987e411';
        console.warn('[TMDB] Using fallback key');
    }
    return tmdbApiKey;
}
const TMDB_IMAGE = 'https://image.tmdb.org/t/p/w500';

const IMDB_SUGGEST_URL = 'https://v3.sg.media-imdb.com/suggestion/x';
const TV_TYPES = new Set(['tvSeries', 'tvMiniSeries', 'movie']);

app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.json());

// ── Helper Functions ──────────────────────────────────────────────────
function toValidSeason(value) {
    const season = Number(value);
    return Number.isInteger(season) && season >= 1 && season <= 99 ? season : undefined;
}

function extractTitleAndSeason(title) {
    const seasonMatch =
        title.match(/\bseason\s*(\d+)\b/i) ||
        title.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i) ||
        title.match(/\bs(\d+)\b/i);
    const season = toValidSeason(seasonMatch?.[1]) || 1;
    const cleanTitle = seasonMatch
        ? title
            .replace(seasonMatch[0], '')
            .replace(/\s*[-:]\s*$/, '')
            .trim()
        : title.trim();

    return {
        title: cleanTitle || title.trim(),
        season,
        hasExplicitSeason: !!seasonMatch,
    };
}

function normalizeTitle(title) {
    return title
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function scoreTitleMatch(queryTitles, title) {
    const candidate = normalizeTitle(title);
    if (!candidate) return -1;

    return Math.max(
        ...queryTitles.map((queryTitle) => {
            const query = normalizeTitle(queryTitle);
            if (!query) return -1;
            if (candidate === query) return 100;
            if (candidate.startsWith(query) || query.startsWith(candidate)) return 70;

            const queryTerms = new Set(query.split(' ').filter((term) => term.length > 2));
            const candidateTerms = new Set(candidate.split(' ').filter((term) => term.length > 2));
            const overlap = [...queryTerms].filter((term) => candidateTerms.has(term)).length;
            return overlap * 10 - Math.abs(queryTerms.size - candidateTerms.size);
        })
    );
}

// ── IMDb / Fallback Search ─────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
    const query = req.query.q || '';
    if (!query) return res.json([]);

    const rawTitle = query.trim();
    const rawTitles = [rawTitle];
    const parsedTitleMap = new Map();

    rawTitles.forEach(title => {
        const parsed = extractTitleAndSeason(title);
        const key = parsed.title.toLowerCase();
        const existing = parsedTitleMap.get(key);
        if (!existing || (!existing.hasExplicitSeason && parsed.hasExplicitSeason)) {
            parsedTitleMap.set(key, parsed);
        }
    });

    const parsedTitles = Array.from(parsedTitleMap.values());
    const queryTitles = parsedTitles.map(p => p.title).slice(0, 3);
    const season = parsedTitles.find(p => p.hasExplicitSeason)?.season || 1;

    const cacheKey = `search-${queryTitles.join('|').toLowerCase()}-${season}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
        const suggestionsResults = await Promise.all(
            queryTitles.map(async (title) => {
                const response = await fetch(`${IMDB_SUGGEST_URL}/${encodeURIComponent(title)}.json`, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                });
                if (!response.ok) return [];
                const data = await response.json();
                return data.d || [];
            })
        );

        const allSuggestions = suggestionsResults.flat();
        const uniqueSuggestions = Array.from(
            new Map(allSuggestions.map(s => [s.id, s])).values()
        );

        const matches = uniqueSuggestions
            .filter((entry) => Boolean(entry.id && entry.l) && (TV_TYPES.has(entry.qid) || entry.qid === 'movie'))
            .sort((left, right) => scoreTitleMatch(queryTitles, right.l) - scoreTitleMatch(queryTitles, left.l))
            .slice(0, 10)
            .map((entry) => ({
                id: entry.id,
                title: entry.l,
                year: entry.y,
                type: entry.qid,
                image: entry.i?.imageUrl || '',
                season: season
            }));

        cache.set(cacheKey, matches, 3600);
        res.json(matches);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// ── TMDB Endpoints ─────────────────────────────────────────────────────
app.get('/api/tmdb/search', async (req, res) => {
    const query = req.query.q || '';
    if (!query) return res.json([]);
    const page = parseInt(req.query.page, 10) || 1;
    const cacheKey = `tmdb-search-${query.toLowerCase()}-${page}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const key = await ensureTmdbKey();
    if (!key) return res.status(500).json({ error: 'No TMDB API key available' });
    try {
        const r = await fetch(`${TMDB_BASE}/search/multi?api_key=${key}&query=${encodeURIComponent(query)}&page=${page}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (!r.ok) return res.status(500).json({ error: 'TMDB search failed' });
        const d = await r.json();
        const results = (d.results || [])
            .filter(item => item.media_type !== 'person')
            .map(item => ({
                id: item.id,
                title: item.title || item.name,
                year: (item.release_date || item.first_air_date || '').split('-')[0],
                type: item.media_type,
                image: item.poster_path ? `${TMDB_IMAGE}${item.poster_path}` : '',
                vote_average: item.vote_average,
            }));
        cache.set(cacheKey, results, 3600);
        res.json(results);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/tmdb/details/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    const key = await ensureTmdbKey();
    if (!key) return res.status(500).json({ error: 'No TMDB API key available' });
    try {
        const r = await fetch(`${TMDB_BASE}/${type}/${id}?api_key=${key}&append_to_response=external_ids`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (!r.ok) return res.status(500).json({ error: 'TMDB details failed' });
        const d = await r.json();
        const result = {
            id: d.id,
            imdb_id: d.external_ids?.imdb_id || d.imdb_id || null,
            title: d.title || d.name,
            overview: d.overview,
            vote_average: d.vote_average,
            year: (d.release_date || d.first_air_date || '').split('-')[0],
            poster: d.poster_path ? `${TMDB_IMAGE}${d.poster_path}` : '',
        };
        if (type === 'tv') {
            result.seasons = (d.seasons || []).filter(s => s.season_number > 0).map(s => ({
                season_number: s.season_number,
                episode_count: s.episode_count,
            }));
            result.number_of_seasons = d.number_of_seasons;
        }
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/tmdb/episodes/:id/:season', async (req, res) => {
    const { id, season } = req.params;
    const key = await ensureTmdbKey();
    if (!key) return res.status(500).json({ error: 'No TMDB API key available' });
    try {
        const r = await fetch(`${TMDB_BASE}/tv/${id}/season/${season}?api_key=${key}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (!r.ok) return res.status(500).json({ error: 'TMDB episodes failed' });
        const d = await r.json();
        const episodes = (d.episodes || []).map(ep => ({
            episode_number: ep.episode_number,
            name: ep.name,
            vote_average: ep.vote_average,
        }));
        res.json({ episodes });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/lookup/imdb-to-tmdb/:imdbId', async (req, res) => {
    const key = await ensureTmdbKey();
    if (!key) return res.json({ tmdbId: null, error: 'No TMDB API key available' });
    try {
        const r = await fetch(`${TMDB_BASE}/find/${req.params.imdbId}?api_key=${key}&external_source=imdb_id`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (!r.ok) return res.json({ tmdbId: null, error: `TMDB error ${r.status}` });
        const d = await r.json();
        const movie = d.movie_results?.[0];
        const tv = d.tv_results?.[0];
        const result = movie || tv;
        res.json({
            tmdbId: result?.id || null,
            type: movie ? 'movie' : tv ? 'tv' : null,
            title: result?.title || result?.name || null,
            year: (result?.release_date || result?.first_air_date || '').substring(0, 4) || null
        });
    } catch (e) {
        res.json({ tmdbId: null, error: e.message });
    }
});

// ── VixSrc Provider ────────────────────────────────────────────────────
app.get('/api/vixsrc/:type/:tmdbId', async (req, res) => {
    const { type, tmdbId } = req.params;
    const season = req.query.season;
    const episode = req.query.episode;
    const mediaType = type === 'movie' ? 'movie' : 'tv';
    const BASE_URL = 'https://vixsrc.to';

    const HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: BASE_URL,
        Origin: BASE_URL
    };

    try {
        const pageUrl = mediaType === 'movie'
            ? `${BASE_URL}/api/movie/${tmdbId}`
            : `${BASE_URL}/api/tv/${tmdbId}/${season}/${episode}`;

        const apiRes = await fetch(pageUrl, { headers: HEADERS });
        if (!apiRes.ok) return res.status(500).json({ error: 'VixSrc API failed', status: apiRes.status });
        const apiData = await apiRes.json();
        if (!apiData?.src) return res.json({ sources: [] });

        const htmlRes = await fetch(BASE_URL + apiData.src, {
            headers: { ...HEADERS, Accept: 'text/html,application/xhtml+xml,*/*' }
        });
        if (!htmlRes.ok) return res.status(500).json({ error: 'VixSrc embed failed' });
        const html = await htmlRes.text();

        const token = html.match(/token["']\s*:\s*["']([^"']+)/)?.[1];
        const expires = html.match(/expires["']\s*:\s*["']([^"']+)/)?.[1];
        const playlist = html.match(/url\s*:\s*["']([^"']+)/)?.[1];

        if (!token || !expires || !playlist) return res.json({ sources: [] });

        const sep = playlist.includes('?') ? '&' : '?';
        const masterUrl = `${playlist}${sep}token=${token}&expires=${expires}&h=1`;

        const plRes = await fetch(masterUrl, {
            headers: { ...HEADERS, Referer: pageUrl }
        });
        if (!plRes.ok) return res.status(500).json({ error: 'VixSrc playlist failed' });
        const playlistContent = await plRes.text();

        const regex = /#EXT-X-STREAM-INF:[^\n]*RESOLUTION=\d+x(\d+)[^\n]*\n([^\n]+)/g;
        let match;
        let bestResolution = 0;
        while ((match = regex.exec(playlistContent)) !== null) {
            const resVal = parseInt(match[1], 10);
            if (resVal > bestResolution) bestResolution = resVal;
        }

        const sources = bestResolution > 0 ? [{
            url: masterUrl,
            quality: `${bestResolution}p`,
            type: 'hls'
        }] : [];

        const audioTracks = [];
        for (const line of playlistContent.split('\n')) {
            if (!line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) continue;
            const language = line.match(/LANGUAGE="([^"]+)"/)?.[1] ?? 'unknown';
            const label = line.match(/NAME="([^"]+)"/)?.[1] ?? 'Audio';
            audioTracks.push({ language, label });
        }

        res.json({ sources, audioTracks, masterUrl, referer: pageUrl });
    } catch (error) {
        console.error('VixSrc error:', error);
        res.status(500).json({ error: 'VixSrc fetch failed', message: error.message });
    }
});

// ── Movy.bz HLS Direct Stream Provider ─────────────────────────────────
const MOVY_API = 'https://api.wecollege.net';
const MOVY_SERVERS = [
    'miami', 'phoenix', 'dallas', 'seattle', 'denver',
    'cancun', 'atlanta', 'houston', 'portland', 'austin',
    'munich', 'berlin', 'paris', 'delhi'
];

const MOVY_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174
];
const MOVY_MAGIC = [109, 118, 109, 49]; // "mvm1"
const movyIsEven = (e) => ((e * (e + 1)) & 1) === 0;

function movyMix(e) {
    e >>>= 0;
    e ^= e >>> 16;
    e = Math.imul(e, 0x85ebca6b) >>> 0;
    e ^= e >>> 13;
    e = Math.imul(e, 0xc2b2ae35) >>> 0;
    return (e ^= e >>> 16) >>> 0;
}

function movyShift(e, t) {
    return ((e >>>= 0), 0 === (t &= 31)) ? e >>> 0 : ((e << t) | (e >>> (32 - t))) >>> 0;
}

function decodeMovyPayload(e, t, a) {
    let r = (function (e) {
        let t = e.replace(/-/g, '+').replace(/_/g, '/').padEnd(4 * Math.ceil(e.length / 4), '=');
        return new Uint8Array(Buffer.from(t, 'base64'));
    })(e);

    let n = (function (e, t, a) {
        let s = (function (e, t) {
            let s = Array(61);
            let r = movyMix(
                (function (e) {
                    let t = 0x811c9dc5;
                    for (let a = 0; a < e.length; a++) t = Math.imul(t ^ e.charCodeAt(a), 0x1000193) >>> 0;
                    return movyMix(t);
                })(e) ^ movyMix((t >>> 0) ^ 0x9e3779b9)
            ) >>> 0;

            for (let e = 0; e < 8; e++) {
                if (movyIsEven(e)) {
                    let t = r % 61;
                    r = movyShift((r + 0x9e3779b9) >>> 0, 7 + (7 & e));
                    s[t] = (r ^ movyMix(r)) >>> 0;
                    r = movyMix((r + t) >>> 0);
                } else {
                    s[e] = MOVY_K[15 & e];
                }
            }
            return { S: s, acc: movyMix(0xa5a5a5a5 ^ r) >>> 0 };
        })(e, t);

        let r = new Uint8Array(a);
        let n = 0;
        for (let e = 0; e < a; ) {
            let t = (function (e, t) {
                let r = e.S;
                let n = e.acc;
                let i = n % 61;
                let o = 0 - Number(i in r);
                let l = r[i] >>> 0;
                let c = Math.imul(0x9e3779b9, t + 1) >>> 0;
                let h = ((((n ^ ((l ^ c) >>> 0)) >>> 0) | (n & ((l ^ c) >>> 0) & o)) >>> 0) >>> 0;
                n = movyMix((movyShift((h + n) >>> 0, 31 & i) ^ movyShift(n, 31 & Math.imul(i, 7))) + 0x9e3779b9 >>> 0);
                r[i] = n >>> 0;
                e.acc = n;
                return n >>> 0;
            })(s, n++);
            r[e++] = 255 & t;
            if (e < a) r[e++] = (t >>> 8) & 255;
            if (e < a) r[e++] = (t >>> 16) & 255;
            if (e < a) r[e++] = (t >>> 24) & 255;
        }
        return r;
    })(t, a, r.length);

    for (let e = 0; e < r.length; e++) r[e] ^= n[e];
    for (let e = 0; e < MOVY_MAGIC.length; e++) {
        if (r[e] !== MOVY_MAGIC[e]) throw Error(`decrypt failed: bad seed or payload`);
    }
    return Buffer.from(r.subarray(MOVY_MAGIC.length)).toString('utf8');
}

const movySeedCache = new Map();
const inflightSeedRequests = new Map();

async function movyGetSeed(mediaId, forceRefresh = false) {
    const key = String(mediaId);
    const now = Date.now();

    if (!forceRefresh) {
        const cached = movySeedCache.get(key);
        if (cached && cached.expiresAt - 4000 > now) {
            return cached.seed;
        }
    }

    if (inflightSeedRequests.has(key)) {
        return await inflightSeedRequests.get(key);
    }

    const promise = (async () => {
        try {
            const r = await fetch(`${MOVY_API}/seed?mediaId=${mediaId}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Referer': 'https://www.movy.bz/',
                    'Origin': 'https://www.movy.bz'
                },
                signal: AbortSignal.timeout(5000)
            });

            if (r.ok) {
                const data = await r.json();
                const ttl = data.ttlMs || 30000;
                movySeedCache.set(key, { seed: data.seed, expiresAt: Date.now() + ttl });
                return data.seed;
            }

            if (r.status === 429) {
                console.warn(`[Movy] 429 on seed for ${mediaId}, checking fallback`);
                const cached = movySeedCache.get(key);
                if (cached) return cached.seed;
            }
        } catch (e) {
            const cached = movySeedCache.get(key);
            if (cached) return cached.seed;
            console.error(`[Movy] Seed error for ${mediaId}:`, e.message);
        } finally {
            inflightSeedRequests.delete(key);
        }

        return movySeedCache.get(key)?.seed || null;
    })();

    inflightSeedRequests.set(key, promise);
    return await promise;
}

app.get('/api/movybz/:type/:tmdbId', async (req, res) => {
    const { type, tmdbId } = req.params;
    const mediaType = type === 'movie' ? 'movie' : 'tv';
    const season = req.query.season || '1';
    const episode = req.query.episode || '1';
    let title = req.query.title || '';
    let year = req.query.year || '';
    let imdbId = req.query.imdbId || '';
    let totalSeasons = req.query.totalSeasons || '1';
    const numericTmdbId = parseInt(tmdbId, 10);

    if (!title || !imdbId || !year) {
        try {
            const key = await ensureTmdbKey();
            if (key) {
                const tmdbRes = await fetch(`${TMDB_BASE}/${mediaType}/${numericTmdbId}?api_key=${key}&append_to_response=external_ids`, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    signal: AbortSignal.timeout(4000)
                });
                if (tmdbRes.ok) {
                    const d = await tmdbRes.json();
                    if (!title) title = d.title || d.name || '';
                    if (!year) year = (d.release_date || d.first_air_date || '').split('-')[0] || '';
                    if (!imdbId) imdbId = d.external_ids?.imdb_id || d.imdb_id || '';
                    if (mediaType === 'tv' && d.number_of_seasons) totalSeasons = String(d.number_of_seasons);
                }
            }
        } catch (err) {
            console.warn('[Movy] TMDB metadata auto-enrich error:', err.message);
        }
    }

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.movy.bz/',
        'Origin': 'https://www.movy.bz'
    };

    let seed = await movyGetSeed(numericTmdbId);
    if (!seed) {
        return res.status(500).json({ error: 'Seed unavailable' });
    }

    const baseParams = {
        title: title,
        mediaType,
        year: year,
        tmdbId: String(numericTmdbId),
        imdbId: imdbId,
        enc: '2',
        seed: seed
    };

    if (mediaType === 'tv') {
        baseParams.totalSeasons = totalSeasons;
        baseParams.seasonId = season;
        baseParams.episodeId = episode;
    }

    for (const city of MOVY_SERVERS) {
        try {
            baseParams.seed = seed;
            const params = new URLSearchParams(baseParams);
            const r = await fetch(`${MOVY_API}/${city}/sources?${params.toString()}`, {
                headers,
                signal: AbortSignal.timeout(5000)
            });

            if (!r.ok) continue;

            const encrypted = await r.text();
            let decrypted;
            try {
                decrypted = decodeMovyPayload(encrypted, seed, numericTmdbId);
            } catch {
                seed = await movyGetSeed(numericTmdbId, true);
                if (!seed) continue;
                baseParams.seed = seed;
                const retryParams = new URLSearchParams(baseParams);
                const retryResp = await fetch(`${MOVY_API}/${city}/sources?${retryParams.toString()}`, {
                    headers,
                    signal: AbortSignal.timeout(5000)
                });
                if (!retryResp.ok) continue;
                decrypted = decodeMovyPayload(await retryResp.text(), seed, numericTmdbId);
            }

            const data = JSON.parse(decrypted);
            if (Array.isArray(data.sources) && data.sources.length > 0) {
                const validSources = data.sources.filter(s => !(s.url || '').includes('.mpd'));
                if (validSources.length === 0) continue;

                const sources = [];
                for (const s of validSources) {
                    const isHls = s.url?.includes('.m3u8');
                    const isMp4 = s.url?.includes('.mp4');
                    const type = isHls ? 'hls' : isMp4 ? 'mp4' : 'hls';

                    if (isHls) {
                        try {
                            const plRes = await fetch(s.url, {
                                headers: {
                                    'User-Agent': headers['User-Agent'],
                                    'Referer': 'https://www.movy.bz/',
                                    'Origin': 'https://www.movy.bz'
                                },
                                signal: AbortSignal.timeout(6000)
                            });
                            if (plRes.ok) {
                                const playlist = await plRes.text();
                                const variantRegex = /#EXT-X-STREAM-INF:[^\n]*BANDWIDTH=(\d+)[^\n]*RESOLUTION=(\d+x\d+)[^\n]*(?:FRAME-RATE=([\d.]+))?[^\n]*\n([^\n]+)/g;
                                let match;
                                const variants = [];
                                while ((match = variantRegex.exec(playlist)) !== null) {
                                    const resParts = match[2].split('x');
                                    variants.push({
                                        bandwidth: parseInt(match[1], 10),
                                        width: parseInt(resParts[0], 10),
                                        height: parseInt(resParts[1], 10),
                                        frameRate: match[3] ? parseFloat(match[3]) : null,
                                        uri: match[4]
                                    });
                                }

                                if (variants.length > 0) {
                                    variants.sort((a, b) => a.height - b.height);
                                    for (const v of variants) {
                                        const fullUrl = v.uri.startsWith('http')
                                            ? v.uri
                                            : new URL(v.uri, s.url).href;
                                        sources.push({
                                            url: fullUrl,
                                            quality: `${v.height}p`,
                                            type: 'hls',
                                            width: v.width,
                                            height: v.height,
                                            bandwidth: v.bandwidth,
                                            frameRate: v.frameRate
                                        });
                                    }
                                } else {
                                    sources.push({
                                        url: s.url,
                                        quality: s.quality || 'Auto',
                                        type: 'hls'
                                    });
                                }
                            } else {
                                sources.push({
                                    url: s.url,
                                    quality: s.quality || 'Auto',
                                    type: 'hls'
                                });
                            }
                        } catch {
                            sources.push({
                                url: s.url,
                                quality: s.quality || 'Auto',
                                type: 'hls'
                            });
                        }
                    } else {
                        sources.push({
                            url: s.url,
                            quality: s.quality || 'Auto',
                            type: isMp4 ? 'mp4' : 'hls'
                        });
                    }
                }

                return res.json({
                    server: city,
                    sources,
                    subtitles: data.subtitles || []
                });
            }
        } catch {
            continue;
        }
    }

    res.json({ sources: [], subtitles: [], error: 'No sources found from Movy servers' });
});

// ── Stream & Manifest Proxy ────────────────────────────────────────────
app.get('/api/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    let referer = req.query.referer || targetUrl || 'https://www.movy.bz/';

    if (!targetUrl) return res.status(400).json({ error: 'Missing url param' });

    try {
        const parsedTarget = new URL(targetUrl);
        const hostname = parsedTarget.hostname;

        if (
            hostname.includes('calmprism') ||
            hostname.includes('peakstorm') ||
            hostname.includes('wecollege') ||
            hostname.includes('movy')
        ) {
            referer = 'https://www.movy.bz/';
        } else if (hostname.includes('vixsrc')) {
            referer = 'https://vixsrc.to/';
        }

        const requestHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': referer,
            'Origin': new URL(referer).origin,
            'Accept': '*/*'
        };

        if (req.headers.range) {
            requestHeaders['Range'] = req.headers.range;
        }

        const response = await fetch(targetUrl, {
            headers: requestHeaders
        });

        if (!response.ok && response.status !== 206) {
            return res.status(response.status).send(`Upstream CDN error: ${response.status}`);
        }

        const contentType = response.headers.get('content-type') || '';
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

        let buffer = Buffer.from(await response.arrayBuffer());

        if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
            try {
                buffer = zlib.gunzipSync(buffer);
            } catch {}
        }

        const firstChunk = buffer.slice(0, 30).toString('utf8');
        const isPlaylist =
            firstChunk.trim().startsWith('#EXTM3U') ||
            contentType.includes('m3u') ||
            contentType.includes('text') ||
            targetUrl.includes('.m3u8');

        if (isPlaylist && firstChunk.includes('#EXT')) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            const rawText = buffer.toString('utf8');
            const base = new URL(targetUrl);
            const proxyBase = `${req.protocol}://${req.get('host')}`;

            const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
            const rewritten = lines.map((line) => {
                const trimmed = line.trim();
                if (!trimmed) return line;

                if (trimmed.startsWith('#')) {
                    return trimmed.replace(/URI="([^"]+)"/g, (match, uri) => {
                        try {
                            const absolute = uri.startsWith('http') ? uri : new URL(uri, base).href;
                            const proxyUrl = `${proxyBase}/api/proxy?url=${encodeURIComponent(absolute)}&referer=${encodeURIComponent(referer)}`;
                            return `URI="${proxyUrl}"`;
                        } catch (e) {
                            return match;
                        }
                    });
                }

                try {
                    const absolute = trimmed.startsWith('http') ? trimmed : new URL(trimmed, base).href;
                    return `${proxyBase}/api/proxy?url=${encodeURIComponent(absolute)}&referer=${encodeURIComponent(referer)}`;
                } catch (e) {
                    return line;
                }
            }).join('\n');

            return res.send(rewritten);
        } else {
            res.status(response.status);
            if (contentType) res.setHeader('Content-Type', contentType);
            const contentRange = response.headers.get('content-range');
            if (contentRange) res.setHeader('Content-Range', contentRange);
            const acceptRanges = response.headers.get('accept-ranges');
            if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
            const contentLength = response.headers.get('content-length');
            if (contentLength) res.setHeader('Content-Length', contentLength);

            return res.send(buffer);
        }
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).send('Proxy stream error: ' + error.message);
    }
});

app.get('/api/resolve', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url' });
    try {
        let referer = 'https://embedmaster.link/';
        if (url.includes('videasy.to')) referer = 'https://player.videasy.to/';
        else if (url.includes('vidfast.pro')) referer = 'https://vidfast.pro/';
        else if (url.includes('vidrock.ru')) referer = 'https://vidrock.ru/';

        const r = await fetch(url, {
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                Referer: referer,
            }
        });
        res.json({ finalUrl: r.url, status: r.status });
    } catch (e) {
        res.json({ finalUrl: url, error: e.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});