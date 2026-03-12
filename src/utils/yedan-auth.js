// ============================================================
// 🔑 YEDAN Auth — 共用 Token 管理 (DRY)
// 優先使用 .env / process.env，不依賴 /home/yedan/ 檔案
// ============================================================
const fs = require('fs');
const path = require('path');

let _cachedToken = null;
let _cacheTime = 0;
const CACHE_TTL = 300000; // 5min

function getToken() {
    if (_cachedToken && Date.now() - _cacheTime < CACHE_TTL) return _cachedToken;

    // 優先 1: process.env (本地 .env 或環境變數)
    if (process.env.FLEET_AUTH_TOKEN) {
        _cachedToken = process.env.FLEET_AUTH_TOKEN.trim();
        _cacheTime = Date.now();
        return _cachedToken;
    }

    // 優先 2: 專案根目錄 .env 檔
    try {
        const localEnv = path.join(process.cwd(), '.env');
        const env = fs.readFileSync(localEnv, 'utf-8');
        const m = env.match(/FLEET_AUTH_TOKEN=(.+)/);
        if (m) {
            _cachedToken = m[1].trim();
            _cacheTime = Date.now();
            return _cachedToken;
        }
    } catch (e) { /* .env not found, continue */ }

    // 優先 3: YEDAN 共享檔案 (最後手段)
    try {
        const yedanEnv = '/home/yedan/.openclaw/secrets/openclaw.env';
        const env = fs.readFileSync(yedanEnv, 'utf-8');
        const m = env.match(/FLEET_AUTH_TOKEN=(.+)/);
        if (m) {
            _cachedToken = m[1].trim();
            _cacheTime = Date.now();
            return _cachedToken;
        }
    } catch (e) { /* yedan file not accessible, continue */ }

    return null;
}

function clearCache() {
    _cachedToken = null;
    _cacheTime = 0;
}

module.exports = { getToken, clearCache };
