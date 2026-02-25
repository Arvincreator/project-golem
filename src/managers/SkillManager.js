// File: lib/skill-manager.js
/**
     * 這是「技能圖書館員」。它負責加載技能，並提供 exportSkill (打包) 與 importSkill (安裝) 功能。
     * 這實現了技能可以社群分享的功能。
     */
const fs = require('fs');
const path = require('path');

class SkillManager {
    constructor() {
        this.baseDir = path.join(process.cwd(), 'src', 'skills');
        this.userDir = path.join(this.baseDir, 'user');
        this.coreDir = path.join(this.baseDir, 'core');

        // 確保目錄結構存在
        [this.baseDir, this.userDir, this.coreDir].forEach(dir => {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        });

        this.skills = new Map();
        this.refresh(); // 初始化時載入
    }

    /**
     * 熱重載所有技能 (清除 require 快取)
     */
    refresh() {
        this.skills.clear();
        console.log("🔄 Skill Manager: Reloading skills...");

        const loadFromDir = (dir, type) => {
            if (!fs.existsSync(dir)) return;
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));

            for (const file of files) {
                try {
                    const fullPath = path.join(dir, file);
                    // 關鍵：清除快取以支援熱更新
                    delete require.cache[require.resolve(fullPath)];

                    const skillModule = require(fullPath);

                    // 驗證模組結構
                    if (skillModule.name && typeof skillModule.run === 'function') {
                        this.skills.set(skillModule.name, {
                            ...skillModule,
                            _filepath: fullPath,
                            _type: type
                        });
                    }
                } catch (err) {
                    console.error(`⚠️ Failed to load skill [${file}]:`, err.message);
                }
            }
        };

        loadFromDir(this.coreDir, 'CORE');
        loadFromDir(this.userDir, 'USER');

        console.log(`📚 Skills Loaded: ${this.skills.size} (Core + User)`);
        return this.skills;
    }

    /**
     * 獲取技能執行函數
     */
    getSkill(name) {
        return this.skills.get(name);
    }

    /**
     * 匯出技能為「技能膠囊」 (Base64 String)
     * 用於社群分享
     */
    exportSkill(name) {
        const skill = this.skills.get(name);
        if (!skill) throw new Error(`Skill "${name}" not found.`);
        if (skill._type === 'CORE') throw new Error("Cannot export Core skills.");

        try {
            const code = fs.readFileSync(skill._filepath, 'utf-8');
            const payload = {
                n: skill.name,    // Name
                v: skill.version || "1.0",
                t: Date.now(),    // Timestamp
                c: code           // Code content
            };

            // 轉為 Base64 字串
            const buffer = Buffer.from(JSON.stringify(payload));
            return `GOLEM_SKILL::${buffer.toString('base64')}`;
        } catch (err) {
            throw new Error(`Export failed: ${err.message}`);
        }
    }

    /**
     * 匯入「技能膠囊」
     */
    importSkill(token) {
        if (!token.startsWith('GOLEM_SKILL::')) {
            throw new Error("Invalid Skill Capsule format.");
        }

        try {
            const base64 = token.split('::')[1];
            const jsonStr = Buffer.from(base64, 'base64').toString('utf-8');
            const payload = JSON.parse(jsonStr);

            // 基本安全檢查
            if (!payload.n || !payload.c) throw new Error("Corrupted skill data.");

            // 安全過濾器 (簡易版)
            const dangerousKeywords = ['require("child_process")', "require('child_process')", 'exec(', 'spawn('];
            if (dangerousKeywords.some(k => payload.c.includes(k))) {
                throw new Error("⚠️ Security Alert: This skill contains restricted system calls.");
            }

            // 寫入檔案
            const filename = `imported-${payload.n.toLowerCase().replace(/\s+/g, '-')}.js`;
            const filePath = path.join(this.userDir, filename);

            // 備份舊檔 (如果存在)
            if (fs.existsSync(filePath)) {
                fs.renameSync(filePath, filePath + '.bak');
            }

            fs.writeFileSync(filePath, payload.c);

            // 立即重新載入
            this.refresh();

            return { success: true, name: payload.n, path: filePath };

        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    listSkills() {
        return Array.from(this.skills.values()).map(s => ({
            name: s.name,
            description: s.description,
            type: s._type
        }));
    }
}

module.exports = new SkillManager();
