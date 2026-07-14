const express = require('express');
const NodeCache = require('node-cache');
const path = require('path');
const freekeys = require('freekeys');

const app = express();
const cache = new NodeCache();
const port = 3000;

const IMDB_SUGGEST_URL = 'https://v3.sg.media-imdb.com/suggestion/x';
const TV_TYPES = new Set(['tvSeries', 'tvMiniSeries', 'movie']); // Including movies for better utility

app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.json());

// Helper functions ported from TS
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

app.get('/api/search', async (req, res) => {
    const query = req.query.q || '';
    if (!query) return res.json([]);

    const rawTitle = query.trim();
    const rawTitles = [rawTitle]; // Simplified aliases for now
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
            .filter((entry) => !!entry.id && !!entry.l && (TV_TYPES.has(entry.qid) || entry.qid === 'movie'))
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

// --- VixSrc Provider ---
let tmdbApiKey = process.env.TMDB_API_KEY || '';

async function ensureTmdbKey() {
    if (tmdbApiKey) return tmdbApiKey;
    try {
        const keys = await freekeys();
        tmdbApiKey = keys.tmdb_key;
    } catch (e) {
        console.warn('[TMDB] Failed to fetch free API key:', e.message);
    }
    return tmdbApiKey;
}

app.get('/api/lookup/imdb-to-tmdb/:imdbId', async (req, res) => {
    const key = await ensureTmdbKey();
    if (!key) return res.json({ tmdbId: null, error: 'No TMDB API key available' });
    try {
        const r = await fetch(`https://api.themoviedb.org/3/find/${req.params.imdbId}?api_key=${key}&external_source=imdb_id`, {
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
        // Step 1: Get embed link from API
        const pageUrl = mediaType === 'movie'
            ? `${BASE_URL}/api/movie/${tmdbId}`
            : `${BASE_URL}/api/tv/${tmdbId}/${season}/${episode}`;

        const apiRes = await fetch(pageUrl, { headers: HEADERS });
        if (!apiRes.ok) return res.status(500).json({ error: 'VixSrc API failed', status: apiRes.status });
        const apiData = await apiRes.json();
        if (!apiData?.src) return res.json({ sources: [] });

        // Step 2: Fetch embed page
        const htmlRes = await fetch(BASE_URL + apiData.src, {
            headers: { ...HEADERS, Accept: 'text/html,application/xhtml+xml,*/*' }
        });
        if (!htmlRes.ok) return res.status(500).json({ error: 'VixSrc embed failed' });
        const html = await htmlRes.text();

        // Step 3: Extract token, expires, playlist URL
        const token = html.match(/token["']\s*:\s*["']([^"']+)/)?.[1];
        const expires = html.match(/expires["']\s*:\s*["']([^"']+)/)?.[1];
        const playlist = html.match(/url\s*:\s*["']([^"']+)/)?.[1];

        if (!token || !expires || !playlist) return res.json({ sources: [] });

        const sep = playlist.includes('?') ? '&' : '?';
        const masterUrl = `${playlist}${sep}token=${token}&expires=${expires}&h=1`;

        // Step 4: Fetch HLS master playlist
        const plRes = await fetch(masterUrl, {
            headers: { ...HEADERS, Referer: pageUrl }
        });
        if (!plRes.ok) return res.status(500).json({ error: 'VixSrc playlist failed' });
        const playlistContent = await plRes.text();

        // Step 5: Parse variants for quality info
        const regex = /#EXT-X-STREAM-INF:[^\n]*RESOLUTION=\d+x(\d+)[^\n]*\n([^\n]+)/g;
        let match;
        let bestResolution = 0;
        while ((match = regex.exec(playlistContent)) !== null) {
            const res = parseInt(match[1], 10);
            if (res > bestResolution) bestResolution = res;
        }

        const sources = bestResolution > 0 ? [{
            url: masterUrl,
            quality: `${bestResolution}p`,
            type: 'hls'
        }] : [];

        // Parse audio tracks
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

// Proxy endpoint for HLS streams
app.get('/api/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    const referer = req.query.referer || targetUrl || 'https://vixsrc.to/';

    if (!targetUrl) return res.status(400).json({ error: 'Missing url param' });

    try {
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                Referer: referer,
                Origin: new URL(referer).origin
            }
        });

        if (!response.ok) return res.status(response.status).send('Proxy error');

        const contentType = response.headers.get('content-type') || '';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');

        const isPlaylist = contentType.includes('m3u') || contentType.includes('text') || targetUrl.includes('.m3u8') || targetUrl.includes('playlist');

        if (isPlaylist) {
            const text = await response.text();
            const base = new URL(targetUrl);
            const proxyBase = `${req.protocol}://${req.get('host')}`;

            // Resolve every URL in the playlist through our proxy
            const lines = text.split('\n');
            let afterStreamInf = false;
            const rewritten = lines.map(line => {
                // Handle URI="..." patterns (keys, media, subtitles)
                const rewrittenLine = line.replace(/URI="([^"]*)"/g, (match, url) => {
                    if (url.startsWith('http') && !url.includes('vixsrc.to')) return match;
                    const absolute = url.startsWith('http') ? url : new URL(url, base).href;
                    const encoded = encodeURIComponent(absolute);
                    const ref = encodeURIComponent(targetUrl);
                    return `URI="${proxyBase}/api/proxy?url=${encoded}&referer=${ref}"`;
                });

                // Handle standalone URLs after #EXT-X-STREAM-INF
                if (afterStreamInf && rewrittenLine.trim() && !rewrittenLine.startsWith('#')) {
                    afterStreamInf = false;
                    const url = rewrittenLine.trim();
                    if (!url.startsWith(proxyBase)) {
                        const absolute = url.startsWith('http') ? url : new URL(url, base).href;
                        const encoded = encodeURIComponent(absolute);
                        const ref = encodeURIComponent(targetUrl);
                        return `${proxyBase}/api/proxy?url=${encoded}&referer=${ref}`;
                    }
                }

                afterStreamInf = rewrittenLine.startsWith('#EXT-X-STREAM-INF');
                return rewrittenLine;
            }).join('\n');

            res.send(rewritten);
        } else {
            const buffer = await response.arrayBuffer();
            res.send(Buffer.from(buffer));
        }
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).send('Proxy error');
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
