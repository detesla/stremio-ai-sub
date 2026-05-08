const { GoogleGenerativeAI } = require("@google/generative-ai");
const { OpenAI } = require("openai");
const srtParser = require("srt-parser-2");
const parser = new srtParser.default();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function translateWithGemini(textChunks, apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Explicitly try v1 API which is more stable for some keys
    const modelsToTry = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-pro"];
    let lastError;

    for (const modelName of modelsToTry) {
        try {
            console.log(`[Gemini] Trying model: ${modelName} (v1)...`);
            const model = genAI.getGenerativeModel(
                { model: modelName },
                { apiVersion: 'v1' } // Force v1 API
            );
            
            const prompt = `Translate these lines to Vietnamese. Return ONLY translated lines, one per line.
            Lines:
            ${textChunks.join('\n')}
            `;
            
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text().trim();
            
            // Basic check to see if it actually translated (should contain common VN characters)
            const isVietnamese = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(text);
            
            if (!isVietnamese && text.length > 0) {
                console.warn(`[Gemini] Translation output seems to be non-Vietnamese, retrying...`);
                continue; 
            }

            const translatedText = text.split('\n');
            console.log(`[Gemini] Success with ${modelName}! First line: "${translatedText[0]}"`);
            return translatedText;
        } catch (err) {
            console.warn(`[Gemini] ${modelName} failed:`, err.message);
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
        // Groq 8B Instant has high limits, use 500 lines
        const chunkSize = 500; 
        for (let i = 0; i < texts.length; i += chunkSize) {
            const chunk = texts.slice(i, i + chunkSize);
            console.log(`[AI] Translating lines ${i} to ${Math.min(i + chunkSize, texts.length)}...`);
            
            let success = false;
            let attempts = 0;
            while (!success && attempts < 3) {
                try {
                    if (i > 0) await sleep(500); // Only 500ms wait
                    const translatedChunk = await translateWithGroq(chunk, apiKey);
                    translatedTexts = translatedTexts.concat(translatedChunk);
                    success = true;
                } catch (err) {
                    attempts++;
                    console.warn(`[Groq] Attempt ${attempts} failed:`, err.message);
                    await sleep(2000);
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
