// ============================================================
// Monica Quota — 配額追蹤 + 智能省額技能
// Monica.im MAX tier quota management for Project Golem
// ============================================================
const fs = require('fs');
const path = require('path');

// ── Model Tier Classification ──
const BASIC_MODELS = {
    'gpt-4o-mini':      { label: 'GPT-4o mini',       tier: 'basic' },
    'deepseek-v3':      { label: 'DeepSeek V3',        tier: 'basic' },
    'deepseek-r1':      { label: 'DeepSeek R1',        tier: 'basic' },
    'claude-3.5-haiku': { label: 'Claude 3.5 Haiku',   tier: 'basic' },
    'gemini-flash':     { label: 'Gemini Flash',        tier: 'basic' },
};

const ADVANCED_MODELS = {
    'gpt-5.2':           { label: 'GPT-5.2',           tier: 'advanced' },
    'gpt-5.1':           { label: 'GPT-5.1',           tier: 'advanced' },
    'claude-4.5-sonnet': { label: 'Claude 4.5 Sonnet',  tier: 'advanced' },
    'claude-4.5-opus':   { label: 'Claude 4.5 Opus',    tier: 'advanced', reserved: true },
    'gemini-3-pro':      { label: 'Gemini 3 Pro',       tier: 'advanced' },
};

// ── Best basic model per task type ──
const BASIC_ROUTING = {
    code:       'gpt-4o-mini',
    analysis:   'deepseek-r1',
    complex:    'deepseek-r1',
    creative:   'deepseek-v3',
    chat:       'deepseek-v3',
    multimodal: 'gemini-flash',
};

// ── Default config ──
const DEFAULT_CONFIG = {
    monthlyAdvancedBudget: 3000,
    dailyFallbackLimit: 100,
    warningPct: 80,
    criticalPct: 95,
    historyDays: 30,
};

function freshQuota() {
    const now = new Date();
    return {
        version: 1,
        monthly: {
            period: now.toISOString().slice(0, 7),
            advancedCount: 0,
            totalCount: 0,
            perModel: {},
        },
        daily: {
            date: now.toISOString().slice(0, 10),
            advancedCount: 0,
            totalCount: 0,
            perModel: {},
        },
        history: [],
        config: { ...DEFAULT_CONFIG },
    };
}

function quotaPath(userDataDir) {
    return path.join(userDataDir || process.cwd(), 'quota_usage.json');
}

/**
 * Load quota from disk. Auto-resets on new day/month.
 */
function loadQuota(userDataDir) {
    const fpath = quotaPath(userDataDir);
    let quota;
    try {
        if (fs.existsSync(fpath)) {
            quota = JSON.parse(fs.readFileSync(fpath, 'utf-8'));
        } else {
            quota = freshQuota();
        }
    } catch (e) {
        console.warn(`[MonicaQuota] JSON parse failed, resetting: ${e.message}`);
        quota = freshQuota();
    }

    // Ensure config exists
    if (!quota.config) quota.config = { ...DEFAULT_CONFIG };
    if (!quota.history) quota.history = [];

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const thisMonth = now.toISOString().slice(0, 7);

    // Daily reset
    if (quota.daily && quota.daily.date !== today) {
        // Archive previous day
        if (quota.daily.date && quota.daily.totalCount > 0) {
            quota.history.push({
                date: quota.daily.date,
                advanced: quota.daily.advancedCount || 0,
                total: quota.daily.totalCount || 0,
                perModel: quota.daily.perModel || {},
            });
            // Trim history
            const maxDays = quota.config.historyDays || 30;
            if (quota.history.length > maxDays) {
                quota.history = quota.history.slice(-maxDays);
            }
        }
        quota.daily = { date: today, advancedCount: 0, totalCount: 0, perModel: {} };
    }

    // Monthly reset
    if (quota.monthly && quota.monthly.period !== thisMonth) {
        quota.monthly = { period: thisMonth, advancedCount: 0, totalCount: 0, perModel: {} };
    }

    // Ensure fields
    if (!quota.daily) quota.daily = { date: today, advancedCount: 0, totalCount: 0, perModel: {} };
    if (!quota.monthly) quota.monthly = { period: thisMonth, advancedCount: 0, totalCount: 0, perModel: {} };

    return quota;
}

/**
 * Save quota atomically (write tmp then rename).
 */
function saveQuota(userDataDir, quota) {
    const fpath = quotaPath(userDataDir);
    const tmp = fpath + '.tmp';
    try {
        fs.writeFileSync(tmp, JSON.stringify(quota, null, 2));
        fs.renameSync(tmp, fpath);
    } catch (e) {
        console.error(`[MonicaQuota] Save failed: ${e.message}`);
        // Try direct write as fallback
        try { fs.writeFileSync(fpath, JSON.stringify(quota, null, 2)); } catch (_) {}
    }
}

/**
 * Record an advanced model usage.
 */
function recordAdvancedUsage(userDataDir, modelId) {
    const quota = loadQuota(userDataDir);
    quota.daily.advancedCount++;
    quota.daily.totalCount++;
    quota.daily.perModel[modelId] = (quota.daily.perModel[modelId] || 0) + 1;
    quota.monthly.advancedCount++;
    quota.monthly.totalCount++;
    quota.monthly.perModel[modelId] = (quota.monthly.perModel[modelId] || 0) + 1;
    saveQuota(userDataDir, quota);
    console.log(`[MonicaQuota] Recorded: ${modelId} (daily: ${quota.daily.advancedCount}, monthly: ${quota.monthly.advancedCount})`);
}

/**
 * Record a basic model usage (no advanced credits consumed).
 */
function recordBasicUsage(userDataDir, modelId) {
    const quota = loadQuota(userDataDir);
    quota.daily.totalCount++;
    quota.monthly.totalCount++;
    saveQuota(userDataDir, quota);
}

/**
 * Check if advanced models are allowed.
 * Returns { allowed, reason, dailyRemaining, monthlyPct, level }
 */
function canUseAdvanced(userDataDir) {
    const quota = loadQuota(userDataDir);
    const cfg = quota.config;
    const monthlyUsed = quota.monthly.advancedCount;
    const monthlyPct = Math.round((monthlyUsed / cfg.monthlyAdvancedBudget) * 100);

    // Monthly budget exceeded → check daily fallback
    if (monthlyUsed >= cfg.monthlyAdvancedBudget) {
        const dailyUsed = quota.daily.advancedCount;
        const dailyRemaining = Math.max(0, cfg.dailyFallbackLimit - dailyUsed);
        if (dailyRemaining <= 0) {
            return { allowed: false, reason: 'daily_limit', dailyRemaining: 0, monthlyPct, level: 'exhausted' };
        }
        return { allowed: true, reason: 'daily_fallback', dailyRemaining, monthlyPct, level: 'critical' };
    }

    // Determine level
    let level = 'ok';
    if (monthlyPct >= cfg.criticalPct) level = 'critical';
    else if (monthlyPct >= cfg.warningPct) level = 'warning';

    const monthlyRemaining = cfg.monthlyAdvancedBudget - monthlyUsed;
    return { allowed: true, reason: 'budget_ok', dailyRemaining: cfg.dailyFallbackLimit, monthlyPct, level, monthlyRemaining };
}

/**
 * Higher-level decision: should this task use advanced models?
 * @param {string} userDataDir
 * @param {string} taskType - code, creative, analysis, chat, multimodal, complex
 * @param {string} complexity - simple, medium, complex
 * @returns {boolean}
 */
function shouldUseAdvanced(userDataDir, taskType, complexity) {
    // Simple tasks and chat always use basic (free)
    if (complexity === 'simple') return false;
    if (taskType === 'chat' && complexity !== 'complex') return false;

    const status = canUseAdvanced(userDataDir);
    if (!status.allowed) return false;

    // Budget-aware routing
    if (status.level === 'critical') {
        // Only complex tasks get advanced at critical level
        return taskType === 'complex' || complexity === 'complex';
    }
    if (status.level === 'warning') {
        // Complex and code get advanced at warning level
        return taskType === 'complex' || taskType === 'code' || complexity === 'complex';
    }

    // Budget OK → medium+ complexity non-chat tasks get advanced
    return complexity !== 'simple';
}

/**
 * Get the best basic model for a given task type.
 */
function getBasicModelForTask(taskType) {
    return BASIC_ROUTING[taskType] || 'deepseek-v3';
}

/**
 * Check if a model ID is advanced.
 */
function isAdvancedModel(modelId) {
    return modelId in ADVANCED_MODELS;
}

// ── Skill run() handler ──

async function run(ctx) {
    const args = ctx.args || {};
    const action = args.action || 'status';
    const userDataDir = ctx.brain ? ctx.brain.userDataDir : process.cwd();

    if (action === 'status') {
        const quota = loadQuota(userDataDir);
        const status = canUseAdvanced(userDataDir);
        const cfg = quota.config;

        let msg = `📊 [Monica Quota 狀態]\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `📅 今日 (${quota.daily.date}):\n`;
        msg += `  Advanced: ${quota.daily.advancedCount} 次 | Total: ${quota.daily.totalCount} 次\n`;

        if (Object.keys(quota.daily.perModel).length > 0) {
            msg += `  模型: ${Object.entries(quota.daily.perModel).map(([k, v]) => `${k}(${v})`).join(', ')}\n`;
        }

        msg += `\n📆 本月 (${quota.monthly.period}):\n`;
        msg += `  Advanced: ${quota.monthly.advancedCount}/${cfg.monthlyAdvancedBudget} (${status.monthlyPct}%)\n`;
        msg += `  Total: ${quota.monthly.totalCount} 次\n`;

        const bar = progressBar(status.monthlyPct);
        msg += `  [${bar}] ${status.monthlyPct}%\n`;

        if (Object.keys(quota.monthly.perModel).length > 0) {
            msg += `  模型: ${Object.entries(quota.monthly.perModel).map(([k, v]) => `${k}(${v})`).join(', ')}\n`;
        }

        msg += `\n🚦 Level: ${status.level.toUpperCase()}`;
        if (status.level === 'exhausted') msg += ' — 今日已無 Advanced 額度！';
        else if (status.level === 'critical') msg += ' — 僅限複雜任務使用 Advanced';
        else if (status.level === 'warning') msg += ' — 節省模式，簡單任務走 Basic';

        return msg;
    }

    if (action === 'budget') {
        const quota = loadQuota(userDataDir);
        const status = canUseAdvanced(userDataDir);
        const cfg = quota.config;
        const remaining = cfg.monthlyAdvancedBudget - quota.monthly.advancedCount;
        const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
        const dayOfMonth = new Date().getUTCDate();
        const daysLeft = daysInMonth - dayOfMonth;
        const dailyAvg = quota.monthly.advancedCount / Math.max(dayOfMonth, 1);
        const projected = Math.round(dailyAvg * daysInMonth);

        let msg = `💰 [配額預算]\n`;
        msg += `剩餘 Advanced: ${remaining}/${cfg.monthlyAdvancedBudget}\n`;
        msg += `本月剩餘天數: ${daysLeft}\n`;
        msg += `日均消耗: ${dailyAvg.toFixed(1)}\n`;
        msg += `月底預估: ${projected}/${cfg.monthlyAdvancedBudget}\n`;
        if (projected > cfg.monthlyAdvancedBudget) {
            msg += `⚠️ 按目前速度將超額 ${projected - cfg.monthlyAdvancedBudget} 次！\n`;
            msg += `建議日均上限: ${Math.floor(remaining / Math.max(daysLeft, 1))} 次/天`;
        } else {
            msg += `✅ 預算充足，可安心使用`;
        }
        return msg;
    }

    if (action === 'history') {
        const quota = loadQuota(userDataDir);
        const days = parseInt(args.days) || 7;
        const recent = quota.history.slice(-days);

        if (recent.length === 0) return 'ℹ️ 尚無歷史紀錄。';

        let msg = `📈 [最近 ${recent.length} 天使用紀錄]\n`;
        for (const day of recent) {
            msg += `${day.date}: Advanced ${day.advanced} | Total ${day.total}`;
            if (day.perModel && Object.keys(day.perModel).length > 0) {
                msg += ` (${Object.entries(day.perModel).map(([k, v]) => `${k}:${v}`).join(',')})`;
            }
            msg += '\n';
        }
        return msg;
    }

    if (action === 'reset') {
        const quota = freshQuota();
        saveQuota(userDataDir, quota);
        return '✅ 配額計數器已重置。';
    }

    return `❌ 未知 action: ${action} (可用: status, budget, history, reset)`;
}

function progressBar(pct) {
    const filled = Math.round(pct / 5);
    const empty = 20 - filled;
    return '█'.repeat(Math.min(filled, 20)) + '░'.repeat(Math.max(empty, 0));
}

module.exports = {
    name: 'MONICA_QUOTA',
    description: 'Monica.im MAX 配額追蹤與智能省額管理',
    run,

    // Exported API for model-router integration
    loadQuota,
    saveQuota,
    canUseAdvanced,
    shouldUseAdvanced,
    recordAdvancedUsage,
    recordBasicUsage,
    getBasicModelForTask,
    isAdvancedModel,
    BASIC_MODELS,
    ADVANCED_MODELS,
    BASIC_ROUTING,
};
