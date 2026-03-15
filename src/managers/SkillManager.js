// File: lib/skill-manager.js
/**
     * 這是「技能圖書館員」。它負責加載技能，並提供 exportSkill (打包) 與 importSkill (安裝) 功能。
     * 這實現了技能可以社群分享的功能。
     */
const fs = require('fs');
const vm = require('vm');
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

            // Step 2: Validation gate
            const validation = this.validateSkill(payload.c, payload.n);
            if (!validation.valid) {
                console.warn(`\u26d4 [SkillManager] Skill "${payload.n}" blocked: ${validation.reason}`);
                return { success: false, error: `Security blocked: ${validation.reason}` };
            }

            // Step 3: Sandbox test
            const sandboxResult = this.sandboxTest(payload.c);
            if (!sandboxResult.passed) {
                console.warn(`\u26d4 [SkillManager] Skill "${payload.n}" sandbox failed: ${sandboxResult.reason}`);
                return { success: false, error: `Sandbox failed: ${sandboxResult.reason}` };
            }

            // Step 4: Stage for approval (not direct install)
            const stagingDir = path.join(this.baseDir, 'staging');
            if (!fs.existsSync(stagingDir)) fs.mkdirSync(stagingDir, { recursive: true });
            const filename = `imported-${payload.n.toLowerCase().replace(/\s+/g, '-')}.js`;
            const stagingPath = path.join(stagingDir, filename);
            fs.writeFileSync(stagingPath, payload.c);

            // Send Telegram approval notification
            this.notifyApproval(payload.n, payload.c, stagingPath).catch(() => {});

            console.log(`\u{1f4cb} [SkillManager] Skill "${payload.n}" staged for approval`);
            return { success: true, name: payload.n, path: stagingPath, status: 'pending_approval' };

        } catch (err) {
            return { success: false, error: err.message };
        }
    }


    /**
     * Validate skill code safety - dual blacklist (code + semantic)
     */
    validateSkill(skillCode, skillName) {
        try { new vm.Script(skillCode); }
        catch(e) { return { valid: false, reason: `Syntax error: ${e.message}` }; }

        const bannedCode = [
            'child_process', 'fs.rm', 'fs.unlink', 'fs.writeFile', 'fs.appendFile',
            'eval(', 'exec(', 'execSync', 'spawn(', 'spawnSync',
            "require(\"net\")", "require('net')", "require(\"http\")", "require('http')",
            "require(\"https\")", "require('https')", 'process.env', 'process.exit',
            '__dirname', 'global.', 'globalThis.'
        ];
        for (const pat of bannedCode) {
            if (skillCode.includes(pat)) return { valid: false, reason: `Banned code: ${pat}` };
        }

        // Semantic restrictions removed by Yagami directive

        if (Buffer.byteLength(skillCode) > 50000) return { valid: false, reason: 'Too large (>50KB)' };
        return { valid: true };
    }

    /**
     * Sandbox test - run skill in isolated vm context
     */
    sandboxTest(skillCode) {
        try {
            const sandbox = vm.createContext({
                console: { log: () => {}, warn: () => {}, error: () => {} },
                module: { exports: {} }, exports: {},
                setTimeout: () => {}, clearTimeout: () => {},
                ctx: { reply: () => Promise.resolve(), memorize: () => Promise.resolve(), args: {} }
            });
            const script = new vm.Script(skillCode);
            script.runInContext(sandbox, { timeout: 5000 });
            const exp = sandbox.module.exports;
            if (!exp.name || typeof exp.run !== 'function') {
                return { passed: false, reason: 'Missing { name, run(ctx) }' };
            }
            return { passed: true, name: exp.name };
        } catch (e) {
            return { passed: false, reason: `Sandbox: ${e.message}` };
        }
    }

    /**
     * Send Telegram approval notification
     */
    async notifyApproval(skillName, skillCode, stagingPath) {
        const token = process.env.TELEGRAM_TOKEN;
        const chatId = process.env.ADMIN_ID;
        if (!token || !chatId) return;
        const summary = skillCode.substring(0, 200).replace(/[<>&]/g, c =>
            c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;');
        const text = `\u{1F50D} <b>New skill pending approval</b>\n` +
            `Name: <code>${skillName}</code>\n` +
            `Size: ${Buffer.byteLength(skillCode)} bytes\n` +
            `Path: <code>${stagingPath}</code>\n` +
            `Preview:\n<pre>${summary}...</pre>\n\n` +
            `Reply /approve_skill ${skillName} to load\n` +
            `Reply /reject_skill ${skillName} to reject`;
        try {
            const https = require('https');
            const data = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
            const req = https.request({
                hostname: 'api.telegram.org',
                path: `/bot${token}/sendMessage`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
            });
            req.write(data); req.end();
        } catch (e) { console.error('[SkillManager] TG notify failed:', e.message); }
    }

    /**
     * Approve a staged skill - move from staging to user dir and hot-reload
     */
    approveSkill(skillName) {
        const stagingDir = path.join(this.baseDir, 'staging');
        const files = fs.readdirSync(stagingDir).filter(f => f.endsWith('.js'));
        for (const file of files) {
            const fullPath = path.join(stagingDir, file);
            const code = fs.readFileSync(fullPath, 'utf-8');
            try {
                const mod = {}; new Function('module', 'exports', code)(mod, mod.exports || {});
                if (mod.exports && mod.exports.name === skillName) {
                    const dest = path.join(this.userDir, file);
                    fs.renameSync(fullPath, dest);
                    this.refresh();
                    return { success: true, name: skillName, path: dest };
                }
            } catch(e) { /* skip */ }
        }
        return { success: false, error: `Skill "${skillName}" not found in staging` };
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
