const ConfigManager = require('../config');
const Introspection = require('../services/Introspection');
const ResponseParser = require('../utils/ResponseParser');
const PatchManager = require('../managers/PatchManager');
const NeuroShunter = require('../core/NeuroShunter');
const path = require('path');
const fs = require('fs');

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
    }

    setIntegrations(tgBot, dcClient, convoManager) {
        this.tgBot = tgBot;
        this.dcClient = dcClient;
        this.convoManager = convoManager;
    }

    start() {
        const hasTelegram = !!ConfigManager.CONFIG.TG_TOKEN;
        const hasDiscord = !!ConfigManager.CONFIG.DC_TOKEN;
        if (!hasTelegram && !hasDiscord) {
            console.warn(`⚠️ [Autonomy][${this.golemId}] No TG_TOKEN or DC_TOKEN configured — autonomy services not started.`);
            return;
        }
        console.log(`🚀 [Autonomy][${this.golemId}] Starting autonomy services...`);
        this.resumeOrScheduleAwakening();
        setInterval(() => this.timeWatcher(), 60000);
        // ✨ [v9.1.5] 定時自動檢查一次日誌狀態 (改為動態排程，支援熱重載)
        this.archiveTimer = null;
        this.scheduleNextArchive();
    }

    /**
     * 動態排程下一次日誌檢查，確保 ConfigManager.CONFIG 的變更能即時生效
     */
    scheduleNextArchive() {
        if (this.archiveTimer) clearTimeout(this.archiveTimer);
        const intervalMin = ConfigManager.CONFIG.ARCHIVE_CHECK_INTERVAL || 30;
        console.log(`📡 [Autonomy] 已排定下一次日誌檢查：${intervalMin} 分鐘後...`);
        this.archiveTimer = setTimeout(async () => {
            await this.checkArchiveStatus();
            this.scheduleNextArchive(); // 遞迴排定下一次
        }, intervalMin * 60000);
    }

    async checkArchiveStatus() {
        console.log(`🕒 [Autonomy] 定時檢查日誌壓縮狀態 (雙重門檻掃描: ${ConfigManager.CONFIG.ARCHIVE_CHECK_INTERVAL}min)...`);
        try {
            const logManager = this.brain.chatLogManager;
            if (!logManager) return;
            const logDir = logManager.dirs.hourly;

            const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const yesterday = logManager._getYesterdayDateString();

            // 門檻設定：從 Config 讀取
            const thresholdYesterday = ConfigManager.CONFIG.ARCHIVE_THRESHOLD_YESTERDAY;
            const thresholdToday = ConfigManager.CONFIG.ARCHIVE_THRESHOLD_TODAY;

            console.log(`📊 [Autonomy] 目前門檻設定 -> 昨日: ${thresholdYesterday}, 本日: ${thresholdToday}`);

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

                    if (ConfigManager.CONFIG.ENABLE_LOG_NOTIFICATIONS) {
                        await this.sendNotification(`📦 **【自動化日誌維護】**\n偵測到${label} (${date}) 已累積達 ${files.length} 小時對話，目前將進行記憶彙整，請稍等...`);
                    }

                    const logArchiveSkill = require('../skills/core/log-archive');
                    const result = await logArchiveSkill.run({
                        brain: this.brain,
                        args: { date: date }
                    });

                    if (ConfigManager.CONFIG.ENABLE_LOG_NOTIFICATIONS) {
                        await this.sendNotification(`✅ **【自動化日誌維護】**\n${date} (${label}) 歸檔完成！\n${result}`);
                    }
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
        const logDir = ConfigManager.LOG_BASE_DIR;

        const scheduleFile = path.join(logDir, 'schedules.json');

        // M-5 Fix: 異步寫入前確保目錄存在
        await fs.promises.mkdir(path.dirname(scheduleFile), { recursive: true }).catch(() => {});

        // 1. 讀取並檢查檔案資料庫 (New Path: logs/schedules.json)
        const stat = await fs.promises.stat(scheduleFile).catch(() => null);
        if (stat) {
            try {
                const rawData = await fs.promises.readFile(scheduleFile, 'utf-8');
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
                        await fs.promises.writeFile(scheduleFile, JSON.stringify(updatedSchedules, null, 2));
                    }
                }
            } catch (e) {
                console.error("❌ [Autonomy:TimeWatcher] 讀取/寫入排程檔案失敗:", e.message);
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
                    // 🚀 ✨ [v9.1.5] Priority VIP Bypass: Do not debounce, insert directly at front of queue.
                    await this.convoManager.enqueue(adminCtx, prompt, { isPriority: true, bypassDebounce: true });
                }
            }
        }
    }

    resumeOrScheduleAwakening() {
        const logDir = ConfigManager.LOG_BASE_DIR;
        const stateFile = path.join(logDir, 'awake_state.json');

        if (fs.existsSync(stateFile)) {
            try {
                const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
                if (state.nextWakeTime) {
                    const nextWake = new Date(state.nextWakeTime);
                    const now = new Date();
                    const waitMs = nextWake.getTime() - now.getTime();

                    if (waitMs > 0) {
                        console.log(`📡 [Autonomy] 偵測到現有排程，將在 ${(waitMs / 60000).toFixed(1)} 分鐘後醒來 (Resume from state)`);
                        this.setupAwakeTimer(waitMs);
                        return;
                    } else {
                        console.log(`📡 [Autonomy] 偵測到已逾期的排程，立即啟動行動...`);
                        this.manifestFreeWill();
                    }
                }
            } catch (e) {
                console.error("❌ [Autonomy] 讀取 awake_state.json 失敗:", e.message);
            }
        }
        this.scheduleNextAwakening();
    }

    scheduleNextAwakening() {
        const minMinutes = ConfigManager.CONFIG.AWAKE_INTERVAL_MIN || 10;
        const maxMinutes = ConfigManager.CONFIG.AWAKE_INTERVAL_MAX || 60;
        const randomMinutes = minMinutes + Math.random() * (maxMinutes - minMinutes);
        const waitMs = randomMinutes * 60000;
        
        this.setupAwakeTimer(waitMs);
    }

    setupAwakeTimer(waitMs) {
        const nextWakeTime = new Date(Date.now() + waitMs);
        const hour = nextWakeTime.getHours();
        let finalWait = waitMs;
        const sleepStart = ConfigManager.CONFIG.SLEEP_START !== undefined ? this.parseHour(ConfigManager.CONFIG.SLEEP_START) : 1;
        const sleepEnd = ConfigManager.CONFIG.SLEEP_END !== undefined ? this.parseHour(ConfigManager.CONFIG.SLEEP_END) : 7;

        // 處理跨夜情況 (例如 23:00 ~ 07:00)
        let isSleeping = false;
        if (sleepStart > sleepEnd) {
            isSleeping = (hour >= sleepStart || hour < sleepEnd);
        } else {
            isSleeping = (hour >= sleepStart && hour < sleepEnd);
        }

        if (isSleeping) {
            console.log(`💤 Golem 休息中... (休眠時段: ${sleepStart}:00 ~ ${sleepEnd}:00)`);
            const morning = new Date(nextWakeTime);
            // 設定為稍微延後一點的時間 (例如 07:00 後加 1 小時也就是 08:00)
            morning.setHours(sleepEnd + 1, 0, 0, 0);
            if (morning < nextWakeTime) morning.setDate(morning.getDate() + 1);
            finalWait = morning.getTime() - Date.now();
        }

        const actualWakeTime = new Date(Date.now() + finalWait);
        console.log(`♻️ [LifeCycle] 下次醒來時間: ${actualWakeTime.toLocaleString('zh-TW')} (${(finalWait / 60000).toFixed(1)} 分鐘後)`);
        
        // 儲存狀態以利重啟恢復
        try {
            const logDir = ConfigManager.LOG_BASE_DIR;
            const stateFile = path.join(logDir, 'awake_state.json');
            fs.mkdirSync(path.dirname(stateFile), { recursive: true });
            fs.writeFileSync(stateFile, JSON.stringify({ nextWakeTime: actualWakeTime.toISOString() }, null, 2));
        } catch (e) {
            console.error("❌ [Autonomy] 儲存 awake_state.json 失敗:", e.message);
        }

        if (this.awakeTimer) clearTimeout(this.awakeTimer);
        this.awakeTimer = setTimeout(() => { 
            this.manifestFreeWill(); 
            this.scheduleNextAwakening(); 
        }, finalWait);
    }

    // 輔助函數：解析 HH:mm 或 純數字
    parseHour(val) {
        if (typeof val === 'string' && val.includes(':')) {
            return parseInt(val.split(':')[0], 10);
        }
        return Number(val);
    }
    async manifestFreeWill() {
        try {
            const roll = Math.random();
            if (roll < 0.2) await this.performSelfReflection();
            else if (roll < 0.6) await this.performNewsChat();
            else await this.performSpontaneousChat();
        } catch (e) { console.error("自由意志執行失敗:", e.message); }
    }
    async getAdminContext() {
        const fakeCtx = {
            chatId: 'system_autonomy', // ✨ [v9.1.5] 修正：賦予明確 ID 避免 Queue 阻塞
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
    async performNewsChat() {
        const interests = (ConfigManager.CONFIG.USER_INTERESTS || '科技圈熱門話題,全球趣聞').split(',').map(i => i.trim()).filter(i => i);
        const selectedInterest = interests[Math.floor(Math.random() * interests.length)];
        await this.run(`上網搜尋「${selectedInterest}」，挑選一件分享給主人。要有個人觀點，像朋友一樣聊天。`, "NewsChat");
    }
    async performSpontaneousChat() {
        const interests = (ConfigManager.CONFIG.USER_INTERESTS || '科技圈熱門話題,全球趣聞').split(',').map(i => i.trim()).filter(i => i);
        const selectedInterest = interests[Math.floor(Math.random() * interests.length)];
        await this.run(`主動社交，傳訊息給主人。語氣自然，符合當下時間。可以聊聊關於「${selectedInterest}」的話題。`, "SpontaneousChat");
    }
    async performSelfReflection(triggerCtx = null) {
        console.log(`🧠 [Autonomy][${this.golemId}] 啟動自我反思程序...`);

        // 1. 讀取最近的對話摘要 (Tier 1)
        const logManager = this.brain.chatLogManager;
        const recentSummaries = logManager ? await logManager.readTierAsync('daily', 3) : [];
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

        // ✅ [Fix] 同步廣播到 Web Dashboard
        try {
            const dashboard = require('../../dashboard');
            if (dashboard && dashboard.webServer) {
                const notifyText = msgText; // Use msgText as notifyText
                let payloadType = 'general';
                let actionData = null;

                if (opts.reply_markup && opts.reply_markup.inline_keyboard) {
                    payloadType = 'approval';
                    actionData = opts.reply_markup.inline_keyboard[0];
                }

                dashboard.webServer.broadcastLog({
                    time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
                    msg: `[${this.golemId}] ${notifyText}`,
                    type: payloadType,
                    raw: notifyText,
                    actionData,
                    golemId: this.golemId
                });
            }
        } catch (e) {
            // 忽略 Dashboard 未載入的錯誤
        }

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
