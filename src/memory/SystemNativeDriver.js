const fs = require('fs');
const path = require('path');

class SystemNativeDriver {
    constructor() {
        this.baseDir = path.join(process.cwd(), 'golem_memory', 'knowledge');
        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
    }
    async init() { console.log("🧠 [Memory:Native] 系統原生核心已啟動"); }
    async recall(query) {
        try {
            const files = fs.readdirSync(this.baseDir).filter(f => f.endsWith('.md'));
            const results = [];
            for (const file of files) {
                const content = fs.readFileSync(path.join(this.baseDir, file), 'utf8');
                const keywords = query.toLowerCase().split(/\s+/);
                let score = 0;
                keywords.forEach(k => { if (content.toLowerCase().includes(k)) score += 1; });
                if (score > 0) results.push({ text: content.replace(/---[\s\S]*?---/, '').trim(), score: score / keywords.length, metadata: { source: file } });
            }
            return results.sort((a, b) => b.score - a.score).slice(0, 3);
        } catch (e) { return []; }
    }
    async memorize(text, metadata) {
        const filename = `mem_${Date.now()}.md`;
        const filepath = path.join(this.baseDir, filename);
        fs.writeFileSync(filepath, `---\ndate: ${new Date().toISOString()}\ntype: ${metadata.type || 'general'}\n---\n${text}`, 'utf8');
    }
    async addSchedule(task, time) { console.warn("⚠️ Native 模式不支援排程"); }
    async checkDueTasks() { return []; }
}

module.exports = SystemNativeDriver;
