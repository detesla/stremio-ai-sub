const axios = require('axios');
const AdmZip = require('adm-zip');

async function searchSubtitles(imdbId, season, episode, apiKey, title = null) {
    try {
        if (title) {
            console.log(`[SubDL] Searching subtitles for title: ${title}...`);
        } else {
            console.log(`[SubDL] Searching subtitles for ID: ${imdbId}...`);
        }
        
        const params = {
            api_key: apiKey,
            languages: 'en'
        };

        if (imdbId) {
            params.imdb_id = imdbId;
        } else if (title) {
            params.film_name = title;
        }

        if (season && episode) {
            params.season = season;
            params.episode = episode;
        }

        const response = await axios.get('https://api.subdl.com/api/v1/subtitles', { 
            params,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Stremio-AI-Sub)'
            },
            timeout: 8000
        });
        
        if (response.data && response.data.status && response.data.subtitles) {
            console.log(`[SubDL] Found ${response.data.subtitles.length} subtitles.`);
            // Transform to our common format, include release name for debugging
            return response.data.subtitles.map(sub => {
                let subUrl = sub.url || sub.link || sub.download_url;
                if (subUrl && subUrl.startsWith('/')) {
                    subUrl = `https://dl.subdl.com${subUrl}`;
                }
                return {
                    url: subUrl,
                    lang: sub.lang || 'en',
                    release: sub.release || sub.name || 'Unknown Release',
                    season: sub.season,
                    episode: sub.episode
                };
            });
        }
        return [];
    } catch (error) {
        console.error('[SubDL] Error searching subtitles:', error.message);
        return [];
    }
}

async function downloadSubtitle(url) {
    try {
        console.log(`[SubDL] Downloading from: ${url}`);
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
        
        if (url.endsWith('.zip')) {
            const zip = new AdmZip(response.data);
            const zipEntries = zip.getEntries();
            // Find the first .srt file in the zip
            const srtEntry = zipEntries.find(entry => entry.entryName.toLowerCase().endsWith('.srt'));
            if (srtEntry) {
                return srtEntry.getData().toString('utf8');
            }
        }
        
        return response.data.toString('utf8');
    } catch (error) {
        console.error('[SubDL] Error downloading subtitle:', error.message);
        return null;
    }
}

module.exports = {
    searchSubtitles,
    downloadSubtitle
};
