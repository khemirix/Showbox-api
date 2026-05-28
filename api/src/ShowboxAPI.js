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
        // Try direct API call first (no browser/bypass needed)
        try {
            console.log(`\n🔄 Getting FebBox ID via API for id=${id} type=${type}`);
            const data = await this.request('Film_sharelink', { mid: id, type });
            console.log('Film_sharelink response:', JSON.stringify(data).substring(0, 300));
            if (data && data.data && data.data.link) {
                const link = data.data.link;
                console.log(`✅ Got link from API: ${link}`);
                return link.split('/').pop();
            }
        } catch (e) {
            console.log('Film_sharelink failed, trying fallback:', e.message);
        }

        // Fallback: try ShareLink module
        try {
            const data = await this.request('ShareLink', { mid: id, type });
            console.log('ShareLink response:', JSON.stringify(data).substring(0, 300));
            if (data && data.data && data.data.link) {
                const link = data.data.link;
                console.log(`✅ Got link from ShareLink: ${link}`);
                return link.split('/').pop();
            }
        } catch (e) {
            console.log('ShareLink failed:', e.message);
        }

        // Fallback: try fetching showbox share URL directly (no Cloudflare on API endpoint)
        try {
            const shareUrl = `https://www.showbox.media/index/share_link?id=${id}&type=${type}`;
            console.log(`Trying direct fetch: ${shareUrl}`);
            const response = await fetch(shareUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Referer': 'https://www.showbox.media/',
                }
            });
            const text = await response.text();
            console.log('Direct fetch response:', text.substring(0, 300));

            try {
                const data = JSON.parse(text);
                if (data && data.data && data.data.link) {
                    const link = data.data.link;
                    console.log(`✅ Got link from direct fetch: ${link}`);
                    return link.split('/').pop();
                }
            } catch (e) {
                // Try regex on raw text
                const match = text.match(/febbox\.com\/share\/([a-zA-Z0-9_-]+)/);
                if (match) {
                    console.log(`✅ Got share key from regex: ${match[1]}`);
                    return match[1];
                }
            }
        } catch (e) {
            console.log('Direct fetch failed:', e.message);
        }

        console.error('All methods failed to get FebBox ID');
        return null;
    }

    async getAutocomplete(keyword, pagelimit = 5) {
        return this.request('Autocomplate2', { keyword, pagelimit: pagelimit }).then(data => {
            return data.data;
        });
    }
}

export default ShowboxAPI;
