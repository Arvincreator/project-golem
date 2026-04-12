// ============================================================
// 🧠 Golem Brain (Multi-Backend) - Clean Architecture Facade
// ============================================================
const path = require('path');
const ConfigManager = require('../config');
const DOMDoctor = require('../services/DOMDoctor');
const OllamaClient = require('../services/OllamaClient');
const { LanceDBProDriver, SystemNativeDriver, GBrainDriver } = require('../../packages/memory');

const BrowserLauncher = require('./BrowserLauncher');
const { ProtocolFormatter } = require('../../packages/protocol');
const PageInteractor = require('./PageInteractor');
const ChatLogManager = require('../managers/ChatLogManager');
const SkillIndexManager = require('../managers/SkillIndexManager');
const NodeRouter = require('./NodeRouter');
const { URLS } = require('./constants');

// ============================================================
// 🧠 Golem Brain (Gemini Web + Ollama) - Dual-Engine + Titan Protocol
// ============================================================
class GolemBrain {
    constructor(options = {}) {
        // ── 實體識別與設定 ──
        this.golemId = options.golemId || 'default';
        this.userDataDir = options.userDataDir || path.resolve(ConfigManager.CONFIG.USER_DATA_DIR || './golem_memory');
        this.skillIndex = new SkillIndexManager(this.userDataDir);

        // ── 瀏覽器狀態 ──
        this.context = null; // Playwright BrowserContext
        this.page = null;
        this.cdpSession = null;

        // ── DOM 修復服務 ──
        this.doctor = new DOMDoctor();
        this.selectors = this.doctor.loadSelectors();

        // ── 記憶引擎 ──
        const requestedMode = ConfigManager.cleanEnv(process.env.GOLEM_MEMORY_MODE || 'gbrain').toLowerCase() || 'gbrain';
        const isIntelMac = process.platform === 'darwin' && process.arch === 'x64';
        let effectiveMode = requestedMode;

        // Intel Mac 無法使用目前的 LanceDB npm native binary，啟動時主動降級避免初始化爆炸。
        if (requestedMode === 'gbrain') {
            effectiveMode = 'gbrain';
            this.memoryDriver = new GBrainDriver();
        } else if (requestedMode === 'native' || requestedMode === 'system') {
            effectiveMode = 'native';
            this.memoryDriver = new SystemNativeDriver();
        } else if (isIntelMac && requestedMode === 'lancedb-pro') {
            effectiveMode = 'native';
            console.warn('⚠️ [Memory] 偵測到 Intel Mac (darwin-x64)。LanceDB Pro 在此架構不受支援，已自動切換為 SystemNativeDriver。');
            this.memoryDriver = new SystemNativeDriver();
        } else {
            effectiveMode = 'lancedb-pro';
            this.memoryDriver = new LanceDBProDriver();
        }

        console.log(`⚙️ [System] 記憶引擎模式(請求): ${requestedMode.toUpperCase()} (Golem: ${this.golemId})`);
        console.log(`🧠 [System] 記憶引擎模式(實際): ${effectiveMode.toUpperCase()} (Golem: ${this.golemId})`);

        // ── 對話日誌 ──
        this.chatLogManager = new ChatLogManager({
            golemId: this.golemId,
            logDir: options.logDir || ConfigManager.LOG_BASE_DIR
        });

        // ── Backend Selection ──
        this.backend = ConfigManager.CONFIG.GOLEM_BACKEND || 'gemini';
        this.ollamaClient = this.backend === 'ollama' ? new OllamaClient() : null;
        this.isInitialized = false;
        this._ollamaBootInjected = false;
        this._webBootInjected = false;
        this._isInjectingSystemPrompt = false;
        
        // ── 實體生命週期追蹤 ──
        this.browserStartTime = null;
    }

    // ─── Public API (向後相容) ─────────────────────────────

    /**
     * 初始化瀏覽器、記憶引擎、注入系統 Prompt
     * @param {boolean} [forceReload=false] - 是否強制重新載入
     * @param {boolean} [skipPromptInjection=false] - 是否跳過注入系統提示詞
     */
    async init(forceReload = false, skipPromptInjection = false) {
        console.log(`🎬 [Brain] 啟動初始化程序 (forceReload: ${forceReload})...`);
        this.backend = ConfigManager.CONFIG.GOLEM_BACKEND || this.backend || 'gemini';

        // Ollama backend: 無需啟動瀏覽器
        if (this.backend === 'ollama') {
            if (this.isInitialized && !forceReload) {
                console.log("✅ [Brain] Ollama 實體已就緒，跳過重複初始化。");
                return;
            }
            if (!this.ollamaClient) this.ollamaClient = new OllamaClient();

            // 初始化日誌與技能索引
            await this.chatLogManager.init();
            const personaManager = require('../skills/core/persona');
            const hasPersona = personaManager.exists(this.userDataDir);
            try {
                if (hasPersona) {
                    const personaData = personaManager.get(this.userDataDir);
                    const personaSkills = personaData.skills || [];
                    const { resolveEnabledSkills } = require('../skills/skillsConfig');
                    const enabledSet = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', personaSkills);
                    await this.skillIndex.sync(Array.from(enabledSet));
                } else {
                    console.log(`⏸️ [Brain][${this.golemId}] 尚未完成設定 (Missing persona.json)，跳過技能索引同步與系統注入。`);
                }
            } catch (e) {
                console.warn('⚠️ [Brain] 技能索引同步失敗:', e.message);
            }

            await this._initMemoryDriver();
            this._linkDashboard();
            this.isInitialized = true;

            if (!skipPromptInjection && hasPersona && (forceReload || !this._ollamaBootInjected)) {
                this._ollamaBootInjected = true;
                await this._injectSystemPrompt(forceReload);
            }
            return;
        }

        if (this.context && !forceReload && this.isInitialized) {
            const personaManager = require('../skills/core/persona');
            const hasPersona = personaManager.exists(this.userDataDir);

            if (!skipPromptInjection && hasPersona && !this._webBootInjected && !this._isInjectingSystemPrompt) {
                console.log(`🧩 [Brain][${this.golemId}] 偵測到已初始化但尚未注入初始提示詞，開始補注入...`);
                await this._injectSystemPrompt(false);
            } else {
                console.log("✅ [Brain] 瀏覽器實體已存在且無須強制重新載入，跳過啟動。");
            }
            return;
        }

        let isNewSession = false;

        // 1. 啟動 / 連線瀏覽器 (Playwright 回傳 Context)
        if (!this.context) {
            console.log(`📂 [System] Browser User Data Dir: ${this.userDataDir} (Golem: ${this.golemId})`);

            this.context = await BrowserLauncher.launch({
                userDataDir: this.userDataDir,
                headless: process.env.PLAYWRIGHT_HEADLESS,
            });
            this.browserStartTime = Date.now();
        }

        // 2. 取得或建立頁面
        if (!this.page) {
            console.log(`🚀 [System] 正在建立瀏覽子頁面...`);
            const pages = this.context.pages();
            this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
            isNewSession = true;
        }

        const targetBackend = this.backend === 'perplexity' ? 'perplexity' : 'gemini';
        await this._navigateToTarget(targetBackend);
        console.log(`🚀 [System] ${targetBackend === 'perplexity' ? 'Perplexity' : 'Gemini'} 頁面載入完成 (Golem: ${this.golemId})`);
        // isNewSession is already set above if a new page was created.

        // 2.5 初始化日誌管理員 (建立目錄)
        await this.chatLogManager.init();

        // 2.6 同步技能索引到 SQLite (僅在完成建立/設定後才啟動)
        const personaManager = require('../skills/core/persona');
        const hasPersona = personaManager.exists(this.userDataDir);
        try {
            if (hasPersona) {
                // 獲取目前啟用的技能清單
                const personaData = personaManager.get(this.userDataDir);
                const personaSkills = personaData.skills || [];
                const { resolveEnabledSkills } = require('../skills/skillsConfig');

                const enabledSet = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', personaSkills);
                await this.skillIndex.sync(Array.from(enabledSet));
            } else {
                console.log(`⏸️ [Brain][${this.golemId}] 尚未完成設定 (Missing persona.json)，跳過技能索引同步與系統提示詞注入。`);
            }
        } catch (e) {
            console.warn('⚠️ [Brain] 技能索引同步失敗:', e.message);
        }

        // 3. 初始化記憶引擎 (含降級策略)
        await this._initMemoryDriver();

        // 4. Dashboard 整合 (可選)
        this._linkDashboard();

        // 在系統提示詞注入前先標記初始化完成，避免 sendMessage() 重入 init()
        this.isInitialized = true;

        // 5. 新會話: 注入系統 Prompt (僅在允許且檔案存在時注入)
        if (!skipPromptInjection && hasPersona && (forceReload || isNewSession) && !this._isInjectingSystemPrompt) {
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

    // ✨ [新增] 動態視覺腳本：針對新版 UI 切換模型 (支援中英文介面與防呆)
    async switchModel(targetMode) {
        if (this.backend === 'ollama') {
            return '⚠️ 目前使用 Ollama 後端，/model 視覺切換僅適用於 Gemini Web。';
        }
        if (!this.page) throw new Error("大腦尚未啟動。");
        try {
            const result = await this.page.evaluate(async (mode) => {
                const delay = (ms) => new Promise(r => setTimeout(r, ms));

                // 定義支援的模式及其可能的中英文關鍵字
                const modeKeywords = {
                    'fast': ['fast', '快捷'],
                    'thinking': ['thinking', '思考型', '思考'], // 增加容錯率
                    'pro': ['pro'] // Pro 通常中英文都叫 Pro
                };

                // 取得目標模式的所有關鍵字
                const targetKeywords = modeKeywords[mode] || [mode];

                // 1. 尋找畫面底部含有目標關鍵字的按鈕 (這可能是展開選單的按鈕)
                const allKnownKeywords = [...modeKeywords.fast, ...modeKeywords.thinking, ...modeKeywords.pro];
                const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
                let pickerBtn = null;

                for (const btn of buttons) {
                    const txt = (btn.innerText || "").toLowerCase().trim();
                    if (allKnownKeywords.some(k => txt.includes(k.toLowerCase())) && btn.offsetHeight > 10 && btn.offsetHeight < 60) {
                        const rect = btn.getBoundingClientRect();
                        // 根據截圖，該按鈕位於畫面下半部
                        if (rect.top > window.innerHeight / 2) {
                            pickerBtn = btn;
                            break;
                        }
                    }
                }

                if (!pickerBtn) return "⚠️ 找不到畫面底部的模型切換按鈕。UI 可能已變更，或您停留在登入畫面。";

                // ✨ [核心防呆] 檢查按鈕是否為「灰色不可點擊」狀態
                const isDisabled = pickerBtn.disabled ||
                    pickerBtn.getAttribute('aria-disabled') === 'true' ||
                    pickerBtn.classList.contains('disabled');

                if (isDisabled) {
                    return "⚠️ 模型切換按鈕目前呈現「灰色不可點擊」狀態！這通常是因為您尚未登入 Google 帳號，或該帳號目前沒有權限切換模型。";
                }

                // 點擊展開選單
                pickerBtn.click();
                await delay(1000); // 等待選單彈出動畫

                // 2. 尋找選單中對應的目標模式 (比對中英文關鍵字)
                const items = Array.from(document.querySelectorAll('*'));
                let targetElement = null;
                let bestMatch = null;

                for (const el of items) {
                    // 排除觸發按鈕本身，避免點到自己導致選單關閉
                    if (pickerBtn === el || pickerBtn.contains(el)) continue;

                    // 排除不可見的元素
                    const rect = el.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) continue;

                    const txt = (el.innerText || "").trim().toLowerCase();

                    // 【防呆關鍵】如果文字太長，代表它是大容器 (例如整個網頁 background)，絕對不能點擊
                    if (txt.length === 0 || txt.length > 50) continue;

                    // 檢查是否包含目標關鍵字
                    if (targetKeywords.some(keyword => txt.includes(keyword.toLowerCase()))) {
                        // 優先尋找帶有標準選單屬性的元素
                        const role = el.getAttribute('role');
                        if (role === 'menuitem' || role === 'menuitemradio' || role === 'option') {
                            targetElement = el;
                            break; // 找到最標準的選項，直接選定中斷
                        }

                        // 否則，尋找最深層的元素 (querySelectorAll 由外而內，最後的通常最深)
                        bestMatch = el;
                    }
                }

                // 如果找不到標準 role，使用最深層的比對結果
                if (!targetElement) {
                    targetElement = bestMatch;
                }

                if (!targetElement) {
                    // 若真的找不到，點擊背景關閉選單避免畫面卡死
                    document.body.click();
                    return `⚠️ 選單已展開，但找不到對應「${mode}」的選項 (已搜尋關鍵字: ${targetKeywords.join(', ')})。您可能目前無法使用該模型。`;
                }

                // 點擊目標選項
                targetElement.click();
                await delay(800);
                return `✅ 成功為您點擊並切換至 [${mode}] 模式！`;
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
     * @returns {Promise<{text: string, attachments: any[]}>} 清理後的 AI 回應與附件
     */
    async sendMessage(text, isSystem = false, options = {}) {
        this.backend = ConfigManager.CONFIG.GOLEM_BACKEND || this.backend || 'gemini';

        // ── [v9.1] Slash Command Interception ──
        if (text.startsWith('/') || text.startsWith('GOLEM_SKILL::')) {
            const commandResult = await NodeRouter.handle({ text, isAdmin: true }, this);
            if (commandResult) {
                console.log(`⚡ [Brain] 指令攔截器已處理: ${text}`);
                return { text: commandResult, attachments: [] };
            }
        }

        if (this.backend === 'ollama') {
            if (!this.isInitialized) await this.init();
            return this._sendMessageViaOllama(text, isSystem, options);
        }

        await this._ensureBrowserHealth();
        if (!this.context || !this.isInitialized) await this.init();
        try { await this.page.bringToFront(); } catch (e) { }
        await this.setupCDP();

        const attachment = options.attachment || null;

        const reqId = ProtocolFormatter.generateReqId();
        const startTag = ProtocolFormatter.buildStartTag(reqId);
        const endTag = ProtocolFormatter.buildEndTag(reqId);
        const payload = ProtocolFormatter.buildEnvelope(text, reqId, options);

        console.log(`📡 [Brain] 發送訊號: ${reqId} (含每回合強制洗腦引擎)${attachment ? ' 📎 含有附件' : ''}`);

        const interactor = new PageInteractor(this.page, this.doctor);

        let result;
        try {
            result = await interactor.interact(
                payload, this.selectors, isSystem, startTag, endTag, 0, attachment
            );
        } catch (e) {
            // 處理 selector 修復觸發的重試
            if (e.message && e.message.startsWith('SELECTOR_HEALED:')) {
                const [, type, newSelector] = e.message.split(':');
                this.selectors[type] = newSelector;
                this.doctor.saveSelectors(this.selectors);
                result = await interactor.interact(
                    payload, this.selectors, isSystem, startTag, endTag, 1, attachment
                );
            } else {
                throw e;
            }
        }

        // 📥 [v9.1.10] 處理 Gemini 回傳的附件，下載至本地伺服器
        if (result.attachments && result.attachments.length > 0) {
            const { downloadFile } = require('../utils/HttpUtils');
            const path = require('path');
            const { v4: uuidv4 } = require('uuid');

            const localAttachments = [];
            for (const att of result.attachments) {
                try {
                    // 🚀 [v9.1.10] 強化副檔名推斷
                    let ext = 'bin';
                    const urlPath = att.url.split('?')[0].split('#')[0];
                    const matchedExt = urlPath.match(/\.([a-zA-Z0-9]+)$/);
                    if (matchedExt) ext = matchedExt[1];
                    else if (att.mimeType === 'image/png') ext = 'png';
                    else if (att.mimeType === 'application/pdf') ext = 'pdf';

                    const fileName = `gemini_res_${Date.now()}_${uuidv4().substring(0, 8)}.${ext}`;
                    const projectRoot = path.resolve(__dirname, '../../');
                    const localPath = path.join(projectRoot, 'data', 'temp_uploads', fileName);

                    await downloadFile(att.url, localPath);
                    console.log(`✅ [Brain] Gemini 回應附件已下載 [${ext}]: ${fileName}`);

                    localAttachments.push({
                        url: `/api/files/${fileName}`,
                        path: localPath,
                        mimeType: att.mimeType || 'application/octet-stream',
                        isNative: true,
                        name: fileName
                    });
                } catch (err) {
                    console.warn(`⚠️ [Brain] 附件下載失敗 (${att.url}): ${err.message}`);
                }
            }
            result.attachments = localAttachments;
        }

        return result;
    }

    async _sendMessageViaOllama(text, isSystem = false, options = {}) {
        if (!this.ollamaClient) this.ollamaClient = new OllamaClient();
        const attachment = options.attachment || null;
        if (attachment) {
            console.warn('⚠️ [Brain] Ollama backend currently ignores browser attachments.');
        }

        const reqId = ProtocolFormatter.generateReqId();
        const payload = ProtocolFormatter.buildEnvelope(text, reqId, options);
        console.log(`📡 [Brain][Ollama] 發送訊號: ${reqId}`);

        const responseText = await this.ollamaClient.chat(payload, {
            model: ConfigManager.CONFIG.OLLAMA_BRAIN_MODEL,
            system: isSystem ? '你正在接收系統層訊息，請嚴格遵守。' : undefined
        });

        return {
            text: responseText,
            attachments: []
        };
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
        if (!this.chatLogManager) return;
        
        // 確保在寫入前已初始化 (防呆)
        if (this.chatLogManager._isInitialized) {
            this.chatLogManager.append(entry);
        } else {
            console.warn(`⚠️ [Brain][${this.golemId}] chatLogManager 未準備就緒，嘗試自動初始化後寫入...`);
            this.chatLogManager.init().then(() => {
                this.chatLogManager.append(entry);
            }).catch(err => {
                console.error(`❌ [Brain][${this.golemId}] appendedChatLog error:`, err);
            });
        }
    }

    // ─── Private Methods ─────────────────────────────────────

    /** 初始化記憶引擎，失敗時降級 */
    async _initMemoryDriver() {
        try {
            await this.memoryDriver.init();
        } catch (e) {
            console.warn("🔄 [System] 記憶引擎降級為 SystemNativeDriver...");
            this.memoryDriver = new SystemNativeDriver();
            await this.memoryDriver.init();
        }
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
        this.backend = ConfigManager.CONFIG.GOLEM_BACKEND || this.backend || 'gemini';
        if (this.backend === 'ollama' && !this.ollamaClient) {
            this.ollamaClient = new OllamaClient();
        }

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

        if (this.backend === 'ollama') {
            await this._injectSystemPrompt(true);
            console.log(`✅ [Brain][${this.golemId}] Ollama 技能注入流程完成。`);
            return;
        }

        // 4. 若瀏覽器還沒準備好，直接返回（表示本次注入會在下次 init 時生效）
        if (!this.page) {
            console.log(`⚠️ [Brain][${this.golemId}] 瀏覽器尚未初始化，技能將在下次啟動時自動載入。`);
            return;
        }

        // 5. 重新開啟對話視窗 (New Chat) 後再注入
        console.log(`🔄 [Brain][${this.golemId}] 正在開啟新的 ${this.backend === 'perplexity' ? 'Perplexity' : 'Gemini'} 對話視窗...`);
        const targetBackend = this.backend === 'perplexity' ? 'perplexity' : 'gemini';
        await this._navigateToTarget(targetBackend);

        await this._injectSystemPrompt(true);
        console.log(`✅ [Brain][${this.golemId}] 完整重啟流程執行完畢 (Config + Skill + Protocol)。`);
    }

    /**
     * 組裝並發送系統 Prompt
     * @param {boolean} [forceRefresh=false]
     */
    async _injectSystemPrompt(forceRefresh = false) {
        if (this._isInjectingSystemPrompt) {
            console.log(`⏳ [Brain][${this.golemId}] 系統提示詞注入進行中，跳過重複觸發。`);
            return;
        }

        this._isInjectingSystemPrompt = true;
        const shouldTrackWebBoot = this.backend !== 'ollama';
        let markedWebInjectedThisRound = false;

        try {
            let { systemPrompt, skillMemoryText } = await ProtocolFormatter.buildSystemPrompt(forceRefresh, {
                userDataDir: this.userDataDir,
                golemId: this.golemId
            });

            if (skillMemoryText) {
                await this.memorize(skillMemoryText, { type: 'system_skills', source: 'boot_init' });
                console.log(`🧠 [Memory] 已成功將技能載入長期記憶中！`);
            }

            // 🚀 [第一階段] 發送底層系統協議 (不含歷史摘要)
            if (shouldTrackWebBoot && !this._webBootInjected) {
                this._webBootInjected = true;
                markedWebInjectedThisRound = true;
            }
            const compressedPrompt = ProtocolFormatter.compress(systemPrompt);
            await this.sendMessage(compressedPrompt, false); // ⚡ 改為 false：等待完整回應
            console.log(`📡 [Brain] 階段一：底層協議注入完成 (${this.backend.toUpperCase()})。`);

            // 🧠 [第二階段] 金字塔式多層記憶注入
            if (this.chatLogManager) {
                try {
                    let historicalMemory = "";

                    // 🏛️ Tier 4: 紀元里程碑 (最近 1 個)
                    const eraSummaries = await this.chatLogManager.readTierAsync('era', 1);
                    if (eraSummaries.length > 0) {
                        eraSummaries.forEach(s => {
                            historicalMemory += `\n=== [紀元回憶: ${s.date}] ===\n${s.content}\n`;
                        });
                    }

                    // 🏛️ Tier 3: 年度回顧 (最近 1 個)
                    const yearlySummaries = await this.chatLogManager.readTierAsync('yearly', 1);
                    if (yearlySummaries.length > 0) {
                        yearlySummaries.forEach(s => {
                            historicalMemory += `\n=== [年度回顧: ${s.date}] ===\n${s.content}\n`;
                        });
                    }

                    // 🏛️ Tier 2: 月度精華 (最近 3 個)
                    const monthlySummaries = await this.chatLogManager.readTierAsync('monthly', 3);
                    if (monthlySummaries.length > 0) {
                        monthlySummaries.forEach(s => {
                            historicalMemory += `\n--- [月度精華: ${s.date}] ---\n${s.content}\n`;
                        });
                    }

                    // 🏛️ Tier 1: 每日摘要 (最近 7 天)
                    const dailySummaries = await this.chatLogManager.readTierAsync('daily', 7);
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
                        const rawMemory = await this.chatLogManager.readRecentHourlyAsync();
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
        } catch (e) {
            if (shouldTrackWebBoot && markedWebInjectedThisRound) {
                this._webBootInjected = false;
            }
            throw e;
        } finally {
            this._isInjectingSystemPrompt = false;
        }
    }

    /**
     * 🌐 導航至目標 AI 後端，支援多網址高可用 (Failover)
     * @param {string} backend - 'gemini' | 'perplexity'
     */
    async _navigateToTarget(backend) {
        if (!this.page) return;

        let urls = [];
        if (backend === 'perplexity') {
            urls = [URLS.PERPLEXITY_APP];
        } else {
            // 優先從 ConfigManager 讀取使用者設定的 URLs，若無則使用 constants 中的預設值
            urls = ConfigManager.CONFIG.GEMINI_URLS && ConfigManager.CONFIG.GEMINI_URLS.length > 0
                ? ConfigManager.CONFIG.GEMINI_URLS
                : [URLS.GEMINI_APP, ...URLS.GEMINI_FALLBACKS];
        }

        let lastError = null;
        let attempt = 0;
        for (const url of urls) {
            try {
                if (attempt > 0) {
                    const delay = Math.min(1000 * Math.pow(2, attempt), 10000); // 最大延遲 10 秒
                    console.log(`⏳ [Brain] 等待 ${delay}ms 後重試連線...`);
                    await new Promise(r => setTimeout(r, delay));
                }
                attempt++;
                console.log(`📡 [Brain] 正在嘗試導航至: ${url}`);
                // 等待 domcontentloaded 以確保基本結構已載入
                const response = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
                const status = response && typeof response.status === 'function' ? response.status() : null;
                if (status !== null && status >= 500) {
                    // 5xx 視為服務不可用，觸發下一個 URL failover
                    throw new Error(`HTTP ${status}`);
                }
                console.log(`✅ [Brain] 成功導航至: ${url}`);
                return; // 成功則退出
            } catch (e) {
                console.warn(`⚠️ [Brain] 導航至 ${url} 失敗: ${e.message}`);
                lastError = e;
                // 繼續嘗試下一個 URL
            }
        }

        throw new Error(`❌ [Brain] 無法連接至 ${backend.toUpperCase()}。所有嘗試過的網址皆失效。最後錯誤: ${lastError ? lastError.message : '未知'}`);
    }

    /**
     * 🛡️ 瀏覽器健康檢查與自癒機制
     */
    async _ensureBrowserHealth(forceRestart = false) {
        if (this.backend === 'ollama') return;
        let isHealthy = !forceRestart;
        if (!forceRestart) {
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
        } // Close if (!forceRestart)

        if (!isHealthy) {
            console.warn(`🩹 [Brain] 偵測到失效狀態或強制重啟 (forceRestart=${forceRestart})，正在執行物理清理並重新初始化...`);
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
            this.isInitialized = false;

            console.log("🌱 [Brain] 準備執行全新初始化 (init)...");
            // 重新初始化 (forceReload = true)
            await this.init(true);
            console.log("✅ [Brain] 自癒初始化完成。");
        }
    }
}

module.exports = GolemBrain;
