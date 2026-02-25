const fs = require('fs');
const path = require('path');
const persona = require('./core/persona');
const CORE_DEFINITION = require('./core/definition');

// ============================================================
// 2. 技能庫 - 自動發現版 (SKILL LIBRARY v9.0+)
// ============================================================

// 🎯 自動掃描 core/ 目錄，動態加載所有技能執行檔
const SKILLS = {};
const coreDir = path.join(__dirname, 'core');

// 確保目錄存在
if (fs.existsSync(coreDir)) {
    const files = fs.readdirSync(coreDir);

    files.forEach(file => {
        // 只加載 .js 文件，跳過其他
        if (!file.endsWith('.js')) return;

        const skillName = file.replace('.js', '').toUpperCase().replace(/-/g, '_');
        try {
            // 動態 require
            const skillModule = require(`./core/${file}`);
            SKILLS[skillName] = skillModule;
            console.log(`✅ [Skills:Core] 已加載: ${skillName}`);
        } catch (e) {
            console.warn(`⚠️ [Skills:Core] 加載失敗: ${file} - ${e.message}`);
        }
    });
} else {
    console.warn(`⚠️ [Skills] core 目錄不存在`);
}

console.log(`📚 [Skills] 共加載 ${Object.keys(SKILLS).length} 個技能`);

// ============================================================
// 3. 匯出邏輯
// ============================================================
module.exports = {
    persona: persona,

    getSystemPrompt: (systemInfo) => {
        let fullPrompt = CORE_DEFINITION(systemInfo) + "\n";

        for (const [name, module] of Object.entries(SKILLS)) {
            const prompt = typeof module === 'string' ? module : (module.PROMPT || "");
            if (!prompt) continue;

            const lines = prompt.trim().split('\n');
            const firstLine = lines.length > 1 ? lines[1] : (lines[0] || "（無描述）");
            fullPrompt += `> [${name}]: ${firstLine.replace('【已載入技能：', '').replace('】', '')}\n`;
        }

        fullPrompt += "\n📚 **技能詳細手冊:**\n";
        for (const [name, module] of Object.entries(SKILLS)) {
            const prompt = typeof module === 'string' ? module : (module.PROMPT || "");
            if (prompt) {
                fullPrompt += `\n--- Skill: ${name} ---\n${prompt}\n`;
            }
        }

        fullPrompt += `\n[系統就緒] 請等待 ${persona.get().userName} 的指令。`;
        return fullPrompt;
    }
};
