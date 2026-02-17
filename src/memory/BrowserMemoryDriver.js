const path = require('path');

// ============================================================
// 🧠 Memory Drivers (雙模記憶驅動 + 排程擴充)
// ============================================================
class BrowserMemoryDriver {
    constructor(brain) { this.brain = brain; }
    async init() {
        if (this.brain.memoryPage) return;
        try {
            this.brain.memoryPage = await this.brain.browser.newPage();
            const memoryPath = 'file:///' + path.join(process.cwd(), 'memory.html').replace(/\\/g, '/');
            console.log(`🧠 [Memory:Browser] 正在掛載神經海馬迴: ${memoryPath}`);
            await this.brain.memoryPage.goto(memoryPath);
            await new Promise(r => setTimeout(r, 5000));
        } catch (e) { console.error("❌ [Memory:Browser] 啟動失敗:", e.message); }
    }
    async recall(query) {
        if (!this.brain.memoryPage) return [];
        return await this.brain.memoryPage.evaluate(async (txt) => {
            return window.queryMemory ? await window.queryMemory(txt) : [];
        }, query);
    }
    async memorize(text, metadata) {
        if (!this.brain.memoryPage) return;
        await this.brain.memoryPage.evaluate(async (t, m) => {
            if (window.addMemory) await window.addMemory(t, m);
        }, text, metadata);
    }
    async addSchedule(task, time) {
        if (!this.brain.memoryPage) return;
        await this.brain.memoryPage.evaluate(async (t, time) => {
            if (window.addSchedule) await window.addSchedule(t, time);
        }, task, time);
    }
    async checkDueTasks() {
        if (!this.brain.memoryPage) return [];
        return await this.brain.memoryPage.evaluate(async () => {
            return window.checkSchedule ? await window.checkSchedule() : [];
        });
    }
}

module.exports = BrowserMemoryDriver;
