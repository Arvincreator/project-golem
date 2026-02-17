const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execSync } = require('child_process');
const { CONFIG } = require('../config');

class SystemQmdDriver {
    constructor() {
        this.baseDir = path.join(process.cwd(), 'golem_memory', 'knowledge');
        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
        this.qmdCmd = 'qmd';
    }
    async init() {
        console.log("🔍 [Memory:Qmd] 啟動引擎探測...");
        try {
            const checkCmd = (c) => {
                try {
                    const findCmd = os.platform() === 'win32' ? `where ${c}` : `command -v ${c}`;
                    execSync(findCmd, { stdio: 'ignore', env: process.env });
                    return true;
                } catch (e) { return false; }
            };
            if (CONFIG.QMD_PATH !== 'qmd' && fs.existsSync(CONFIG.QMD_PATH)) this.qmdCmd = `"${CONFIG.QMD_PATH}"`;
            else if (checkCmd('qmd')) this.qmdCmd = 'qmd';
            else {
                const homeQmd = path.join(os.homedir(), '.bun', 'bin', 'qmd');
                if (fs.existsSync(homeQmd)) this.qmdCmd = `"${homeQmd}"`;
                else if (os.platform() !== 'win32') {
                    try {
                        const bashFound = execSync('bash -lc "which qmd"', { encoding: 'utf8', env: process.env }).trim();
                        if (bashFound) this.qmdCmd = `"${bashFound}"`;
                        else throw new Error();
                    } catch (e) { throw new Error("QMD_NOT_FOUND"); }
                } else throw new Error("QMD_NOT_FOUND");
            }
            console.log(`🧠 [Memory:Qmd] 引擎連線成功: ${this.qmdCmd}`);
            try {
                execSync(`${this.qmdCmd} collection add "${path.join(this.baseDir, '*.md')}" --name golem-core`, { stdio: 'ignore', env: process.env, shell: true });
            } catch (e) { }
        } catch (e) {
            console.error(`❌ [Memory:Qmd] 找不到 qmd。`);
            throw new Error("QMD_MISSING");
        }
    }
    async recall(query) {
        return new Promise((resolve) => {
            const safeQuery = query.replace(/"/g, '\\"');
            const cmd = `${this.qmdCmd} search golem-core "${safeQuery}" --hybrid --limit 3`;
            exec(cmd, (err, stdout) => {
                if (err) { resolve([]); return; }
                const result = stdout.trim();
                if (result) resolve([{ text: result, score: 0.95, metadata: { source: 'qmd' } }]);
                else resolve([]);
            });
        });
    }
    async memorize(text, metadata) {
        const filename = `mem_${Date.now()}.md`;
        const filepath = path.join(this.baseDir, filename);
        fs.writeFileSync(filepath, `---\ndate: ${new Date().toISOString()}\ntype: ${metadata.type || 'general'}\n---\n${text}`, 'utf8');
        exec(`${this.qmdCmd} embed golem-core "${filepath}"`, (err) => { if (err) console.error("⚠️ [Memory:Qmd] 索引失敗"); });
    }
    async addSchedule(task, time) { console.warn("⚠️ QMD 模式不支援排程"); }
    async checkDueTasks() { return []; }
}

module.exports = SystemQmdDriver;
