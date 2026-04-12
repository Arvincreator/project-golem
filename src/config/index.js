require('dotenv').config();
const fs = require('fs');
const path = require('path');

// --- ⚙️ 全域配置 ---
const cleanEnv = (str, allowSpaces = false) => {
    if (!str) return "";
    // [Fix] 僅移除控制字元，保留 Unicode (如中文) 以避免 USER_INTERESTS 等欄位被清空
    let cleaned = str.replace(/[\x00-\x1F\x7F]/g, "");
    if (!allowSpaces) cleaned = cleaned.replace(/\s/g, "");
    return (cleaned || "").trim();
};

const isPlaceholder = (str) => {
    if (!str) return true;
    // 檢查常見的佔位符關鍵字與長度
    const lowered = str.toLowerCase();
    const hasPlaceholderKeywords = /你的|這裡|your_|token_here/i.test(lowered);
    return hasPlaceholderKeywords || str.length < 8;
};

const normalizeBackend = (value) => {
    const backend = cleanEnv(value).toLowerCase();
    if (backend === 'gemini' || backend === 'ollama' || backend === 'perplexity') return backend;
    return 'gemini';
};

const normalizeEmbeddingProvider = (value) => {
    const provider = cleanEnv(value).toLowerCase();
    if (provider === 'local' || provider === 'ollama') return provider;
    return 'local';
};

const CONFIG = {
    TG_TOKEN: cleanEnv(process.env.TELEGRAM_TOKEN),
    TG_AUTH_MODE: cleanEnv(process.env.TG_AUTH_MODE) || 'ADMIN',
    TG_CHAT_ID: cleanEnv(process.env.TG_CHAT_ID),
    DC_TOKEN: cleanEnv(process.env.DISCORD_TOKEN),
    PLAYWRIGHT_PROFILE: cleanEnv(process.env.PLAYWRIGHT_PROFILE || ''),
    USER_DATA_DIR: cleanEnv(process.env.USER_DATA_DIR || '', true),
    API_KEYS: (process.env.GEMINI_API_KEYS || '').split(',').map(k => cleanEnv(k)).filter(k => k),
    ADMIN_ID: cleanEnv(process.env.ADMIN_ID),
    DISCORD_ADMIN_ID: cleanEnv(process.env.DISCORD_ADMIN_ID),
    ADMIN_IDS: [process.env.ADMIN_ID, process.env.DISCORD_ADMIN_ID].map(k => cleanEnv(k)).filter(k => k),
    GITHUB_REPO: cleanEnv(process.env.GITHUB_REPO || 'https://raw.githubusercontent.com/Arvincreator/project-golem/main/', true),
    QMD_PATH: cleanEnv(process.env.GOLEM_QMD_PATH || 'qmd', true),
    DONATE_URL: 'https://buymeacoffee.com/arvincreator',
    TZ: cleanEnv(process.env.TZ) || 'Asia/Taipei',
    INTERVENTION_LEVEL: cleanEnv(process.env.GOLEM_INTERVENTION_LEVEL) || 'CONSERVATIVE',
    TG_ENGINE: cleanEnv(process.env.TG_ENGINE) || 'grammy',
    CB_TG_TIMEOUT_MS: cleanEnv(process.env.CB_TG_TIMEOUT_MS) || '10000',
    CB_TG_RESET_MS: cleanEnv(process.env.CB_TG_RESET_MS) || '15000',
    CB_TG_ERROR_PCT: cleanEnv(process.env.CB_TG_ERROR_PCT) || '30',
    // --- AI Backend ---
    GOLEM_BACKEND: normalizeBackend(process.env.GOLEM_BACKEND),
    GOLEM_MEMORY_MODE: cleanEnv(process.env.GOLEM_MEMORY_MODE) || 'gbrain',
    // --- Scheduled Tasks ---
    AWAKE_INTERVAL_MIN: Number(cleanEnv(process.env.GOLEM_AWAKE_INTERVAL_MIN)) || 10, // 預設最小 10 分鐘
    AWAKE_INTERVAL_MAX: Number(cleanEnv(process.env.GOLEM_AWAKE_INTERVAL_MAX)) || 60, // 預設最大 60 分鐘
    SLEEP_START: process.env.GOLEM_SLEEP_START !== undefined ? Number(cleanEnv(process.env.GOLEM_SLEEP_START)) : 1, // 預設凌晨 1 點
    SLEEP_END: process.env.GOLEM_SLEEP_END !== undefined ? Number(cleanEnv(process.env.GOLEM_SLEEP_END)) : 7, // 預設早上 7 點
    USER_INTERESTS: cleanEnv(process.env.USER_INTERESTS || '科技圈熱門話題,全球趣聞', true),
    ENABLE_LOG_NOTIFICATIONS: (process.env.ENABLE_LOG_NOTIFICATIONS === 'true'),
    ARCHIVE_CHECK_INTERVAL: Number(cleanEnv(process.env.ARCHIVE_CHECK_INTERVAL)) || 30,
    ARCHIVE_THRESHOLD_YESTERDAY: Number(cleanEnv(process.env.ARCHIVE_THRESHOLD_YESTERDAY)) || 3,
    ARCHIVE_THRESHOLD_TODAY: Number(cleanEnv(process.env.ARCHIVE_THRESHOLD_TODAY)) || 1,
    // --- Embedding Config ---
    EMBEDDING_PROVIDER: normalizeEmbeddingProvider(process.env.GOLEM_EMBEDDING_PROVIDER),
    LOCAL_EMBEDDING_MODEL: cleanEnv(process.env.GOLEM_LOCAL_EMBEDDING_MODEL) || 'Xenova/bge-small-zh-v1.5',
    OLLAMA_BASE_URL: cleanEnv(process.env.GOLEM_OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434', true),
    OLLAMA_BRAIN_MODEL: cleanEnv(process.env.GOLEM_OLLAMA_BRAIN_MODEL || process.env.OLLAMA_BRAIN_MODEL || 'llama3.1:8b', true),
    OLLAMA_EMBEDDING_MODEL: cleanEnv(process.env.GOLEM_OLLAMA_EMBEDDING_MODEL || process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text', true),
    OLLAMA_RERANK_MODEL: cleanEnv(process.env.GOLEM_OLLAMA_RERANK_MODEL || process.env.OLLAMA_RERANK_MODEL || '', true),
    OLLAMA_TIMEOUT_MS: Number(cleanEnv(process.env.GOLEM_OLLAMA_TIMEOUT_MS || process.env.OLLAMA_TIMEOUT_MS)) || 60000,
    GEMINI_URLS: (process.env.GEMINI_URLS || '').split(',').map(u => cleanEnv(u, true)).filter(u => u),
    MAX_AUTO_TURNS: Number(cleanEnv(process.env.GOLEM_MAX_AUTO_TURNS)) || 5,
    MAX_RESPONSE_WORDS: Number(cleanEnv(process.env.GOLEM_MAX_RESPONSE_WORDS)) || 0,
};

// 驗證關鍵 Token
if (isPlaceholder(CONFIG.TG_TOKEN)) { console.warn("⚠️ [Config] TELEGRAM_TOKEN 無效，TG Bot 預設不啟動。"); CONFIG.TG_TOKEN = ""; }
if (isPlaceholder(CONFIG.DC_TOKEN)) { console.warn("⚠️ [Config] DISCORD_TOKEN 無效，Discord Bot 不啟動。"); CONFIG.DC_TOKEN = ""; }
if (CONFIG.API_KEYS.some(isPlaceholder)) CONFIG.API_KEYS = CONFIG.API_KEYS.filter(k => !isPlaceholder(k));

// 🚀 已簡化為單機模式 (Single-Golem Architecture)
let GOLEMS_CONFIG = [];
const GOLEM_MODE = "SINGLE";

// 單機模式：只使用 .env 配置
if (CONFIG.TG_TOKEN || CONFIG.DC_TOKEN) {
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

// 計算路徑前綴 (固定為 single)
const MODE_DIR = 'single';
let LOG_BASE_DIR = path.join(process.cwd(), 'logs', MODE_DIR);

// 🎯 Profile 導向的核心路徑計算 (Titan Chronos 模式)
const getMemoryBaseDir = () => {
    // 優先序：
    // 1. 若有設定 PLAYWRIGHT_PROFILE，則使用 ./profiles/{profile}
    // 2. 若無 profile 但有手動設定 USER_DATA_DIR，則遵循之
    // 3. 以上皆無，回退至 ./golem_memory (向後相容)
    const profile = CONFIG.PLAYWRIGHT_PROFILE;
    if (profile) return path.resolve(`./profiles/${profile}`);
    
    return path.resolve(CONFIG.USER_DATA_DIR || './golem_memory');
};

const getKnowledgeBaseDir = () => path.join(getMemoryBaseDir(), 'knowledge');

// 🔄 導出動態路徑
const paths = {
    get MEMORY_BASE_DIR() { return getMemoryBaseDir(); },
    get KNOWLEDGE_BASE_DIR() { return getKnowledgeBaseDir(); }
};

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
    CONFIG.PLAYWRIGHT_PROFILE = cleanEnv(process.env.PLAYWRIGHT_PROFILE || '');
    CONFIG.USER_DATA_DIR = cleanEnv(process.env.USER_DATA_DIR || '', true);

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
    CONFIG.TG_ENGINE = cleanEnv(process.env.TG_ENGINE) || 'grammy';
    CONFIG.CB_TG_TIMEOUT_MS = cleanEnv(process.env.CB_TG_TIMEOUT_MS) || '10000';
    CONFIG.CB_TG_RESET_MS = cleanEnv(process.env.CB_TG_RESET_MS) || '15000';
    CONFIG.CB_TG_ERROR_PCT = cleanEnv(process.env.CB_TG_ERROR_PCT) || '30';
    CONFIG.GOLEM_BACKEND = normalizeBackend(process.env.GOLEM_BACKEND);
    CONFIG.AWAKE_INTERVAL_MIN = Number(cleanEnv(process.env.GOLEM_AWAKE_INTERVAL_MIN)) || 10;
    CONFIG.AWAKE_INTERVAL_MAX = Number(cleanEnv(process.env.GOLEM_AWAKE_INTERVAL_MAX)) || 60;
    CONFIG.SLEEP_START = process.env.GOLEM_SLEEP_START !== undefined ? Number(cleanEnv(process.env.GOLEM_SLEEP_START)) : 1;
    CONFIG.SLEEP_END = process.env.GOLEM_SLEEP_END !== undefined ? Number(cleanEnv(process.env.GOLEM_SLEEP_END)) : 7;
    CONFIG.USER_INTERESTS = cleanEnv(process.env.USER_INTERESTS || '科技圈熱門話題,全球趣聞', true);
    CONFIG.ENABLE_LOG_NOTIFICATIONS = (process.env.ENABLE_LOG_NOTIFICATIONS === 'true');
    CONFIG.ARCHIVE_CHECK_INTERVAL = Number(cleanEnv(process.env.ARCHIVE_CHECK_INTERVAL)) || 30;
    CONFIG.ARCHIVE_THRESHOLD_YESTERDAY = Number(cleanEnv(process.env.ARCHIVE_THRESHOLD_YESTERDAY)) || 3;
    CONFIG.ARCHIVE_THRESHOLD_TODAY = Number(cleanEnv(process.env.ARCHIVE_THRESHOLD_TODAY)) || 1;
    CONFIG.EMBEDDING_PROVIDER = normalizeEmbeddingProvider(process.env.GOLEM_EMBEDDING_PROVIDER);
    CONFIG.LOCAL_EMBEDDING_MODEL = cleanEnv(process.env.GOLEM_LOCAL_EMBEDDING_MODEL) || 'Xenova/bge-small-zh-v1.5';
    CONFIG.OLLAMA_BASE_URL = cleanEnv(process.env.GOLEM_OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434', true);
    CONFIG.OLLAMA_BRAIN_MODEL = cleanEnv(process.env.GOLEM_OLLAMA_BRAIN_MODEL || process.env.OLLAMA_BRAIN_MODEL || 'llama3.1:8b', true);
    CONFIG.OLLAMA_EMBEDDING_MODEL = cleanEnv(process.env.GOLEM_OLLAMA_EMBEDDING_MODEL || process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text', true);
    CONFIG.OLLAMA_RERANK_MODEL = cleanEnv(process.env.GOLEM_OLLAMA_RERANK_MODEL || process.env.OLLAMA_RERANK_MODEL || '', true);
    CONFIG.OLLAMA_TIMEOUT_MS = Number(cleanEnv(process.env.GOLEM_OLLAMA_TIMEOUT_MS || process.env.OLLAMA_TIMEOUT_MS)) || 60000;
    CONFIG.GOLEM_MEMORY_MODE = cleanEnv(process.env.GOLEM_MEMORY_MODE) || 'gbrain';

    const newGeminiUrls = (process.env.GEMINI_URLS || '').split(',').map(u => cleanEnv(u, true)).filter(u => u);
    CONFIG.GEMINI_URLS.length = 0;
    CONFIG.GEMINI_URLS.push(...newGeminiUrls);

    CONFIG.MAX_AUTO_TURNS = Number(cleanEnv(process.env.GOLEM_MAX_AUTO_TURNS)) || 5;
    CONFIG.MAX_RESPONSE_WORDS = Number(cleanEnv(process.env.GOLEM_MAX_RESPONSE_WORDS)) || 0;

    // 重新載入 GOLEMS_CONFIG (固定為單機模式)
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

    // ✅ [後端簡化] 模式固定為 SINGLE
    console.log(`🔄 [Config] 設定已熱重載完成 (Active API Keys: ${CONFIG.API_KEYS.length}, Golems: ${GOLEMS_CONFIG.length})`);
};

module.exports = {
    cleanEnv,
    isPlaceholder,
    normalizeBackend,
    normalizeEmbeddingProvider,
    CONFIG,
    GOLEMS_CONFIG,
    GOLEM_MODE,
    MODE_DIR,
    LOG_BASE_DIR,
    get MEMORY_BASE_DIR() { return paths.MEMORY_BASE_DIR; },
    get KNOWLEDGE_BASE_DIR() { return paths.KNOWLEDGE_BASE_DIR; },
    reloadConfig
};
