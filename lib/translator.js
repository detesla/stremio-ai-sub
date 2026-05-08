const { GoogleGenerativeAI } = require("@google/generative-ai");
const { OpenAI } = require("openai");
const axios = require("axios");
const srtParser = require("srt-parser-2");
const parser = new srtParser.default();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function translateWithGemini(textChunks, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const prompt = `Translate these subtitle lines to Vietnamese. Return ONLY the translated lines, one per line.
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

    const prompt = `Translate the following subtitle lines from English to Vietnamese. 
    Return ONLY the translated Vietnamese text, one line per original line. 
    Maintain EXACTLY ${textChunks.length} lines.
    
    Lines:
    ${textChunks.join('\n')}
    `;

    const chatCompletion = await openai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.1-8b-instant", // High rate limit model
        temperature: 0.1,
    });

    return chatCompletion.choices[0].message.content.trim().split('\n');
}

async function translateSrt(srtContent, provider, apiKey) {
    const data = parser.fromSrt(srtContent);
    const texts = data.map(item => item.text.replace(/\n/g, ' '));
    
    console.log(`[AI] Starting translation for ${texts.length} lines using ${provider}...`);
    
    let translatedTexts = [];
    
    if (provider === 'gemini') {
        // Gemini 1.5 Flash can handle huge chunks
        const chunkSize = 2000; 
        for (let i = 0; i < texts.length; i += chunkSize) {
            const chunk = texts.slice(i, i + chunkSize);
            console.log(`[AI] Translating lines ${i} to ${Math.min(i + chunkSize, texts.length)}...`);
            try {
                const translatedChunk = await translateWithGemini(chunk, apiKey);
                translatedTexts = translatedTexts.concat(translatedChunk);
            } catch (err) {
                console.error('[Gemini] Error:', err.message);
                translatedTexts = translatedTexts.concat(chunk); // Fallback to original
            }
        }
    } else {
        // Groq free tier has a tiny 6000 TPM limit. Use 50 lines to stay safe.
        const chunkSize = 50; 
        for (let i = 0; i < texts.length; i += chunkSize) {
            const chunk = texts.slice(i, i + chunkSize);
            console.log(`[AI] Translating lines ${i} to ${Math.min(i + chunkSize, texts.length)}...`);
            
            let success = false;
            let attempts = 0;
            while (!success && attempts < 3) {
                try {
                    // Wait at least 12 seconds between chunks to stay under 6000 TPM
                    if (i > 0) {
                        console.log('[Groq] Waiting 12s to stay under TPM limit...');
                        await sleep(12000);
                    }
                    const translatedChunk = await translateWithGroq(chunk, apiKey);
                    translatedTexts = translatedTexts.concat(translatedChunk);
                    success = true;
                } catch (err) {
                    attempts++;
                    console.warn(`[Groq] Attempt ${attempts} failed:`, err.message);
                    // If limit reached, wait even longer
                    await sleep(20000);
                }
            }
            if (!success) translatedTexts = translatedTexts.concat(chunk);
        }
    }

    console.log(`[AI] Translation complete! Reassembling SRT...`);

    // Reassemble SRT
    const translatedData = data.map((item, index) => ({
        ...item,
        text: translatedTexts[index] || item.text // Fallback to original if missing
    }));

    return parser.toSrt(translatedData);
}

module.exports = { translateSrt };
