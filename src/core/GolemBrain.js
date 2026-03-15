// ============================================================
// Golem Brain - Dual-Engine Architecture (API / Browser)
// ============================================================
const path = require('path');
const ConfigManager = require('../config');
const DOMDoctor = require('../services/DOMDoctor');
const BrowserMemoryDriver = require('../memory/BrowserMemoryDriver');
const SystemQmdDriver = require('../memory/SystemQmdDriver');
const SystemNativeDriver = require('../memory/SystemNativeDriver');

const BrowserLauncher = require('./BrowserLauncher');
const ProtocolFormatter = require('../services/ProtocolFormatter');
const PageInteractor = require('./PageInteractor');
const ChatLogManager = require('../managers/ChatLogManager');
const SkillIndexManager = require('../managers/SkillIndexManager');
const NodeRouter = require('./NodeRouter');
const { URLS, AI_PROVIDERS, ACTIVE_PROVIDER } = require('./constants');
const ApiLLMClient = require('../services/ApiLLMClient');

// RAG client (optional)
let aragClient = null;
try {
    const AragClient = require('../services/AragClient');
    aragClient = new AragClient();
} catch (e) { }

class GolemBrain {
    constructor(options = {}) {
        this.golemId = options.golemId || 'default';
        this.userDataDir = options.userDataDir || path.resolve(ConfigManager.CONFIG.USER_DATA_DIR || './golem_memory');
        this.skillIndex = new SkillIndexManager(this.userDataDir);

        // Engine mode: 'api' = no Puppeteer, 'browser' = Puppeteer
        this.engineMode = (process.env.GOLEM_BRAIN_ENGINE || 'browser').toLowerCase();
        console.log(`[GolemBrain] Engine: ${this.engineMode.toUpperCase()}`);

        // Browser state
        this.browser = null;
        this.page = null;
        this.memoryPage = null;
        this.cdpSession = null;

        // DOM repair
        this.doctor = new DOMDoctor();
        this.selectors = this.doctor.loadSelectors();

        // Memory engine
        const mode = ConfigManager.cleanEnv(process.env.GOLEM_MEMORY_MODE || 'browser').toLowerCase();
        console.log(`[GolemBrain] Memory: ${mode.toUpperCase()} (Golem: ${this.golemId})`);
        if (mode === 'qmd') this.memoryDriver = new SystemQmdDriver();
        else if (mode === 'native' || mode === 'system') this.memoryDriver = new SystemNativeDriver();
        else this.memoryDriver = new BrowserMemoryDriver(this);

        // Browser health
        this.browserHealthy = true;
        this.browserFailCount = 0;
        this.browserFailed = false;

        // API LLM Client
        this.apiClient = new ApiLLMClient();
        if (this.apiClient.available) {
            console.log(`[GolemBrain] API available: ${this.apiClient.providerName}`);
        }

        // Chat log
        this.chatLogManager = new ChatLogManager({
            golemId: this.golemId,
            logDir: options.logDir || ConfigManager.LOG_BASE_DIR,
            isSingleMode: options.isSingleMode !== undefined ? options.isSingleMode : (ConfigManager.GOLEM_MODE === 'SINGLE')
        });
    }

    async init(forceReload = false) {
        if (this.browser && !forceReload) return;

        let isNewSession = false;

        // API mode: skip browser entirely
        if (this.engineMode === 'api') {
            console.log(`[GolemBrain] API-only mode — skipping Puppeteer`);
            this.browserFailed = true;
            this.browserHealthy = false;

            // Parallel init: chatLog + skillIndex
            await Promise.all([
                this.chatLogManager.init(),
                this._syncSkillIndex(),
            ]);

            // Memory driver init — force native in API mode if still Browser
            if (this.memoryDriver instanceof BrowserMemoryDriver) {
                console.log('[GolemBrain] API mode: switching memory to SystemNativeDriver');
                this.memoryDriver = new SystemNativeDriver();
            }
            await this._initMemoryDriver();

            // 3-Layer Memory Architecture (inspired by Letta/MemGPT)
            // Core: SystemNativeDriver (fast, local, always in-context)
            // Recall: ChatLogManager (5-tier pyramid, searchable history)
            // Archival: AragClient (Edge A-RAG, semantic+graph+causal)
            this.recallMemory = this.chatLogManager;
            this.archivalMemory = aragClient;
            console.log(`[GolemBrain] 3-Layer Memory: Core=${this.memoryDriver.constructor.name}, Recall=ChatLog, Archival=${aragClient ? 'A-RAG' : 'none'}`);

            this._linkDashboard();
            return;
        }

        // Browser mode
        if (!this.browser) {
            console.log(`[GolemBrain] Browser Data Dir: ${this.userDataDir} (Golem: ${this.golemId})`);
            try {
                this.browser = await BrowserLauncher.launch({
                    userDataDir: this.userDataDir,
                    headless: process.env.PUPPETEER_HEADLESS,
                });
            } catch (browserErr) {
                console.warn(`[GolemBrain] Browser launch failed: ${browserErr.message}`);
                if (this.apiClient && this.apiClient.available) {
                    console.log(`[GolemBrain] Falling back to API-only mode`);
                    this.browserFailed = true;
                    this.browserHealthy = false;
                } else {
                    throw browserErr;
                }
            }
        }

        if (!this.browserFailed && !this.page) {
            const pages = await this.browser.pages();
            this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
            console.log(`[GolemBrain] Browser Session Started (Golem: ${this.golemId})`);
            const provider = AI_PROVIDERS[ACTIVE_PROVIDER];
            console.log(`[GolemBrain] AI Provider: ${provider.name} (${ACTIVE_PROVIDER})`);
            console.log(`[GolemBrain] Navigating to: ${provider.url}`);
            await this.page.goto(provider.url, { waitUntil: 'networkidle2', timeout: 60000 });
            isNewSession = true;

            // Quick auth check: verify textarea exists within 3s
            const authOk = await this._checkBrowserAuth();
            if (!authOk) {
                console.warn(`[GolemBrain] Browser auth failed — textarea not found. Switching to API mode.`);
                this.browserHealthy = false;
                this.browserFailed = true;
            }
        }

        // Parallel init
        await Promise.all([
            this.chatLogManager.init(),
            this._syncSkillIndex(),
        ]);

        await this._initMemoryDriver();
        this._linkDashboard();

        if (!this.browserFailed && (forceReload || isNewSession)) {
            await this._injectSystemPrompt(forceReload);
        }
    }

    /**
     * Quick auth check: verify the AI textarea is accessible within 3 seconds
     */
    async _checkBrowserAuth() {
        if (!this.page) return false;
        try {
            const textarea = await this.page.waitForSelector(
                'textarea, [contenteditable="true"], div[role="textbox"]',
                { timeout: 3000 }
            );
            return !!textarea;
        } catch (e) {
            return false;
        }
    }

    async _syncSkillIndex() {
        try {
            const personaManager = require('../skills/core/persona');
            if (personaManager.exists(this.userDataDir)) {
                const personaData = personaManager.get(this.userDataDir);
                const personaSkills = personaData.skills || [];
                const { resolveEnabledSkills } = require('../skills/skillsConfig');
                const enabledSet = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', personaSkills);
                await this.skillIndex.sync(Array.from(enabledSet));
                this._skillCount = enabledSet.size;
            } else {
                console.log(`[Brain][${this.golemId}] No persona.json, skipping skill sync.`);
            }
        } catch (e) {
            console.warn('[Brain] Skill index sync failed:', e.message);
        }
    }

    async setupCDP() {
        if (this.cdpSession) return;
        try {
            this.cdpSession = await this.page.target().createCDPSession();
            await this.cdpSession.send('Network.enable');
            console.log("[CDP] Neuro-Link Active");
        } catch (e) {
            console.error("[CDP] Connection failed:", e.message);
        }
    }

    async switchModel(targetMode) {
        if (!this.page) throw new Error("Brain not initialized.");
        try {
            const result = await this.page.evaluate(async (mode) => {
                const delay = (ms) => new Promise(r => setTimeout(r, ms));
                const modeKeywords = {
                    'fast': ['fast', '快捷'],
                    'thinking': ['thinking', '思考型', '思考'],
                    'pro': ['pro']
                };
                const targetKeywords = modeKeywords[mode] || [mode];
                const allKnownKeywords = [...modeKeywords.fast, ...modeKeywords.thinking, ...modeKeywords.pro];
                const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
                let pickerBtn = null;
                for (const btn of buttons) {
                    const txt = (btn.innerText || "").toLowerCase().trim();
                    if (allKnownKeywords.some(k => txt.includes(k.toLowerCase())) && btn.offsetHeight > 10 && btn.offsetHeight < 60) {
                        const rect = btn.getBoundingClientRect();
                        if (rect.top > window.innerHeight / 2) { pickerBtn = btn; break; }
                    }
                }
                if (!pickerBtn) return "Model switch button not found.";
                if (pickerBtn.disabled || pickerBtn.getAttribute('aria-disabled') === 'true') {
                    return "Model switch button is disabled.";
                }
                pickerBtn.click();
                await delay(1000);
                const items = Array.from(document.querySelectorAll('*'));
                let targetElement = null, bestMatch = null;
                for (const el of items) {
                    if (pickerBtn === el || pickerBtn.contains(el)) continue;
                    const rect = el.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) continue;
                    const txt = (el.innerText || "").trim().toLowerCase();
                    if (txt.length === 0 || txt.length > 50) continue;
                    if (targetKeywords.some(keyword => txt.includes(keyword.toLowerCase()))) {
                        const role = el.getAttribute('role');
                        if (role === 'menuitem' || role === 'menuitemradio' || role === 'option') { targetElement = el; break; }
                        bestMatch = el;
                    }
                }
                if (!targetElement) targetElement = bestMatch;
                if (!targetElement) { document.body.click(); return `Option "${mode}" not found.`; }
                targetElement.click();
                await delay(800);
                return `Switched to [${mode}]`;
            }, targetMode.toLowerCase());
            return result;
        } catch (error) {
            return `Switch failed: ${error.message}`;
        }
    }

    async sendMessage(text, isSystem = false, options = {}) {
        if (!this.browser && this.engineMode !== 'api') await this.init();

        // API-only mode or browser unhealthy: use API directly
        if (this.browserFailed || (!this.browserHealthy && this.apiClient && this.apiClient.available)) {
            // Route model selection before sending
            try {
                const router = require('../skills/core/model-router');
                const route = router.selectBestModel(text, {
                    engine: this.engineMode || 'api',
                    userDataDir: this.userDataDir,
                    conversationId: this.golemId,
                });
                this.apiClient.setModel(route.model);
                if (route.reason !== 'sticky') {
                    console.log(`[GolemBrain] API → ${route.model} (${route.taskType})`);
                }
            } catch (routeErr) {
                // Routing failure is non-fatal, use default model
            }
            try {
                return await this.apiClient.sendMessage(text);
            } catch (apiErr) {
                console.error(`[GolemBrain] API failed: ${apiErr.message}`);
                if (this.engineMode === 'api') throw apiErr;
                // Reset browser to try again
                this.browserHealthy = true;
                this.browserFailCount = 0;
            }
        }

        try { await this.page.bringToFront(); } catch (e) { }
        await this.setupCDP();

        // Slash command interception
        if (text.startsWith('/') || text.startsWith('GOLEM_SKILL::')) {
            const commandResult = await NodeRouter.handle({ text, isAdmin: true }, this);
            if (commandResult) {
                console.log(`[Brain] Command intercepted: ${text}`);
                return commandResult;
            }
        }

        const reqId = ProtocolFormatter.generateReqId();
        const startTag = ProtocolFormatter.buildStartTag(reqId);
        const endTag = ProtocolFormatter.buildEndTag(reqId);
        const payload = ProtocolFormatter.buildEnvelope(text, reqId, options);

        console.log(`[Brain] Signal: ${reqId}`);
        const interactor = new PageInteractor(this.page, this.doctor);

        try {
            return await interactor.interact(payload, this.selectors, isSystem, startTag, endTag);
        } catch (e) {
            if (e.message && e.message.startsWith('SELECTOR_HEALED:')) {
                const [, type, newSelector] = e.message.split(':');
                this.selectors[type] = newSelector;
                this.doctor.saveSelectors(this.selectors);
                return interactor.interact(payload, this.selectors, isSystem, startTag, endTag, 1);
            }
            this.browserFailCount = (this.browserFailCount || 0) + 1;
            if (this.browserFailCount >= 1) {
                this.browserHealthy = false;
                console.log(`[GolemBrain] Browser unhealthy (${this.browserFailCount} failures). Using API next.`);
            }
            if (this.apiClient && this.apiClient.available) {
                console.log(`[GolemBrain] Falling back to API (${this.apiClient.providerName})...`);
                try {
                    const apiResponse = await this.apiClient.sendMessage(text);
                    console.log(`[GolemBrain] API fallback OK (${apiResponse.length} chars)`);
                    return apiResponse;
                } catch (apiErr) {
                    console.error(`[GolemBrain] API fallback failed: ${apiErr.message}`);
                }
            }
            throw e;
        }
    }

    /**
     * Recall from local memory + RAG (merged, top 5)
     */
    async recall(queryText) {
        if (!queryText) return [];
        const results = [];

        // Local memory
        try {
            const local = await this.memoryDriver.recall(queryText);
            if (local && local.length > 0) results.push(...local);
        } catch (e) { }

        // Graph RAG (if available)
        if (aragClient) {
            try {
                const ragResults = await aragClient.query(queryText, 5);
                if (ragResults && ragResults.length > 0) {
                    for (const r of ragResults) {
                        results.push({ text: r.name || r.content || JSON.stringify(r), source: 'graph-rag', score: r.score || 0 });
                    }
                }
            } catch (e) {
                console.warn('[GolemBrain] RAG query failed:', e.message);
            }
        }

        // Sort by score descending, take top 5
        results.sort((a, b) => (b.score || 0) - (a.score || 0));
        return results.slice(0, 5);
    }

    async memorize(text, metadata = {}) {
        try { await this.memoryDriver.memorize(text, metadata); } catch (e) { }
    }

    _appendChatLog(entry) {
        this.chatLogManager.init().then(() => {
            this.chatLogManager.append(entry);
        });
    }

    async _initMemoryDriver() {
        try {
            await this.memoryDriver.init();
        } catch (e) {
            console.warn("[GolemBrain] Memory driver fallback to Browser/Native...");
            this.memoryDriver = new BrowserMemoryDriver(this);
            await this.memoryDriver.init();
        }
    }

    _linkDashboard() {
        if (!process.argv.includes('dashboard')) return;
        try {
            const dashboard = require('../../dashboard');
            dashboard.setContext(this.golemId, this, this.memoryDriver);
        } catch (e) {
            try {
                const dashboard = require('../../dashboard.js');
                dashboard.setContext(this.golemId, this, this.memoryDriver);
            } catch (err) { }
        }
    }

    async reloadSkills() {
        ProtocolFormatter._lastScanTime = 0;
        console.log(`[Brain][${this.golemId}] Skill cache cleared, reloading...`);
        if (!this.page) {
            console.log(`[Brain][${this.golemId}] Browser not ready, skills load on next init.`);
            return;
        }
        const { AI_PROVIDERS, ACTIVE_PROVIDER } = require('./constants');
        await this.page.goto(AI_PROVIDERS[ACTIVE_PROVIDER].url, { waitUntil: 'networkidle2' });
        await this._injectSystemPrompt(true);
        console.log(`[Brain][${this.golemId}] Skills reloaded.`);
    }

    async _injectSystemPrompt(forceRefresh = false) {
        // In API mode, skip browser-based injection
        if (this.engineMode === 'api') {
            console.log(`[Brain] API mode — skipping browser prompt injection`);
            return;
        }

        let { systemPrompt, skillMemoryText } = await ProtocolFormatter.buildSystemPrompt(forceRefresh, {
            userDataDir: this.userDataDir,
            golemId: this.golemId
        });

        if (skillMemoryText) {
            await this.memorize(skillMemoryText, { type: 'system_skills', source: 'boot_init' });
            console.log(`[Memory] Skills loaded to long-term memory`);
        }

        const compressedPrompt = ProtocolFormatter.compress(systemPrompt);
        await this.sendMessage(compressedPrompt, false);
        console.log(`[Brain] Phase 1: Protocol injected.`);

        // Phase 2: Multi-tier memory injection
        if (this.chatLogManager) {
            try {
                let historicalMemory = "";

                const eraSummaries = this.chatLogManager.readTier('era', 1);
                eraSummaries.forEach(s => { historicalMemory += `\n=== [Era: ${s.date}] ===\n${s.content}\n`; });

                const yearlySummaries = this.chatLogManager.readTier('yearly', 1);
                yearlySummaries.forEach(s => { historicalMemory += `\n=== [Yearly: ${s.date}] ===\n${s.content}\n`; });

                const monthlySummaries = this.chatLogManager.readTier('monthly', 3);
                monthlySummaries.forEach(s => { historicalMemory += `\n--- [Monthly: ${s.date}] ---\n${s.content}\n`; });

                const dailySummaries = this.chatLogManager.readTier('daily', 7);
                dailySummaries.forEach(s => { historicalMemory += `\n--- [${s.date}] ---\n${s.content}\n`; });

                if (historicalMemory) {
                    // Token budget: API mode 10K, browser mode 200K
                    const MAX_CHARS = this.engineMode === 'api' ? 10000 : 200000;
                    if (historicalMemory.length > MAX_CHARS) {
                        console.warn(`[Brain] Memory exceeds budget (${historicalMemory.length} > ${MAX_CHARS}), truncating...`);
                        historicalMemory = historicalMemory.slice(-MAX_CHARS);
                    }

                    const memoryPulse = `【Load long-term memory】\n${historicalMemory}`;
                    await this.sendMessage(memoryPulse, false);
                    console.log(`[Brain] Phase 2: Memory injected (${historicalMemory.length} chars)`);
                } else {
                    const rawMemory = this.chatLogManager.readRecentHourly();
                    if (rawMemory) {
                        const MAX_RAW = this.engineMode === 'api' ? 10000 : 200000;
                        const safeRaw = rawMemory.length > MAX_RAW ? rawMemory.slice(-MAX_RAW) : rawMemory;
                        await this.sendMessage(`【Load recent raw logs】\n${safeRaw}`, false);
                        console.log(`[Brain] Phase 2 (fallback): Raw hourly injected (${safeRaw.length} chars)`);
                    }
                }
            } catch (e) {
                console.warn(`[Brain] Memory injection failed: ${e.message}`);
            }
        }
    }

    /**
     * Health status for /health endpoint
     */
    getHealthStatus() {
        return {
            golemId: this.golemId,
            engine: this.engineMode,
            browserHealthy: this.engineMode === 'api' ? null : this.browserHealthy,
            browserFailed: this.engineMode === 'api' ? null : this.browserFailed,
            apiAvailable: this.apiClient ? this.apiClient.available : false,
            apiProvider: this.apiClient ? this.apiClient.providerName : 'none',
            apiModel: this.apiClient ? this.apiClient.getModel() : null,
            memoryReady: this.memoryDriver ? (this.memoryDriver.isReady !== undefined ? this.memoryDriver.isReady : true) : false,
            ragAvailable: !!aragClient,
            memory: {
                core: this.memoryDriver ? this.memoryDriver.constructor.name : 'none',
                recall: this.chatLogManager ? 'ChatLogManager' : 'none',
                archival: aragClient ? 'A-RAG' : 'none',
            },
            skills: this.skillIndex ? {
                loaded: this._skillCount || 0,
            } : null,
        };
    }
}

module.exports = GolemBrain;
