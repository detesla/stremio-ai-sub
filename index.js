require('dotenv').config();
const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const opensubs = require('./lib/opensubs');
const subdl = require('./lib/subdl');
const translator = require('./lib/translator');
const cache = require('./lib/cache');

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

// Actual Subtitle Content Route
let osToken = null;

app.get('/sub/:provider/:id.srt', async (req, res) => {
    const { provider, id } = req.params;
    const apiKey = provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.GROQ_API_KEY;
    
    if (!apiKey) {
        return res.status(500).send('API Key missing for provider ' + provider);
    }

    try {
        // 1. Check Cache
        let srtContent = cache.getCachedSubtitle(id, provider);
        if (srtContent) {
            console.log(`Serving ${id} from cache (${provider})`);
            return res.header('Content-Type', 'text/plain').send(srtContent);
        }

        // 2. Search Subtitles via Proxy
        let imdbId = id;
        let season, episode;
        if (id.includes(':')) {
            [imdbId, season, episode] = id.split(':');
        }

        let subs = await opensubs.searchSubtitles(imdbId, season, episode);
        
        // Fallback to SubDL if OpenSubs finds nothing
        if (!subs || subs.length === 0) {
            console.log(`[Proxy] No subtitles found on OpenSubs, trying SubDL...`);
            const subdlApiKey = process.env.SUBDL_API_KEY;
            if (subdlApiKey) {
                const subdlSubs = await subdl.searchSubtitles(imdbId, season, episode, subdlApiKey);
                if (subdlSubs && subdlSubs.length > 0) {
                    subs = subdlSubs; // Use subdl results
                }
            }
        }

        if (!subs || subs.length === 0) {
            return res.status(404).send('No English subtitles found on OpenSubs or SubDL.');
        }

        let englishSrt = null;
        // Try the first 3 subtitles
        for (let i = 0; i < Math.min(subs.length, 3); i++) {
            const currentSub = subs[i];
            console.log(`[Proxy] Downloading subtitle #${i + 1} from ${currentSub.url.includes('subdl') ? 'SubDL' : 'OpenSubs'}...`);
            
            if (currentSub.url.includes('subdl.com')) {
                englishSrt = await subdl.downloadSubtitle(currentSub.url);
            } else {
                englishSrt = await opensubs.downloadSubtitle(currentSub.url);
            }
            
            if (englishSrt) break;
        }
        
        if (!englishSrt) {
            return res.status(500).send('Failed to download subtitles from all proxy sources.');
        }

        // 3. Translate
        const translatedSrt = await translator.translateSrt(englishSrt, provider, apiKey);
        
        // 4. Cache and Send
        cache.saveToCache(id, provider, translatedSrt);
        res.header('Content-Type', 'text/plain').send(translatedSrt);

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
    console.log('-------------------------');
});
