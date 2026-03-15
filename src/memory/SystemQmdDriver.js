const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync, execSync } = require('child_process');
const { CONFIG, KNOWLEDGE_BASE_DIR } = require('../config');

class SystemQmdDriver {
    constructor() {
        this.baseDir = KNOWLEDGE_BASE_DIR;
        this.qmdPath = null; // 完整路徑，不再用 shell
    }

    async init() {
        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
        console.log("[Memory:Qmd] 啟動引擎探測...");
        try {
            // 安全: 用 execFileSync (不走 shell) 偵測 qmd
            const checkCmd = (c) => {
                try {
                    const findCmd = os.platform() === 'win32' ? 'where' : 'which';
                    const result = execFileSync(findCmd, [c], { encoding: 'utf8', timeout: 5000 });
                    return result.trim().split('\n')[0].trim();
                } catch (e) { return null; }
            };

            if (CONFIG.QMD_PATH !== 'qmd' && fs.existsSync(CONFIG.QMD_PATH)) {
                this.qmdPath = path.resolve(CONFIG.QMD_PATH);
            } else {
                const found = checkCmd('qmd');
                if (found) {
                    this.qmdPath = found;
                } else {
                    const homeQmd = path.join(os.homedir(), '.bun', 'bin', 'qmd');
                    if (fs.existsSync(homeQmd)) {
                        this.qmdPath = homeQmd;
                    } else {
                        throw new Error("QMD_NOT_FOUND");
                    }
                }
            }

            console.log(`[Memory:Qmd] 引擎連線成功: ${this.qmdPath}`);

            // 安全: 使用 execFileSync (不走 shell)，避免 glob injection
            try {
                const mdFiles = fs.readdirSync(this.baseDir).filter(f => f.endsWith('.md'));
                for (const mdFile of mdFiles) {
                    const fullPath = path.join(this.baseDir, mdFile);
                    execFileSync(this.qmdPath, ['collection', 'add', fullPath, '--name', 'golem-core'], {
                        stdio: 'ignore', timeout: 10000
                    });
                }
            } catch (e) {
                console.warn("[Memory:Qmd] Collection 初始化部分失敗:", e.message);
            }
        } catch (e) {
            console.error("[Memory:Qmd] 找不到 qmd。");
            throw new Error("QMD_MISSING");
        }
    }

    async recall(query) {
        return new Promise((resolve) => {
            if (!this.qmdPath) { resolve([]); return; }
            // 安全: 使用 execFile (不走 shell)，query 作為參數而非字串拼接
            const safeQuery = String(query).slice(0, 500); // 限制長度
            execFile(this.qmdPath, ['search', 'golem-core', safeQuery, '--hybrid', '--limit', '3'], {
                timeout: 15000
            }, (err, stdout) => {
                if (err) { resolve([]); return; }
                const result = (stdout || '').trim();
                if (result) resolve([{ text: result, score: 0.95, metadata: { source: 'qmd' } }]);
                else resolve([]);
            });
        });
    }

    async memorize(text, metadata) {
        const safeText = String(text).slice(0, 50000); // 限制大小
        const filename = `mem_${Date.now()}.md`;
        const filepath = path.join(this.baseDir, filename);
        const content = `---\ndate: ${new Date().toISOString()}\ntype: ${(metadata.type || 'general').replace(/[^a-zA-Z0-9_-]/g, '')}\n---\n${safeText}`;
        fs.writeFileSync(filepath, content, 'utf8');

        // 安全: execFile 不走 shell
        if (this.qmdPath) {
            execFile(this.qmdPath, ['embed', 'golem-core', filepath], { timeout: 10000 }, (err) => {
                if (err) console.error("[Memory:Qmd] 索引失敗:", err.message);
            });
        }
    }

    async addSchedule(task, time) { console.warn("[Memory:Qmd] QMD 模式不支援排程"); }
    async checkDueTasks() { return []; }
}

module.exports = SystemQmdDriver;
