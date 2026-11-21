import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import dotenv from 'dotenv';

dotenv.config();

// Personal project: the Febbox session is bundled so no configuration is needed.
// WARNING: this is a real session token committed to a public repository.
const FEBBOX_UI_COOKIE = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3OTUzMDAxNDIsIm5iZiI6MTc5NTMwMDE0MiwiZXhwIjoxODI2NDA0MTYyLCJkYXRhIjp7InVpZCI6NDY4ODQwLCJ0b2tlbiI6Ijk2ZjVkZGJhM2Y2NDM5NzVjODkwODBmNTVlZjY1MjI0In19.hYlteRsTANWskfdzBmNiKBRzXbyojzB058bYHaebGaQ';

export const FEBBOX_AUTH_CONFIGURED = Boolean(FEBBOX_UI_COOKIE);

class FebboxAPI {
    constructor() {
        this.baseUrl = 'https://www.febbox.com';
        this.headers = this._getDefaultHeaders();
        this._setAuthCookie(FEBBOX_UI_COOKIE);
    }

    // Set the auth cookie for requests
    _setAuthCookie(cookie) {
        if (!cookie) {
            return this;
        }

        this.headers.cookie = String(cookie).startsWith('ui=') ? String(cookie) : `ui=${cookie}`;
        return this;
    }

    // Default headers used for all requests
    _getDefaultHeaders() {
        return {
            'x-requested-with': 'XMLHttpRequest',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        };
    }

    // Helper method to create the referer header for each request
    _setReferer(shareKey) {
        this.headers.referer = `${this.baseUrl}/share/${shareKey}`;
    }

    // Fetch JSON data from a URL
    async _fetchJson(url, cookie = null) {
        const headers = {
            ...this.headers,
            ...(cookie ? { cookie: String(cookie).startsWith('ui=') ? String(cookie) : `ui=${cookie}` } : {})
        };

        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(`Error fetching data from ${url}: ${response.statusText}`);

        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            data = null;
        }

        // Febbox replies with a JSON "Please login" payload instead of an HTTP 401.
        if (data && (data.login_required || data.code === -1)) {
            const error = new Error(
                `Febbox login required or session expired${data.msg ? `: ${data.msg}` : ''}. Set a valid FEBBOX_UI_COOKIE.`
            );
            error.status = 401;
            throw error;
        }
        return data === null ? text : data;
    }

    // Get the list of files from a shared folder
    async getFileList(shareKey, parentId = 0 , cookie = null) {
        const url = `${this.baseUrl}/file/file_share_list?share_key=${shareKey}&pwd=&parent_id=${parentId}&is_html=0`;
        this._setReferer(shareKey);

        const data = await this._fetchJson(url , cookie);
        if (!data || !data.data || !Array.isArray(data.data.file_list)) {
            const error = new Error('Febbox returned an invalid file list');
            error.status = 502;
            throw error;
        }
        return data.data.file_list;
    }

    // Get video file qualities and links from a shared video
    async getLinks(shareKey, fid , cookie = null) {
        const url = `${this.baseUrl}/console/video_quality_list?fid=${fid}`;
        this._setReferer(shareKey);

        const data = await this._fetchJson(url, cookie);
        if (!data || typeof data !== 'object' || !data.html) {
            const error = new Error('Febbox returned no quality list HTML for this file');
            error.status = 502;
            throw error;
        }

        // Parse HTML response and extract file qualities
        const dom = new JSDOM(data.html);
        const doc = dom.window.document;
        const links = this._extractFileQualities(doc).filter((link) => Boolean(link.url));

        if (!links.length) {
            const error = new Error(
                'No stream links found on Febbox. The FEBBOX_UI_COOKIE may be missing or expired.'
            );
            error.status = 502;
            throw error;
        }
        return links;
    }

    // Extract file qualities from the parsed DOM
    _extractFileQualities(doc) {
        return Array.from(doc.querySelectorAll('.file_quality')).map(fileDiv => {
            const url = fileDiv.getAttribute('data-url');
            const quality = fileDiv.getAttribute('data-quality');
            const name = fileDiv.querySelector('.name')?.textContent.trim();
            const speed = fileDiv.querySelector('.speed span')?.textContent.trim();
            const size = fileDiv.querySelector('.size')?.textContent.trim();

            return { url, quality, name, speed, size };
        });
    }
}

export default FebboxAPI;
