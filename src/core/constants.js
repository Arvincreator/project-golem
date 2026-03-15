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

/** 🏛️ 金字塔式分層記憶保留策略 */
const MEMORY_TIERS = Object.freeze({
    // Tier 0: 每小時原始日誌
    HOURLY_RETENTION_MS: 3 * 24 * 60 * 60 * 1000,    // 72 小時
    // Tier 1: 每日摘要
    DAILY_RETENTION_MS: 90 * 24 * 60 * 60 * 1000,     // 90 天
    DAILY_SUMMARY_CHARS: 1500,
    // Tier 2: 每月精華
    MONTHLY_RETENTION_MS: 5 * 365 * 24 * 60 * 60 * 1000, // 5 年
    MONTHLY_SUMMARY_CHARS: 3000,
    // Tier 3: 年度回顧 (永久)
    YEARLY_SUMMARY_CHARS: 5000,
    // Tier 4: 紀元里程碑 (永久)
    ERA_SUMMARY_CHARS: 8000,
});

/** 日誌保留時間 (毫秒) - 向下相容 */
const LOG_RETENTION_MS = MEMORY_TIERS.HOURLY_RETENTION_MS;

/** 🛡️ Anti-Hallucination Rules (injected into brain system prompt) */
const ANTI_HALLUCINATION_RULES = `## 反幻覺核心規則 (ANTI-HALLUCINATION)
1. 不知道就說「我目前沒有這個資訊」— 絕不編造
2. RAG 查無結果時回報「知識庫沒有相關資料」— 不技術性迴避
3. 引用資料必須標明來源和信心等級 (HIGH/MEDIUM/LOW)
4. 信心=LOW 的資訊必須加警告「此資訊未經驗證」
5. 超出能力範圍直接說明，不裝懂
6. 數字/日期/名稱不確定時用「大約」「可能」修飾`;

module.exports = {
    TIMINGS,
    LIMITS,
    URLS,
    BROWSER_ARGS,
    LOCK_FILES,
    LOG_RETENTION_MS,
    MEMORY_TIERS,
    ANTI_HALLUCINATION_RULES,
};
