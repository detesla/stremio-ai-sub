const axios = require('axios');

const OPENSUBTITLES_API_URL = 'https://api.opensubtitles.com/api/v1';

async function searchSubtitles(imdbId, season, episode, apiKey) {
    try {
        let params = {
            languages: 'en',
            order_by: 'download_count',
            order_direction: 'desc'
        };

        if (season && episode) {
            params.parent_imdb_id = imdbId.replace('tt', '');
            params.season_number = season;
            params.episode_number = episode;
        } else {
            params.imdb_id = imdbId.replace('tt', '');
        }

        const response = await axios.get(`${OPENSUBTITLES_API_URL}/subtitles`, {
            params,
            headers: {
                'Api-Key': apiKey,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        return response.data.data;
    } catch (error) {
        console.error('Error searching OpenSubtitles:', error.response?.data || error.message);
        return [];
    }
}

async function login(username, password, apiKey) {
    try {
        const response = await axios.post(`${OPENSUBTITLES_API_URL}/login`, {
            username,
            password
        }, {
            headers: {
                'Api-Key': apiKey,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        if (response.data.token) {
            console.log('[OpenSubs] Login successful!');
        }
        return response.data.token;
    } catch (error) {
        console.error('Error logging in to OpenSubtitles:', error.response?.data || error.message);
        return null;
    }
}

async function getDownloadLink(fileId, token, apiKey) {
    try {
        console.log(`[OpenSubs] Requesting download for file_id: ${fileId}...`);
        const response = await axios.post(`${OPENSUBTITLES_API_URL}/download`, 
            { file_id: fileId },
            {
                headers: {
                    'Authorization': token, // OpenSubtitles uses token directly without 'Bearer'
                    'Api-Key': apiKey,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }
        );
        return response.data.link;
    } catch (error) {
        console.error('[OpenSubs] Error getting download link:', error.response?.data || error.message);
        return null;
    }
}

async function downloadSubtitle(url) {
    try {
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error('Error downloading subtitle content:', error.message);
        return null;
    }
}

module.exports = {
    searchSubtitles,
    login,
    getDownloadLink,
    downloadSubtitle
};
