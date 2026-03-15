// src/skills/core/skill-inject.js
// Self-learning skill injection — allows Rensin to create and load new skills autonomously
const fs = require('fs');
const path = require('path');
const magma = require('../../memory/graph/ma_gma');

const USER_SKILLS_DIR = path.join(process.cwd(), 'src', 'skills', 'user');
// Safety patterns — block dangerous APIs in user-created skills
const DANGEROUS_PATTERNS = [
    /child_process/,
    /\bexec\s*\(/,
    /\bspawn\s*\(/,
    /\beval\s*\(/,
    /new\s+Function\s*\(/,
    /process\.exit/,
    /fs\.rm\b/,
];

async function execute(args) {
    const task = args.task || args.command || 'list';

    if (task === 'create' || task === 'inject') {
        const name = args.name;
        const code = args.code;
        const description = args.description || '';

        if (!name || !code) return 'skill-inject create 需要: name, code, description';

        // Security validation
        for (const pattern of DANGEROUS_PATTERNS) {
            if (pattern.test(code)) {
                return `❌ 安全檢查失敗: 技能包含危險 API (${pattern.source})`;
            }
        }

        // Validate skill structure
        if (!code.includes('module.exports') && !code.includes('exports.')) {
            return '❌ 技能必須有 module.exports (需要導出 name, execute/run, PROMPT)';
        }

        // Ensure user skills directory exists
        if (!fs.existsSync(USER_SKILLS_DIR)) {
            fs.mkdirSync(USER_SKILLS_DIR, { recursive: true });
        }

        const filename = `${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}.js`;
        const filepath = path.join(USER_SKILLS_DIR, filename);

        // Backup if exists
        if (fs.existsSync(filepath)) {
            fs.copyFileSync(filepath, filepath + '.bak');
        }

        fs.writeFileSync(filepath, code, 'utf-8');

        // Validate by trying to require
        try {
            delete require.cache[require.resolve(filepath)];
            const loaded = require(filepath);
            if (!loaded.name) {
                fs.unlinkSync(filepath);
                return '❌ 技能載入後缺少 name 欄位';
            }
        } catch (e) {
            fs.unlinkSync(filepath);
            return `❌ 技能語法錯誤: ${e.message}`;
        }

        // Refresh SkillManager
        try {
            const skillManager = require('../../managers/SkillManager');
            skillManager.refresh();
        } catch (e) { console.warn('[skill-inject] SkillManager refresh failed:', e.message); }

        // Record to MAGMA
        magma.addNode(`skill_${name}`, {
            type: 'skill_injection',
            name,
            description,
            filepath: filename,
            created_at: new Date().toISOString()
        });
        magma.addRelation('rensin', 'created_skill', `skill_${name}`, { layer: 'causal' });

        return `✅ 技能 "${name}" 已注入並載入！路徑: ${filename}`;
    }

    if (task === 'list') {
        if (!fs.existsSync(USER_SKILLS_DIR)) return '尚無自訂技能。';
        const files = fs.readdirSync(USER_SKILLS_DIR).filter(f => f.endsWith('.js'));
        if (files.length === 0) return '尚無自訂技能。';
        return `自訂技能 (${files.length}):\n` + files.map(f => `  - ${f}`).join('\n');
    }

    if (task === 'remove' || task === 'delete') {
        const name = args.name;
        if (!name) return 'remove 需要 name 參數';
        const filename = `${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}.js`;
        const filepath = path.join(USER_SKILLS_DIR, filename);
        if (!fs.existsSync(filepath)) return `技能 "${name}" 不存在`;
        fs.unlinkSync(filepath);
        try {
            const skillManager = require('../../managers/SkillManager');
            skillManager.refresh();
        } catch (e) { console.warn('[skill-inject] SkillManager refresh failed:', e.message); }
        return `✅ 技能 "${name}" 已移除`;
    }

    return '可用指令: create (注入新技能), list (列出自訂技能), remove (移除技能)';
}

module.exports = {
    execute,
    name: 'skill-inject',
    description: '自主技能注入 — 讓 Rensin 能自己創建、測試、載入新技能',
    PROMPT: `## skill-inject (自主技能注入)
讓你能夠自主創建和管理自訂技能。

### 使用方式:
1. **建立技能**: \`{ "action": "skill-inject", "task": "create", "name": "技能名", "code": "module.exports = { name: '...', execute: async (args) => '...' , PROMPT: '...' }", "description": "說明" }\`
2. **列出技能**: \`{ "action": "skill-inject", "task": "list" }\`
3. **移除技能**: \`{ "action": "skill-inject", "task": "remove", "name": "技能名" }\`

### 安全限制:
- 禁止使用 child_process, exec, spawn, eval, Function 構造
- 必須導出 name, execute/run, PROMPT
- 自動備份舊版本
- 所有注入記錄寫入 MAGMA 知識圖譜`
};

if (require.main === module) {
    const rawArgs = process.argv[2];
    if (!rawArgs) { console.log('Usage: node skill-inject.js \'{"task":"list"}\''); process.exit(1); }
    try {
        execute(JSON.parse(rawArgs)).then(console.log).catch(e => console.error(e.message));
    } catch (e) { console.error(`Parse Error: ${e.message}`); }
}
