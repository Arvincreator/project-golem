require('dotenv').config();

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
if (isPlaceholder(CONFIG.TG_TOKEN)) { console.warn("⚠️ [Config] TELEGRAM_TOKEN 無效，TG Bot 不啟動。"); CONFIG.TG_TOKEN = ""; }
if (isPlaceholder(CONFIG.DC_TOKEN)) { console.warn("⚠️ [Config] DISCORD_TOKEN 無效，Discord Bot 不啟動。"); CONFIG.DC_TOKEN = ""; }
if (CONFIG.API_KEYS.some(isPlaceholder)) CONFIG.API_KEYS = CONFIG.API_KEYS.filter(k => !isPlaceholder(k));

// --- 🩺 啟動驗證 ---
function validateConfig() {
    const errors = [];
    const warnings = [];

    // 至少一個 messaging platform
    if (!CONFIG.TG_TOKEN && !CONFIG.DC_TOKEN) {
        errors.push('未設定任何 Bot Token (TELEGRAM_TOKEN 或 DISCORD_TOKEN)，至少需要一個');
    }

    // Gemini API keys
    if (CONFIG.API_KEYS.length === 0) {
        warnings.push('GEMINI_API_KEYS 為空，DOMDoctor 自修復功能不可用');
    }

    // Admin ID
    if (!CONFIG.ADMIN_ID && !CONFIG.DISCORD_ADMIN_ID) {
        warnings.push('未設定 ADMIN_ID，所有人都能使用 bot');
    }

    // 報告結果
    if (errors.length > 0) {
        console.error('\n❌ [Config] 啟動失敗 — 配置錯誤:');
        errors.forEach(e => console.error(`   • ${e}`));
        console.error('   → 請檢查 .env 檔案 (可參考 .env.example)\n');
        process.exit(1);
    }

    if (warnings.length > 0) {
        warnings.forEach(w => console.warn(`⚠️ [Config] ${w}`));
    }
}

function printConfigSummary() {
    const pkg = (() => { try { return require('../../package.json'); } catch { return { version: 'unknown' }; } })();
    const features = [
        ['Telegram Bot',  CONFIG.TG_TOKEN ? '✅ ON' : '❌ OFF'],
        ['Discord Bot',   CONFIG.DC_TOKEN ? '✅ ON' : '❌ OFF'],
        ['Gemini API Keys', CONFIG.API_KEYS.length > 0 ? `✅ ${CONFIG.API_KEYS.length} key(s)` : '❌ None'],
        ['Auth Mode',     CONFIG.TG_AUTH_MODE],
        ['Admin ID',      CONFIG.ADMIN_ID || '(not set)'],
        ['Memory Dir',    CONFIG.USER_DATA_DIR],
        ['Dashboard',     process.env.ENABLE_WEB_DASHBOARD === 'true' ? '✅ ON' : '❌ OFF'],
    ];

    console.log(`\n🦞 Project Golem v${pkg.version}`);
    console.log('┌──────────────────┬───────────────────────┐');
    console.log('│ Feature          │ Status                │');
    console.log('├──────────────────┼───────────────────────┤');
    features.forEach(([name, status]) => {
        console.log(`│ ${name.padEnd(16)} │ ${status.padEnd(21)} │`);
    });
    console.log('└──────────────────┴───────────────────────┘\n');
}

module.exports = {
    cleanEnv,
    isPlaceholder,
    CONFIG,
    validateConfig,
    printConfigSummary
};
