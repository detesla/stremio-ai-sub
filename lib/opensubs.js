const axios = require('axios');

async function searchSubtitles(imdbId, season, episode) {
    try {
        console.log(`[Proxy] Searching subtitles via Stremio Proxy for ${imdbId}...`);
        
        // Use Stremio's official OpenSubtitles proxy which is very stable
        const type = (season && episode) ? 'series' : 'movie';
        const url = `https://opensubtitles-v3.strem.io/subtitles/${type}/${imdbId}.json`;
        
        const response = await axios.get(url);
        
        if (response.data && response.data.subtitles) {
            // Filter only English subtitles to translate
            const englishSubs = response.data.subtitles.filter(s => s.lang === 'eng');
            console.log(`[Proxy] Found ${englishSubs.length} English subtitles.`);
            return englishSubs;
        }
        return [];
    } catch (error) {
        console.error('[Proxy] Error searching subtitles:', error.message);
        return [];
    }
}

// In this version, the proxy already gives us the direct download URL
async function getDownloadLink(sub) {
    return sub.url;
}

async function downloadSubtitle(url) {
    try {
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error('[Proxy] Error downloading subtitle:', error.message);
        return null;
    }
}

// Keep login for backward compatibility but we don't strictly need it now
async function login() {
    return "proxy_token";
}

module.exports = {
    searchSubtitles,
    getDownloadLink,
    downloadSubtitle,
    login
};
