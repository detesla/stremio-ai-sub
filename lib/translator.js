const { GoogleGenerativeAI } = require("@google/generative-ai");
const { OpenAI } = require("openai");
const axios = require("axios");
const srtParser = require("srt-parser-2");
const parser = new srtParser.default();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function translateWithGemini(textChunks, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
    
    const prompt = `Translate these subtitle lines to Vietnamese. 
    Return ONLY the translated lines, one per line. 
    IMPORTANT: DO NOT translate or include any sound descriptions (like [Music], (Sigh), [Silence]), speaker tags (like JOHN:), or non-dialogue text.
    If a line is just a sound description, return a single period (.).
    Lines:
    ${textChunks.join('\n')}
    `;

    try {
        console.log(`[Gemini-Raw] Sending request to ${url}...`);
        const response = await axios.post(url, {
            contents: [{
                parts: [{ text: prompt }]
            }],
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            ]
        });

        if (response.data && response.data.candidates) {
            const text = response.data.candidates[0].content.parts[0].text.trim();
            const translatedText = text.split('\n');
            console.log(`[Gemini-Raw] Success! First line: "${translatedText[0]}"`);
            return translatedText;
        }
        throw new Error('Invalid response from Gemini');
    } catch (err) {
        console.error(`[Gemini-Raw] Failed:`, err.response ? err.response.data : err.message);
        throw err;
    }
}

async function translateWithGroq(textChunks, apiKey) {
    const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: "https://api.groq.com/openai/v1"
    });

    const prompt = `Translate to Vietnamese, one line per line. Return ONLY translated lines. 
    IMPORTANT: DO NOT translate or include any sound descriptions (like [Music], (Sigh), [Silence]), speaker tags (like JOHN:), or non-dialogue text.
    If a line is just a sound description, return a single period (.).\nLines:\n${textChunks.join('\n')}`;

    const chatCompletion = await openai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.1-8b-instant",
        temperature: 0, // More stable
    });

    return chatCompletion.choices[0].message.content.trim().split('\n');
}

async function translateWithPuter(textChunks, apiKey) {
    const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: "https://api.puter.com/puterai/openai/v1/",
    });

    const prompt = `Translate to Vietnamese, one line per line. Return ONLY translated lines. 
    IMPORTANT: DO NOT translate or include any sound descriptions (like [Music], (Sigh), [Silence]), speaker tags (like JOHN:), or non-dialogue text.
    If a line is just a sound description, return a single period (.).\nLines:\n${textChunks.join('\n')}`;

    const chatCompletion = await openai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: process.env.PUTER_MODEL || "gpt-4o-mini",
    });

    return chatCompletion.choices[0].message.content.trim().split('\n');
}

let currentKeyIndex = { gemini: 0, groq: 0, puter: 0 };

async function translateSrt(srtContent, provider, apiKeyString) {
    const apiKeys = apiKeyString.split(',').map(k => k.trim());
    const data = parser.fromSrt(srtContent);
    const texts = data.map(item => {
        // Robust SDH removal
        let cleaned = item.text
            .replace(/\[[\s\S]*?\]/g, '') // [Music]
            .replace(/\([\s\S]*?\)/g, '') // (Sigh)
            .replace(/\{[\s\S]*?\}/g, '') // {Door}
            .replace(/【[\s\S]*?】/g, '') // 【Audio】
            .replace(/^[A-Z\s]+:/g, '') // SPEAKER:
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join(' ')
            .trim();
        return cleaned || '.'; // Use a dot to keep index consistent
    });
    
    console.log(`[AI] Starting translation for ${texts.length} lines using ${provider}...`);
    console.log(`[AI] Using ${apiKeys.length} API keys for rotation.`);
    
    let translatedTexts = [];
    
    if (provider === 'gemini') {
        const chunkSize = 100; // Smaller chunks for more reliable rotation
        for (let i = 0; i < texts.length; i += chunkSize) {
            const chunk = texts.slice(i, i + chunkSize);
            console.log(`[AI Progress] Translating lines ${i} to ${Math.min(i + chunkSize, texts.length)}...`);
            
            let success = false;
            while (!success && currentKeyIndex.gemini < apiKeys.length) {
                try {
                    const translatedChunk = await translateWithGemini(chunk, apiKeys[currentKeyIndex.gemini]);
                    translatedTexts = translatedTexts.concat(translatedChunk);
                    success = true;
                } catch (err) {
                    if (err.response && err.response.status === 429) {
                        console.warn(`[Gemini] Key #${currentKeyIndex.gemini} exhausted. Rotating to next key...`);
                        currentKeyIndex.gemini++;
                        if (currentKeyIndex.gemini >= apiKeys.length) {
                            console.error('[Gemini] ALL KEYS EXHAUSTED! Falling back to original text.');
                            break;
                        }
                    } else {
                        console.error('[Gemini] Error:', err.message);
                        break;
                    }
                }
            }
            if (!success) translatedTexts = translatedTexts.concat(chunk);
        }
    } else if (provider === 'puter') {
        const chunkSize = 50; 
        for (let i = 0; i < texts.length; i += chunkSize) {
            const chunk = texts.slice(i, i + chunkSize);
            console.log(`[AI Progress] Puter - Translating lines ${i} to ${Math.min(i + chunkSize, texts.length)}...`);
            
            let success = false;
            while (!success && currentKeyIndex.puter < apiKeys.length) {
                try {
                    const translatedChunk = await translateWithPuter(chunk, apiKeys[currentKeyIndex.puter]);
                    translatedTexts = translatedTexts.concat(translatedChunk);
                    success = true;
                } catch (err) {
                    console.error('[Puter] Error:', err.message);
                    currentKeyIndex.puter++;
                    if (currentKeyIndex.puter >= apiKeys.length) break;
                }
            }
            if (!success) translatedTexts = translatedTexts.concat(chunk);
        }
    } else {
        const chunkSize = 30; 
        for (let i = 0; i < texts.length; i += chunkSize) {
            const chunk = texts.slice(i, i + chunkSize);
            const progress = Math.round((i / texts.length) * 100);
            console.log(`[AI Progress] ${progress}% - Translating lines ${i} to ${Math.min(i + chunkSize, texts.length)}...`);
            
            let success = false;
            while (!success && currentKeyIndex.groq < apiKeys.length) {
                try {
                    if (i > 0) await sleep(10000); 
                    const translatedChunk = await translateWithGroq(chunk, apiKeys[currentKeyIndex.groq]);
                    translatedTexts = translatedTexts.concat(translatedChunk);
                    success = true;
                } catch (err) {
                    if (err.message && (err.message.includes('429') || err.message.includes('quota'))) {
                        console.warn(`[Groq] Key #${currentKeyIndex.groq} exhausted. Rotating...`);
                        currentKeyIndex.groq++;
                        if (currentKeyIndex.groq >= apiKeys.length) break;
                    } else {
                        console.error('[Groq] Error:', err.message);
                        break;
                    }
                }
            }
            if (!success) translatedTexts = translatedTexts.concat(chunk);
        }
    }

    console.log(`[AI] 100% COMPLETE! Saving to cache...`);
    // Reassemble SRT
    const translatedData = data.map((item, index) => ({
        ...item,
        text: translatedTexts[index] || item.text
    }));

    return parser.toSrt(translatedData);
}

module.exports = { translateSrt };
