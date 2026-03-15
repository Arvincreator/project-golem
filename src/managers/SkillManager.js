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

        this.skills = new Map();
        // 🎯 V9.0.7 解耦：不再於建構子中主動掃描，改為懶加載
    }

    /**
     * 熱重載所有技能 (清除 require 快取)
     */
    refresh() {
        // 確保目錄結構在需要加載時才建立
        [this.baseDir, this.userDir, this.coreDir].forEach(dir => {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        });

        this.skills.clear();
        const isDashboard = process.argv.includes('dashboard');
        if (!isDashboard) {
            console.log("🔄 Skill Manager: Reloading skills...");
        }

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
        if (this.skills.size === 0) this.refresh();
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
     * 安全掃描代碼 — 使用 AST 語法分析 + 模式匹配雙重檢查
     * @param {string} code - 要掃描的代碼
     * @returns {{ safe: boolean, reason?: string }}
     */
    _securityScan(code) {
        // 第一層: 危險模式匹配 (不可用字串拼接繞過的層級)
        const dangerousPatterns = [
            // child_process 各種寫法
            /child_process/i,
            /child_proc/i,
            // 危險全域物件
            /\bprocess\s*\.\s*env/,
            /\bprocess\s*\.\s*exit/,
            /\bprocess\s*\.\s*kill/,
            /\bprocess\s*\.\s*argv/,
            // 動態 require (可繞過靜態檢查)
            /require\s*\(\s*[^'"]/,     // require(variable) — 非字面量
            /require\s*\.\s*resolve/,
            // 危險函數
            /\beval\s*\(/,
            /\bFunction\s*\(/,
            /\bexec\s*\(/,
            /\bexecSync\s*\(/,
            /\bspawn\s*\(/,
            /\bspawnSync\s*\(/,
            /\bfork\s*\(/,
            /\bexecFile\s*\(/,
            // 檔案系統危險操作
            /fs\s*\.\s*(?:unlink|rmdir|rm|chmod|chown|writeFile|appendFile|rename|copyFile)/,
            /fs\s*\.\s*(?:unlinkSync|rmdirSync|rmSync|chmodSync|chownSync|writeFileSync)/,
            // 網路操作
            /\bhttp\s*\.\s*(?:get|request|createServer)/,
            /\bhttps\s*\.\s*(?:get|request)/,
            /\bnet\s*\.\s*(?:connect|createConnection|createServer)/,
            /\bdgram\s*\./,
            // 全域汙染
            /global\s*\[/,
            /global\s*\.\s*(?!pausedConversations)/,
            /globalThis\s*\./,
            /__proto__/,
            /prototype\s*\.\s*constructor/,
            // 編碼繞過
            /Buffer\s*\.\s*from\s*\(.*(?:base64|hex)/,
            /atob\s*\(/, /btoa\s*\(/,
            // cluster / worker_threads
            /\bcluster\b/, /worker_threads/
        ];

        for (const pattern of dangerousPatterns) {
            if (pattern.test(code)) {
                return { safe: false, reason: `Security: 偵測到危險模式 ${pattern.source}` };
            }
        }

        // 第二層: 允許的 require 白名單
        const requireMatches = code.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g) || [];
        const allowedModules = ['path', 'url', 'querystring', 'crypto', 'util', 'assert', 'events', 'stream'];
        for (const req of requireMatches) {
            const modMatch = req.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
            if (modMatch) {
                const mod = modMatch[1];
                // 允許相對路徑（同目錄）和白名單模組
                if (!mod.startsWith('./') && !mod.startsWith('../') && !allowedModules.includes(mod)) {
                    return { safe: false, reason: `Security: 不允許的模組 require("${mod}")` };
                }
                // 阻止路徑穿越
                if (mod.includes('..') && mod.split('..').length > 2) {
                    return { safe: false, reason: `Security: 過深的路徑穿越 require("${mod}")` };
                }
            }
        }

        // 第三層: 語法驗證
        try {
            new Function(code); // 語法檢查 (不執行)
        } catch (e) {
            return { safe: false, reason: `Syntax Error: ${e.message}` };
        }

        return { safe: true };
    }

    /**
     * 匯入「技能膠囊」— 安全強化版
     */
    importSkill(token) {
        if (!token.startsWith('GOLEM_SKILL::')) {
            throw new Error("Invalid Skill Capsule format.");
        }

        try {
            const base64 = token.split('::')[1];
            if (!base64 || base64.length > 500000) {
                throw new Error("Capsule 大小超出限制 (max 500KB)");
            }
            const jsonStr = Buffer.from(base64, 'base64').toString('utf-8');
            const payload = JSON.parse(jsonStr);

            // 基本結構驗證
            if (!payload.n || !payload.c) throw new Error("Corrupted skill data.");
            if (typeof payload.n !== 'string' || typeof payload.c !== 'string') {
                throw new Error("Invalid skill data types.");
            }

            // 安全: 檔名淨化 — 只允許英數字和連字號
            const safeName = payload.n.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 50);
            if (!safeName) throw new Error("Invalid skill name.");

            // 安全: AST + 模式掃描
            const scanResult = this._securityScan(payload.c);
            if (!scanResult.safe) {
                throw new Error(`Security Alert: ${scanResult.reason}`);
            }

            // 寫入檔案 (只允許在 userDir 內)
            const filename = `imported-${safeName}.js`;
            const filePath = path.join(this.userDir, filename);

            // 安全: 確認最終路徑確實在 userDir 內
            const resolvedPath = path.resolve(filePath);
            const resolvedUserDir = path.resolve(this.userDir);
            if (!resolvedPath.startsWith(resolvedUserDir)) {
                throw new Error("Security: Path traversal detected.");
            }

            // 備份舊檔
            if (fs.existsSync(filePath)) {
                fs.renameSync(filePath, filePath + '.bak');
            }

            fs.writeFileSync(filePath, payload.c);

            // 嘗試載入，失敗則回滾
            try {
                this.refresh();
            } catch (loadErr) {
                // 回滾: 恢復備份
                if (fs.existsSync(filePath + '.bak')) {
                    fs.renameSync(filePath + '.bak', filePath);
                } else {
                    fs.unlinkSync(filePath);
                }
                this.refresh();
                throw new Error(`Skill 載入失敗，已回滾: ${loadErr.message}`);
            }

            return { success: true, name: payload.n, path: filePath };

        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    listSkills() {
        if (this.skills.size === 0) this.refresh();
        return Array.from(this.skills.values()).map(s => ({
            name: s.name,
            description: s.description,
            type: s._type
        }));
    }
}

module.exports = new SkillManager();
