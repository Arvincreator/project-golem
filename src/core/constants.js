// ============================================================
// ⚙️ GolemBrain Constants
// ============================================================

/** @enum {number} 時間相關常數 (毫秒) */
const TIMINGS = Object.freeze({
    INPUT_DELAY: 800,
    SYSTEM_DELAY: 2000,
    POLL_INTERVAL: 500,
    TIMEOUT: 300000,           // 5 分鐘總超時
    BROWSER_RETRY_DELAY: 1000,
    CDP_TIMEOUT: 5000,
});

/** @enum {number} 限制與閾值 */
const LIMITS = Object.freeze({
    MAX_INTERACT_RETRY: 3,
    MAX_BROWSER_RETRY: 3,
    STABLE_THRESHOLD_COMPLETE: 10,   // 已收到 BEGIN 後，停頓 10 次 (5秒) 強制截斷
    STABLE_THRESHOLD_THINKING: 60,   // 未收到 BEGIN，Thinking Mode 容忍 60 次 (30秒)
});

/** @enum {string} Gemini 相關 URL */
const URLS = Object.freeze({
    GEMINI_APP: 'https://gemini.google.com/app',
});

/** 瀏覽器啟動參數 */
const BROWSER_ARGS = Object.freeze([
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-setuid-sandbox',
    '--window-size=1280,900',
    '--disable-gpu',
]);

/** Chrome Lock 檔案名稱 */
const LOCK_FILES = Object.freeze(['SingletonLock', 'SingletonSocket', 'SingletonCookie']);

/** 日誌保留時間 (毫秒) - 預設 1 天 */
const LOG_RETENTION_MS = 24 * 60 * 60 * 1000;

module.exports = {
    TIMINGS,
    LIMITS,
    URLS,
    BROWSER_ARGS,
    LOCK_FILES,
    LOG_RETENTION_MS,
};
