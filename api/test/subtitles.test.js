import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUBDL_API_KEY = 'test-subdl-key';
process.env.WYZIE_SUBS_API_KEY = 'test-wyzie-key';
process.env.OPENSUBTITLES_API_KEY = 'test-opensubtitles-key';
process.env.OPENSUBTITLES_USERNAME = 'test-user';
process.env.OPENSUBTITLES_PASSWORD = 'test-password';

const {
    findSubtitles,
    fetchSubtitleFile,
    fetchStoredSubtitleFile,
    languageCounts,
    bestForLanguage,
    withTimeout,
    setHttpFetchForTests
} = await import('../src/SubtitlesAPI.js');

function response(options = {}) {
    const { status = 200, json = null, text = '', contentType = 'application/json' } = options;
    return {
        ok: status >= 200 && status < 300,
        status: status,
        headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
        json: async () => json,
        text: async () => text
    };
}

function tokenFromUrl(url) {
    const match = String(url || '').match(/[?&]id=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

function srt() {
    return '1\n00:00:01,000 --> 00:00:02,000\nMerci\n\n';
}

async function withFetch(fn, run) {
    setHttpFetchForTests(fn);
    try {
        return await run();
    } finally {
        setHttpFetchForTests(null);
    }
}

test('SubDL adapter uses the official v2 API and normalizes one result per search', async () => {
    let request = null;
    const data = await withFetch(async (url, options) => {
        request = { url: new URL(url), options };
        assert.equal(options.headers.Authorization, 'Bearer test-subdl-key');
        return response({ json: { subtitles: [
            { n_id: 'sdl-fr', lang: 'fr', release: 'Dune.FRENCH.1080p', downloads: 500 },
            { n_id: 'sdl-de', lang: 'de', release: 'Dune.GERMAN.1080p', downloads: 900 }
        ] } });
    }, () => findSubtitles({
        imdbId: 'tt15239678', type: 'movie', title: 'Dune', provider: 'subdl'
    }));

    assert.equal(request.url.pathname, '/api/v2/subtitles/search');
    assert.equal(request.url.searchParams.get('imdb_id'), 'tt15239678');
    assert.equal(request.url.searchParams.get('languages'), 'ar,fr,en,pl');
    assert.equal(request.url.searchParams.get('type'), 'movie');
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].providerLabel, 'SubDL');
    assert.equal(data.results[0].lang, 'fr');
    assert.match(data.results[0].url, /^\/api\/subtitles\/file\?id=/);
    assert.ok(!data.results[0].url.includes('api_key'));
});

test('Wyzie adapter passes its key server-side and hides the signed download URL', async () => {
    let request = null;
    const data = await withFetch(async (url) => {
        request = new URL(url);
        return response({ json: [
            { id: 'wz-en', language: 'en', release: 'Dune.ENGLISH.1080p',
              url: 'https://sub.wyzie.io/c/abc/id/wz-en?tok=secret&lang=en', downloadCount: 1200 }
        ] });
    }, () => findSubtitles({
        imdbId: 'tt15239679', type: 'movie', title: 'Dune', provider: 'wyzie'
    }));

    assert.equal(request.hostname, 'sub.wyzie.io');
    assert.equal(request.searchParams.get('key'), 'test-wyzie-key');
    assert.equal(request.searchParams.get('language'), 'ar,fr,en,pl');
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].providerLabel, 'Wyzie Subs');
    assert.match(data.results[0].url, /^\/api\/subtitles\/file\?id=/);
    assert.ok(!data.results[0].url.includes('tok='));
});

test('OpenSubtitles.com adapter searches with Api-Key and exposes only an opaque result id', async () => {
    let request = null;
    const data = await withFetch(async (url, options) => {
        request = { url: new URL(url), options };
        assert.equal(options.headers['Api-Key'], 'test-opensubtitles-key');
        return response({ json: { data: [{ attributes: {
            language: 'pl',
            release: 'Dune.POLISH.1080p',
            download_count: 700,
            feature_details: { imdb_id: 'tt1523980', title: 'Dune' },
            files: [{ file_id: 77 }]
        } }] } });
    }, () => findSubtitles({
        imdbId: 'tt1523980', type: 'movie', title: 'Dune', provider: 'opensubtitles'
    }));

    assert.equal(request.url.pathname, '/api/v1/subtitles');
    assert.equal(request.url.searchParams.get('imdb_id'), '1523980');
    assert.equal(request.url.searchParams.get('languages'), 'ar,fr,en,pl');
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].providerLabel, 'OpenSubtitles.com');
    assert.equal(data.results[0].id, 'opensubtitles:77');
    assert.match(data.results[0].url, /^\/api\/subtitles\/file\?id=/);
    assert.ok(!data.results[0].url.includes('test-opensubtitles-key'));
});

test('combined Auto search collects all providers, filters languages, and keeps provider names', async () => {
    const data = await withFetch(async (url) => {
        const value = String(url);
        if (value.includes('mysubs.org')) {
            return response({ json: { data: [{
                id: 'my-1', file: { name: 'Dune.MYSUBS.ar.srt' },
                urls: { srt: 'https://www.mysubs.org/s/my-1.srt' }
            }] } });
        }
        if (value.includes('subtitles.website')) {
            return response({ json: { data: [{
                id: 'sw-1', release: 'Dune.WEBSITE.ar.srt', format: 'srt', downloads: 10,
                download_url: 'https://subtitles.website/strapi/uploads/sw-1.srt'
            }] } });
        }
        if (value.includes('api.subdl.com')) {
            return response({ json: { subtitles: [
                { n_id: 'sdl-ar', lang: 'ara', release: 'Dune.SUBDL.ar', downloads: 100 },
                { n_id: 'sdl-fr', lang: 'fre', release: 'Dune.SUBDL.fr', downloads: 200 },
                { n_id: 'sdl-de', lang: 'deu', release: 'Dune.SUBDL.de', downloads: 300 }
            ] } });
        }
        if (value.includes('sub.wyzie.io')) {
            return response({ json: [
                { id: 'wz-en', language: 'eng', release: 'Dune.WYZIE.en',
                  url: 'https://sub.wyzie.io/c/wz-en?tok=secret', downloadCount: 400 }
            ] });
        }
        if (value.includes('api.opensubtitles.com')) {
            return response({ json: { data: [{ attributes: {
                language: 'pol', release: 'Dune.OPENSUBTITLES.pl', download_count: 500,
                files: [{ file_id: 81 }]
            } }] } });
        }
        throw new Error('Unexpected provider URL: ' + value);
    }, () => findSubtitles({
        imdbId: 'tt1523981', type: 'movie', title: 'Dune', provider: 'auto'
    }));

    assert.equal(data.providers.length, 5);
    assert.deepEqual(data.providers,
        ['mysubs', 'subtitles-website', 'subdl', 'wyzie', 'opensubtitles']);
    const names = data.results.map((result) => result.providerLabel);
    ['MySubs', 'subtitles.website', 'SubDL', 'Wyzie Subs', 'OpenSubtitles.com']
        .forEach((name) => assert.ok(names.includes(name), 'missing provider ' + name));
    assert.deepEqual(data.languages.map((lang) => lang.code), ['ar', 'fr', 'en', 'pl']);
    assert.ok(!data.results.some((result) => result.lang === 'de'));
    assert.deepEqual(data.errors, []);
});

test('all four language filters return only the best three ranked results', async () => {
    const data = await withFetch(async (url) => {
        if (String(url).includes('api.subdl.com')) {
            return response({ json: { subtitles: [
                { n_id: 's-fr-1', lang: 'fr', release: 'Movie.FR.one', downloads: 10 },
                { n_id: 's-fr-2', lang: 'fr', release: 'Movie.FR.two', downloads: 20 },
                { n_id: 's-fr-3', lang: 'fr', release: 'Movie.FR.three', downloads: 30 },
                { n_id: 's-en-1', lang: 'en', release: 'Movie.EN.one', downloads: 40 },
                { n_id: 's-pl-1', lang: 'pl', release: 'Movie.PL.one', downloads: 50 },
                { n_id: 's-xx-1', lang: 'es', release: 'Movie.ES.one', downloads: 99 }
            ] } });
        }
        return response({ status: 404, json: {} });
    }, () => findSubtitles({
        imdbId: 'tt1523982', type: 'movie', title: 'Movie', provider: 'subdl'
    }));

    assert.deepEqual(data.languages.map((lang) => lang.code), ['ar', 'fr', 'en', 'pl']);
    assert.equal(data.languages.find((lang) => lang.code === 'fr').count, 3);
    const topThree = bestForLanguage(data.results, 'fr', 3);
    assert.equal(topThree.length, 3);
    assert.ok(topThree[0].score >= topThree[1].score);
    assert.ok(topThree[1].score >= topThree[2].score);
    assert.equal(languageCounts(data.results).find((lang) => lang.code === 'ar').count, 0);
    assert.equal(bestForLanguage(data.results, 'es', 3).length, 0);
});

test('duplicate subtitles are removed before ranking', async () => {
    const data = await withFetch(async (url) => {
        if (String(url).includes('api.subdl.com')) {
            return response({ json: { subtitles: [
                { n_id: 'dup-a', lang: 'en', release: 'Same.Movie.2024.1080p', downloads: 5 }
            ] } });
        }
        if (String(url).includes('sub.wyzie.io')) {
            return response({ json: [
                { id: 'dup-b', lang: 'en', release: 'Same Movie 2024 1080p',
                  url: 'https://sub.wyzie.io/c/dup-b?tok=secret', downloadCount: 5000 }
            ] });
        }
        return response({ status: 404, json: {} });
    }, () => findSubtitles({
        imdbId: 'tt1523983', type: 'movie', title: 'Same Movie', provider: 'auto'
    }));

    const english = data.results.filter((result) => result.lang === 'en');
    assert.equal(english.length, 1);
    assert.equal(english[0].providerLabel, 'Wyzie Subs');
});

test('provider failures and timeouts do not block the other providers', async () => {
    const data = await withFetch(async (url) => {
        const value = String(url);
        if (value.includes('mysubs.org') || value.includes('api.subdl.com')) {
            throw new Error('simulated failure');
        }
        if (value.includes('subtitles.website')) {
            return response({ json: { data: [{
                id: 'ok-1', release: 'Movie.WEBSITE.ar', format: 'srt',
                download_url: 'https://subtitles.website/strapi/uploads/ok-1.srt'
            }] } });
        }
        if (value.includes('sub.wyzie.io')) {
            return response({ json: [
                { id: 'ok-2', language: 'en', release: 'Movie.WYZIE.en',
                  url: 'https://sub.wyzie.io/c/ok-2?tok=secret' }
            ] });
        }
        return response({ status: 404, json: {} });
    }, () => findSubtitles({
        imdbId: 'tt1523984', type: 'movie', title: 'Movie', provider: 'auto'
    }));

    assert.ok(data.results.length >= 2);
    assert.equal(data.errors.length, 2);
    assert.deepEqual(data.errors.map((error) => error.provider).sort(),
        ['mysubs', 'subdl']);
    await assert.rejects(
        withTimeout(new Promise(() => {}), 10, 'slow-provider'),
        /timed out/
    );
});

test('movie and series searches send the right season and episode parameters', async () => {
    const requests = [];
    await withFetch(async (url) => {
        const parsed = new URL(url);
        requests.push(parsed);
        return response({ json: { subtitles: [] } });
    }, async () => {
        await findSubtitles({ imdbId: 'tt1523985', type: 'movie', provider: 'subdl' });
        await findSubtitles({ imdbId: 'tt1523986', type: 'tv', season: 2, episode: 5, provider: 'wyzie' });
        await findSubtitles({ imdbId: 'tt1523987', type: 'tv', season: 3, episode: 7, provider: 'opensubtitles' });
    });

    assert.equal(requests[0].searchParams.get('type'), 'movie');
    assert.equal(requests[0].searchParams.get('season'), null);
    assert.equal(requests[1].searchParams.get('season'), '2');
    assert.equal(requests[1].searchParams.get('episode'), '5');
    assert.equal(requests[2].searchParams.get('type'), 'episode');
    assert.equal(requests[2].searchParams.get('season_number'), '3');
    assert.equal(requests[2].searchParams.get('episode_number'), '7');
});

test('new-provider downloads are proxied as WebVTT with keys kept server-side', async () => {
    const calls = [];
    const vtt = await withFetch(async (url, options) => {
        const value = String(url);
        calls.push({ url: value, options });
        if (value.includes('sub.wyzie.io/search')) {
            return response({ json: [
                { id: 'dl-1', language: 'fr', release: 'Download.FR',
                  url: 'https://sub.wyzie.io/c/dl-1?tok=secret' }
            ] });
        }
        if (value.includes('sub.wyzie.io/c/')) {
            assert.ok(value.includes('to=vtt'));
            return response({
                text: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nMerci\n',
                contentType: 'text/vtt'
            });
        }
        throw new Error('Unexpected URL: ' + value);
    }, async () => {
        const data = await findSubtitles({
            imdbId: 'tt1523988', type: 'movie', title: 'Download', provider: 'wyzie'
        });
        const id = tokenFromUrl(data.results[0].url);
        assert.ok(id);
        assert.ok(!data.results[0].url.includes('test-wyzie-key'));
        return fetchStoredSubtitleFile(id);
    });

    assert.match(vtt, /^WEBVTT/);
    assert.match(vtt, /00:00:01\.000/);
    assert.ok(calls.some((call) => call.url.includes('sub.wyzie.io/search')));
});

test('OpenSubtitles download uses the login token only on the API server', async () => {
    const calls = [];
    setHttpFetchForTests(async (url, options) => {
        const value = String(url);
        calls.push({ url: value, options });
        if (value.includes('/api/v1/subtitles?')) {
            return response({ json: { data: [{ attributes: {
                language: 'en', release: 'OS.Download.EN', download_count: 12,
                files: [{ file_id: 123 }]
            } }] } });
        }
        if (value.includes('/api/v1/login')) {
            return response({ json: { token: 'server-only-token', base_url: 'api.opensubtitles.com' } });
        }
        if (value.includes('/api/v1/download')) {
            assert.equal(options.headers.Authorization, 'Bearer server-only-token');
            assert.deepEqual(JSON.parse(options.body), { file_id: 123, sub_format: 'srt' });
            return response({ json: {
                link: 'https://dl.opensubtitles.example/os-123.srt', file_name: 'os-123.srt'
            } });
        }
        if (value.includes('dl.opensubtitles.example')) {
            return response({ text: srt(), contentType: 'text/plain' });
        }
        throw new Error('Unexpected URL: ' + value);
    });
    try {
        const data = await findSubtitles({
            imdbId: 'tt1523989', type: 'movie', title: 'OS Download', provider: 'opensubtitles'
        });
        const id = tokenFromUrl(data.results[0].url);
        const vtt = await fetchStoredSubtitleFile(id);
        assert.match(vtt, /^WEBVTT/);
        assert.ok(!data.results[0].url.includes('server-only-token'));
    } finally {
        setHttpFetchForTests(null);
    }
});

test('legacy MySubs and subtitles.website file proxy still converts SRT to WebVTT', async () => {
    await withFetch(async () => response({ text: srt(), contentType: 'text/plain' }), async () => {
        const fromMySubs = await fetchSubtitleFile('https://www.mysubs.org/s/legacy.srt');
        const fromWebsite = await fetchSubtitleFile(
            'https://subtitles.website/strapi/uploads/legacy.srt'
        );
        assert.match(fromMySubs, /^WEBVTT/);
        assert.match(fromWebsite, /^WEBVTT/);
        assert.match(fromMySubs, /00:00:01\.000/);
    });
    await assert.rejects(
        fetchSubtitleFile('https://evil.example/subtitle.srt'),
        /Invalid subtitle URL/
    );
});
