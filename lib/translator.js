const { GoogleGenerativeAI } = require("@google/generative-ai");
const { OpenAI } = require("openai");
const srtParser = require("srt-parser-2");
const parser = new srtParser.default();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function translateWithGemini(textChunks, apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `You are a professional subtitle translator. Translate the following subtitle lines from English to Vietnamese. 
    Maintain the emotional tone, slang, and context. 
    Return ONLY the translated text, one line per original line. 
    Do not add any explanations or change the number of lines.
    
    Lines to translate:
    ${textChunks.join('\n')}
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim().split('\n');
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
        // Gemini 1.5 Flash is fast and handles big chunks
        const chunkSize = 1000; 
        for (let i = 0; i < texts.length; i += chunkSize) {
            const chunk = texts.slice(i, i + chunkSize);
            console.log(`[AI] Translating lines ${i} to ${Math.min(i + chunkSize, texts.length)}...`);
            const translatedChunk = await translateWithGemini(chunk, apiKey);
            translatedTexts = translatedTexts.concat(translatedChunk);
        }
    } else {
        // Groq has TPM limits, use 200 lines and add delay
        const chunkSize = 200;
        for (let i = 0; i < texts.length; i += chunkSize) {
            const chunk = texts.slice(i, i + chunkSize);
            console.log(`[AI] Translating lines ${i} to ${Math.min(i + chunkSize, texts.length)}...`);
            
            if (i > 0) {
                console.log('[AI] Sleeping 2s to avoid Groq rate limit...');
                await sleep(2000);
            }

            const translatedChunk = await translateWithGroq(chunk, apiKey);
            translatedTexts = translatedTexts.concat(translatedChunk);
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
