require('dotenv').config();
const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const opensubs = require('./lib/opensubs');
const translator = require('./lib/translator');
const cache = require('./lib/cache');

const app = express();
const PORT = process.env.PORT || 7000;

// 1. Define Manifest
const manifest = {
    id: 'community.ai.subtitles.vn',
    version: '1.0.0',
    name: 'AI Vietnamese Subtitles',
    description: 'Bản dịch phụ đề tiếng Việt sử dụng Gemini Pro & Groq Llama 3',
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
            label: '🇻🇳 AI Vietnamese (Groq Llama 3)'
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

        // 2. OpenSubtitles Login & Search
        if (!osToken) {
            console.log('Logging in to OpenSubtitles...');
            osToken = await opensubs.login(
                process.env.OPENSUBTITLES_USERNAME,
                process.env.OPENSUBTITLES_PASSWORD,
                process.env.OPENSUBTITLES_API_KEY
            );
        }

        let imdbId = id;
        let season, episode;
        if (id.includes(':')) {
            [imdbId, season, episode] = id.split(':');
        }

        const subs = await opensubs.searchSubtitles(imdbId, season, episode, process.env.OPENSUBTITLES_API_KEY);
        if (!subs || subs.length === 0) {
            return res.status(404).send('No English subtitles found for this movie/episode.');
        }

        // TRY MULTIPLE SUBS IN CASE OF 503
        let downloadUrl = null;
        let englishSrt = null;

        for (let i = 0; i < Math.min(subs.length, 5); i++) {
            const currentSub = subs[i];
            console.log(`[OpenSubs] Trying subtitle choice #${i + 1} (ID: ${currentSub.attributes.files[0].file_id})...`);
            
            downloadUrl = await opensubs.getDownloadLink(
                currentSub.attributes.files[0].file_id, 
                osToken,
                process.env.OPENSUBTITLES_API_KEY
            );

            if (downloadUrl) {
                console.log(`[OpenSubs] Success! Got download link for choice #${i + 1}`);
                englishSrt = await opensubs.downloadSubtitle(downloadUrl);
                if (englishSrt) break;
            } else {
                console.log(`[OpenSubs] Choice #${i + 1} failed with 503. Trying next...`);
            }
        }
        
        if (!englishSrt) {
            return res.status(500).send('OpenSubtitles is currently unstable (Error 503). All 5 attempts failed. Please try again later.');
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
    console.log('-------------------------');
});
