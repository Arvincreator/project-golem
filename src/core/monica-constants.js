// Monica.im — Constants & Platform Rules
// 16 user-specified models: 8 Advanced (Web only) + 8 Basic (Web + API)
// Web and API models are SEPARATE — use resolveForBrain() to get the right ID

// === MODEL_REGISTRY: 16 user-specified models ===
const MODEL_REGISTRY = {
    // === Advanced (Web only) ===
    'gpt-5.4':           { web: { keywords: ['GPT-5.4'] },           api: null,                        tier: 'advanced' },
    'gpt-5.3-codex':     { web: { keywords: ['GPT-5.3 Codex'] },     api: null,                        tier: 'advanced' },
    'gemini-3.1-pro':    { web: { keywords: ['Gemini 3.1 Pro'] },     api: null,                        tier: 'advanced' },
    'gemini-3-pro':      { web: { keywords: ['Gemini 3 Pro'] },       api: null,                        tier: 'advanced' },
    'claude-4.6-sonnet': { web: { keywords: ['Claude 4.6 Sonnet'] },  api: null,                        tier: 'advanced' },
    'claude-4.5-sonnet': { web: { keywords: ['Claude 4.5 Sonnet'] },  api: null,                        tier: 'advanced' },
    'grok-4':            { web: { keywords: ['Grok 4'] },             api: null,                        tier: 'advanced' },
    'grok-3':            { web: { keywords: ['Grok 3'] },             api: { id: 'x-ai/grok-3-beta' }, tier: 'advanced' },

    // === Basic (Web + API) ===
    'gpt-4o':            { web: { keywords: ['GPT-4o'] },             api: { id: 'gpt-4o' },           tier: 'basic', context: 128000, maxOutput: 16384, rpm: 100, costIn: 2.50, costOut: 10.00 },
    'gpt-4o-mini':       { web: { keywords: ['GPT-4o mini'] },        api: { id: 'gpt-4o-mini' },      tier: 'basic', context: 128000, maxOutput: 16384, rpm: 500, costIn: 0.15, costOut: 0.60 },
    'gpt-4.1':           { web: { keywords: ['GPT-4.1'] },            api: { id: 'gpt-4.1' },          tier: 'basic', context: 128000, maxOutput: 32768, rpm: 100, costIn: 2.00, costOut: 8.00 },
    'gpt-4.1-mini':      { web: { keywords: ['GPT-4.1 mini'] },       api: { id: 'gpt-4.1-mini' },     tier: 'basic', context: 128000, maxOutput: 16384, rpm: 500, costIn: 0.40, costOut: 1.60 },
    'gpt-4.1-nano':      { web: { keywords: ['GPT-4.1 nano'] },       api: { id: 'gpt-4.1-nano' },     tier: 'basic', context: 128000, maxOutput: 16384, rpm: 500, costIn: 0.10, costOut: 0.40 },
    'gpt-4':             { web: { keywords: ['GPT-4'] },              api: null,                        tier: 'basic' },
    'gemini-3-flash':    { web: { keywords: ['Gemini 3 Flash'] },      api: null,                       tier: 'basic' },
    'gemini-2.5-pro':    { web: { keywords: ['Gemini 2.5 Pro'] },      api: { id: 'gemini-2.5-pro' },  tier: 'basic', context: 1000000, maxOutput: 8192, rpm: 100, costIn: 1.25, costOut: 10.00 },

    // === v10.5: Claude Opus 4.6 (direct API via ClaudeBrain) ===
    'claude-opus-4.6':   { web: null,                                  api: { id: 'claude-opus-4-6-20250515' }, tier: 'basic', context: 200000, maxOutput: 32000, rpm: 50, costIn: 15.00, costOut: 75.00 },
};

// Web-only models → API fallback (when Web brain fails)
const CROSS_BRAIN_FALLBACKS = {
    'gpt-5.4':           'gpt-4.1',
    'gpt-5.3-codex':     'gpt-4.1',
    'gemini-3.1-pro':    'gemini-2.5-pro',
    'gemini-3-pro':      'gemini-2.5-pro',
    'gemini-3-flash':    'gpt-4.1-nano',
    'claude-4.6-sonnet': 'gpt-4.1',
    'claude-4.5-sonnet': 'gpt-4.1',
    'grok-4':            'grok-3',
    'gpt-4':             'gpt-4o',
};

// Resolve a canonical model name for a specific brain type
// Returns { model, keywords, apiId } or null if unsupported
function resolveForBrain(model, brainType) {
    const entry = MODEL_REGISTRY[model];
    if (!entry) return null;

    if (brainType === 'web') {
        if (entry.web) {
            return { model, keywords: entry.web.keywords };
        }
        return null;
    }

    if (brainType === 'api') {
        // Direct API support
        if (entry.api) {
            return { model, apiId: entry.api.id };
        }
        // Cross-brain fallback
        const fallbackModel = CROSS_BRAIN_FALLBACKS[model];
        if (fallbackModel) {
            const fallbackEntry = MODEL_REGISTRY[fallbackModel];
            if (fallbackEntry && fallbackEntry.api) {
                return { model: fallbackModel, apiId: fallbackEntry.api.id, fallbackFrom: model };
            }
        }
        return null;
    }

    return null;
}

// --- Legacy MODEL_SPECS wrapper (for backward compatibility) ---
// Build MODEL_SPECS from MODEL_REGISTRY for code that imports it
const MODEL_SPECS = {};
for (const [name, entry] of Object.entries(MODEL_REGISTRY)) {
    if (entry.api || entry.context) {
        MODEL_SPECS[name] = {
            apiId: entry.api ? entry.api.id : name,
            context: entry.context || 128000,
            maxOutput: entry.maxOutput || 8192,
            rpm: entry.rpm || 100,
            tpm: (entry.rpm || 100) * 1000,
            costIn: entry.costIn || 2.50,
            costOut: entry.costOut || 10.00,
            tier: entry.tier || 'basic',
        };
    }
}

function getModelSpec(model) {
    return MODEL_SPECS[model] || { apiId: model, context: 128000, maxOutput: 8192, rpm: 100, tpm: 100000, costIn: 2.50, costOut: 10.00, tier: 'basic' };
}

function estimateTokens(text) {
    if (!text) return 0;
    const cjkCount = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    const latinCount = text.length - cjkCount;
    return Math.ceil(cjkCount / 1.5 + latinCount / 4);
}

// 8-dimension routing rules — shared between RouterBrain and model-router skill
// Three-brain assignment: GPT-5.4 (reasoning+creative), Grok-4 (code+realtime), Claude 4.6 (analysis+refactor)
const ROUTING_RULES = [
    { name: 'realtime',
      patterns: /real.?time|即時|live|streaming|websocket|current|news|trending|hotfix|urgent.?fix|最新|時事/i,
      model: 'grok-4' },
    { name: 'refactor',
      patterns: /refactor|重構|redesign|clean.?up|simplify|optimize.?code|DRY|SOLID|架構|code.?review|pull.?request|\bPR\b/i,
      model: 'claude-4.6-sonnet' },
    { name: 'code',
      patterns: /code|function|debug|error|bug|implement|程式|代碼|修復|開發|script|api|class|module|TypeError|npm|git|python|java|javascript|rust|排序|sort|array|list|regex|sql|html|css/i,
      model: 'grok-4' },
    { name: 'reasoning',
      patterns: /math|logic|prove|theorem|calculate|equation|數學|邏輯|推理|計算|證明|solve|algorithm|求解|方程|幾何|x²|²|³|∑|∫|≥|≤|≠|\d+x\s*[+\-=]/i,
      model: 'gpt-5.4' },
    { name: 'creative',
      patterns: /write|story|creative|poem|essay|blog|文章|寫|創作|文案|小說|詩|設計|品牌|marketing/i,
      model: 'gpt-5.4' },
    { name: 'fast',
      patterns: /translate|翻譯|summarize|摘要|quick|簡單|短|TL;DR|explain briefly|快/i,
      model: 'gpt-4.1-mini' },
    { name: 'analysis',
      patterns: /analyze|research|compare|evaluate|分析|研究|比較|評估|報告|audit|review|策略/i,
      model: 'claude-4.6-sonnet' },
    { name: 'flexible',
      patterns: /open.?source|自由|flexible|general|通用|聊天|chat|conversation|日常/i,
      model: 'gpt-4o' },
];

module.exports = {
    URLS: {
        MONICA_APP: 'https://monica.im/home/chat',
        MONICA_LOGIN: 'https://monica.im/login',
        MONICA_API: 'https://openapi.monica.im/v1',
    },
    TIMINGS: {
        INPUT_DELAY: 800,
        SYSTEM_DELAY: 2000,
        POLL_INTERVAL: 500,
        TIMEOUT: 300000,
        BROWSER_RETRY_DELAY: 1000,
        MIN_SEND_INTERVAL: 3000,
        MODEL_SWITCH_DELAY: 1500,
        WAIT_FOR_READY: 15000,
    },
    LIMITS: {
        MAX_INTERACT_RETRY: 3,
        MAX_BROWSER_RETRY: 3,
        STABLE_THRESHOLD_COMPLETE: 10,
        STABLE_THRESHOLD_THINKING: 60,
        EST_CHARS_PER_TOKEN: 4,
        MAX_DAILY_CALLS: 500,
    },
    BROWSER_ARGS: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--window-size=1400,900',
        '--disable-gpu',
    ],
    DEFAULT_SELECTORS: {
        input: 'textarea.ant-input[placeholder="Ask me anything"]',
        send: 'ENTER_KEY',
        response: 'div[class*="chat-main-wrapper"] div[class*="markdown"], div[class*="message-content"]',
        modelPicker: 'div[class*="model"], button[class*="model"]',
    },
    SELECTOR_HINTS: {
        input: 'Monica.im 的 Ant Design textarea 聊天輸入框，class 含 ant-input，placeholder="Ask me anything"',
        send: 'Monica.im 的傳送按鈕（可能不存在，用 Enter 鍵發送）',
        response: 'Monica.im AI 回覆的最新訊息容器，可能含 markdown class 或 message-content',
    },
    // DOM keyword matching for web brain model picker (from MODEL_REGISTRY)
    MODELS: Object.fromEntries(
        Object.entries(MODEL_REGISTRY)
            .filter(([, e]) => e.web)
            .map(([name, e]) => [name, e.web.keywords])
    ),
    MODEL_REGISTRY,
    CROSS_BRAIN_FALLBACKS,
    resolveForBrain,
    MODEL_SPECS,
    getModelSpec,
    estimateTokens,
    ROUTING_RULES,
};
