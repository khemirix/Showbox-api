import fetch from 'node-fetch';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BASE = 'https://subtitles.website/strapi';
const CACHE_TTL = 6 * 60 * 60 * 1000;
const cache = new Map();

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
        format: (format || 'srt').toLowerCase(),
        // Relative on purpose: the browser prepends the Showbox API origin.
        url: '/api/subtitles/file?url=' + encodeURIComponent(directUrl)
    };
}

// MySubs has precise season/episode filtering and a generous rate limit.
async function findMySubs({ imdbId, isSeries, season, episode }) {
    const url = new URL('https://www.mysubs.org/api/v1/titles/' + encodeURIComponent(imdbId) + '/subtitles');
    url.searchParams.set('lang', 'ar');
    if (isSeries && season && episode) {
        url.searchParams.set('season', String(season));
        url.searchParams.set('episode', String(episode));
    }
    try {
        const res = await fetch(url.toString(), {
            headers: { 'User-Agent': UA, Accept: 'application/json' },
            timeout: 20000
        });
        if (!res.ok) return null;
        const json = await res.json();
        const items = Array.isArray(json.data) ? json.data : [];
        const pick = items.find(function(x) { return x.urls && x.urls.vtt; }) ||
                     items.find(function(x) { return x.urls && x.urls.srt; });
        if (!pick) return null;
        const directUrl = pick.urls.vtt || pick.urls.srt;
        return asSubtitle(pick.id, pick.file && pick.file.name,
            directUrl.endsWith('.vtt') ? 'vtt' : 'srt', directUrl);
    } catch (e) {
        return null;
    }
}

// Fallback with broad Arabic coverage (guest access, cached for 6 hours).
async function findSubtitlesWebsite({ imdbId, isSeries, season, episode }) {
    const url = new URL(BASE + '/api/search/subtitles');
    url.searchParams.set('imdb', imdbId);
    url.searchParams.set('language', 'ar');
    if (isSeries && season && episode) {
        url.searchParams.set('season', String(season));
        url.searchParams.set('episode', String(episode));
    }

    let items = [];
    try {
        const res = await fetch(url.toString(), {
            headers: { 'User-Agent': UA, Accept: 'application/json' },
            timeout: 20000
        });
        if (!res.ok) return null;
        const json = await res.json();
        items = Array.isArray(json.data) ? json.data : [];
    } catch (e) {
        return null;
    }

    // Keep only subtitles for the exact requested episode.
    if (isSeries && season && episode) {
        items = items.filter(function(item) {
            return episodeMatch(item.release || item.name || '', season, episode);
        });
    }

    // Prefer VTT (native WebVTT), then SRT (converted by the file proxy).
    items.sort(function(a, b) {
        const rank = function(x) { return (x.format || '').toLowerCase() === 'vtt' ? 0 : 1; };
        return rank(a) - rank(b) || (b.downloads || 0) - (a.downloads || 0);
    });

    const pick = items[0];
    if (!pick || !pick.download_url) return null;
    const directUrl = pick.download_url.startsWith('http')
        ? pick.download_url
        : BASE + pick.download_url;
    return asSubtitle(pick.id, pick.release || pick.film_title,
        pick.format || 'srt', directUrl);
}

export async function findArabicSubtitle({ imdbId, type, season, episode }) {
    if (!/^tt\d+$/.test(imdbId || '')) return null;

    const isSeries = type === 'series' || type === 'tv';
    const key = [imdbId, isSeries ? 'series' : 'movie', season || '', episode || ''].join('|');
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;

    const args = { imdbId: imdbId, isSeries: isSeries, season: season, episode: episode };
    let value = await findMySubs(args);
    if (!value) value = await findSubtitlesWebsite(args);

    if (value) cache.set(key, { at: Date.now(), value: value });
    return value;
}

function srtToVtt(text) {
    let out = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim() + '\n';
    if (/^WEBVTT/.test(out)) return out;
    out = out.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    out = out.replace(/(^|\n)\d+\n(?=\d{2}:\d{2}:\d{2}\.)/g, '$1');
    return 'WEBVTT\n\n' + out;
}

export async function fetchSubtitleFile(directUrl) {
    const allowed = /^https:\/\/(?:www\.)?(?:subtitles\.website\/strapi\/uploads\/|mysubs\.org\/s\/)/i;
    if (!allowed.test(directUrl || '')) {
        throw Object.assign(new Error('Invalid subtitle URL'), { status: 400 });
    }
    const res = await fetch(directUrl, {
        headers: { 'User-Agent': UA, Accept: '*/*' },
        timeout: 20000
    });
    if (!res.ok) throw Object.assign(new Error('Subtitle file unavailable'), { status: 502 });
    const text = await res.text();
    return /\.vtt(\?|$)/i.test(directUrl) ? text : srtToVtt(text);
}
