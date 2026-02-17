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
