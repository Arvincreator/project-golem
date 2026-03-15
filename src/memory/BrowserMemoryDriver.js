const path = require('path');
const fs = require('fs');

class BrowserMemoryDriver {
    constructor(brain) {
        this.brain = brain;
        this.isReady = false;
    }
    async init() {
        if (this.brain.memoryPage) return;
        try {
            this.brain.memoryPage = await this.brain.browser.newPage();

            const baseDir = process.env.HOST_PROJECT_DIR || process.cwd();
            const sourceHtmlPath = path.join(baseDir, 'memory.html');
            const targetDir = this.brain.chatLogManager
                ? this.brain.chatLogManager.logDir
                : path.join(baseDir, 'logs', this.brain.golemId);
            const targetHtmlPath = path.join(targetDir, 'memory.html');

            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            if (fs.existsSync(sourceHtmlPath)) {
                let htmlContent = fs.readFileSync(sourceHtmlPath, 'utf8');
                htmlContent = htmlContent.replace(
                    /<title>(.*?)<\/title>/,
                    `<title>$1 (${this.brain.golemId})</title>`
                );
                htmlContent = htmlContent.replace(
                    /<h1>([\s\S]*?)<\/h1>/,
                    `<h1>$1 <span style="font-size:0.5em; color:var(--accent-pink); border:2px solid black; padding:0 10px; margin-left:10px;">ID: ${this.brain.golemId}</span></h1>`
                );
                fs.writeFileSync(targetHtmlPath, htmlContent);
            }

            // Fix: use 'file://' not 'file:///' — Linux absolute paths already start with /
            const memoryPath = 'file://' + targetHtmlPath.replace(/\\/g, '/');
            console.log(`[Memory:Browser] Mounting: ${memoryPath} (Golem: ${this.brain.golemId})`);

            this.brain.memoryPage.on('console', msg => {
                console.log(`[Memory:Browser] ${msg.text()}`);
            });

            await this.brain.memoryPage.goto(memoryPath);
            await new Promise(r => setTimeout(r, 5000));
            this.isReady = true;
        } catch (e) {
            console.error("[Memory:Browser] Init failed:", e.message);
            this.isReady = false;
        }
    }
    async recall(query) {
        if (!this.brain.memoryPage || !this.isReady) return [];
        try {
            return await this.brain.memoryPage.evaluate(async (txt) => {
                if (!txt || txt.trim() === "") {
                    return window.getAllMemories ? await window.getAllMemories() : [];
                }
                return window.queryMemory ? await window.queryMemory(txt) : [];
            }, query);
        } catch (e) {
            console.warn("[Memory:Browser] recall error:", e.message);
            return [];
        }
    }
    async memorize(text, metadata) {
        if (!this.brain.memoryPage || !this.isReady) return;
        try {
            await this.brain.memoryPage.evaluate(async (t, m) => {
                if (window.addMemory) await window.addMemory(t, m);
            }, text, metadata);
        } catch (e) {
            console.warn("[Memory:Browser] memorize error:", e.message);
        }
    }
    async addSchedule(task, time) {
        if (!this.brain.memoryPage || !this.isReady) return;
        try {
            await this.brain.memoryPage.evaluate(async (t, time) => {
                if (window.addSchedule) await window.addSchedule(t, time);
            }, task, time);
        } catch (e) {
            console.warn("[Memory:Browser] addSchedule error:", e.message);
        }
    }
    async checkDueTasks() {
        if (!this.brain.memoryPage || !this.isReady) return [];
        try {
            return await this.brain.memoryPage.evaluate(async () => {
                return window.checkSchedule ? await window.checkSchedule() : [];
            });
        } catch (e) {
            console.warn("[Memory:Browser] checkDueTasks error:", e.message);
            return [];
        }
    }
    async clearMemory() {
        if (!this.brain.memoryPage || !this.isReady) return;
        try {
            await this.brain.memoryPage.evaluate(async () => {
                if (window.clearAllMemory) await window.clearAllMemory();
            });
            console.log("[Memory:Browser] IndexedDB cleared.");
        } catch (e) {
            console.warn("[Memory:Browser] clearMemory error:", e.message);
        }
    }
    async exportMemory() {
        if (!this.brain.memoryPage || !this.isReady) return "[]";
        try {
            return await this.brain.memoryPage.evaluate(async () => {
                return window.exportMemories ? await window.exportMemories() : "[]";
            });
        } catch (e) {
            console.warn("[Memory:Browser] exportMemory error:", e.message);
            return "[]";
        }
    }
    async importMemory(jsonData) {
        if (!this.brain.memoryPage || !this.isReady) return { success: false, error: "Not ready" };
        try {
            return await this.brain.memoryPage.evaluate(async (data) => {
                return window.importMemories ? await window.importMemories(data) : { success: false, error: "Not supported" };
            }, jsonData);
        } catch (e) {
            console.warn("[Memory:Browser] importMemory error:", e.message);
            return { success: false, error: e.message };
        }
    }
}

module.exports = BrowserMemoryDriver;
