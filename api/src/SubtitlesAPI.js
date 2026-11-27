import fetch from 'node-fetch';
import { randomBytes } from 'node:crypto';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const OPENSUBTITLES_UA = 'KhemirixTV/1.0 (subtitle provider integration)';
const BASE = 'https://subtitles.website/strapi';
const CACHE_TTL = 6 * 60 * 60 * 1000;
const FILE_TTL = 6 * 60 * 60 * 1000;
const SEARCH_TIMEOUT_MS = Math.max(250, Number(process.env.SUBTITLE_SEARCH_TIMEOUT_MS) || 12000);
const cache = new Map();
const fileStore = new Map();

// The player exposes exactly these four languages. Provider codes are mapped
// onto them here so no other language can reach the UI.
export const SUBTITLE_LANGUAGES = [
    { code: 'ar', label: 'Arabic 🇸🇦', aliases: ['ar', 'ara', 'arabic'] },
    { code: 'fr', label: 'French 🇫🇷', aliases: ['fr', 'fra', 'fre', 'french'] },
    { code: 'en', label: 'English 🇬🇧', aliases: ['en', 'eng', 'english'] },
    { code: 'pl', label: 'Polish 🇵🇱', aliases: ['pl', 'pol', 'polish'] }
];

export const SUBTITLE_PROVIDERS = [
    { id: 'mysubs', label: 'MySubs' },
    { id: 'subtitles-website', label: 'subtitles.website' },
    { id: 'subdl', label: 'SubDL' },
    { id: 'wyzie', label: 'Wyzie Subs' },
    { id: 'opensubtitles', label: 'OpenSubtitles.com' }
];

const PROVIDER_LABELS = SUBTITLE_PROVIDERS.reduce((out, provider) => {
    out[provider.id] = provider.label;
    return out;
}, {});

let httpFetch = fetch;

// Test seam only: production always uses node-fetch.
export function setHttpFetchForTests(fn) {
    httpFetch = typeof fn === 'function' ? fn : fetch;
}

export function normalizeLanguageCode(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return null;
    const base = raw.split(/[-_]/)[0];
    const candidates = [raw, base];
    for (const candidate of candidates) {
        const language = SUBTITLE_LANGUAGES.find((item) => item.aliases.indexOf(candidate) !== -1);
        if (language) return language.code;
    }
    const letters = raw.replace(/[^a-z]/g, '');
    const loose = SUBTITLE_LANGUAGES.find((item) => item.aliases.indexOf(letters) !== -1);
    return loose ? loose.code : null;
}

function languageLabel(code) {
    const language = SUBTITLE_LANGUAGES.find((item) => item.code === code);
    return language ? language.label : code;
}

function episodeMatch(name, season, episode) {
    const s = String(season).padStart(2, '0');
    const e = String(episode).padStart(2, '0');
    return new RegExp(
        '(^|[^0-9])s?0?' + Number(season) + '[^0-9a-z]?e?0?' + Number(episode) + '($|[^0-9])',
        'i'
    ).test(name) || name.toLowerCase().includes('s' + s + 'e' + e) || name.toLowerCase().includes(s + 'x' + e);
}

function asSubtitle(id, name, format, directUrl) {
    if (!directUrl) return null;
    return {
        id: id,
        name: name || 'Arabic',
        lang: 'ar',
        languages: [{ code: 'ar', label: 'العربية' }],
        format: (format || 'srt').toLowerCase(),
        // Relative on purpose: the browser prepends the Showbox API origin.
        url: '/api/subtitles/file?url=' + encodeURIComponent(directUrl)
    };
}

function rememberFile(entry) {
    const id = randomBytes(16).toString('hex');
    fileStore.set(id, Object.assign({ at: Date.now() }, entry));
    return '/api/subtitles/file?id=' + id;
}

function getStoredFile(id) {
    const entry = fileStore.get(String(id || ''));
    if (!entry) return null;
    if (Date.now() - entry.at > FILE_TTL) {
        fileStore.delete(String(id));
        return null;
    }
    return entry;
}

function numberOrZero(value) {
    const number = Number(value);
    return isFinite(number) && number > 0 ? number : 0;
}

function imdbDigits(value) {
    return String(value || '').replace(/^tt/i, '').replace(/^0+/, '');
}

function textTokens(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((token) => token.length > 2);
}

function tokenSimilarity(a, b) {
    const left = textTokens(a);
    const right = textTokens(b);
    if (!left.length || !right.length) return 0;
    const rightSet = new Set(right);
    const shared = left.filter((token) => rightSet.has(token)).length;
    return shared / new Set(left.concat(right)).size;
}

function rankSubtitles(results, args) {
    const wantedImdb = imdbDigits(args.imdbId);
    const wantedTitle = args.title || '';
    return results.slice().map((result) => {
        let score = 0;
        const resultImdb = imdbDigits(result.imdbId);
        score += resultImdb && wantedImdb ? (resultImdb === wantedImdb ? 30 : 0) : 20;

        const releaseText = [result.release, result.name, result.fileName].filter(Boolean).join(' ');
        if (!args.isSeries) {
            score += 20;
        } else if (args.season && args.episode) {
            const exact = episodeMatch(releaseText, args.season, args.episode) ||
                (numberOrZero(result.season) === numberOrZero(args.season) &&
                 numberOrZero(result.episode) === numberOrZero(args.episode));
            score += exact ? 30 : (result.season || result.episode ? 5 : 12);
        } else {
            score += 10;
        }

        score += tokenSimilarity(releaseText, wantedTitle) * 15;

        const quality = result.quality || {};
        score += Math.min(15, Math.log10(numberOrZero(quality.downloads) + 1) * 5);
        score += Math.min(6, numberOrZero(quality.rating));
        score += Math.min(10, numberOrZero(quality.matchScore) * 10);
        score += Math.min(8, numberOrZero(quality.qualityScore) / 10);
        if (String(result.format || '').toLowerCase() === 'vtt') score += 4;

        return Object.assign({}, result, { score: Math.round(score * 100) / 100 });
    }).sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const order = SUBTITLE_PROVIDERS.map((provider) => provider.id);
        return order.indexOf(a.provider) - order.indexOf(b.provider);
    });
}

function dedupeSubtitles(results) {
    const seen = new Set();
    return results.filter((result) => {
        const release = String(result.release || result.name || result.fileName || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '');
        const key = result.lang + '|' + release;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function bestForLanguage(results, code, limit) {
    const max = Math.max(1, Number(limit) || 3);
    return (Array.isArray(results) ? results : [])
        .filter((result) => result && result.lang === code)
        .slice(0, max);
}

export function languageCounts(results) {
    const items = Array.isArray(results) ? results : [];
    return SUBTITLE_LANGUAGES.map((language) => ({
        code: language.code,
        label: language.label,
        count: items.filter((result) => result && result.lang === language.code).length
    }));
}

function normalizeProviderSubtitle(raw, provider, args) {
    if (!raw) return null;
    const attrs = raw.attributes || {};
    const details = attrs.feature_details || {};
    const language = normalizeLanguageCode(
        raw.language || raw.lang || attrs.language || raw.language_code || ''
    );
    if (!language) return null;

    const release = String(
        raw.release || raw.release_name || raw.fileName || raw.file_name ||
        raw.name || attrs.release || details.title || ''
    ).trim();
    const rawId = raw.id || raw.n_id || raw.nId || raw.subtitle_id ||
        (Array.isArray(attrs.files) && attrs.files[0] && attrs.files[0].file_id) || release;
    if (!rawId) return null;

    let url = null;
    if (provider === 'wyzie' && raw.url) {
        try {
            const download = new URL(raw.url);
            download.searchParams.set('to', 'vtt');
            url = rememberFile({ kind: 'wyzie', url: download.toString(), format: 'vtt' });
        } catch (e) {
            url = null;
        }
    } else if (provider === 'subdl') {
        const file = Array.isArray(raw.unpack_files) && raw.unpack_files[0];
        if (file && file.url) {
            url = rememberFile({ kind: 'direct', url: file.url, format: 'srt' });
        } else if (rawId) {
            url = rememberFile({ kind: 'subdl', nId: String(rawId), format: 'srt' });
        }
    } else if (provider === 'opensubtitles') {
        const file = Array.isArray(attrs.files) && attrs.files[0];
        if (file && file.file_id) {
            url = rememberFile({ kind: 'opensubtitles', fileId: file.file_id, format: 'srt' });
        }
    }
    if (!url) return null;

    return {
        id: provider + ':' + String(rawId),
        provider: provider,
        providerLabel: PROVIDER_LABELS[provider] || provider,
        name: release || PROVIDER_LABELS[provider] || provider,
        release: release,
        fileName: String(raw.fileName || raw.file_name || ''),
        lang: language,
        languages: [{ code: language, label: languageLabel(language) }],
        format: provider === 'wyzie' ? 'vtt' : 'srt',
        url: url,
        imdbId: String(raw.imdb_id || details.imdb_id || args.imdbId || ''),
        title: String(details.title || raw.title || args.title || ''),
        season: numberOrZero(raw.season || details.season_number || args.season),
        episode: numberOrZero(raw.episode || details.episode_number || args.episode),
        quality: {
            downloads: numberOrZero(raw.downloads || raw.downloadCount || attrs.download_count),
            rating: numberOrZero(raw.rating || attrs.rating),
            matchScore: numberOrZero(raw.match_score || (raw.match && raw.match.score)),
            qualityScore: numberOrZero(raw.quality && raw.quality.score),
            format: String(raw.format || attrs.format || 'srt').toLowerCase()
        }
    };
}

function withLegacyProvider(result, provider) {
    if (!result) return null;
    return Object.assign({}, result, {
        id: provider + ':' + String(result.id || result.name),
        provider: provider,
        providerLabel: PROVIDER_LABELS[provider] || provider,
        release: String(result.name || ''),
        lang: 'ar',
        languages: [{ code: 'ar', label: languageLabel('ar') }],
        imdbId: '',
        title: '',
        season: 0,
        episode: 0,
        quality: { downloads: 0, rating: 0, matchScore: 0, qualityScore: 0, format: result.format || 'srt' }
    });
}

// MySubs has precise season/episode filtering and a generous rate limit.
async function findMySubs(args) {
    const url = new URL('https://www.mysubs.org/api/v1/titles/' + encodeURIComponent(args.imdbId) + '/subtitles');
    url.searchParams.set('lang', 'ar');
    if (args.isSeries && args.season && args.episode) {
        url.searchParams.set('season', String(args.season));
        url.searchParams.set('episode', String(args.episode));
    }
    const res = await httpFetch(url.toString(), {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        timeout: 20000
    });
    if (res.status === 404) return [];
    if (!res.ok) throw Object.assign(new Error('MySubs unavailable'), { status: res.status });
    const json = await res.json();
    const items = Array.isArray(json.data) ? json.data : [];
    const pick = items.find(function (x) { return x.urls && x.urls.vtt; }) ||
                 items.find(function (x) { return x.urls && x.urls.srt; });
    if (!pick) return [];
    const directUrl = pick.urls.vtt || pick.urls.srt;
    const subtitle = asSubtitle(pick.id, pick.file && pick.file.name,
        directUrl.endsWith('.vtt') ? 'vtt' : 'srt', directUrl);
    const normalized = withLegacyProvider(subtitle, 'mysubs');
    return normalized ? [normalized] : [];
}

// Fallback with broad Arabic coverage (guest access, cached for 6 hours).
async function findSubtitlesWebsite(args) {
    const url = new URL(BASE + '/api/search/subtitles');
    url.searchParams.set('imdb', args.imdbId);
    url.searchParams.set('language', 'ar');
    if (args.isSeries && args.season && args.episode) {
        url.searchParams.set('season', String(args.season));
        url.searchParams.set('episode', String(args.episode));
    }

    let items = [];
    const res = await httpFetch(url.toString(), {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        timeout: 20000
    });
    if (res.status === 404) return [];
    if (!res.ok) {
        throw Object.assign(new Error('subtitles.website unavailable'), { status: res.status });
    }
    const json = await res.json();
    items = Array.isArray(json.data) ? json.data : [];

    // Keep only subtitles for the exact requested episode.
    if (args.isSeries && args.season && args.episode) {
        items = items.filter(function (item) {
            return episodeMatch(item.release || item.name || '', args.season, args.episode);
        });
    }

    // Prefer VTT (native WebVTT), then SRT (converted by the file proxy).
    items.sort(function (a, b) {
        const rank = (x) => ((x.format || '').toLowerCase() === 'vtt' ? 0 : 1);
        return rank(a) - rank(b) || (numberOrZero(b.downloads) - numberOrZero(a.downloads));
    });

    const pick = items[0];
    if (!pick || !pick.download_url) return [];
    const directUrl = pick.download_url.startsWith('http')
        ? pick.download_url
        : BASE + pick.download_url;
    const subtitle = asSubtitle(pick.id, pick.release || pick.film_title,
        pick.format || 'srt', directUrl);
    const normalized = withLegacyProvider(subtitle, 'subtitles-website');
    return normalized ? [normalized] : [];
}

async function findSubDL(args) {
    const key = process.env.SUBDL_API_KEY;
    if (!key) return [];
    const url = new URL('https://api.subdl.com/api/v2/subtitles/search');
    url.searchParams.set('imdb_id', args.imdbId);
    url.searchParams.set('languages', 'ar,fr,en,pl');
    url.searchParams.set('type', args.isSeries ? 'tv' : 'movie');
    if (args.isSeries && args.season) url.searchParams.set('season', String(args.season));
    if (args.isSeries && args.episode) url.searchParams.set('episode', String(args.episode));
    const res = await httpFetch(url.toString(), {
        headers: { 'Authorization': 'Bearer ' + key, 'User-Agent': UA, Accept: 'application/json' },
        timeout: 20000
    });
    if (res.status === 404) return [];
    if (!res.ok) throw Object.assign(new Error('SubDL unavailable'), { status: res.status });
    const json = await res.json();
    const items = Array.isArray(json.subtitles) ? json.subtitles
        : (Array.isArray(json.results) ? json.results : []);
    return items.slice(0, 30)
        .map((item) => normalizeProviderSubtitle(item, 'subdl', args))
        .filter(Boolean);
}

async function findWyzie(args) {
    const key = process.env.WYZIE_SUBS_API_KEY;
    if (!key) return [];
    const url = new URL('https://sub.wyzie.io/search');
    url.searchParams.set('id', args.imdbId);
    url.searchParams.set('language', 'ar,fr,en,pl');
    url.searchParams.set('key', key);
    url.searchParams.set('limit', '50');
    url.searchParams.set('machine', 'exclude');
    if (args.isSeries && args.season && args.episode) {
        url.searchParams.set('season', String(args.season));
        url.searchParams.set('episode', String(args.episode));
    }
    const res = await httpFetch(url.toString(), {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        timeout: 20000
    });
    if (res.status === 404) return [];
    if (!res.ok) throw Object.assign(new Error('Wyzie Subs unavailable'), { status: res.status });
    const json = await res.json();
    const items = Array.isArray(json) ? json
        : (Array.isArray(json.subtitles) ? json.subtitles : []);
    return items.slice(0, 50)
        .map((item) => normalizeProviderSubtitle(item, 'wyzie', args))
        .filter(Boolean);
}

async function findOpenSubtitles(args) {
    const key = process.env.OPENSUBTITLES_API_KEY;
    if (!key) return [];
    const params = {
        imdb_id: imdbDigits(args.imdbId),
        languages: 'ar,fr,en,pl',
        order_by: 'download_count',
        type: args.isSeries ? (args.season && args.episode ? 'episode' : 'tvshow') : 'movie'
    };
    if (args.isSeries && args.season) params.season_number = String(args.season);
    if (args.isSeries && args.episode) params.episode_number = String(args.episode);
    const url = new URL('https://api.opensubtitles.com/api/v1/subtitles');
    Object.keys(params).sort().forEach((keyName) => url.searchParams.set(keyName, params[keyName]));
    const res = await httpFetch(url.toString(), {
        headers: { 'Api-Key': key, 'User-Agent': OPENSUBTITLES_UA, Accept: 'application/json' },
        timeout: 20000
    });
    if (res.status === 404) return [];
    if (!res.ok) {
        throw Object.assign(new Error('OpenSubtitles.com unavailable'), { status: res.status });
    }
    const json = await res.json();
    const items = Array.isArray(json.data) ? json.data : [];
    return items.slice(0, 30)
        .map((item) => normalizeProviderSubtitle(item, 'opensubtitles', args))
        .filter(Boolean);
}

export function withTimeout(promise, ms, label) {
    let timer = null;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
            reject(Object.assign(new Error('Provider timed out'), { provider: label, code: 'timeout' }));
        }, Math.max(1, Number(ms) || SEARCH_TIMEOUT_MS));
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

const PROVIDER_ADAPTERS = {
    mysubs: findMySubs,
    'subtitles-website': findSubtitlesWebsite,
    subdl: findSubDL,
    wyzie: findWyzie,
    opensubtitles: findOpenSubtitles
};

// "auto" searches every provider concurrently. One slow or failed provider
// never blocks the others; each adapter spends at most one search request.
export async function findSubtitles(args) {
    const options = args || {};
    if (!/^tt\d+$/.test(options.imdbId || '')) {
        return { subtitle: null, results: [], languages: languageCounts([]), providers: [], errors: [] };
    }

    const request = {
        imdbId: String(options.imdbId),
        type: String(options.type || 'movie'),
        title: String(options.title || ''),
        season: numberOrZero(options.season),
        episode: numberOrZero(options.episode),
        isSeries: options.type === 'series' || options.type === 'tv'
    };
    const choice = String(options.provider || 'auto').toLowerCase();
    const selected = choice === 'auto' || !PROVIDER_ADAPTERS[choice]
        ? Object.keys(PROVIDER_ADAPTERS)
        : [choice];
    const key = [request.imdbId, request.isSeries ? 'series' : 'movie', request.season,
        request.episode, request.title, selected.join(',')].join('|');
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;

    const settled = await Promise.all(selected.map(async (provider) => {
        try {
            const results = await withTimeout(PROVIDER_ADAPTERS[provider](request),
                SEARCH_TIMEOUT_MS, provider);
            return { provider: provider, results: Array.isArray(results) ? results : [] };
        } catch (error) {
            return { provider: provider, results: [], error: error };
        }
    }));

    const collected = settled.reduce((all, entry) => all.concat(entry.results), []);
    const ranked = dedupeSubtitles(rankSubtitles(collected, request));
    const value = {
        subtitle: ranked[0] || null,
        results: ranked,
        languages: languageCounts(ranked),
        providers: settled.map((entry) => entry.provider),
        errors: settled.filter((entry) => entry.error)
            .map((entry) => ({ provider: entry.provider, message: 'Subtitle provider unavailable' }))
    };
    if (ranked.length) cache.set(key, { at: Date.now(), value: value });
    return value;
}

export async function findSubtitle(args) {
    const data = await findSubtitles(args || {});
    return data.subtitle || null;
}

export async function findArabicSubtitle(args) {
    return findSubtitle(args || {});
}

function srtToVtt(text) {
    let out = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim() + '\n';
    if (/^WEBVTT/.test(out)) return out;
    out = out.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    out = out.replace(/(^|\n)\d+\n(?=\d{2}:\d{2}:\d{2}\.)/g, '$1');
    return 'WEBVTT\n\n' + out;
}

async function downloadText(url, headers) {
    const res = await httpFetch(url, {
        headers: Object.assign({ 'User-Agent': UA, Accept: '*/*' }, headers || {}),
        timeout: 20000
    });
    if (!res.ok) throw Object.assign(new Error('Subtitle file unavailable'), { status: 502 });
    return res.text();
}

export async function fetchSubtitleFile(directUrl) {
    const allowed = /^https:\/\/(?:www\.)?(?:subtitles\.website\/strapi\/uploads\/|mysubs\.org\/s\/)/i;
    if (!allowed.test(directUrl || '')) {
        throw Object.assign(new Error('Invalid subtitle URL'), { status: 400 });
    }
    const text = await downloadText(directUrl);
    return /\.vtt(\?|$)/i.test(directUrl) ? text : srtToVtt(text);
}

let openSubtitlesAuth = { token: '', baseUrl: 'api.opensubtitles.com', expiresAt: 0, pending: null };

async function openSubtitlesToken() {
    const username = process.env.OPENSUBTITLES_USERNAME;
    const password = process.env.OPENSUBTITLES_PASSWORD;
    if (!username || !password) return openSubtitlesAuth;
    if (openSubtitlesAuth.token && Date.now() < openSubtitlesAuth.expiresAt) return openSubtitlesAuth;
    if (openSubtitlesAuth.pending) return openSubtitlesAuth.pending;

    openSubtitlesAuth.pending = (async () => {
        try {
            const res = await httpFetch('https://api.opensubtitles.com/api/v1/login', {
                method: 'POST',
                headers: {
                    'Api-Key': process.env.OPENSUBTITLES_API_KEY || '',
                    'Content-Type': 'application/json',
                    'User-Agent': OPENSUBTITLES_UA
                },
                body: JSON.stringify({ username: username, password: password }),
                timeout: 20000
            });
            if (!res.ok) return openSubtitlesAuth;
            const json = await res.json();
            openSubtitlesAuth.token = String(json.token || '');
            openSubtitlesAuth.baseUrl = String(json.base_url || 'api.opensubtitles.com');
            openSubtitlesAuth.expiresAt = Date.now() + (23 * 60 * 60 * 1000);
        } catch (e) {
            // Anonymous downloads still work with the API key alone.
        }
        return openSubtitlesAuth;
    })().finally(() => { openSubtitlesAuth.pending = null; });

    return openSubtitlesAuth.pending;
}

async function storedFileText(entry) {
    if (entry.kind === 'direct' || entry.kind === 'wyzie') {
        return downloadText(entry.url);
    }
    if (entry.kind === 'subdl') {
        const key = process.env.SUBDL_API_KEY;
        if (!key) throw Object.assign(new Error('SubDL is not configured'), { status: 503 });
        const url = 'https://api.subdl.com/api/v2/subtitles/' + encodeURIComponent(entry.nId) +
            '/download?format=file';
        const res = await httpFetch(url, {
            headers: { 'Authorization': 'Bearer ' + key, 'User-Agent': UA, Accept: '*/*' },
            timeout: 20000
        });
        if (!res.ok) throw Object.assign(new Error('Subtitle file unavailable'), { status: 502 });
        const type = String(res.headers && res.headers.get ? res.headers.get('content-type') || '' : '');
        if (type.indexOf('json') !== -1) {
            const json = await res.json();
            const link = json.link || json.url;
            if (!link) throw Object.assign(new Error('Subtitle download link unavailable'), { status: 502 });
            return downloadText(link);
        }
        return res.text();
    }
    if (entry.kind === 'opensubtitles') {
        const key = process.env.OPENSUBTITLES_API_KEY;
        if (!key) throw Object.assign(new Error('OpenSubtitles is not configured'), { status: 503 });
        const auth = await openSubtitlesToken();
        const base = /^https?:\/\//.test(auth.baseUrl)
            ? String(auth.baseUrl).replace(/\/$/, '')
            : 'https://' + auth.baseUrl;
        const headers = {
            'Api-Key': key,
            'Content-Type': 'application/json',
            'User-Agent': OPENSUBTITLES_UA
        };
        if (auth.token) headers.Authorization = 'Bearer ' + auth.token;
        const res = await httpFetch(base + '/api/v1/download', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ file_id: Number(entry.fileId) || entry.fileId, sub_format: 'srt' }),
            timeout: 20000
        });
        if (!res.ok) throw Object.assign(new Error('Subtitle file unavailable'), { status: 502 });
        const json = await res.json();
        if (!json.link) throw Object.assign(new Error('Subtitle download link unavailable'), { status: 502 });
        return downloadText(json.link, { 'User-Agent': OPENSUBTITLES_UA });
    }
    throw Object.assign(new Error('Invalid subtitle file'), { status: 400 });
}

export async function fetchStoredSubtitleFile(id) {
    const entry = getStoredFile(id);
    if (!entry) throw Object.assign(new Error('Unknown subtitle file'), { status: 400 });
    const text = await storedFileText(entry);
    return entry.format === 'vtt' || /^WEBVTT/i.test(text) ? text : srtToVtt(text);
}
