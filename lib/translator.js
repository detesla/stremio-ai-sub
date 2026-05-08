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
    DO NOT include any speaker names or sound descriptions like [Music] or (Door creaks).
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
    DO NOT include any speaker names or sound descriptions like [Music] or (Door creaks).\nLines:\n${textChunks.join('\n')}`;

    const chatCompletion = await openai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.1-8b-instant",
        temperature: 0, // More stable
    });

    return chatCompletion.choices[0].message.content.trim().split('\n');
}

async function translateSrt(srtContent, provider, apiKey) {
    const data = parser.fromSrt(srtContent);
    const texts = data.map(item => {
        // Remove SDH (text in brackets/parentheses) and speaker names
        return item.text
            .replace(/\[.*?\]/g, '') // Remove [Music]
            .replace(/\(.*?\)/g, '') // Remove (Screams)
            .replace(/^[A-Z\s]+:/g, '') // Remove SPEAKER:
            .replace(/\n/g, ' ')
            .trim();
    });
    
    console.log(`[AI] Starting translation for ${texts.length} lines using ${provider}...`);
    
    let translatedTexts = [];
    
    if (provider === 'gemini') {
        const chunkSize = 500; // Gemini is fast
        for (let i = 0; i < texts.length; i += chunkSize) {
            const chunk = texts.slice(i, i + chunkSize);
            console.log(`[AI Progress] Translating lines ${i} to ${Math.min(i + chunkSize, texts.length)}...`);
            try {
                const translatedChunk = await translateWithGemini(chunk, apiKey);
                translatedTexts = translatedTexts.concat(translatedChunk);
            } catch (err) {
                console.error('[Gemini] Error:', err.message);
                translatedTexts = translatedTexts.concat(chunk);
            }
        }
    } else {
        const chunkSize = 50; 
        for (let i = 0; i < texts.length; i += chunkSize) {
            const chunk = texts.slice(i, i + chunkSize);
            const progress = Math.round((i / texts.length) * 100);
            console.log(`[AI Progress] ${progress}% - Translating lines ${i} to ${Math.min(i + chunkSize, texts.length)}...`);
            
            let success = false;
            let attempts = 0;
            while (!success && attempts < 3) {
                try {
                    if (i > 0) await sleep(12000); 
                    const translatedChunk = await translateWithGroq(chunk, apiKey);
                    translatedTexts = translatedTexts.concat(translatedChunk);
                    success = true;
                } catch (err) {
                    attempts++;
                    console.warn(`[Groq] Rate limit hit, waiting 20s...`);
                    await sleep(20000);
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
