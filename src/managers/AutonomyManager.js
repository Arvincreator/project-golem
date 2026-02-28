const { CONFIG } = require('../config');
const Introspection = require('../services/Introspection');
const ResponseParser = require('../utils/ResponseParser');
const PatchManager = require('../managers/PatchManager');
const NeuroShunter = require('../core/NeuroShunter');
const path = require('path');
const fs = require('fs');

class AutonomyManager {
    constructor(brain, controller, memory) {
        this.brain = brain;
        this.controller = controller;
        this.memory = memory;
        this.tgBot = null;
        this.dcClient = null;
        this.convoManager = null;
    }

    setIntegrations(tgBot, dcClient, convoManager) {
        this.tgBot = tgBot;
        this.dcClient = dcClient;
        this.convoManager = convoManager;
    }

    start() {
        if (!CONFIG.TG_TOKEN && !CONFIG.DC_TOKEN) return;
        this.scheduleNextAwakening();
        setInterval(() => this.timeWatcher(), 60000);
        // ✨ [v9.0.7] 每 30 分鐘自動檢查一次日誌狀態
        setInterval(() => this.checkArchiveStatus(), 30 * 60000);
    }
    async checkArchiveStatus() {
        console.log(`🕒 [Autonomy] 定時檢查日誌壓縮狀態 (雙重門檻掃描)...`);
        try {
            const ChatLogManager = require('../managers/ChatLogManager');
            const logManager = new ChatLogManager();
            const logDir = logManager.logDir;

            const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const yesterday = logManager._getYesterdayDateString();

            // 門檻設定：本日需累積 12 小時 (半天) 以上，昨日只需 3 小時 (確保最終歸檔)
            const checkConfigs = [
                { date: yesterday, threshold: 3, label: "昨日" },
                { date: today, threshold: 12, label: "本日" }
            ];

            for (const config of checkConfigs) {
                const { date, threshold, label } = config;

                // 掃描指定日期的每小時日誌
                const files = fs.readdirSync(logDir)
                    .filter(f => f.startsWith(date) && f.length === 14 && f.endsWith('.log'));

                if (files.length >= threshold) {
                    console.log(`📦 [Autonomy] 偵測到 ${date} (${label}) 有 ${files.length} 個日誌待壓縮，啟動自動化程序...`);

                    await this.sendNotification(`📦 **【自動化日誌維護】**\n偵測到${label} (${date}) 已累積達 ${files.length} 小時對話，目前將進行記憶彙整，請稍等...`);

                    const logArchiveSkill = require('../skills/core/log-archive');
                    const result = await logArchiveSkill.run({
                        brain: this.brain,
                        args: { date: date }
                    });

                    await this.sendNotification(`✅ **【自動化日誌維護】**\n${date} (${label}) 歸檔完成！\n${result}`);
                }
            }
        } catch (e) {
            console.error("❌ [Autonomy] 自動密令壓縮失敗:", e.message);
        }
    }
    async timeWatcher() {
        if (!this.brain.memoryDriver || !this.brain.memoryDriver.checkDueTasks) return;
        try {
            const tasks = await this.brain.memoryDriver.checkDueTasks();
            if (tasks && tasks.length > 0) {
                console.log(`⏰ [TimeWatcher] 發現 ${tasks.length} 個到期任務！`);
                for (const task of tasks) {
                    const adminCtx = await this.getAdminContext();
                    const prompt = `【⏰ 系統排程觸發】\n時間：${task.time}\n任務內容：${task.task}\n\n請根據任務內容，主動向使用者發送訊息或執行操作。`;
                    if (this.convoManager) {
                        await this.convoManager.enqueue(adminCtx, prompt);
                    }
                }
            }
        } catch (e) { console.error("TimeWatcher Error:", e); }
    }
    scheduleNextAwakening() {
        const waitMs = (2 + Math.random() * 3) * 3600000;
        const nextWakeTime = new Date(Date.now() + waitMs);
        const hour = nextWakeTime.getHours();
        let finalWait = waitMs;
        if (hour >= 1 && hour <= 7) {
            console.log("💤 Golem 休息中...");
            const morning = new Date(nextWakeTime);
            morning.setHours(8, 0, 0, 0);
            if (morning < nextWakeTime) morning.setDate(morning.getDate() + 1);
            finalWait = morning.getTime() - Date.now();
        }
        console.log(`♻️ [LifeCycle] 下次醒來: ${(finalWait / 60000).toFixed(1)} 分鐘後`);
        setTimeout(() => { this.manifestFreeWill(); this.scheduleNextAwakening(); }, finalWait);
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
            chatId: 'system_autonomy', // ✨ [v9.0.6] 修正：賦予明確 ID 避免 Queue 阻塞
            isAdmin: true,
            platform: 'autonomy',
            reply: async (msg, opts) => await this.sendNotification(msg),
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
        const currentCode = Introspection.readSelf();
        const advice = this.memory.getAdvice();
        const prompt = `【任務】自主進化提案\n代碼：\n${currentCode.slice(0, 20000)}\n記憶：${advice}\n要求：輸出 JSON Array。`;
        const raw = await this.brain.sendMessage(prompt);
        const patches = ResponseParser.extractJson(raw);
        if (patches.length > 0) {
            const patch = patches[0];
            const targetName = patch.file === 'skills.js' ? 'skills.js' : 'index.js';
            const targetPath = targetName === 'skills.js' ? path.join(process.cwd(), 'skills.js') : path.join(process.cwd(), 'index.js');
            const testFile = PatchManager.createTestClone(targetPath, patches);
            global.pendingPatch = { path: testFile, target: targetPath, name: targetName, description: patch.description };
            const msgText = `💡 **自主進化提案**\n目標：${targetName}\n內容：${patch.description}`;
            const options = { reply_markup: { inline_keyboard: [[{ text: '🚀 部署', callback_data: 'PATCH_DEPLOY' }, { text: '🗑️ 丟棄', callback_data: 'PATCH_DROP' }]] } };
            if (triggerCtx) { await triggerCtx.reply(msgText, options); await triggerCtx.sendDocument(testFile); }
            else if (this.tgBot && CONFIG.ADMIN_IDS[0]) { await this.tgBot.sendMessage(CONFIG.ADMIN_IDS[0], msgText, options); await this.tgBot.sendDocument(CONFIG.ADMIN_IDS[0], testFile); }
        }
    }
    async sendNotification(msgText) {
        if (!msgText) return;
        if (this.tgBot && CONFIG.ADMIN_IDS[0]) await this.tgBot.sendMessage(CONFIG.ADMIN_IDS[0], msgText);
        else if (this.dcClient && CONFIG.DISCORD_ADMIN_ID) {
            const user = await this.dcClient.users.fetch(CONFIG.DISCORD_ADMIN_ID);
            await user.send(msgText);
        }
    }
}

module.exports = AutonomyManager;
