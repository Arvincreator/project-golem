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

const PROJECT_ROOT = path.resolve(__dirname, '../../');
const SELECTOR_FILE = path.resolve(PROJECT_ROOT, 'monica_selectors.json');
const USAGE_FILE = path.resolve(PROJECT_ROOT, 'golem_memory', 'monica_usage.json');

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
            args: BROWSER_ARGS,
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
        try {
            await this.page.waitForSelector(
                this.selectors.input || 'textarea, [contenteditable="true"]',
                { visible: true, timeout: 15000 }
            );
        } catch (e) {
            console.warn('[MonicaWeb] 輸入框未出現，fallback 等待 3s');
            await new Promise(r => setTimeout(r, 3000));
        }

        // Session 過期偵測
        const cookies = await this.page.cookies();
        const sessionCookie = cookies.find(c =>
            c.name.includes('session') || c.name.includes('token') || c.name.includes('auth')
        );
        if (sessionCookie && sessionCookie.expires > 0) {
            const expiresIn = sessionCookie.expires * 1000 - Date.now();
            if (expiresIn < 0) {
                throw new Error('[MonicaWeb] Session 已過期，需重新登入: node scripts/monica-dom-scout.js --login');
            }
            if (expiresIn < 300000) {
                console.warn(`[MonicaWeb] ⚠️ Session 將在 ${Math.ceil(expiresIn / 60000)} 分鐘後過期`);
            }
        }
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
            console.error(`[MonicaWeb] sendMessage failed: ${e.message}`);
            // 重新載入 selectors (DOMDoctor 可能已更新)
            this._loadSelectors();
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
        if (!resolved) return `⚠️ ${model} 不支援 Web 模式`;

        const modelKeywords = resolved.keywords || MODELS[model] || [model];
        console.log(`[MonicaWeb] Switching model to: ${resolved.model} (keywords: ${modelKeywords.join(', ')})...`);

        const delay = (ms) => new Promise(r => setTimeout(r, ms));

        // 策略 A: 用 monica_selectors.json 的 modelPicker
        if (this.selectors.modelPicker && this.selectors.modelPicker !== 'NONE') {
            try {
                await this.page.waitForSelector(this.selectors.modelPicker, { timeout: 3000 });
                await this.page.click(this.selectors.modelPicker);
                await delay(TIMINGS.MODEL_SWITCH_DELAY);
                const found = await this.page.evaluate((keywords) => {
                    const options = document.querySelectorAll('[class*="option"], [class*="item"], li, [role="option"], [role="menuitem"]');
                    for (const opt of options) {
                        const text = (opt.textContent || '').toLowerCase();
                        if (keywords.some(k => text.includes(k.toLowerCase())) && opt.offsetHeight > 0) {
                            opt.click();
                            return true;
                        }
                    }
                    return false;
                }, modelKeywords);
                if (found) {
                    const verified = await this._verifyModelSwitch(model, modelKeywords);
                    if (!verified) {
                        // Retry once
                        await this.page.click(this.selectors.modelPicker);
                        await delay(TIMINGS.MODEL_SWITCH_DELAY);
                        await this.page.evaluate((keywords) => {
                            const options = document.querySelectorAll('[class*="option"], [class*="item"], li, [role="option"], [role="menuitem"]');
                            for (const opt of options) {
                                const text = (opt.textContent || '').toLowerCase();
                                if (keywords.some(k => text.includes(k.toLowerCase())) && opt.offsetHeight > 0) { opt.click(); return true; }
                            }
                            return false;
                        }, modelKeywords);
                    }
                    this._currentModel = model;
                    this._logSwitchResult(model, true, 'A');
                    return `已切換至 ${model} (Monica Web${verified ? '' : ', retry'})`;
                }
            } catch (e) { /* fall through to strategy B */ }
        }

        // 策略 B: 掃描頁面上的模型名稱文字
        try {
            const found = await this.page.evaluate((keywords) => {
                const all = document.querySelectorAll('button, [role="button"], span, div');
                for (const el of all) {
                    if (el.offsetHeight === 0) continue;
                    const text = (el.textContent || '').toLowerCase().trim();
                    if (text.length > 3 && text.length < 30 &&
                        keywords.some(k => text.includes(k.toLowerCase()))) {
                        el.click();
                        return true;
                    }
                }
                return false;
            }, modelKeywords);
            if (found) {
                await delay(TIMINGS.MODEL_SWITCH_DELAY);
                const verified = await this._verifyModelSwitch(model, modelKeywords);
                this._currentModel = model;
                this._logSwitchResult(model, true, 'B');
                return `已切換至 ${model} (策略 B${verified ? '' : ', unverified'})`;
            }
        } catch (e) { /* fall through */ }

        // Graceful degradation: 記錄偏好但不卡住
        console.warn(`[MonicaWeb] 模型切換 UI 未找到，記錄偏好 ${model}`);
        this._currentModel = model;
        this._logSwitchResult(model, false, 'none');
        return `⚠️ 模型 UI 未找到，已記錄偏好 ${model} (下次新對話時生效)`;
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

    async _verifyModelSwitch(model, keywords) {
        const delay = (ms) => new Promise(r => setTimeout(r, ms));
        await delay(1000);
        try {
            return await this.page.evaluate((kws) => {
                const indicators = document.querySelectorAll(
                    '[class*="model"], [class*="current"], [class*="selected"], [class*="active"], [class*="picker"]'
                );
                for (const el of indicators) {
                    const text = (el.textContent || '').toLowerCase();
                    if (kws.some(k => text.includes(k.toLowerCase())) && el.offsetHeight > 0) return true;
                }
                return false;
            }, keywords);
        } catch { return false; }
    }

    _logSwitchResult(model, success, strategy) {
        try {
            const logPath = path.resolve(PROJECT_ROOT, 'golem_memory', 'model_switch_log.json');
            const log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf-8')) : [];
            log.push({ timestamp: new Date().toISOString(), model, success, strategy });
            if (log.length > 500) log.splice(0, log.length - 500);
            fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
        } catch (e) { /* non-critical */ }
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
        if (this._dailyCalls > LIMITS.MAX_DAILY_CALLS) {
            throw new Error(`[MonicaWeb] 每日用量已達上限 (${LIMITS.MAX_DAILY_CALLS} calls)，請明日再試`);
        }
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
