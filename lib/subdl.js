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

        if (response.data && response.data.status && response.data.subtitles) {
            console.log(`[SubDL] Found ${response.data.subtitles.length} subtitles.`);
            if (response.data.subtitles.length > 0) {
                console.log(`[SubDL Debug] First sub object:`, JSON.stringify(response.data.subtitles[0], null, 2));
            }
            // Transform to our common format
            return response.data.subtitles.map(sub => ({
                url: sub.url || sub.link || sub.download_url || `https://subdl.com/s/subtitle/${sub.subs_id}`,
                lang: sub.lang || 'en'
            }));
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
