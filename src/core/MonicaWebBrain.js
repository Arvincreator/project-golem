// ============================================================
// MonicaWebBrain — Puppeteer-based Monica.im web automation
// Mirrors GolemBrain pattern, adapted for Monica.im chat interface
// Primary brain: GPT-5.4, Claude Sonnet 4.6, Gemini 3.1
// ============================================================
const fs = require('fs');
const path = require('path');
const ConfigManager = require('../config');
const ProtocolFormatter = require('../services/ProtocolFormatter');
const ChatLogManager = require('../managers/ChatLogManager');
const SkillIndexManager = require('../managers/SkillIndexManager');
const NodeRouter = require('./NodeRouter');
const BrowserLauncher = require('./BrowserLauncher');
const MonicaPageInteractor = require('./MonicaPageInteractor');
const DOMDoctor = require('../services/DOMDoctor');
const SystemNativeDriver = require('../memory/SystemNativeDriver');
const { URLS, TIMINGS, LIMITS, BROWSER_ARGS, DEFAULT_SELECTORS, MODELS, resolveForBrain } = require('./monica-constants');

const SELECTOR_FILE = path.resolve(process.cwd(), 'monica_selectors.json');
const USAGE_FILE = path.resolve(process.cwd(), 'golem_memory', 'monica_usage.json');

class MonicaWebBrain {
    constructor(options = {}) {
        this.golemId = options.golemId || 'default';
        this.userDataDir = options.userDataDir || path.resolve(ConfigManager.CONFIG.USER_DATA_DIR || './golem_memory');
        this.monicaProfileDir = path.resolve(this.userDataDir, 'monica_profile');
        this.skillIndex = options.skillIndex || new SkillIndexManager(this.userDataDir);

        this.browser = null;
        this.page = null;

        this.memoryDriver = options.memoryDriver || new SystemNativeDriver();
        this.chatLogManager = options.chatLogManager || new ChatLogManager({
            golemId: this.golemId,
            logDir: options.logDir || ConfigManager.LOG_BASE_DIR,
            isSingleMode: options.isSingleMode !== undefined ? options.isSingleMode : (ConfigManager.GOLEM_MODE === 'SINGLE')
        });

        this.doctor = new DOMDoctor();
        this.selectors = this._loadSelectors();
        this._currentModel = process.env.MONICA_WEB_DEFAULT_MODEL || 'gpt-4o';
        this._lastSendTime = 0;
        this._dailyCalls = 0;
        this._callDate = new Date().toISOString().slice(0, 10);

        this.status = 'idle';
        this._loadUsage();
    }

    // === Public API ===

    async init(forceReload = false) {
        if (this.browser && !forceReload) return;

        console.log(`[MonicaWeb:${this.golemId}] Initializing...`);

        // Ensure profile dir exists
        if (!fs.existsSync(this.monicaProfileDir)) {
            fs.mkdirSync(this.monicaProfileDir, { recursive: true });
        }

        // Launch browser with Monica profile
        const headless = process.env.PUPPETEER_HEADLESS || 'new';
        this.browser = await BrowserLauncher.launch({
            userDataDir: this.monicaProfileDir,
            headless,
            protocolTimeout: 300000,
        });

        const pages = await this.browser.pages();
        this.page = pages[0] || await this.browser.newPage();
        await this.page.setViewport({ width: 1400, height: 900 });

        // Navigate to Monica
        console.log(`[MonicaWeb] Navigating to ${URLS.MONICA_APP}...`);
        await this.page.goto(URLS.MONICA_APP, { waitUntil: 'networkidle2', timeout: 60000 });

        // Check login status
        const url = this.page.url();
        if (url.includes('/login') || url.includes('/signin') || url.includes('/auth')) {
            console.warn('[MonicaWeb] Not logged in! Please run: node scripts/monica-dom-scout.js --login');
            throw new Error('[MonicaWeb] Monica.im login required. Run DOM scout with --login first.');
        }

        // Wait for chat interface to render
        await new Promise(r => setTimeout(r, 3000));
        console.log(`[MonicaWeb] Chat interface loaded at: ${this.page.url()}`);

        // Init memory
        try { await this.memoryDriver.init(); } catch (e) {
            console.warn('[MonicaWeb] Memory init failed:', e.message);
        }

        // Init chat log
        await this.chatLogManager.init();

        // Sync skills
        try {
            const personaPath = path.resolve(this.userDataDir, 'persona.json');
            if (fs.existsSync(personaPath)) {
                const persona = JSON.parse(fs.readFileSync(personaPath, 'utf-8'));
                if (persona.skills) await this.skillIndex.syncToDb(persona.skills);
            }
        } catch (e) { /* optional */ }

        // Inject system prompt
        await this._injectSystemPrompt(forceReload);

        this.status = 'running';
        console.log(`[MonicaWeb:${this.golemId}] Ready! Model: ${this._currentModel}`);
    }

    async sendMessage(text, isSystem = false, options = {}) {
        if (!this.browser) await this.init();

        // Command interception
        if (text.startsWith('/') || text.startsWith('GOLEM_SKILL::')) {
            const result = await NodeRouter.handle({ text, isAdmin: true }, this);
            if (result) return result;
        }

        // Rate limit: min interval between sends
        const now = Date.now();
        const elapsed = now - this._lastSendTime;
        if (elapsed < TIMINGS.MIN_SEND_INTERVAL) {
            await new Promise(r => setTimeout(r, TIMINGS.MIN_SEND_INTERVAL - elapsed));
        }
        this._lastSendTime = Date.now();

        // Track usage
        this._trackUsage();

        // Build envelope
        const reqId = ProtocolFormatter.generateReqId();
        const startTag = ProtocolFormatter.buildStartTag(reqId);
        const endTag = ProtocolFormatter.buildEndTag(reqId);
        const payload = ProtocolFormatter.buildEnvelope(text, reqId, options);

        console.log(`[MonicaWeb] Sending request: ${reqId} (model: ${this._currentModel})`);

        try {
            await this.page.bringToFront();
        } catch (e) { /* may fail in headless */ }

        const interactor = new MonicaPageInteractor(this.page, this.doctor);

        try {
            const response = await interactor.interact(
                payload, { ...this.selectors }, isSystem, startTag, endTag
            );

            console.log(`[MonicaWeb] Response received (${(response || '').length} chars)`);
            return response || '';
        } catch (e) {
            // Try to heal selector on failure
            if (e.message.includes('SELECTOR_HEALED:')) {
                const newSel = e.message.split('SELECTOR_HEALED:')[1];
                console.log(`[MonicaWeb] Selector healed: ${newSel}`);
                // Retry with healed selector
                return interactor.interact(payload, { ...this.selectors }, isSystem, startTag, endTag, 1);
            }
            throw e;
        }
    }

    async recall(queryText) {
        if (!queryText) return [];
        try { return await this.memoryDriver.recall(queryText); } catch (e) { return []; }
    }

    async memorize(text, metadata = {}) {
        try { await this.memoryDriver.memorize(text, metadata); } catch (e) {
            console.warn('[MonicaWeb] memorize failed:', e.message);
        }
    }

    async switchModel(model) {
        const resolved = resolveForBrain(model, 'web');
        if (!resolved) {
            console.warn(`[MonicaWeb] Model ${model} not available on Web`);
            return `⚠️ ${model} 不支援 Web 模式`;
        }
        const modelKeywords = resolved.keywords || MODELS[model] || [model];
        console.log(`[MonicaWeb] Switching model to: ${resolved.model} (keywords: ${modelKeywords.join(', ')})...`);

        try {
            const result = await this.page.evaluate((keywords) => {
                // Find model picker (usually below or above input)
                const allElements = document.querySelectorAll('button, [role="button"], div[class*="model"], span[class*="model"]');

                for (const el of allElements) {
                    const text = (el.innerText || '').trim();
                    if (text.length > 0 && text.length < 50 && el.offsetHeight > 0) {
                        // Check if this looks like a model selector
                        const lowerText = text.toLowerCase();
                        if (lowerText.includes('gpt') || lowerText.includes('claude') ||
                            lowerText.includes('gemini') || lowerText.includes('model')) {
                            el.click();
                            return `clicked picker: ${text}`;
                        }
                    }
                }
                return null;
            }, modelKeywords);

            if (result) {
                await new Promise(r => setTimeout(r, 1000));

                // Now find and click the target model in dropdown
                const clicked = await this.page.evaluate((keywords) => {
                    const items = document.querySelectorAll('[role="menuitem"], [role="option"], li, div[class*="item"]');
                    for (const item of items) {
                        const text = (item.innerText || '').toLowerCase();
                        for (const kw of keywords) {
                            if (text.includes(kw.toLowerCase()) && item.offsetHeight > 0) {
                                item.click();
                                return text;
                            }
                        }
                    }
                    return null;
                }, modelKeywords);

                if (clicked) {
                    this._currentModel = model;
                    await new Promise(r => setTimeout(r, TIMINGS.MODEL_SWITCH_DELAY));
                    return `已切換至 ${model} (Monica Web)`;
                }
            }

            return `⚠️ 模型切換失敗: 找不到 "${model}" 選項`;
        } catch (e) {
            return `❌ 模型切換錯誤: ${e.message}`;
        }
    }

    async reloadSkills() {
        ProtocolFormatter._lastScanTime = 0;
        await this._injectSystemPrompt(true);
        console.log(`[MonicaWeb:${this.golemId}] Skills reloaded.`);
    }

    _appendChatLog(entry) {
        this.chatLogManager.init().then(() => this.chatLogManager.append(entry));
    }

    _linkDashboard() {
        if (!process.argv.includes('dashboard')) return;
        try {
            const dashboard = require('../../dashboard');
            dashboard.setContext(this.golemId, this, this.memoryDriver);
        } catch (e) { /* optional */ }
    }

    // === Internal ===

    _loadSelectors() {
        try {
            if (fs.existsSync(SELECTOR_FILE)) {
                const data = JSON.parse(fs.readFileSync(SELECTOR_FILE, 'utf-8'));
                return { ...DEFAULT_SELECTORS, ...data };
            }
        } catch (e) {
            console.warn('[MonicaWeb] Failed to load selectors:', e.message);
        }
        return { ...DEFAULT_SELECTORS };
    }

    async _injectSystemPrompt(forceReload = false) {
        if (!this.page) return;
        const { systemPrompt } = await ProtocolFormatter.buildSystemPrompt(forceReload, {
            userDataDir: this.userDataDir,
            golemId: this.golemId
        });

        const compressed = ProtocolFormatter.compress(systemPrompt);
        console.log(`[MonicaWeb] Injecting system prompt (${compressed.length} chars)...`);

        // Send system prompt as first message
        const interactor = new MonicaPageInteractor(this.page, this.doctor);
        await interactor.interact(compressed, { ...this.selectors }, true, '', '');
        console.log('[MonicaWeb] System prompt injected.');
    }

    _trackUsage() {
        const today = new Date().toISOString().slice(0, 10);
        if (today !== this._callDate) {
            this._dailyCalls = 0;
            this._callDate = today;
        }
        this._dailyCalls++;
        this._saveUsage();
    }

    _loadUsage() {
        try {
            if (fs.existsSync(USAGE_FILE)) {
                const data = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8'));
                this._dailyCalls = data.dailyCalls || 0;
                this._callDate = data.callDate || new Date().toISOString().slice(0, 10);
            }
        } catch (e) { console.warn('[MonicaWebBrain] Failed to load usage data:', e.message); }
    }

    _saveUsage() {
        try {
            fs.writeFileSync(USAGE_FILE, JSON.stringify({
                dailyCalls: this._dailyCalls,
                callDate: this._callDate,
                model: this._currentModel,
                lastSave: new Date().toISOString(),
            }, null, 2));
        } catch (e) { console.warn('[MonicaWebBrain] Failed to save usage data:', e.message); }
    }
}

module.exports = MonicaWebBrain;
