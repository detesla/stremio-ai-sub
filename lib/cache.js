const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '../cache');

if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR);
}

function getCachePath(id, provider) {
    return path.join(CACHE_DIR, `${id}_${provider}.srt`);
}

function getCachedSubtitle(id, provider) {
    const filePath = getCachePath(id, provider);
    if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
    }
    return null;
}

function saveToCache(id, provider, content) {
    const filePath = getCachePath(id, provider);
    fs.writeFileSync(filePath, content, 'utf8');
}

module.exports = {
    getCachedSubtitle,
    saveToCache
};
