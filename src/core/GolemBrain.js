// ============================================================
// 🧠 Golem Brain (Web Gemini) - Clean Architecture Facade
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

        // ── 瀏覽器狀態 ──
        this.browser = null;
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
        else if (mode === 'native' || mode === 'system') this.memoryDriver = new SystemNativeDriver();
        else this.memoryDriver = new BrowserMemoryDriver(this);

        // ── 對話日誌 ──
        this.chatLogManager = new ChatLogManager({
            golemId: this.golemId,
            logDir: options.logDir || ConfigManager.LOG_BASE_DIR,
            isSingleMode: options.isSingleMode !== undefined ? options.isSingleMode : (ConfigManager.GOLEM_MODE === 'SINGLE')
        });
    }

    // ─── Public API (向後相容) ─────────────────────────────

    /**
     * 初始化瀏覽器、記憶引擎、注入系統 Prompt
     * @param {boolean} [forceReload=false] - 是否強制重新載入
     */
    async init(forceReload = false) {
        if (this.browser && !forceReload) return;

        let isNewSession = false;

        // 1. 啟動 / 連線瀏覽器
        if (!this.browser) {
            console.log(`📂 [System] Browser User Data Dir: ${this.userDataDir} (Golem: ${this.golemId})`);

            this.browser = await BrowserLauncher.launch({
                userDataDir: this.userDataDir,
                headless: process.env.PUPPETEER_HEADLESS,
            });
        }

        // 2. 取得或建立頁面
        if (!this.page) {
            const pages = await this.browser.pages();
            this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
            console.log(`🚀 [System] Browser Session Started (Golem: ${this.golemId})`);
            await this.page.goto(URLS.GEMINI_APP, { waitUntil: 'networkidle2' });
            isNewSession = true;
        }

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
            this.cdpSession = await this.page.target().createCDPSession();
            await this.cdpSession.send('Network.enable');
            console.log("🔌 [CDP] 網路神經連結已建立 (Neuro-Link Active)");
        } catch (e) {
            console.error("❌ [CDP] 連線失敗:", e.message);
        }
    }

    // ✨ [新增] 動態視覺腳本：針對新版 UI 切換模型 (支援中英文介面與防呆)
    async switchModel(targetMode) {
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
     * @returns {Promise<string>} 清理後的 AI 回應
     */
    async sendMessage(text, isSystem = false, options = {}) {
        if (!this.browser) await this.init();
        try { await this.page.bringToFront(); } catch (e) { console.warn('[GolemBrain]', e.message); }
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
        try { return await this.memoryDriver.recall(queryText); } catch (e) { console.warn('[GolemBrain]', e.message); return []; }
    }

    /**
     * 將內容存入長期記憶
     * @param {string} text - 要記憶的文字
     * @param {Object} [metadata={}] - 附加 metadata
     */
    async memorize(text, metadata = {}) {
        try { await this.memoryDriver.memorize(text, metadata); } catch (e) { console.warn('[GolemBrain]', e.message); }
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

    /** 連結 Dashboard (若以 dashboard 模式啟動) */
    _linkDashboard() {
        if (!process.argv.includes('dashboard')) return;
        try {
            const dashboard = require('../../dashboard');
            dashboard.setContext(this.golemId, this, this.memoryDriver);
        } catch (e) {
            try {
                const dashboard = require('../../dashboard.js');
                dashboard.setContext(this.golemId, this, this.memoryDriver);
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
        // 1. 清除 ProtocolFormatter 快取，讓下次 build 時重新掃描
        ProtocolFormatter._lastScanTime = 0;
        console.log(`🔄 [Brain][${this.golemId}] 技能快取已清除，開始重新開啟對話視窗並注入...`);

        // 2. 若瀏覽器還沒準備好，直接返回（表示本次注入會在下次 init 時生效）
        if (!this.page) {
            console.log(`⚠️ [Brain][${this.golemId}] 瀏覽器尚未初始化，技能將在下次啟動時自動載入。`);
            return;
        }

        // 3. 重新開啟 Gemini 視窗 (New Chat) 後再注入
        console.log(`🔄 [Brain][${this.golemId}] 正在開啟新的 Gemini 對話視窗...`);
        const { URLS } = require('./constants');
        console.log(`🚀 [System] Browser Session Started (Golem: ${this.golemId})`);
        await this.page.goto(URLS.GEMINI_APP, { waitUntil: 'networkidle2' });

        await this._injectSystemPrompt(true);
        console.log(`✅ [Brain][${this.golemId}] 技能書已成功注入至全新的 Gemini 會話。`);
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
        console.log(`📡 [Brain] 階段一：底層協議注入完成。`);

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
}

module.exports = GolemBrain;
