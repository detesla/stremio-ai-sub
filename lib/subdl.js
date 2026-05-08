const axios = require('axios');

async function searchSubtitles(imdbId, season, episode, apiKey) {
    try {
        console.log(`[SubDL] Searching subtitles for ${imdbId}...`);
        const response = await axios.get(`https://api.subdl.com/api/v1/subtitles`, {
            params: {
                api_key: apiKey,
                imdb_id: imdbId,
                languages: 'en',
                season: season,
                episode: episode
            },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Stremio-AI-Sub)'
            }
        });

        if (response.data.status && response.data.subtitles.length > 0) {
            return response.data.subtitles;
        }
        return [];
    } catch (error) {
        console.error('[SubDL] Error searching subtitles:', error.message);
        return [];
    }
}

async function downloadSubtitle(url) {
    try {
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error('[SubDL] Error downloading subtitle:', error.message);
        return null;
    }
}

module.exports = {
    searchSubtitles,
    downloadSubtitle
};
