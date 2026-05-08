require('dotenv').config();
const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const opensubs = require('./lib/opensubs');
const subdl = require('./lib/subdl');
const translator = require('./lib/translator');
const cache = require('./lib/cache');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 7000;

// 1. Define Manifest
const manifest = {
    id: 'community.ai.subtitles.vn',
    version: '1.0.0',
    name: 'AI Vietnamese Subtitles',
    description: 'Bản dịch phụ đề tiếng Việt AI (Gemini & Groq)',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt']
};

const builder = new addonBuilder(manifest);

// 2. Subtitles Resource Handler
builder.defineSubtitlesHandler(async (args) => {
    const { type, id } = args;
    
    const baseUrl = global.currentBaseUrl || `http://localhost:${PORT}`;

    const tracks = [
        {
            id: `ai_gemini_${id}`,
            url: `${baseUrl}/sub/gemini/${id}.srt`,
            lang: 'vie',
            label: '🇻🇳 AI Vietnamese (Gemini Pro)'
        },
        {
            id: `ai_groq_${id}`,
            url: `${baseUrl}/sub/groq/${id}.srt`,
            lang: 'vie',
            label: '🇻🇳 AI Vietnamese (AI Dịch)'
        },
        {
            id: `ai_puter_${id}`,
            url: `${baseUrl}/sub/puter/${id}.srt`,
            lang: 'vie',
            label: '🇻🇳 AI Vietnamese (Puter AI)'
        }
    ];

    return { subtitles: tracks };
});

const addonInterface = builder.getInterface();
const addonRouter = getRouter(addonInterface);

// 3. Express Routes
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers.host;
    global.currentBaseUrl = `${protocol}://${host}`;
    
    next();
});

// Use official Stremio SDK router
app.use(addonRouter);

// Helper to get metadata from Cinemeta
async function getMediaMetadata(id, type) {
    try {
        const imdbId = id.split(':')[0];
        const url = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
        console.log(`[Cinemeta] Fetching metadata for ${imdbId}...`);
        const response = await axios.get(url, { timeout: 5000 });
        if (response.data && response.data.meta) {
            return {
                name: response.data.meta.name,
                year: response.data.meta.year || response.data.meta.releaseInfo || ''
            };
        }
    } catch (err) {
        console.error('[Cinemeta] Error:', err.message);
    }
    return null;
}

// Actual Subtitle Content Route
let osToken = null;

app.get('/sub/:provider/:id.srt', async (req, res) => {
    const { provider, id } = req.params;
    
    let apiKey = '';
    if (provider === 'gemini') apiKey = process.env.GEMINI_API_KEY;
    else if (provider === 'groq') apiKey = process.env.GROQ_API_KEY;
    else if (provider === 'puter') apiKey = process.env.PUTER_AUTH_TOKEN;
    
    if (!apiKey) {
        return res.status(500).send('API Key missing for provider ' + provider);
    }

    try {
        // 1. Check Cache
        let srtContent = cache.getCachedSubtitle(id, provider);
        if (srtContent) {
            console.log(`Serving ${id} from cache (${provider})`);
            return res.header('Content-Type', 'text/plain; charset=utf-8').send(srtContent);
        }

        // 2. Search & Download English Subtitles (if not cached)
        let englishSrt = cache.getCachedEnglish(id);
        
        if (!englishSrt) {
            let imdbId = id;
            let season, episode;
            if (id.includes(':')) {
                [imdbId, season, episode] = id.split(':');
            }

            let subs = null;
            const subdlApiKey = process.env.SUBDL_API_KEY;
            
            // Try SubDL with ID first
            if (subdlApiKey) {
                subs = await subdl.searchSubtitles(imdbId, season, episode, subdlApiKey);
                
                // FALLBACK: Search by Title if ID fails
                if (!subs || subs.length === 0) {
                    console.log(`[Proxy] No subtitles found by ID on SubDL, trying Title search...`);
                    const type = id.includes(':') ? 'series' : 'movie';
                    const meta = await getMediaMetadata(id, type);
                    if (meta) {
                        const searchTitle = `${meta.name} ${meta.year}`.trim();
                        let foundSubs = await subdl.searchSubtitles(null, season, episode, subdlApiKey, searchTitle);
                        
                        // Filter by season/episode to be absolutely sure
                        if (season && episode && foundSubs && foundSubs.length > 0) {
                            const sCode = `S${season.padStart(2, '0')}`;
                            const eCode = `E${episode.padStart(2, '0')}`;
                            const fullCode = `${sCode}${eCode}`.toLowerCase();
                            
                            foundSubs = foundSubs.filter(s => {
                                // Priority 1: Check structured fields
                                if (s.season == season && s.episode == episode) return true;
                                // Priority 2: Check release name for S01E01 etc.
                                if (s.release.toLowerCase().includes(fullCode)) return true;
                                return false;
                            });
                        }
                        subs = foundSubs;
                    }
                }
            }

            // Fallback to OpenSubs if SubDL finds nothing
            if (!subs || subs.length === 0) {
                console.log(`[Proxy] No subtitles found on SubDL (filtered), trying OpenSubs...`);
                subs = await opensubs.searchSubtitles(imdbId, season, episode);
            }

            if (!subs || subs.length === 0) {
                return res.status(404).send('No English subtitles found.');
            }

            // Download the first working subtitle
            for (let i = 0; i < Math.min(subs.length, 3); i++) {
                const currentSub = subs[i];
                console.log(`[Proxy] Candidate #${i + 1} from ${currentSub.url.includes('subdl') ? 'SubDL' : 'OpenSubs'}`);
                if (currentSub.release) {
                    console.log(`[Proxy] Checking in release: ${currentSub.release}`);
                }
                
                if (currentSub.url.includes('subdl.com')) {
                    englishSrt = await subdl.downloadSubtitle(currentSub.url, season, episode);
                } else {
                    englishSrt = await opensubs.downloadSubtitle(currentSub.url);
                }
                
                if (englishSrt) break;
            }
            
            if (!englishSrt) {
                return res.status(500).send('Failed to download subtitles from all sources.');
            }

            // Cache the English one for the next provider request (Gemini/Groq)
            cache.saveToEnglish(id, englishSrt);
        } else {
            console.log(`[Proxy] Using cached English SRT for ${id}`);
        }

        // 3. Translate
        const translatedSrt = await translator.translateSrt(englishSrt, provider, apiKey);
        
        // 4. Cache and Send
        cache.saveToCache(id, provider, translatedSrt);
        res.header('Content-Type', 'text/plain; charset=utf-8').send(translatedSrt);

    } catch (error) {
        console.error('Error processing subtitle:', error);
        res.status(500).send('Internal Server Error: ' + error.message);
    }
});

app.listen(PORT, () => {
    console.log(`AI Subtitle Add-on running at http://localhost:${PORT}/manifest.json`);
    console.log('--- Environment Check ---');
    console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '✅' : '❌');
    console.log('GROQ_API_KEY:', process.env.GROQ_API_KEY ? '✅' : '❌');
    console.log('OPENSUBTITLES_API_KEY:', process.env.OPENSUBTITLES_API_KEY ? '✅' : '❌');
    console.log('OPENSUBTITLES_USERNAME:', process.env.OPENSUBTITLES_USERNAME ? '✅' : '❌');
    console.log('SUBDL_API_KEY:', process.env.SUBDL_API_KEY ? '✅' : '❌');
    console.log('PUTER_AUTH_TOKEN:', process.env.PUTER_AUTH_TOKEN ? '✅' : '❌');
    console.log('-------------------------');
});
