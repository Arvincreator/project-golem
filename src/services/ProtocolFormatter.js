// ============================================================
// 📡 ProtocolFormatter - Golem 協議格式化 (v9.0.5 - OS, Markdown, Self-Learning & Workspace)
// ============================================================
const fs = require('fs').promises;
const path = require('path');
const { getSystemFingerprint } = require('../utils/system');
const skills = require('../skills');
const skillManager = require('../managers/SkillManager');

class ProtocolFormatter {
    /**
     * 產生短請求 ID (用於信封標記)
     * @returns {string} 4 字元的 base36 ID
     */
    static generateReqId() {
        return Date.now().toString(36).slice(-4);
    }

    /**
     * 建立信封開始標籤
     * @param {string} reqId - 請求 ID
     * @returns {string}
     */
    static buildStartTag(reqId) {
        return `[[BEGIN:${reqId}]]`;
    }

    /**
     * 建立信封結束標籤
     * @param {string} reqId - 請求 ID
     * @returns {string}
     */
    static buildEndTag(reqId) {
        return `[[END:${reqId}]]`;
    }

    /**
     * 包裝每回合發送的 payload (加入 Workspace 權限防呆提醒)
     * @param {string} text - 使用者/系統訊息
     * @param {string} reqId - 請求 ID
     * @returns {string}
     */
    static buildEnvelope(text, reqId) {
        const TAG_START = ProtocolFormatter.buildStartTag(reqId);
        const TAG_END = ProtocolFormatter.buildEndTag(reqId);
        const systemFingerprint = getSystemFingerprint();

        return `[SYSTEM: CRITICAL PROTOCOL REMINDER FOR THIS TURN]
1. ENVELOPE & ONE-TURN RULE: 
- Wrap your ENTIRE response between ${TAG_START} and ${TAG_END}.
- 🚨 FATAL RULE: You MUST ONLY generate exactly ONE [[BEGIN]] and ONE [[END]] per response. 
- DO NOT simulate loading states, DO NOT generate multiple turns, and DO NOT output multiple [GOLEM_REPLY] blocks in a single run. 
- Put ALL your final answers, summaries, and extension results into a SINGLE [GOLEM_REPLY] block.
2. TAGS: Use [GOLEM_MEMORY], [GOLEM_ACTION], and [GOLEM_REPLY]. Do not output raw text outside tags.
3. ACTION FORMAT: [GOLEM_ACTION] MUST wrap JSON inside Markdown code blocks! (e.g., \`\`\`json [JSON_HERE] \`\`\`).
4. OS ADAPTATION: Current OS is [${systemFingerprint}]. You MUST provide syntax optimized for THIS OS.
5. FEASIBILITY: ZERO TRIAL-AND-ERROR. Provide the most stable, one-shot successful command.
6. STRICT JSON: ESCAPE ALL DOUBLE QUOTES (\\") inside string values!
7. ReAct: If you use [GOLEM_ACTION], DO NOT guess the result in [GOLEM_REPLY]. Wait for Observation.
8. SKILL DISCOVERY: You can check skill files in \`src/skills/lib\` and memorize their usage in [GOLEM_MEMORY].
9. WORKSPACE: If you cannot access Google Workspace (@Google Drive/Keep/etc.), explicitly tell the user to enable the extension.

[USER INPUT / SYSTEM MESSAGE]
${text}`;
    }

    // --- [效能優化] 靜態快取變數 ---
    static _cachedPrompt = null;
    static _cachedMemoryText = null;
    static _lastScanTime = 0;
    static CACHE_TTL = 300000; // 5 分鐘快取

    /**
     * 組裝完整的系統 Prompt (包含動態掃描 lib/ 下的 .md 檔)
     * @param {boolean} [forceRefresh=false] - 是否強制重新掃描
     * @returns {Promise<{ systemPrompt: string, skillMemoryText: string|null }>}
     */
    static async buildSystemPrompt(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && ProtocolFormatter._cachedPrompt && (now - ProtocolFormatter._lastScanTime < ProtocolFormatter.CACHE_TTL)) {
            console.log("⚡ [ProtocolFormatter] 使用快取的系統協議 (Cache Hit)");
            return { systemPrompt: ProtocolFormatter._cachedPrompt, skillMemoryText: ProtocolFormatter._cachedMemoryText };
        }

        const systemFingerprint = getSystemFingerprint();
        let systemPrompt = skills.getSystemPrompt(systemFingerprint);
        let skillMemoryText = "【系統技能庫初始化】我目前已掛載並精通以下可用技能：\n";

        // --- [優化] 使用 Promise.all 平行掃描 src/skills/lib/*.md ---
        const libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
        try {
            const files = await fs.readdir(libPath);
            const mdFiles = files.filter(f => f.endsWith('.md'));

            if (mdFiles.length > 0) {
                console.log(`📡 [ProtocolFormatter] 正在平行讀取 ${mdFiles.length} 個技能說明書...`);
                systemPrompt += `\n\n### 🧩 CORE SKILL PROTOCOLS (Cognitive Layer):\n`;

                const readTasks = mdFiles.map(async (file) => {
                    const content = await fs.readFile(path.join(libPath, file), 'utf-8');
                    const skillName = path.basename(file, '.md').toUpperCase();
                    return { skillName, content };
                });

                const results = await Promise.all(readTasks);
                for (const res of results) {
                    systemPrompt += `#### SKILL: ${res.skillName}\n${res.content}\n\n`;
                    skillMemoryText += `- 技能 "${res.skillName}"：已載入認知說明書\n`;
                }
            }
        } catch (e) {
            console.warn("❌ [ProtocolFormatter] 說明書掃描失敗:", e);
        }

        const superProtocol = `
\n\n【⚠️ GOLEM PROTOCOL v9.0.7 - TWO-TIER ARCHITECTURE】
You act as a middleware OS. Strictly follow this structure:

[[BEGIN:reqId]]
[GOLEM_MEMORY]
- Manage context and preferences. Output "null" if no update.
- 🧠 HIPPOCAMPUS: Store skill usage details from src/skills/lib.

[GOLEM_ACTION]
- MANDATORY: Use Markdown JSON code blocks.
- Action names MUST match core components (e.g., moltbot, schedule).
\`\`\`json
[ {"action": "name", "args": {}} ]
\`\`\`

[GOLEM_REPLY]
- Pure text response to the user.

[[END:reqId]]

🚨 CRITICAL: Use the exact [[BEGIN:reqId]] and [[END:reqId]] tags provided in each turn!
`;

        const finalPrompt = systemPrompt + superProtocol;

        // 更新快取
        ProtocolFormatter._cachedPrompt = finalPrompt;
        ProtocolFormatter._cachedMemoryText = skillMemoryText;
        ProtocolFormatter._lastScanTime = now;

        return { systemPrompt: finalPrompt, skillMemoryText };
    }

    /**
     * [效能優化] 壓縮指令，移除多餘空白與換行
     * @param {string} prompt 
     * @returns {string}
     */
    static compress(prompt) {
        if (!prompt) return "";
        return prompt
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n');
    }
}

module.exports = ProtocolFormatter;
