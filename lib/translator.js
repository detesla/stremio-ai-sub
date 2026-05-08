const { GoogleGenerativeAI } = require("@google/generative-ai");
const { OpenAI } = require("openai");
const srtParser = require("srt-parser-2");
const parser = new srtParser.default();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function translateWithGemini(textChunks, apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    const modelsToTry = ["gemini-1.5-flash-latest", "gemini-1.5-flash", "gemini-pro"];
    let lastError;

    for (const modelName of modelsToTry) {
        try {
            console.log(`[Gemini] Trying model: ${modelName}...`);
            const model = genAI.getGenerativeModel({ 
                model: modelName,
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
                ]
            });
            
            const prompt = `Translate the following subtitle lines from English to Vietnamese. 
            Return ONLY the translated Vietnamese text, one line per original line. 
            Maintain the EXACT same number of lines. Do not add any notes.
            
            Lines:
            ${textChunks.join('\n')}
            `;
            
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const translatedText = response.text().trim().split('\n');
            console.log(`[Gemini] First line translated: "${translatedText[0]}"`);
            return translatedText;
        } catch (err) {
            console.warn(`[Gemini] Model ${modelName} failed:`, err.message);
            lastError = err;
        }
    }
    throw lastError;
}

async function translateWithGroq(textChunks, apiKey) {
    const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: "https://api.groq.com/openai/v1"
    });

    const prompt = `Translate the following subtitle lines from English to Vietnamese. 
    Maintain the emotional tone and context. 
    Return ONLY the translated text, one line per original line. 
    
    Lines to translate:
    ${textChunks.join('\n')}
    `;

    const chatCompletion = await openai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
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
        // Groq has severe TPM limits, use small chunks and aggressive retry
        const chunkSize = 100; // Even smaller chunks
        for (let i = 0; i < texts.length; i += chunkSize) {
            const chunk = texts.slice(i, i + chunkSize);
            console.log(`[AI] Translating lines ${i} to ${Math.min(i + chunkSize, texts.length)}...`);
            
            let success = false;
            let attempts = 0;
            while (!success && attempts < 5) {
                try {
                    if (attempts > 0 || i > 0) await sleep(5000); // 5s wait between chunks or retries
                    const translatedChunk = await translateWithGroq(chunk, apiKey);
                    translatedTexts = translatedTexts.concat(translatedChunk);
                    success = true;
                } catch (err) {
                    attempts++;
                    if (err.status === 429) {
                        const waitTime = (err.headers && err.headers['retry-after']) ? (parseInt(err.headers['retry-after']) * 1000) : 15000;
                        console.warn(`[Groq] Rate limit! Waiting ${waitTime/1000}s...`);
                        await sleep(waitTime + 1000);
                    } else {
                        console.error('[Groq] Error:', err.message);
                        break;
                    }
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
