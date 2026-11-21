import express from 'express';
import cors from 'cors';
import ShowboxAPI from './ShowboxAPI.js';
import FebboxAPI, { FEBBOX_AUTH_CONFIGURED } from './FebBoxApi.js';
import { findArabicSubtitle, fetchSubtitleFile } from './SubtitlesAPI.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || process.env.API_PORT || 3000;

// Enable CORS for all origins
app.use(cors());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());

const showboxAPI = new ShowboxAPI();
const febboxAPI = new FebboxAPI();

function sendError(res, error) {
    const status = error && error.status ? error.status : 500;
    res.status(status).json({ error: (error && error.message) || 'Unknown error' });
}

app.get('/', (req, res) => {
    res.send('Showbox and Febbox API is working!');
});

// Lets clients detect a missing/expired Febbox session without leaking the cookie.
app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        febboxAuthConfigured: FEBBOX_AUTH_CONFIGURED
    });
});

// Arabic subtitles: search by IMDb id and serve a CORS-safe WebVTT file.
app.get('/api/subtitles/search', async (req, res) => {
    const { imdb, type, season, episode } = req.query;
    try {
        const subtitle = await findArabicSubtitle({ imdbId: imdb, type, season, episode });
        res.json({ subtitle: subtitle });
    } catch (error) {
        sendError(res, error);
    }
});

app.get('/api/subtitles/file', async (req, res) => {
    try {
        const vtt = await fetchSubtitleFile(req.query.url);
        res.set('Content-Type', 'text/vtt; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(vtt);
    } catch (error) {
        sendError(res, error);
    }
});

app.get('/api/autocomplete', async (req, res) => {
    const { keyword, pagelimit } = req.query;
    try {
        const results = await showboxAPI.getAutocomplete(keyword, pagelimit);
        res.json(results);
    } catch (error) {
        sendError(res, error);
    }
});

app.get('/api/search', async (req, res) => {
    const { type = 'all', title, page = 1, pagelimit = 20 } = req.query;
    try {
        const results = await showboxAPI.search(title, type, page, pagelimit);
        res.json(results);
    } catch (error) {
        sendError(res, error);
    }
});

app.get('/api/movie/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const movieDetails = await showboxAPI.getMovieDetails(id);
        res.json(movieDetails);
    } catch (error) {
        sendError(res, error);
    }
});

app.get('/api/show/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const showDetails = await showboxAPI.getShowDetails(id);
        res.json(showDetails);
    } catch (error) {
        sendError(res, error);
    }
});

app.get('/api/febbox/id', async (req, res) => {
    const { id, type } = req.query;
    try {
        const febBoxId = await showboxAPI.getFebBoxId(id, type);
        res.json({ febBoxId });
    } catch (error) {
        sendError(res, error);
    }
});

app.get('/api/febbox/files', async (req, res) => {
    const { shareKey, parent_id = 0 } = req.query;
    try {
        const files = await febboxAPI.getFileList(shareKey, parent_id);
        res.json(files);
    } catch (error) {
        sendError(res, error);
    }
});

app.get('/api/febbox/links', async (req, res) => {
    const { shareKey, fid } = req.query;
    try {
        const links = await febboxAPI.getLinks(shareKey, fid);
        res.json(links);
    } catch (error) {
        sendError(res, error);
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    if (!FEBBOX_AUTH_CONFIGURED) {
        console.warn('WARNING: no Febbox session configured — /api/febbox/links will return no results.');
    }
});
