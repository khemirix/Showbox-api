import CryptoJS from 'crypto-js';
import { customAlphabet } from 'nanoid';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const CONFIG = {
    BASE_URL: 'https://mbpapi.shegu.net/api/api_client/index/',
    APP_KEY: 'moviebox',
    APP_ID: 'com.tdo.showbox',
    IV: 'wEiphTn!',
    KEY: '123d6cedf626dy54233aa1w6',
    DEFAULTS: {
        CHILD_MODE: process.env.CHILD_MODE || '0',
        APP_VERSION: '11.5',
        LANG: 'en',
        PLATFORM: 'android',
        CHANNEL: 'Website',
        APPID: '27',
        VERSION: '129',
        MEDIUM: 'Website',
    },
};

const nanoid = customAlphabet('0123456789abcdef', 32);

class ShowboxAPI {
    constructor() {
        this.baseUrl = CONFIG.BASE_URL;
    }

    encrypt(data) {
        return CryptoJS.TripleDES.encrypt(
            data,
            CryptoJS.enc.Utf8.parse(CONFIG.KEY),
            { iv: CryptoJS.enc.Utf8.parse(CONFIG.IV) }
        ).toString();
    }

    generateVerify(encryptedData) {
        return CryptoJS.MD5(
            CryptoJS.MD5(CONFIG.APP_KEY).toString() + CONFIG.KEY + encryptedData
        ).toString();
    }

    getExpiryTimestamp() {
        return Math.floor(Date.now() / 1000 + 60 * 60 * 12);
    }

    async request(module, params = {}) {
        const requestData = {
            ...CONFIG.DEFAULTS,
            expired_date: this.getExpiryTimestamp(),
            module,
            ...params,
        };

        const encryptedData = this.encrypt(JSON.stringify(requestData));
        const body = JSON.stringify({
            app_key: CryptoJS.MD5(CONFIG.APP_KEY).toString(),
            verify: this.generateVerify(encryptedData),
            encrypt_data: encryptedData,
        });

        const formData = new URLSearchParams({
            data: Buffer.from(body).toString('base64'),
            appid: CONFIG.DEFAULTS.APPID,
            platform: CONFIG.DEFAULTS.PLATFORM,
            version: CONFIG.DEFAULTS.VERSION,
            medium: CONFIG.DEFAULTS.MEDIUM,
        });

        const response = await fetch(this.baseUrl, {
            method: 'POST',
            headers: {
                'Platform': CONFIG.DEFAULTS.PLATFORM,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'okhttp/3.2.0',
            },
            body: `${formData.toString()}&token${nanoid()}`,
        });

        return response.json();
    }

    async search(title, type = 'all', page = 1, pagelimit = 20) {
        return this.request('Search5', { page, type, keyword: title, pagelimit }).then(data => {
            return data.data;
        });
    }

    async getMovieDetails(movieId) {
        return this.request('Movie_detail', { mid: movieId }).then(data => {
            return data.data;
        });
    }

    async getShowDetails(showId) {
        return this.request('TV_detail_v2', { tid: showId }).then(data => {
            return data.data;
        });
    }

    async getFebBoxId(id, type) {
        const targetUrl = `https://www.showbox.media/index/share_link?id=${id}&type=${type}`;
        const bypassBaseUrl = process.env.BYPASS_URL || 'http://localhost:8000';
        const bypassUrl = `${bypassBaseUrl}/html?url=${encodeURIComponent(targetUrl)}`;

        console.log(`\n🔄 Bypassing Cloudflare for: ${targetUrl}`);
        console.log(`🔗 Bypass URL: ${bypassUrl}`);

        try {
            const response = await fetch(bypassUrl, { timeout: 60000 });

            if (!response.ok) {
                console.error(`Bypass server returned error: ${response.status} ${response.statusText}`);
                return null;
            }

            const rawText = await response.text();
            console.log(`📄 Raw response (first 500 chars): ${rawText.substring(0, 500)}`);

            // Strategy 1: try to parse as JSON directly
            try {
                const data = JSON.parse(rawText);
                if (data && data.data && data.data.link) {
                    const link = data.data.link;
                    console.log(`✅ Got link from JSON: ${link}`);
                    return link.split('/').pop();
                }
            } catch (e) {
                console.log('Response is not JSON, trying HTML extraction...');
            }

            // Strategy 2: extract from HTML - look for febbox.com share link
            const febboxPatterns = [
                /febbox\.com\/share\/([a-zA-Z0-9_-]+)/,
                /href=["']https?:\/\/[^"']*febbox\.com\/share\/([a-zA-Z0-9_-]+)/,
                /"link"\s*:\s*"([^"]*febbox\.com[^"]*)"/,
                /window\.location\s*=\s*["']([^"']*febbox[^"']*)["']/,
                /share_key['":\s]+['"]([a-zA-Z0-9_-]+)['"]/,
            ];

            for (const pattern of febboxPatterns) {
                const match = rawText.match(pattern);
                if (match) {
                    console.log(`✅ Got link from HTML pattern: ${match[0]}`);
                    // Return share key or full URL last segment
                    return match[1].split('/').pop();
                }
            }

            // Strategy 3: look for any redirect or meta refresh URL
            const metaRefresh = rawText.match(/content=["'][0-9]+;\s*url=([^"']+)["']/i);
            if (metaRefresh) {
                const redirectUrl = metaRefresh[1];
                console.log(`✅ Got redirect URL: ${redirectUrl}`);
                if (redirectUrl.includes('febbox')) {
                    return redirectUrl.split('/').pop();
                }
            }

            console.error('Could not extract Febbox ID from response');
            console.error('Full response:', rawText.substring(0, 1000));
            return null;

        } catch (error) {
            console.error('Error during bypass request:', error.message);
            return null;
        }
    }

    async getAutocomplete(keyword, pagelimit = 5) {
        return this.request('Autocomplate2', { keyword, pagelimit: pagelimit }).then(data => {
            return data.data;
        });
    }
}

export default ShowboxAPI;
