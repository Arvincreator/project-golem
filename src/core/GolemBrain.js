// ============================================================
// 🧠 Golem Brain (Web Gemini) - Clean Architecture Facade
// ============================================================
const path = require('path');
const ConfigManager = require('../config');
const DOMDoctor = require('../services/DOMDoctor');
const BrowserMemoryDriver = require('../memory/BrowserMemoryDriver');
const SystemQmdDriver = require('../memory/SystemQmdDriver');
const SystemNativeDriver = require('../memory/SystemNativeDriver');
const LanceDBMemoryDriver = require('../memory/LanceDBMemoryDriver');

const BrowserLauncher = require('./BrowserLauncher');
const ProtocolFormatter = require('../services/ProtocolFormatter');
const PageInteractor = require('./PageInteractor');
const ChatLogManager = require('../managers/ChatLogManager');
const SkillIndexManager = require('../managers/SkillIndexManager');
const NodeRouter = require('./NodeRouter');
const { URLS } = require('./constants');

// ============================================================
// 🧠 Golem Brain (Web Gemini) - Dual-Engine + Titan Protocol
// ============================================================
class GolemBrain {
    constructor(options = {}) {
        // ── 實體識別與設定 ──
        this.golemId = options.golemId || 'default';
        this.userDataDir = options.userDataDir || path.resolve(ConfigManager.CONFIG.USER_DATA_DIR || './golem_memory');
        this.skillIndex = new SkillIndexManager(this.userDataDir);
        this.loginResolver = null; // 用於非阻塞等待使用者選擇登入

        // ── 瀏覽器狀態 ──
        this.context = null; // Playwright BrowserContext
        this.page = null;
        this.memoryPage = null;
        this.cdpSession = null;

        // ── DOM 修復服務 ──
        this.doctor = new DOMDoctor();
        this.selectors = this.doctor.loadSelectors();

        // ── 記憶引擎 ──
        const mode = ConfigManager.cleanEnv(process.env.GOLEM_MEMORY_MODE || 'browser').toLowerCase();
        console.log(`⚙️ [System] 記憶引擎模式: ${mode.toUpperCase()} (Golem: ${this.golemId})`);
        if (mode === 'qmd') this.memoryDriver = new SystemQmdDriver();
        else if (mode === 'lancedb') this.memoryDriver = new LanceDBMemoryDriver();
        else if (mode === 'native' || mode === 'system') this.memoryDriver = new SystemNativeDriver();
        else this.memoryDriver = new BrowserMemoryDriver(this);

        // ── 對話日誌 ──
        this.chatLogManager = new ChatLogManager({
            golemId: this.golemId,
            logDir: options.logDir || ConfigManager.LOG_BASE_DIR
        });

        // ── Backend Selection ──
        this.backend = ConfigManager.CONFIG.GOLEM_BACKEND || 'gemini';

        // ── [v9.1] 登入狀態 ──
        this.loginPromptDone = false;
        this.forceHeadful = false;
    }

    // ─── Public API (向後相容) ─────────────────────────────

    /**
     * 初始化瀏覽器、記憶引擎、注入系統 Prompt
     * @param {boolean} [forceReload=false] - 是否強制重新載入
     * @param {boolean} [skipFullInit=false] - 是否跳過完整初始化 (記憶與 Prompt)
     */
    async init(forceReload = false, skipFullInit = false) {
        console.log(`🎬 [Brain] 啟動初始化程序 (forceReload: ${forceReload})...`);
        if (this.context && !forceReload) {
            console.log("✅ [Brain] 瀏覽器實體已存在且無須強制重新載入，跳過啟動。");
            return;
        }

        let isNewSession = false;

        // 1. 啟動 / 連線瀏覽器 (Playwright 回傳 Context)
        if (!this.context) {
            console.log(`📂 [System] Browser User Data Dir: ${this.userDataDir} (Golem: ${this.golemId})`);

            // 支援強制有頭模式，預設為無頭 (Headless)
            const isHeadless = this.forceHeadful ? false : (process.env.PUPPETEER_HEADLESS !== 'false');

            this.context = await BrowserLauncher.launch({
                userDataDir: this.userDataDir,
                headless: String(isHeadless),
            });
        }

        // 2. 取得或建立頁面
        if (!this.page) {
            console.log(`🚀 [System] 正在建立瀏覽子頁面...`);
            const pages = this.context.pages();
            this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
            isNewSession = true;
        }

        const targetUrl = this.backend === 'perplexity' ? URLS.PERPLEXITY_APP : URLS.GEMINI_APP;
        console.log(`📡 [Brain] 導航至目標頁面: ${targetUrl}`);
        await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log(`🚀 [System] ${this.backend === 'perplexity' ? 'Perplexity' : 'Gemini'} 頁面載入完成 (Golem: ${this.golemId})`);
        // isNewSession is already set above if a new page was created.

        // 2.5 初始化日誌管理員 (建立目錄)
        await this.chatLogManager.init();

        // 2.6 同步技能索引到 SQLite (僅在完成建立/設定後才啟動)
        try {
            const personaManager = require('../skills/core/persona');
            if (personaManager.exists(this.userDataDir)) {
                // 獲取目前啟用的技能清單
                const personaData = personaManager.get(this.userDataDir);
                const personaSkills = personaData.skills || [];
                const { resolveEnabledSkills } = require('../skills/skillsConfig');

                const enabledSet = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', personaSkills);
                await this.skillIndex.sync(Array.from(enabledSet));
            } else {
                console.log(`⏸️ [Brain][${this.golemId}] 尚未完成設定 (Missing persona.json)，跳過技能索引同步。`);
            }
        } catch (e) {
            console.warn('⚠️ [Brain] 技能索引同步失敗:', e.message);
        }
        
        // 如果只要基礎啟動 (例如為了手動登入)，則在此處提早結束
        if (skipFullInit) {
            console.log("⏩ [Brain] SkipFullInit 啟用，跳過記憶引擎與系統 Prompt 注入。");
            return;
        }

        // 3. 初始化記憶引擎 (含降級策略)
        await this._initMemoryDriver();

        // 4. Dashboard 整合 (可選)
        this._linkDashboard();

        // 5. 新會話: 注入系統 Prompt
        if (forceReload || isNewSession) {
            await this._injectSystemPrompt(forceReload);
        }
    }

    /**
     * 建立 Chrome DevTools Protocol 連線
     */
    async setupCDP() {
        if (this.cdpSession) return;
        try {
            // Playwright CDP 連線方式
            this.cdpSession = await this.page.context().newCDPSession(this.page);
            await this.cdpSession.send('Network.enable');
            console.log("🔌 [CDP] 網路神經連結已建立 (Neuro-Link Active)");
        } catch (e) {
            console.error("❌ [CDP] 連線失敗:", e.message);
        }
    }

    // ✨ [優化] 動態視覺腳本：針對新版 UI 切換模型 (支援中英文介面與防呆)
    async switchModel(targetMode) {
        if (!this.page) throw new Error("大腦尚未啟動。");
        try {
            const result = await this.page.evaluate(async (mode) => {
                const delay = (ms) => new Promise(r => setTimeout(r, ms));

                // 定義支援的模式及其可能的中英文關鍵字
                const modeKeywords = {
                    'fast': ['fast', '快捷', 'flash'],
                    'thinking': ['thinking', '思考型', '思考'], 
                    'pro': ['pro', 'advanced']
                };

                // 取得目標模式的所有關鍵字
                const targetKeywords = modeKeywords[mode] || [mode];

                // 1. 尋找畫面底部的模型切換按鈕 (通常位於輸入框區域)
                const allKnownKeywords = [...modeKeywords.fast, ...modeKeywords.thinking, ...modeKeywords.pro, 'Gemini'];
                
                // 優先使用精確選擇器
                let pickerBtn = document.querySelector('button.input-area-switch') || 
                               document.querySelector('button[aria-label="開啟模式挑選器"]') ||
                               document.querySelector('button[aria-label*="mode picker"]') ||
                               document.querySelector('button[mat-mdc-menu-trigger]');

                if (!pickerBtn) {
                    const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
                    for (const btn of buttons) {
                        const txt = (btn.innerText || btn.getAttribute('aria-label') || "").toLowerCase().trim();
                        if (allKnownKeywords.some(k => txt.includes(k.toLowerCase())) && btn.offsetHeight > 10 && btn.offsetHeight < 100) {
                            const rect = btn.getBoundingClientRect();
                            if (rect.top > window.innerHeight / 2) {
                                pickerBtn = btn;
                                break;
                            }
                        }
                    }
                }

                if (!pickerBtn) return "⚠️ 找不到模型切換按鈕。UI 可能已變更，或您停留在登入畫面。";

                // ✨ [核心防呆] 檢查按鈕是否為「不可點擊」狀態
                const isDisabled = pickerBtn.disabled ||
                    pickerBtn.getAttribute('aria-disabled') === 'true' ||
                    pickerBtn.classList.contains('disabled') ||
                    (pickerBtn.style.opacity && parseFloat(pickerBtn.style.opacity) < 0.6);

                if (isDisabled) {
                    return "⚠️ 模型切換按鈕目前不可點擊！這通常是因為該帳號目前沒有權限切換模型。";
                }

                // 點擊展開選單
                pickerBtn.click();
                await delay(1200); 

                // 2. 尋找選單中對應的目標模式
                const items = Array.from(document.querySelectorAll('button.bard-mode-list-button, mat-list-item, [role="menuitem"], [role="option"]'));
                let targetElement = null;
                let bestMatch = null;

                for (const el of items) {
                    const txt = (el.innerText || el.getAttribute('aria-label') || "").trim().toLowerCase();
                    if (txt.length === 0 || txt.length > 200) continue;

                    if (targetKeywords.some(keyword => txt.includes(keyword.toLowerCase()))) {
                        targetElement = el;
                        break; 
                    }
                }

                if (!targetElement) {
                    // 兜底：如果找不到精確選擇器，則遍歷所有元素
                    const allElements = Array.from(document.querySelectorAll('button, div[role="button"]'));
                    for (const el of allElements) {
                        const txt = (el.innerText || "").toLowerCase().trim();
                        if (txt.length > 0 && txt.length < 100 && targetKeywords.some(keyword => txt.includes(keyword.toLowerCase()))) {
                            bestMatch = el;
                        }
                    }
                    targetElement = bestMatch;
                }

                if (!targetElement) {
                    document.body.click(); // 關閉選單
                    return `⚠️ 已展開選單，但找不到對應「${mode}」的選項。`;
                }

                targetElement.click();
                await delay(800);
                return `✅ 成功切換至 [${mode}] 模式！`;
            }, targetMode.toLowerCase());

            return result;
        } catch (error) {
            return `❌ 視覺腳本執行失敗: ${error.message}`;
        }
    }

    /**
     * 發送訊息到 Gemini 並等待結構化回應
     * @param {string} text - 訊息內容
     * @param {boolean} [isSystem=false] - 是否為系統訊息
     * @returns {Promise<string>} 清理後的 AI 回應
     */
    async sendMessage(text, isSystem = false, options = {}, ctx = null) {
        await this._ensureBrowserHealth();
        if (!this.context) await this.init();

        // ── [v9.1] 首次發送訊息前詢問是否登入 (僅限 TTY 或非生產環境) ──
        if (!this.loginPromptDone && !isSystem) {
            await this._checkLoginRequirement(ctx);
        }

        try { await this.page.bringToFront(); } catch (e) { }
        await this.setupCDP();

        // ── [v9.1] Slash Command Interception ──
        if (text.startsWith('/') || text.startsWith('GOLEM_SKILL::')) {
            const commandResult = await NodeRouter.handle({ text, isAdmin: true }, this);
            if (commandResult) {
                console.log(`⚡ [Brain] 指令攔截器已處理: ${text}`);
                // 模擬 AI 回應格式返回 (若有需要可以包裝成更複雜的格式)
                return commandResult;
            }
        }

        const reqId = ProtocolFormatter.generateReqId();
        const startTag = ProtocolFormatter.buildStartTag(reqId);
        const endTag = ProtocolFormatter.buildEndTag(reqId);
        const payload = ProtocolFormatter.buildEnvelope(text, reqId, options);

        console.log(`📡 [Brain] 發送訊號: ${reqId} (含每回合強制洗腦引擎)`);

        const interactor = new PageInteractor(this.page, this.doctor);

        try {
            return await interactor.interact(
                payload, this.selectors, isSystem, startTag, endTag
            );
        } catch (e) {
            // 處理 selector 修復觸發的重試
            if (e.message && e.message.startsWith('SELECTOR_HEALED:')) {
                const [, type, newSelector] = e.message.split(':');
                this.selectors[type] = newSelector;
                this.doctor.saveSelectors(this.selectors);
                return interactor.interact(
                    payload, this.selectors, isSystem, startTag, endTag, 1
                );
            }
            throw e;
        }
    }

    /**
     * 從記憶中回憶相關內容
     * @param {string} queryText - 查詢文字
     * @returns {Promise<Array>}
     */
    async recall(queryText) {
        if (!queryText) return [];
        await this._ensureBrowserHealth();
        try { return await this.memoryDriver.recall(queryText); } catch (e) { return []; }
    }

    /**
     * 將內容存入長期記憶
     * @param {string} text - 要記憶的文字
     * @param {Object} [metadata={}] - 附加 metadata
     */
    async memorize(text, metadata = {}) {
        await this._ensureBrowserHealth();
        try { await this.memoryDriver.memorize(text, metadata); } catch (e) { }
    }

    /**
     * 附加對話日誌
     * @param {Object} entry - 日誌紀錄
     */
    _appendChatLog(entry) {
        // 確保在寫入前已初始化 (防呆)
        this.chatLogManager.init().then(() => {
            this.chatLogManager.append(entry);
        });
    }

    // ─── Private Methods ─────────────────────────────────────

    /** 初始化記憶引擎，失敗時降級 */
    async _initMemoryDriver() {
        try {
            await this.memoryDriver.init();
        } catch (e) {
            console.warn("🔄 [System] 記憶引擎降級為 Browser/Native...");
            this.memoryDriver = new BrowserMemoryDriver(this);
            await this.memoryDriver.init();
        }
    }

    /**
     * [v9.1] 詢問使用者是否需要手動登入
     */
    async _checkLoginRequirement(ctx) {
        if (this.loginPromptDone) return;

        // 如果沒有 ctx，則無法進行互動（可能是系統自動任務），預設跳過
        if (!ctx) {
            this.loginPromptDone = true;
            return;
        }

        return new Promise(async (resolve) => {
            this.loginResolver = resolve;

            const promptText = "❓ **檢測到尚未進入登入流程**\n您是否希望現在開啟瀏覽器視窗進行 Google 帳號登入？\n\n(登入後將可使用您的個人設定與 Pro/Thinking 模型)";
            const replyOptions = {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🌐 開啟視窗並登入', callback_data: 'LOGIN_MANUAL' },
                        { text: '⏩ 暫不登入 (使用遊客身份)', callback_data: 'LOGIN_SKIP' }
                    ]]
                }
            };

            await ctx.reply(promptText, replyOptions);

            // 如果是終端機模式 (Telegram/Discord)，使用者也會看到按鈕。
            // 如果是 Web Dashboard，按鈕會變成互動視窗。
            console.log('⏳ [Golem] 等待使用者確認登入需求 (透過 Dashboard 或通訊軟體)...');
            
            // 此 Promise 將在 handleUnifiedCallback 中被 resolve
        });
    }

    /**
     * [v9.1] 被外部呼叫以回應登入需求
     */
    async resolveLogin(choice, ctx) {
        if (!this.loginResolver) return;
        
        const resolve = this.loginResolver;

        if (choice === 'manual') {
            await ctx.reply("🚀 **好的，正在為您開啟登入視窗...**\n請在視窗中完成 Google 登入後，點擊下方「我已完成登入」按鈕。");
            
            // 更新 resolver 為等待 "完成"
            this.loginResolver = resolve;

            // 執行開啟有頭模式
            await this._manualLoginFlowNoWait();

            await ctx.reply("🔑 **請確認登入狀態**", {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ 我已完成登入', callback_data: 'LOGIN_DONE' }
                    ]]
                }
            });
        } else if (choice === 'skip') {
            this.loginPromptDone = true;
            this.loginResolver = null;
            await ctx.reply("🆗 收到。將使用目前的瀏覽器環境（遊客模式）繼續執行初始化。");
            await this.init(true, false);
            resolve();
        } else if (choice === 'done') {
            this.loginPromptDone = true;
            this.loginResolver = null;
            await ctx.reply("🔄 **收到！正在切換回後台模式並啟動大腦...**");
            this.forceHeadful = false;
            if (this.context) {
                await this.context.close();
                this.context = null;
                this.page = null;
                this.cdpSession = null;
            }
            await this.init(true, false);
            resolve();
        }
    }

    /**
     * [v9.1] 開啟登入視窗（不阻塞）
     */
    async _manualLoginFlowNoWait() {
        if (this.context) {
            console.log('🛑 [Golem] 正在關閉目前瀏覽器以切換至有頭模式...');
            await this.context.close();
            this.context = null;
            this.page = null;
            this.cdpSession = null;
        }
        this.forceHeadful = true;
        await this.init(true, true);
        console.log('🌐 [Golem] 登入視窗已開啟。');
    }

    /** 連結 Dashboard (若以 dashboard 模式啟動) */
    _linkDashboard(autonomy = null) {
        if (!process.argv.includes('dashboard')) return;
        try {
            const dashboard = require('../../dashboard');
            dashboard.setContext(this.golemId, this, this.memoryDriver, autonomy);
        } catch (e) {
            try {
                const dashboard = require('../../dashboard.js');
                dashboard.setContext(this.golemId, this, this.memoryDriver, autonomy);
            } catch (err) {
                console.error("Failed to link dashboard context:", err);
            }
        }
    }

    /**
     * 🔄 對外公開：重新組裝技能書並注入 Gemini（開啟全新的聊天視窗）
     * 供 Dashboard 的「注入技能書」按鈕使用
     * ✅ [需求變更] 依據使用者要求，禁止即時熱注入，改為「重新開啟 Gemini 對話視窗」後再注入
     */
    async reloadSkills() {
        // 1. 設定熱重載：從 .env 重新讀取配置 (包含 API Key, 模式, 選用技能等)
        console.log(`🔄 [Brain][${this.golemId}] 正在執行設定熱重載 (Config Reload)...`);
        ConfigManager.reloadConfig();

        // 2. 技能同步：依據最新設定同步 SQLite 索引
        console.log(`📡 [Brain][${this.golemId}] 正在同步技能索引 (Skill Sync)...`);
        try {
            const personaManager = require('../skills/core/persona');
            const personaData = personaManager.get(this.userDataDir);
            const personaSkills = personaData.skills || [];
            const { resolveEnabledSkills } = require('../skills/skillsConfig');

            // 使用最新的 process.env.OPTIONAL_SKILLS
            const enabledSet = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', personaSkills);
            await this.skillIndex.sync(Array.from(enabledSet));
        } catch (e) {
            console.warn(`⚠️ [Brain][${this.golemId}] 技能同步失敗:`, e.message);
        }

        // 3. 清除 ProtocolFormatter 快取，讓下次 build 時重新掃描
        ProtocolFormatter._lastScanTime = 0;
        console.log(`🔄 [Brain][${this.golemId}] 協議快取已清除，開始重新開啟對話視窗並注入...`);

        // 4. 若瀏覽器還沒準備好，直接返回（表示本次注入會在下次 init 時生效）
        if (!this.page) {
            console.log(`⚠️ [Brain][${this.golemId}] 瀏覽器尚未初始化，技能將在下次啟動時自動載入。`);
            return;
        }

        // 5. 重新開啟對話視窗 (New Chat) 後再注入
        console.log(`🔄 [Brain][${this.golemId}] 正在開啟新的 ${this.backend === 'perplexity' ? 'Perplexity' : 'Gemini'} 對話視窗...`);
        const targetUrl = this.backend === 'perplexity' ? URLS.PERPLEXITY_APP : URLS.GEMINI_APP;
        await this.page.goto(targetUrl, { waitUntil: 'networkidle2' });

        await this._injectSystemPrompt(true);
        console.log(`✅ [Brain][${this.golemId}] 完整重啟流程執行完畢 (Config + Skill + Protocol)。`);
    }

    /**
     * 組裝並發送系統 Prompt
     * @param {boolean} [forceRefresh=false]
     */
    async _injectSystemPrompt(forceRefresh = false) {
        let { systemPrompt, skillMemoryText } = await ProtocolFormatter.buildSystemPrompt(forceRefresh, {
            userDataDir: this.userDataDir,
            golemId: this.golemId
        });

        if (skillMemoryText) {
            await this.memorize(skillMemoryText, { type: 'system_skills', source: 'boot_init' });
            console.log(`🧠 [Memory] 已成功將技能載入長期記憶中！`);
        }

        // 🚀 [第一階段] 發送底層系統協議 (不含歷史摘要)
        const compressedPrompt = ProtocolFormatter.compress(systemPrompt);
        await this.sendMessage(compressedPrompt, false); // ⚡ 改為 false：等待完整回應
        console.log(`📡 [Brain] 階段一：底層協議注入完成 (${this.backend.toUpperCase()})。`);

        // 🧠 [第二階段] 金字塔式多層記憶注入
        if (this.chatLogManager) {
            try {
                let historicalMemory = "";

                // 🏛️ Tier 4: 紀元里程碑 (最近 1 個)
                const eraSummaries = this.chatLogManager.readTier('era', 1);
                if (eraSummaries.length > 0) {
                    eraSummaries.forEach(s => {
                        historicalMemory += `\n=== [紀元回憶: ${s.date}] ===\n${s.content}\n`;
                    });
                }

                // 🏛️ Tier 3: 年度回顧 (最近 1 個)
                const yearlySummaries = this.chatLogManager.readTier('yearly', 1);
                if (yearlySummaries.length > 0) {
                    yearlySummaries.forEach(s => {
                        historicalMemory += `\n=== [年度回顧: ${s.date}] ===\n${s.content}\n`;
                    });
                }

                // 🏛️ Tier 2: 月度精華 (最近 3 個)
                const monthlySummaries = this.chatLogManager.readTier('monthly', 3);
                if (monthlySummaries.length > 0) {
                    monthlySummaries.forEach(s => {
                        historicalMemory += `\n--- [月度精華: ${s.date}] ---\n${s.content}\n`;
                    });
                }

                // 🏛️ Tier 1: 每日摘要 (最近 7 天)
                const dailySummaries = this.chatLogManager.readTier('daily', 7);
                if (dailySummaries.length > 0) {
                    dailySummaries.forEach(s => {
                        historicalMemory += `\n--- [${s.date} 摘要] ---\n${s.content}\n`;
                    });
                }

                if (historicalMemory) {
                    const tierCounts = [
                        eraSummaries.length > 0 ? `紀元×${eraSummaries.length}` : null,
                        yearlySummaries.length > 0 ? `年度×${yearlySummaries.length}` : null,
                        monthlySummaries.length > 0 ? `月度×${monthlySummaries.length}` : null,
                        dailySummaries.length > 0 ? `每日×${dailySummaries.length}` : null,
                    ].filter(Boolean);

                    // ⚡ [Fix] Token 預算保護：超過 200K 字元時，從最舊 Tier 開始截斷
                    const MAX_MEMORY_CHARS = 200000;
                    if (historicalMemory.length > MAX_MEMORY_CHARS) {
                        console.warn(`⚠️ [Brain] 歷史記憶超過 Token 預算 (${historicalMemory.length} chars > ${MAX_MEMORY_CHARS})，截斷較舊 Tier...`);
                        historicalMemory = historicalMemory.slice(-MAX_MEMORY_CHARS);
                    }

                    // ⚡ [Fix] 動態生成注入說明，只列出實際有資料的層
                    const tierDesc = tierCounts.length > 0
                        ? `（涵蓋：${tierCounts.join(' → ')}）`
                        : '';

                    const memoryPulse = `【指令：載入長期記憶與背景壓縮】\n以下是你過去對話的多層次彙總精華${tierDesc}。請完整閱讀並內化這些背景，將其視為你目前已知的所有先驗知識與決策紀錄：\n${historicalMemory}`;
                    await this.sendMessage(memoryPulse, false);
                    console.log(`🧠 [Brain] 階段二：已注入多層記憶 (${tierCounts.join(', ')})。`);
                } else {
                    // 🕐 Tier 0 Fallback：無任何壓縮摘要時，直接載入全部 hourly 原始對話
                    const rawMemory = this.chatLogManager.readRecentHourly();
                    if (rawMemory) {
                        const MAX_RAW_CHARS = 200000;
                        const safeRaw = rawMemory.length > MAX_RAW_CHARS
                            ? rawMemory.slice(-MAX_RAW_CHARS)
                            : rawMemory;
                        const rawPulse = `【指令：載入近期原始對話紀錄】\n目前尚無任何壓縮摘要，以下是你最近的完整對話原文。請完整閱讀並視為你已知的先驗背景：\n${safeRaw}`;
                        await this.sendMessage(rawPulse, false);
                        console.log(`🕐 [Brain] 階段二(Fallback)：已注入 Tier 0 原始 hourly 對話 (${safeRaw.length} chars)。`);
                    } else {
                        console.log(`ℹ️ [Brain] 階段二：無任何歷史記憶可注入 (全新會話)。`);
                    }
                }
            } catch (e) {
                console.warn(`⚠️ [Brain] 歷史記憶掃描或注入失敗: ${e.message}`);
            }
        }
    }

    /**
     * 🛡️ 瀏覽器健康檢查與自癒機制
     */
    async _ensureBrowserHealth() {
        let isHealthy = true;
        try {
            if (!this.context) return; // 尚未啟動不視為故障，由 sendMessage 的 init() 處理

            // 1. 檢查連線狀態
            // Playwright 中，如果 context.browser 存在，則檢查連線
            const browser = this.context.browser();
            if (browser && !browser.isConnected()) {
                console.warn("📡 [Brain] 偵測到瀏覽器連線斷開，啟動自癒程序...");
                isHealthy = false;
            }

            // 2. 檢查頁面活性 (防止視窗被手動關閉或 Crash)
            if (isHealthy && this.page) {
                try {
                    // 執行一個輕量級的評估，若頁面已關閉或無回應，此處會噴錯
                    await this.page.evaluate(() => 1);
                } catch (e) {
                    console.warn(`⚠️ [Brain] 偵測到偵錯頁面無回應 (${e.message})，啟動重新掛載程序...`);
                    isHealthy = false;
                }
            }
        } catch (e) {
            isHealthy = false;
        }

        if (!isHealthy) {
            console.warn("🩹 [Brain] 偵測到失效狀態，正在執行物理清理並重新初始化...");
            // 清理舊實體 (確保清理乾淨，防止殘留 Lock)
            try {
                if (this.context) {
                    console.log("掃描 [Brain] 正在強制關閉舊瀏覽器...");
                    await Promise.race([
                        this.context.close(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('CLOSE_TIMEOUT')), 5000))
                    ]).catch(e => console.warn(`⚠️ [Brain] 關閉舊瀏覽器超時或失敗: ${e.message}`));
                }
            } catch (e) { }

            this.context = null;
            this.page = null;
            this.memoryPage = null;
            this.cdpSession = null;

            console.log("🌱 [Brain] 準備執行全新初始化 (init)...");
            // 重新初始化 (forceReload = true)
            await this.init(true);
            console.log("✅ [Brain] 自癒初始化完成。");
        }
    }
}

module.exports = GolemBrain;
