const axios = require('axios');
require('dotenv').config();

async function listModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const response = await axios.get(url);
        console.log("CÁC MODEL BẠN CÓ THỂ DÙNG:");
        response.data.models.forEach(m => {
            console.log(`- ${m.name.replace('models/', '')}`);
        });
    } catch (err) {
        console.error("Lỗi khi kiểm tra:", err.response ? err.response.data : err.message);
    }
}

listModels();