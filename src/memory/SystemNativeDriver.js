const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { KNOWLEDGE_BASE_DIR } = require('../config');

/**
 * SystemNativeDriver — Filesystem-based memory persistence
 * v10.0: Async I/O throughout, proper error handling
 */
class SystemNativeDriver {
    constructor() {
        this.baseDir = KNOWLEDGE_BASE_DIR;
    }

    async init() {
        try {
            await fsp.mkdir(this.baseDir, { recursive: true });
        } catch (e) {
            // Fallback to sync for init only
            if (!fs.existsSync(this.baseDir)) {
                fs.mkdirSync(this.baseDir, { recursive: true });
            }
        }
        console.log("[Memory:Native] 系統原生核心已啟動");
    }

    async recall(query) {
        try {
            const files = await fsp.readdir(this.baseDir);
            const mdFiles = files.filter(f => f.endsWith('.md'));
            const results = [];

            for (const file of mdFiles) {
                try {
                    const content = await fsp.readFile(path.join(this.baseDir, file), 'utf8');
                    const keywords = query.toLowerCase().split(/\s+/);
                    let score = 0;
                    keywords.forEach(k => { if (content.toLowerCase().includes(k)) score += 1; });
                    if (score > 0) {
                        results.push({
                            text: content.replace(/---[\s\S]*?---/, '').trim(),
                            score: score / keywords.length,
                            metadata: { source: file }
                        });
                    }
                } catch (e) {
                    console.warn(`[Memory:Native] Failed to read ${file}: ${e.message}`);
                }
            }

            return results.sort((a, b) => b.score - a.score).slice(0, 3);
        } catch (e) {
            console.warn(`[Memory:Native] recall failed: ${e.message}`);
            return [];
        }
    }

    async memorize(text, metadata) {
        const filename = `mem_${Date.now()}.md`;
        const filepath = path.join(this.baseDir, filename);
        try {
            const content = `---\ndate: ${new Date().toISOString()}\ntype: ${metadata.type || 'general'}\n---\n${text}`;
            await fsp.writeFile(filepath, content, 'utf8');
        } catch (e) {
            console.warn(`[Memory:Native] memorize failed: ${e.message}`);
        }
    }

    async addSchedule(task, time) { console.warn("[Memory:Native] Native 模式不支援排程"); }
    async checkDueTasks() { return []; }
}

module.exports = SystemNativeDriver;
