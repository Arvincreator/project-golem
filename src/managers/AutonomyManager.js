const ConfigManager = require('../config');
const Introspection = require('../services/Introspection');
const ResponseParser = require('../utils/ResponseParser');
const PatchManager = require('../managers/PatchManager');
const NeuroShunter = require('../core/NeuroShunter');
const SelfEvolution = require('../core/SelfEvolution');
const OODALoop = require('../core/OODALoop');
const path = require('path');
const fs = require('fs');
const endpoints = require('../config/endpoints');
const warroom = require('../utils/warroom-client');

class AutonomyManager {
    constructor(brain, controller, memory, options = {}) {
        this.golemId = options.golemId || 'default';
        this.brain = brain;
        this.controller = controller;
        this.memory = memory;
        this.tgBot = null;
        this.dcClient = null;
        this.convoManager = null;
        this.pendingPatch = null;
        this._moltbookLearner = null;
        this._statusReportTimer = null;
        this.selfEvolution = new SelfEvolution({ golemId: this.golemId });
        this.oodaLoop = null; // initialized after brain is ready
        this._threeLayerMemory = null;
    }

    setIntegrations(tgBot, dcClient, convoManager) {
        this.tgBot = tgBot;
        this.dcClient = dcClient;
        this.convoManager = convoManager;
    }

    start() {
        if (!ConfigManager.CONFIG.TG_TOKEN && !ConfigManager.CONFIG.DC_TOKEN) return;
        this.scheduleNextAwakening();
        this._timeWatcherTimer = setInterval(() => this.timeWatcher(), 60000);
        // ✨ [v9.0.8] 可配置 Archive 檢查間隔 (分鐘)
        const archiveInterval = (parseInt(process.env.ARCHIVE_CHECK_INTERVAL) || 30) * 60000;
        this._archiveTimer = setInterval(() => this.checkArchiveStatus(), archiveInterval);

        // 🦞 Moltbook 自動學習
        this._startMoltbookLearner();

        // 📊 定期狀態報告 (每 2 小時)
        this._statusReportTimer = setInterval(() => this._sendStatusReport(), 2 * 60 * 60 * 1000);
        // 首次報告在啟動 5 分鐘後
        this._statusInitTimer = setTimeout(() => this._sendStatusReport(), 5 * 60 * 1000);
    }

    _startMoltbookLearner() {
        try {
            const MoltbookLearner = require('./MoltbookLearner');
            this._moltbookLearner = new MoltbookLearner(this.brain, this.controller, this, {
                golemId: this.golemId
            });
            this._moltbookLearner.start();
            console.log(`🦞 [Autonomy] Moltbook auto-learning enabled`);
        } catch (e) {
            console.warn(`[Autonomy] Moltbook learner failed to start: ${e.message}`);
        }
    }

    async _sendStatusReport() {
        try {
            const uptime = process.uptime();
            const uptimeStr = `${Math.floor(uptime / 3600)}h${Math.floor((uptime % 3600) / 60)}m`;
            const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);

            const moltStats = this._moltbookLearner ? this._moltbookLearner.getStats() : null;
            const queueStatus = this.controller?.pendingTasks?.size || 0;

            // 行動日誌摘要
            const SecurityManager = require('./SecurityManager');
            const secMgr = this.controller?.security;
            const actionSummary = secMgr?.getActionSummary(5) || '(無紀錄)';

            // Circuit Breaker 狀態
            let cbInfo = '';
            try {
                const cb = require('../core/circuit_breaker');
                const cbStatus = cb.getStatus();
                const openCBs = Object.entries(cbStatus).filter(([, v]) => v.state !== 'CLOSED');
                if (openCBs.length > 0) {
                    cbInfo = `\n⚡ 熔斷: ${openCBs.map(([k, v]) => `${k}=${v.state}`).join(', ')}`;
                }
            } catch (e) { /* optional */ }

            const lines = [
                `📊 <b>${endpoints.AGENT_ID} 狀態報告</b>`,
                ``,
                `⏱ 運行: ${uptimeStr} | 記憶體: ${memMB}MB`,
                `🔄 待審批任務: ${queueStatus}`,
                `📝 最近行動: ${actionSummary}`,
            ];

            if (moltStats) {
                lines.push(`🦞 Moltbook: ${moltStats.cycles} 週期, ${moltStats.interactions} 互動, ${moltStats.errors} 錯誤`);
            }

            if (cbInfo) lines.push(cbInfo);

            lines.push(``, `<i>L0/L1 自動執行中 | L2+ 等待爸爸審批</i>`);

            await this.sendNotification(lines.join('\n'), { parse_mode: 'HTML' });

            // 同步到戰情室 (non-blocking)
            warroom.report('status_report', {
                uptime: uptimeStr,
                memory_mb: memMB,
                pending_tasks: queueStatus,
                moltbook_stats: moltStats,
                action_summary: actionSummary
            }).catch((err) => { console.warn('[AutonomyManager] Status report send failed:', err.message); });
        } catch (e) {
            console.warn(`[Autonomy] Status report failed: ${e.message}`);
        }
    }

    /**
     * L0/L1 自動執行報告 — 發 Telegram 通知
     */
    async reportAutoAction(action, level, result, success) {
        try {
            const emoji = success ? '✅' : '❌';
            const actionDesc = `${action?.action || '?'}${action?.task ? ':' + action.task : ''}`;
            const resultSnippet = String(result).substring(0, 300);

            const msg = [
                `${emoji} <b>[${level} 自動執行]</b> ${actionDesc}`,
                `<pre>${this._escapeHtml(resultSnippet)}</pre>`,
            ].join('\n');

            await this.sendNotification(msg, { parse_mode: 'HTML' });
        } catch (e) {
            console.warn(`[Autonomy] Auto-action report failed: ${e.message}`);
        }
    }

    async recordActionOutcome(action, outcome, success) {
        // Write to RAG
        await this.writeRAGAfter(action, outcome, success);
        // Track in SelfEvolution for strategy learning
        const suggestion = this.selfEvolution.afterAction(action, outcome, success);
        if (suggestion && suggestion.suggestSkill) {
            console.log(`[AutonomyManager] SelfEvolution suggests new skill from pattern: ${suggestion.pattern}`);
        }
    }

    setThreeLayerMemory(mem) {
        this._threeLayerMemory = mem;
    }

    /**
     * L2+ 審批請求 — 發 Telegram 帶按鈕
     */
    async requestApproval(action, level, description, approvalId) {
        try {
            const actionDesc = `${action?.action || '?'}${action?.task ? ':' + action.task : ''}`;

            const msg = [
                `⚠️ <b>[${level} 需要審批]</b>`,
                `動作: <code>${actionDesc}</code>`,
                `說明: ${this._escapeHtml(description.substring(0, 500))}`,
            ].join('\n');

            await this.sendNotification(msg, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ 批准', callback_data: `APPROVE_${approvalId}` },
                        { text: '❌ 拒絕', callback_data: `DENY_${approvalId}` }
                    ]]
                }
            });
        } catch (e) {
            console.warn(`[Autonomy] Approval request failed: ${e.message}`);
        }
    }

    /**
     * 更新戰情室 (Notion War Room) — delegates to warroom-client
     */
    async _updateWarRoom(eventType, data) {
        return warroom.report(eventType, data, endpoints.AGENT_ID);
    }

    /**
     * RAG 查詢 — 動作前先查經驗
     */
    async queryRAGBefore(action) {
        if (!endpoints.RAG_URL) return null;
        try {
            const { getToken } = require('../utils/yedan-auth');
            const token = getToken();
            if (!token) return null;

            const query = `${action?.action || ''} ${action?.task || ''} outcome`;
            const res = await fetch(`${endpoints.RAG_URL}/query`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ query, max_hops: 1, limit: 3 }),
                signal: AbortSignal.timeout(8000)
            });
            if (!res.ok) return null;
            return res.json();
        } catch (e) { return null; }
    }

    /**
     * RAG 寫入 — 動作後記錄經驗
     */
    async writeRAGAfter(action, outcome, success) {
        if (!endpoints.RAG_URL) return;
        try {
            const { getToken } = require('../utils/yedan-auth');
            const token = getToken();
            if (!token) return;

            const actionDesc = `${action?.action || '?'}:${action?.task || ''}`;
            await fetch(`${endpoints.RAG_URL}/evolve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    agent_id: endpoints.AGENT_ID,
                    situation: `Action: ${actionDesc}`,
                    action_taken: actionDesc,
                    outcome: String(outcome).substring(0, 500),
                    score: success ? 4 : 1
                }),
                signal: AbortSignal.timeout(8000)
            });
        } catch (e) { /* non-blocking */ }
    }

    stop() {
        if (this._timeWatcherTimer) { clearInterval(this._timeWatcherTimer); this._timeWatcherTimer = null; }
        if (this._archiveTimer) { clearInterval(this._archiveTimer); this._archiveTimer = null; }
        if (this._statusReportTimer) { clearInterval(this._statusReportTimer); this._statusReportTimer = null; }
        if (this._statusInitTimer) { clearTimeout(this._statusInitTimer); this._statusInitTimer = null; }
        if (this._awakeningTimer) { clearTimeout(this._awakeningTimer); this._awakeningTimer = null; }
        if (this._moltbookLearner && typeof this._moltbookLearner.stop === 'function') {
            this._moltbookLearner.stop();
        }
        console.log(`[AutonomyManager:${this.golemId}] All timers stopped.`);
    }

    _escapeHtml(text) {
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    async checkArchiveStatus() {
        console.log(`🕒 [Autonomy] 定時檢查日誌壓縮狀態 (雙重門檻掃描)...`);
        try {
            const ChatLogManager = require('../managers/ChatLogManager');
            // ✅ [H-1 Fix] 傳入正確 golemId/logDir/isSingleMode，確保掃描正確目錄
            const logManager = new ChatLogManager({
                golemId: this.golemId,
                logDir: ConfigManager.LOG_BASE_DIR,
                isSingleMode: ConfigManager.GOLEM_MODE === 'SINGLE'
            });
            const logDir = logManager.dirs.hourly;

            const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const yesterday = logManager._getYesterdayDateString();

            // ✨ [v9.0.8] 可配置 Archive 閾值 (環境變數 or 預設)
            const thresholdYesterday = parseInt(process.env.ARCHIVE_THRESHOLD_YESTERDAY) || 3;
            const thresholdToday = parseInt(process.env.ARCHIVE_THRESHOLD_TODAY) || 12;
            const checkConfigs = [
                { date: yesterday, threshold: thresholdYesterday, label: "昨日" },
                { date: today, threshold: thresholdToday, label: "本日" }
            ];

            for (const config of checkConfigs) {
                const { date, threshold, label } = config;

                // 掃描指定日期的每小時日誌
                const files = fs.readdirSync(logDir)
                    .filter(f => f.startsWith(date) && f.length === 14 && f.endsWith('.log'));

                if (files.length >= threshold) {
                    console.log(`📦 [Autonomy] 門檻達成：${date} (${label}) 已累積 ${files.length} 個時段日誌，啟動自動歸檔程序...`);

                    await this.sendNotification(`📦 **【自動化日誌維護】**\n偵測到${label} (${date}) 已累積達 ${files.length} 小時對話，目前將進行記憶彙整，請稍等...`);

                    const logArchiveSkill = require('../skills/core/log-archive');
                    const result = await logArchiveSkill.run({
                        brain: this.brain,
                        args: { date: date }
                    });

                    await this.sendNotification(`✅ **【自動化日誌維護】**\n${date} (${label}) 歸檔完成！\n${result}`);
                } else {
                    console.log(`ℹ️ [Autonomy] ${date} (${label}) 目前累積 ${files.length}/${threshold} 份日誌，未達壓縮門檻。`);
                }
            }
        } catch (e) {
            console.error("❌ [Autonomy] 自動密令壓縮失敗:", e.message);
        }
    }
    async timeWatcher() {
        const now = new Date();
        const nowTime = now.getTime();
        let fileTasks = [];
        const updatedSchedules = [];

        // --- ✨ 路徑隔離 (Path Isolation) ---
        const logDir = ConfigManager.GOLEM_MODE === 'SINGLE'
            ? ConfigManager.LOG_BASE_DIR
            : path.join(ConfigManager.LOG_BASE_DIR, this.golemId);

        const scheduleFile = path.join(logDir, 'schedules.json');

        // M-5 Fix: 寫入前先確保目錄存在，防止拍程觸發在首次對話之前導致寫入失敗
        fs.mkdirSync(path.dirname(scheduleFile), { recursive: true });

        // 1. 讀取並檢查檔案資料庫 (New Path: logs/schedules.json)
        if (fs.existsSync(scheduleFile)) {
            try {
                const rawData = fs.readFileSync(scheduleFile, 'utf-8');
                if (rawData.trim()) {
                    const schedules = JSON.parse(rawData);
                    schedules.forEach(item => {
                        const itemTime = new Date(item.time).getTime();
                        if (itemTime <= nowTime) {
                            fileTasks.push(item);
                        } else {
                            updatedSchedules.push(item);
                        }
                    });

                    // 如果有過期或已處理的，寫回檔案進行更新 (物理移除)
                    if (fileTasks.length > 0) {
                        fs.writeFileSync(scheduleFile, JSON.stringify(updatedSchedules, null, 2));
                    }
                }
            } catch (e) {
                console.error("❌ [Autonomy:TimeWatcher] 讀取排程檔案失敗:", e.message);
            }
        }

        // 2. 處理到期任務 (整合檔案任務與 Driver 任務)
        let totalTasks = [...fileTasks];

        // 額外檢查 BrowserMemoryDriver (雙保險)
        if (this.brain.memoryDriver && typeof this.brain.memoryDriver.checkDueTasks === 'function') {
            const driverTasks = await this.brain.memoryDriver.checkDueTasks() || [];
            totalTasks = totalTasks.concat(driverTasks);
        }

        if (totalTasks.length > 0) {
            console.log(`⏰ [TimeWatcher] 發現 ${totalTasks.length} 個到期任務！`);
            for (const task of totalTasks) {
                const adminCtx = await this.getAdminContext();
                const prompt = `【⏰ 系統排程觸發】\n時間：${task.time}\n任務內容：${task.task}\n\n請根據任務內容，主動向使用者發送訊息或執行操作。`;
                if (this.convoManager) {
                    // 🚀 ✨ [v9.0.8] Priority VIP Bypass: Do not debounce, insert directly at front of queue.
                    await this.convoManager.enqueue(adminCtx, prompt, { isPriority: true, bypassDebounce: true });
                }
            }
        }
    }
    scheduleNextAwakening() {
        const minHours = ConfigManager.CONFIG.AWAKE_INTERVAL_MIN || 2;
        const maxHours = ConfigManager.CONFIG.AWAKE_INTERVAL_MAX || 5;
        const randomHours = minHours + Math.random() * (maxHours - minHours);
        const waitMs = randomHours * 3600000;
        const nextWakeTime = new Date(Date.now() + waitMs);
        const hour = nextWakeTime.getHours();
        let finalWait = waitMs;
        const sleepStart = ConfigManager.CONFIG.SLEEP_START !== undefined ? ConfigManager.CONFIG.SLEEP_START : 1;
        const sleepEnd = ConfigManager.CONFIG.SLEEP_END !== undefined ? ConfigManager.CONFIG.SLEEP_END : 7;

        // 處理跨夜情況 (例如 23:00 ~ 07:00)
        let isSleeping = false;
        if (sleepStart > sleepEnd) {
            isSleeping = hour >= sleepStart || hour < sleepEnd;
        } else {
            isSleeping = hour >= sleepStart && hour < sleepEnd;
        }

        if (isSleeping) {
            // Run sleep consolidation when entering sleep period
            this._runSleepConsolidation().catch(e => console.warn('[AutonomyManager] Sleep consolidation error:', e.message));
            console.log(`💤 Golem 休息中... (休眠時段: ${sleepStart}:00 ~ ${sleepEnd}:00)`);
            const morning = new Date(nextWakeTime);
            // 設定為稍微延後一點的時間 (例如 07:00 後加 1 小時也就是 08:00)
            morning.setHours(sleepEnd + 1, 0, 0, 0);
            if (morning < nextWakeTime) morning.setDate(morning.getDate() + 1);
            finalWait = morning.getTime() - Date.now();
        }
        console.log(`♻️ [LifeCycle] 下次醒來: ${(finalWait / 60000).toFixed(1)} 分鐘後`);
        this._awakeningTimer = setTimeout(() => { this.manifestFreeWill(); this.scheduleNextAwakening(); }, finalWait);
    }
    async manifestFreeWill() {
        try {
            // Use OODA loop for informed decision-making
            if (!this.oodaLoop) {
                this.oodaLoop = new OODALoop(this.brain, { golemId: this.golemId });
            }
            const loopResult = await this.oodaLoop.runLoop(this.memory, null, null);
            const decision = loopResult?.decision;

            if (decision && decision.action !== 'noop') {
                console.log(`[AutonomyManager] OODA decided: ${decision.action} (${decision.reason})`);
                if (decision.action === 'gc_hint' && global.gc) global.gc();
                // For other actions, fall through to random behavior
            }

            // Default behavioral selection
            const roll = Math.random();
            if (roll < 0.2) await this.performSelfReflection();
            else if (roll < 0.6) await this.performNewsChat();
            else await this.performSpontaneousChat();
        } catch (e) {
            console.error("自由意志執行失敗:", e.message);
            // Fallback to original random behavior
            const roll = Math.random();
            if (roll < 0.2) await this.performSelfReflection();
            else if (roll < 0.6) await this.performNewsChat();
            else await this.performSpontaneousChat();
        }
    }
    async getAdminContext() {
        const fakeCtx = {
            chatId: 'system_autonomy', // ✨ [v9.0.6] 修正：賦予明確 ID 避免 Queue 阻塞
            isAdmin: true,
            platform: 'autonomy',
            reply: async (msg, opts) => await this.sendNotification(msg, opts),
            sendTyping: async () => { }
        };
        return fakeCtx;
    }
    async run(taskName, type) {
        console.log(`🤖 自主行動: ${taskName}`);
        const prompt = `[系統指令: ${type}]\n任務：${taskName}\n請執行並使用標準格式回報。`;
        const raw = await this.brain.sendMessage(prompt);
        await NeuroShunter.dispatch(await this.getAdminContext(), raw, this.brain, this.controller);
    }
    async performNewsChat() { await this.run("上網搜尋「科技圈熱門話題」或「全球趣聞」，挑選一件分享給主人。要有個人觀點，像朋友一樣聊天。", "NewsChat"); }
    async performSpontaneousChat() { await this.run("主動社交，傳訊息給主人。語氣自然，符合當下時間。", "SpontaneousChat"); }
    async performSelfReflection(triggerCtx = null) {
        console.log(`🧠 [Autonomy][${this.golemId}] 啟動自我反思程序...`);

        // 1. 讀取最近的對話摘要 (Tier 1)
        const ChatLogManager = require('../managers/ChatLogManager');
        const logManager = new ChatLogManager({
            golemId: this.golemId,
            logDir: ConfigManager.LOG_BASE_DIR,
            isSingleMode: ConfigManager.GOLEM_MODE === 'SINGLE'
        });

        const recentSummaries = logManager.readTier('daily', 3);
        const summaryContext = recentSummaries.map(s => `[${s.date}] ${s.content}`).join('\n\n');

        // 2. 建構反思 Prompt
        const prompt = `【系統指令：自我反思】
請回顧你最近 3 天的對話摘要，評估你的表現、使用者的滿意度，以及是否有任何需要優化的邏輯或需要記錄的學習。

對話摘要：
${summaryContext || "（目前尚無對話摘要）"}

請根據 <Skill: REFLECTION> 的格式要求產出反思報告。
如果你發現了具體的代碼 Bug 並有信心修復，請額外產生 [PATCH] 或建議透過 evolution 技能進行修復。`;

        const adminCtx = await this.getAdminContext();
        if (triggerCtx) {
            // 如果是手動觸發，則透過 convoManager 進行
            if (this.convoManager) {
                await this.convoManager.enqueue(triggerCtx, prompt, { isPriority: true });
            }
        } else {
            // 如果是自動觸發
            const raw = await this.brain.sendMessage(prompt);
            await NeuroShunter.dispatch(adminCtx, raw, this.brain, this.controller);
        }
    }
    async _runSleepConsolidation() {
        try {
            if (!this._threeLayerMemory) return;

            const working = this._threeLayerMemory.getWorkingContext(50);
            if (working.length < 3) return;

            // Summarize working memory into episodic
            const summary = working.map(w => String(w.content || '').substring(0, 100)).join(' | ');
            this._threeLayerMemory.recordEpisode(
                `Sleep consolidation: ${working.length} items`,
                ['sleep_consolidation'],
                summary.substring(0, 500),
                0.5
            );

            // Clear old working memory (keep last 5)
            const toKeep = 5;
            if (working.length > toKeep) {
                this._threeLayerMemory.clearWorking();
                working.slice(-toKeep).forEach(w => this._threeLayerMemory.addToWorking(w));
            }

            // Auto-deprecate stale episodes
            if (typeof this._threeLayerMemory.deprecateStaleEpisodes === 'function') {
                this._threeLayerMemory.deprecateStaleEpisodes(90);
            }

            console.log(`[AutonomyManager] Sleep consolidation complete: ${working.length} working → episodic`);
        } catch (e) {
            console.warn('[AutonomyManager] Sleep consolidation failed:', e.message);
        }
    }

    async sendNotification(msgText, opts = {}) {
        if (!msgText) return;

        // --- Telegram Routing ---
        let tgTargetId = ConfigManager.CONFIG.ADMIN_IDS[0];
        let tgAuthMode = ConfigManager.CONFIG.TG_AUTH_MODE;
        if (this.tgBot && this.tgBot.golemConfig) {
            const gCfg = this.tgBot.golemConfig;
            tgAuthMode = gCfg.tgAuthMode || tgAuthMode;
            if (tgAuthMode === 'CHAT' && gCfg.chatId) {
                tgTargetId = gCfg.chatId;
            } else if (gCfg.adminId) {
                tgTargetId = Array.isArray(gCfg.adminId) ? gCfg.adminId[0] : String(gCfg.adminId).split(',')[0].trim();
            }
        } else if (tgAuthMode === 'CHAT' && ConfigManager.CONFIG.TG_CHAT_ID) {
            tgTargetId = ConfigManager.CONFIG.TG_CHAT_ID;
        }

        // --- Discord Routing ---
        let dcTargetId = ConfigManager.CONFIG.DISCORD_ADMIN_ID;
        let dcAuthMode = 'ADMIN';
        if (this.dcClient && this.dcClient.golemConfig) {
            const gCfg = this.dcClient.golemConfig;
            dcAuthMode = gCfg.dcAuthMode || dcAuthMode;
            if (dcAuthMode === 'CHAT' && gCfg.dcChatId) {
                dcTargetId = gCfg.dcChatId;
            } else if (gCfg.dcAdminId) {
                dcTargetId = Array.isArray(gCfg.dcAdminId) ? gCfg.dcAdminId[0] : String(gCfg.dcAdminId).split(',')[0].trim();
            }
        }

        // --- Dispatch ---
        let sent = false;
        if (this.tgBot && tgTargetId) {
            await this.tgBot.sendMessage(tgTargetId, msgText, opts).then(() => sent = true).catch(e => console.error("❌ [Autonomy] TG 通知發送失敗:", e.message));
        }

        if (!sent && this.dcClient && dcTargetId) {
            try {
                if (dcAuthMode === 'CHAT') {
                    const channel = await this.dcClient.channels.fetch(dcTargetId);
                    if (channel) await channel.send(msgText);
                } else {
                    const user = await this.dcClient.users.fetch(dcTargetId);
                    if (user) await user.send(msgText);
                }
            } catch (e) {
                console.error("❌ [Autonomy] DC 通知發送失敗:", e.message);
            }
        }
    }
}

module.exports = AutonomyManager;
