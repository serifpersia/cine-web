const express = require('express');
const NodeCache = require('node-cache');
const path = require('path');

const app = express();
const cache = new NodeCache();
const port = 3000;

const IMDB_SUGGEST_URL = 'https://v3.sg.media-imdb.com/suggestion/x';
const TV_TYPES = new Set(['tvSeries', 'tvMiniSeries', 'movie']); // Including movies for better utility

app.use(express.static('public'));
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

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
