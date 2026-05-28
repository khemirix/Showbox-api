import express from 'express';
import cors from 'cors';
import ShowboxAPI from './ShowboxAPI.js';
import FebboxAPI from './FebBoxApi.js';
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

app.get('/', (req, res) => {
    res.send('Showbox and Febbox API is working!');
});

app.get('/api/autocomplete', async (req, res) => {
    const { keyword, pagelimit } = req.query;
    try {
        const results = await showboxAPI.getAutocomplete(keyword, pagelimit);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/search', async (req, res) => {
    const { type = 'all', title, page = 1, pagelimit = 20 } = req.query;
    try {
        const results = await showboxAPI.search(title, type, page, pagelimit);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/movie/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const movieDetails = await showboxAPI.getMovieDetails(id);
        res.json(movieDetails);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/show/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const showDetails = await showboxAPI.getShowDetails(id);
        res.json(showDetails);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/febbox/id', async (req, res) => {
    const { id, type } = req.query;
    try {
        const febBoxId = await showboxAPI.getFebBoxId(id, type);
        res.json({ febBoxId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/febbox/files', async (req, res) => {
    const { shareKey, parent_id = 0 } = req.query;
    const cookie = req.headers['x-auth-cookie'] || null;
    try {
        const files = await febboxAPI.getFileList(shareKey, parent_id, cookie);
        res.json(files);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/febbox/links', async (req, res) => {
    const { shareKey, fid } = req.query;
    const cookie = req.headers['x-auth-cookie'] || null;
    try {
        const links = await febboxAPI.getLinks(shareKey, fid, cookie);
        res.json(links);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
