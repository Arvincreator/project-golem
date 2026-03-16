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
    DONATE_URL: 'https://buymeacoffee.com/arvincreator',
    TZ: cleanEnv(process.env.TZ) || 'Asia/Taipei',
    INTERVENTION_LEVEL: cleanEnv(process.env.GOLEM_INTERVENTION_LEVEL) || 'CONSERVATIVE',
    AWAKE_INTERVAL_MIN: Number(cleanEnv(process.env.GOLEM_AWAKE_INTERVAL_MIN)) || 2, // 預設最小 2 小時
    AWAKE_INTERVAL_MAX: Number(cleanEnv(process.env.GOLEM_AWAKE_INTERVAL_MAX)) || 5,  // 預設最大 5 小時 (2 + 3)
    SLEEP_START: process.env.GOLEM_SLEEP_START !== undefined ? Number(cleanEnv(process.env.GOLEM_SLEEP_START)) : 1, // 預設凌晨 1 點
    SLEEP_END: process.env.GOLEM_SLEEP_END !== undefined ? Number(cleanEnv(process.env.GOLEM_SLEEP_END)) : 7 // 預設早上 7 點
};

// 驗證關鍵 Token
if (isPlaceholder(CONFIG.TG_TOKEN)) { console.warn("⚠️ [Config] TELEGRAM_TOKEN 無效，TG Bot 預設不啟動。"); CONFIG.TG_TOKEN = ""; }
if (isPlaceholder(CONFIG.DC_TOKEN)) { console.warn("⚠️ [Config] DISCORD_TOKEN 無效，Discord Bot 不啟動。"); CONFIG.DC_TOKEN = ""; }
if (CONFIG.API_KEYS.some(isPlaceholder)) CONFIG.API_KEYS = CONFIG.API_KEYS.filter(k => !isPlaceholder(k));

// 🚀 解析運行模式 (單機 vs 多機)
let GOLEMS_CONFIG = [];
let GOLEM_MODE = (process.env.GOLEM_MODE || '').trim().toUpperCase();
let modeToUse = GOLEM_MODE;
const golemsJsonPath = path.join(process.cwd(), 'golems.json');

if (GOLEM_MODE === 'SINGLE') {
    // 強制單機模式：只使用 .env 配置，忽略 golems.json
    if (CONFIG.TG_TOKEN) {
        GOLEMS_CONFIG.push({
            id: 'golem_A',
            tgToken: CONFIG.TG_TOKEN,
            tgAuthMode: CONFIG.TG_AUTH_MODE,
            adminId: CONFIG.ADMIN_ID,
            chatId: CONFIG.TG_CHAT_ID
        });
    }
} else if (fs.existsSync(golemsJsonPath)) {
    try {
        GOLEMS_CONFIG = JSON.parse(fs.readFileSync(golemsJsonPath, 'utf8'));
    } catch (e) {
        console.error("❌ [Config] golems.json 格式錯誤:", e.message);
        modeToUse = "SINGLE"; // 降級
    }
}

// 處理單機模式或多機模式降級
if (modeToUse === "SINGLE" || GOLEMS_CONFIG.length === 0) {
    modeToUse = "SINGLE";
    GOLEM_MODE = "SINGLE"; // 同步實際模式
    if (CONFIG.TG_TOKEN || CONFIG.DC_TOKEN) {
        GOLEMS_CONFIG = [{
            id: 'golem_A',
            tgToken: CONFIG.TG_TOKEN,
            tgAuthMode: CONFIG.TG_AUTH_MODE,
            chatId: CONFIG.TG_CHAT_ID,
            adminId: CONFIG.ADMIN_ID,
            dcToken: CONFIG.DC_TOKEN,
            dcAdminId: CONFIG.DISCORD_ADMIN_ID
        }];
    }
} else {
    GOLEM_MODE = "MULTI"; // 明確標示多機
    modeToUse = "MULTI";
}

// 確保 ID 唯一，且都有基本的 Token 屬性
const seenIds = new Set();
GOLEMS_CONFIG = GOLEMS_CONFIG.filter(g => {
    if (!g.id) return false;
    if (seenIds.has(g.id)) return false;
    seenIds.add(g.id);
    return true;
});

// 計算 mode-aware 路徑前綴
// ✅ [Bug #5 修復] 改為 let，讓 reloadConfig() 能在切換模式時同步更新路徑
let MODE_DIR = modeToUse === 'SINGLE' ? 'single' : 'multi';
let LOG_BASE_DIR = path.join(process.cwd(), 'logs', MODE_DIR);
let MEMORY_BASE_DIR = modeToUse === 'SINGLE'
    ? path.resolve(CONFIG.USER_DATA_DIR || './golem_memory')
    : path.resolve(CONFIG.USER_DATA_DIR || './golem_memory', MODE_DIR);
let KNOWLEDGE_BASE_DIR = modeToUse === 'SINGLE'
    ? path.join(process.cwd(), 'golem_memory', 'knowledge')
    : path.join(process.cwd(), 'golem_memory', MODE_DIR, 'knowledge');

// 🔄 熱重載支援函數
const reloadConfig = () => {
    // 重新載入 .env 檔案取得最新值 (不依賴 cached process.env)
    const EnvManager = require('../utils/EnvManager');
    const freshEnv = EnvManager.readEnv();
    Object.assign(process.env, freshEnv);

    // 重新整理變數到 CONFIG
    CONFIG.TG_TOKEN = cleanEnv(process.env.TELEGRAM_TOKEN);
    CONFIG.TG_AUTH_MODE = cleanEnv(process.env.TG_AUTH_MODE) || 'ADMIN';
    CONFIG.TG_CHAT_ID = cleanEnv(process.env.TG_CHAT_ID);
    CONFIG.DC_TOKEN = cleanEnv(process.env.DISCORD_TOKEN);
    CONFIG.USER_DATA_DIR = cleanEnv(process.env.USER_DATA_DIR || './golem_memory', true);

    // 更新陣列 (Mutate in-place 以利 reference 共用)
    const newApiKeys = (process.env.GEMINI_API_KEYS || '').split(',').map(k => cleanEnv(k)).filter(k => k && !isPlaceholder(k));
    CONFIG.API_KEYS.length = 0;
    CONFIG.API_KEYS.push(...newApiKeys);

    CONFIG.ADMIN_ID = cleanEnv(process.env.ADMIN_ID);
    CONFIG.DISCORD_ADMIN_ID = cleanEnv(process.env.DISCORD_ADMIN_ID);

    const newAdminIds = [process.env.ADMIN_ID, process.env.DISCORD_ADMIN_ID].map(k => cleanEnv(k)).filter(k => k);
    CONFIG.ADMIN_IDS.length = 0;
    CONFIG.ADMIN_IDS.push(...newAdminIds);

    CONFIG.GITHUB_REPO = cleanEnv(process.env.GITHUB_REPO || 'https://raw.githubusercontent.com/Arvincreator/project-golem/main/', true);
    CONFIG.QMD_PATH = cleanEnv(process.env.GOLEM_QMD_PATH || 'qmd', true);
    CONFIG.TZ = cleanEnv(process.env.TZ) || 'Asia/Taipei';
    CONFIG.INTERVENTION_LEVEL = cleanEnv(process.env.GOLEM_INTERVENTION_LEVEL) || 'CONSERVATIVE';
    CONFIG.AWAKE_INTERVAL_MIN = Number(cleanEnv(process.env.GOLEM_AWAKE_INTERVAL_MIN)) || 2;
    CONFIG.AWAKE_INTERVAL_MAX = Number(cleanEnv(process.env.GOLEM_AWAKE_INTERVAL_MAX)) || 5;
    CONFIG.SLEEP_START = process.env.GOLEM_SLEEP_START !== undefined ? Number(cleanEnv(process.env.GOLEM_SLEEP_START)) : 1;
    CONFIG.SLEEP_END = process.env.GOLEM_SLEEP_END !== undefined ? Number(cleanEnv(process.env.GOLEM_SLEEP_END)) : 7;

    // 重新載入 GOLEMS_CONFIG
    if (freshEnv.GOLEM_MODE === 'SINGLE') {
        // 單機模式：從 .env 重新建立 golem_A
        GOLEMS_CONFIG.length = 0;
        const hasToken = CONFIG.TG_TOKEN || CONFIG.DC_TOKEN;
        if (hasToken) {
            GOLEMS_CONFIG.push({
                id: 'golem_A',
                tgToken: CONFIG.TG_TOKEN,
                tgAuthMode: CONFIG.TG_AUTH_MODE,
                chatId: CONFIG.TG_CHAT_ID,
                adminId: CONFIG.ADMIN_ID,
                dcToken: CONFIG.DC_TOKEN,
                dcAdminId: CONFIG.DISCORD_ADMIN_ID
            });
        }
    } else {
        // 多機模式：從 golems.json 載入
        const golemsJsonPath = path.join(process.cwd(), 'golems.json');
        if (fs.existsSync(golemsJsonPath)) {
            try {
                const newGolemsConfig = JSON.parse(fs.readFileSync(golemsJsonPath, 'utf8'));
                const seenIds = new Set();
                const validGolems = newGolemsConfig.filter(g => {
                    if (!g.id) return false;
                    if (seenIds.has(g.id)) return false;
                    seenIds.add(g.id);
                    return true;
                });
                GOLEMS_CONFIG.length = 0;
                GOLEMS_CONFIG.push(...validGolems);
            } catch (e) {
                console.error("❌ [Config] 熱重載 golems.json 失敗:", e.message);
            }
        }
    }

    // ✅ [Bug #5 修復] 同步更新 mode-aware 路徑常數
    const freshMode = (freshEnv.GOLEM_MODE || '').trim().toUpperCase();
    let newModeToUse = freshMode === 'SINGLE' ? 'SINGLE' : 'MULTI';
    if (newModeToUse !== 'SINGLE' && GOLEMS_CONFIG.length === 0) {
        newModeToUse = 'SINGLE'; // 降級
    }

    GOLEM_MODE = newModeToUse;
    const newModeDir = newModeToUse === 'SINGLE' ? 'single' : 'multi';
    MODE_DIR = newModeDir;
    LOG_BASE_DIR = path.join(process.cwd(), 'logs', newModeDir);
    MEMORY_BASE_DIR = newModeToUse === 'SINGLE'
        ? path.resolve(process.env.USER_DATA_DIR || CONFIG.USER_DATA_DIR || './golem_memory')
        : path.resolve(process.env.USER_DATA_DIR || CONFIG.USER_DATA_DIR || './golem_memory', newModeDir);
    KNOWLEDGE_BASE_DIR = newModeToUse === 'SINGLE'
        ? path.join(process.cwd(), 'golem_memory', 'knowledge')
        : path.join(process.cwd(), 'golem_memory', newModeDir, 'knowledge');

    console.log(`🔄 [Config] 設定已熱重載完成 (Active API Keys: ${CONFIG.API_KEYS.length}, Golems: ${GOLEMS_CONFIG.length}, Mode: ${MODE_DIR})`);
};

const _exports = {
    cleanEnv,
    isPlaceholder,
    CONFIG,
    GOLEMS_CONFIG,
    GOLEM_MODE,
    MODE_DIR,
    LOG_BASE_DIR,
    MEMORY_BASE_DIR,
    KNOWLEDGE_BASE_DIR,
    reloadConfig
};

// Use defineProperty for mode-aware paths so they're always current
Object.defineProperty(_exports, 'GOLEM_MODE', { get: () => GOLEM_MODE, enumerable: true });
Object.defineProperty(_exports, 'MODE_DIR', { get: () => MODE_DIR, enumerable: true });
Object.defineProperty(_exports, 'LOG_BASE_DIR', { get: () => LOG_BASE_DIR, enumerable: true });
Object.defineProperty(_exports, 'MEMORY_BASE_DIR', { get: () => MEMORY_BASE_DIR, enumerable: true });
Object.defineProperty(_exports, 'KNOWLEDGE_BASE_DIR', { get: () => KNOWLEDGE_BASE_DIR, enumerable: true });

module.exports = _exports;
