require('dotenv').config();
const fs = require('fs');
const path = require('path');

// --- ⚙️ 全域配置 ---
const cleanEnv = (str, allowSpaces = false) => {
    if (!str) return "";
    let cleaned = str.replace(/[^\x20-\x7E]/g, "");
    if (!allowSpaces) cleaned = cleaned.replace(/\s/g, "");
    return (cleaned || "").trim();
};

const isPlaceholder = (str) => {
    if (!str) return true;
    return /你的|這裡|YOUR_|TOKEN/i.test(str) || str.length < 10;
};

const CONFIG = {
    TG_TOKEN: cleanEnv(process.env.TELEGRAM_TOKEN),
    TG_AUTH_MODE: cleanEnv(process.env.TG_AUTH_MODE) || 'ADMIN',
    TG_CHAT_ID: cleanEnv(process.env.TG_CHAT_ID),
    DC_TOKEN: cleanEnv(process.env.DISCORD_TOKEN),
    USER_DATA_DIR: cleanEnv(process.env.USER_DATA_DIR || './golem_memory', true),
    API_KEYS: (process.env.GEMINI_API_KEYS || '').split(',').map(k => cleanEnv(k)).filter(k => k),
    ADMIN_ID: cleanEnv(process.env.ADMIN_ID),
    DISCORD_ADMIN_ID: cleanEnv(process.env.DISCORD_ADMIN_ID),
    ADMIN_IDS: [process.env.ADMIN_ID, process.env.DISCORD_ADMIN_ID].map(k => cleanEnv(k)).filter(k => k),
    GITHUB_REPO: cleanEnv(process.env.GITHUB_REPO || 'https://raw.githubusercontent.com/Arvincreator/project-golem/main/', true),
    QMD_PATH: cleanEnv(process.env.GOLEM_QMD_PATH || 'qmd', true),
    DONATE_URL: 'https://buymeacoffee.com/arvincreator'
};

// 驗證關鍵 Token
if (isPlaceholder(CONFIG.TG_TOKEN)) { console.warn("⚠️ [Config] TELEGRAM_TOKEN 無效，TG Bot 預設不啟動。"); CONFIG.TG_TOKEN = ""; }
if (isPlaceholder(CONFIG.DC_TOKEN)) { console.warn("⚠️ [Config] DISCORD_TOKEN 無效，Discord Bot 不啟動。"); CONFIG.DC_TOKEN = ""; }
if (CONFIG.API_KEYS.some(isPlaceholder)) CONFIG.API_KEYS = CONFIG.API_KEYS.filter(k => !isPlaceholder(k));

// 🚀 解析多重 Golem (無限擴展) 配置
let GOLEMS_CONFIG = [];
const golemsJsonPath = path.join(process.cwd(), 'golems.json');
if (fs.existsSync(golemsJsonPath)) {
    try {
        GOLEMS_CONFIG = JSON.parse(fs.readFileSync(golemsJsonPath, 'utf8'));
    } catch (e) {
        console.error("❌ [Config] golems.json 格式錯誤:", e.message);
    }
} else {
    // 預設向後相容: 使用 .env 的 TG_TOKEN 作為單例模式
    if (CONFIG.TG_TOKEN) {
        GOLEMS_CONFIG.push({ id: 'golem_A', tgToken: CONFIG.TG_TOKEN });
    }
}

// 確保 ID 唯一，且都有基本的 Token 屬性
const seenIds = new Set();
GOLEMS_CONFIG = GOLEMS_CONFIG.filter(g => {
    if (!g.id) return false;
    if (seenIds.has(g.id)) return false;
    seenIds.add(g.id);
    return true;
});

module.exports = {
    cleanEnv,
    isPlaceholder,
    CONFIG,
    GOLEMS_CONFIG
};
