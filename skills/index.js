const fs = require('fs');
const path = require('path');
const persona = require('./core/persona');
const CORE_DEFINITION = require('./core/definition');

// ============================================================
// 2. 技能庫 (SKILL LIBRARY v9.0)
// ============================================================
// 載入所有技能模組
const SKILLS = {
    MULTI_AGENT_ORCHESTRATOR: require('./lib/multi-agent'),
    CHRONOS_MANAGER: require('./lib/chronos'),
    MEMORY_ARCHITECT: require('./lib/memory'),
    CLOUD_OBSERVER: require('./lib/cloud'),
    TOOL_EXPLORER: require('./lib/tool-explorer'),
    OPTIC_NERVE: require('./lib/optic-nerve'),
    CODE_WIZARD: require('./lib/code-wizard'),
    SYS_ADMIN: require('./lib/sys-admin'),
    EVOLUTION: require('./lib/evolution'),
    ACTOR: require('./lib/actor'),
    GIT_MASTER: require('./lib/git'),
    SPOTIFY_DJ: require('./lib/spotify'),
    YOUTUBE_OBSERVER: require('./lib/youtube'),
    SKILL_ARCHITECT: require('./lib/skill-architect'),
};

// ============================================================
// 3. 匯出邏輯
// ============================================================
module.exports = {
    persona: persona,

    getSystemPrompt: (systemInfo) => {
        // 1. 注入核心定義 (環境資訊 + 身份)
        // 注意：這裡不包含 Output Protocol，因為 index.js 會強制注入 Tri-Stream Protocol
        let fullPrompt = CORE_DEFINITION(systemInfo) + "\n";

        // 2. 注入技能模組
        fullPrompt += "📦 **已載入技能模組 (Active Skills):**\n";
        for (const [name, prompt] of Object.entries(SKILLS)) {
            // 只顯示技能名稱與第一行描述，保持 Prompt 簡潔
            fullPrompt += `> [${name}]: ${prompt.trim().split('\n')[1].replace('【已載入技能：', '').replace('】', '')}\n`;
        }

        // 3. 詳細技能說明
        fullPrompt += "\n📚 **技能詳細手冊:**\n";
        for (const [name, prompt] of Object.entries(SKILLS)) {
            fullPrompt += `\n--- Skill: ${name} ---\n${prompt}\n`;
        }

        fullPrompt += `\n[系統就緒] 請等待 ${persona.get().userName} 的指令。`;
        return fullPrompt;
    }
};
