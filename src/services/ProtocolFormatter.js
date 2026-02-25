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
- Wrap your ENTIRE response between [[BEGIN:XXX]] and [[END:XXX]].
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

    /**
     * 組裝完整的系統 Prompt (包含動態掃描 lib/ 下的 .md 檔)
     * @returns {Promise<{ systemPrompt: string, skillMemoryText: string|null }>}
     */
    static async buildSystemPrompt() {
        const systemFingerprint = getSystemFingerprint();
        let systemPrompt = skills.getSystemPrompt(systemFingerprint);
        let skillMemoryText = "【系統技能庫初始化】我目前已掛載並精通以下可用技能：\n";

        // --- [新增] 動態掃描 src/skills/lib/*.md ---
        const libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
        try {
            const files = await fs.readdir(libPath);
            const mdFiles = files.filter(f => f.endsWith('.md'));

            if (mdFiles.length > 0) {
                systemPrompt += `\n\n### 🧩 CORE SKILL PROTOCOLS (Cognitive Layer):\n`;
                for (const file of mdFiles) {
                    const content = await fs.readFile(path.join(libPath, file), 'utf-8');
                    const skillName = path.basename(file, '.md').toUpperCase();
                    systemPrompt += `#### SKILL: ${skillName}\n${content}\n\n`;
                    skillMemoryText += `- 技能 "${skillName}"：已載入認知說明書\n`;
                }
            }
        } catch (e) {
            console.warn("❌ [ProtocolFormatter] 說明書掃描失敗:", e);
        }

        const superProtocol = `
\n\n【⚠️ GOLEM PROTOCOL v9.0.6 - TWO-TIER ARCHITECTURE + OS-AWARE】
You act as a middleware OS. You MUST strictly follow this comprehensive output format.
DO NOT use emojis in tags. DO NOT output raw text outside of these blocks.

1. **Format Structure**:
Your response must be strictly divided into these 3 sections:

[GOLEM_MEMORY]
- Manage long-term state, project context, and user preferences.
- 🧠 **HIPPOCAMPUS**: If you inspect new skill files in \`src/skills/lib\`, you MUST memorize how to use them here.
- If no update is needed, output "null".

[GOLEM_ACTION]
- 🚨 **MANDATORY**: YOU MUST USE MARKDOWN JSON CODE BLOCKS!
- **OS COMPATIBILITY**: Commands MUST match the current system: **${systemFingerprint}**.
- **Execution Layer**: Skills are now separated from prompts. Execute via action name.
\`\`\`json
[
  {"action": "moltbot", "task": "feed", "limit": 5}
]
\`\`\`

[GOLEM_REPLY]
- Pure text response to the user.

2. **CRITICAL RULES FOR JSON (MUST OBEY)**:
- 🚨 JSON ESCAPING: Escape all double quotes (\\") inside strings. Unescaped quotes will crash the parser!
- 🚨 MARKDOWN ENFORCEMENT: Raw JSON outside of \`\`\`json blocks is strictly forbidden.

3. **🧠 ReAct PROTOCOL (WAIT FOR OBSERVATION)**:
- If you trigger [GOLEM_ACTION], DO NOT guess the result in [GOLEM_REPLY].
- Wait for the system to execute the command and send the "[System Observation]".
`;

        return { systemPrompt: systemPrompt + superProtocol, skillMemoryText };
    }
}

module.exports = ProtocolFormatter;
