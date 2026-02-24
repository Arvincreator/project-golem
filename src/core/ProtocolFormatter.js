// ============================================================
// 📡 ProtocolFormatter - Golem 協議格式化 (v9.0.5 - OS, Markdown, Self-Learning & Workspace)
// ============================================================
const { getSystemFingerprint } = require('../utils/system');
const skills = require('../skills');
const skillManager = require('../skills/lib/skill-manager');

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
     * 組裝完整的系統 Prompt (擴展 Workspace 的客服引導)
     * @returns {{ systemPrompt: string, skillMemoryText: string|null }}
     */
    static buildSystemPrompt() {
        const systemFingerprint = getSystemFingerprint();
        let systemPrompt = skills.getSystemPrompt(systemFingerprint);
        let skillMemoryText = null;

        try {
            const activeSkills = skillManager.listSkills();
            if (activeSkills.length > 0) {
                systemPrompt += `\n\n### 🛠️ DYNAMIC SKILLS AVAILABLE (Output {"action": "skill_name", ...}):\n`;

                skillMemoryText = "【系統技能庫初始化】我目前已掛載並精通以下可用技能：\n";
                activeSkills.forEach(s => {
                    systemPrompt += `- Action: "${s.name}" | Desc: ${s.description}\n`;
                    skillMemoryText += `- 技能 "${s.name}"：${s.description}\n`;
                });
                systemPrompt += `(Use these skills via [GOLEM_ACTION] when requested by user.)\n`;

                console.log(`🧠 [Memory] 準備將 ${activeSkills.length} 項技能載入長期記憶中`);
            }
        } catch (e) {
            console.warn("Skills injection failed:", e);
        }

        const superProtocol = `
\n\n【⚠️ GOLEM PROTOCOL v9.0.5 - CHRONOS + OS-AWARE + SELF-LEARNING + WORKSPACE】
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
- **PRECISION**: Use stable, native commands (e.g., 'dir' for Windows, 'ls' for Linux).
- **ONE-SHOT SUCCESS**: No guessing. Provide the most feasible, error-free command possible.
\`\`\`json
[
  {"action": "command", "parameter": "SPECIFIC_STABLE_COMMAND_FOR_${systemFingerprint}"}
]
\`\`\`

[GOLEM_REPLY]
- Pure text response to the user.
- If an action is pending, use: "正在執行 [${systemFingerprint}] 相容指令，請稍候...".

2. **CRITICAL RULES FOR JSON (MUST OBEY)**:
- 🚨 JSON ESCAPING: Escape all double quotes (\\") inside strings. Unescaped quotes will crash the parser!
- 🚨 MARKDOWN ENFORCEMENT: Raw JSON outside of \`\`\`json blocks is strictly forbidden.

3. **🧠 ReAct PROTOCOL (WAIT FOR OBSERVATION)**:
- If you trigger [GOLEM_ACTION], DO NOT guess the result in [GOLEM_REPLY].
- Wait for the system to execute the command and send the "[System Observation]".

4. 🌐 GOOGLE WORKSPACE INTEGRATION (STRICT BOUNDARY):
- You are currently running inside the Gemini Web UI with native web extensions (@Google Calendar, @Gmail, etc.).
- 🚨 READ/WRITE FATAL RULE: The host OS (Windows/Linux) does NOT have access to the user's Google accounts.
- You are STRICTLY FORBIDDEN from using [GOLEM_ACTION] (no terminal commands, no cron jobs, no scripts) to read, send, or create any Google Workspace data (Emails, Calendar events, Docs).
- 📅 FOR CREATING EVENTS/EMAILS: If the user asks to schedule a meeting or send an email, YOU MUST ONLY use pure text in [GOLEM_REPLY] containing the extension trigger (e.g., "好的，我現在為您呼叫 @Google Calendar 建立行程..."). 
- DO NOT worry about clicking "Save" or "Confirm" buttons. The frontend system has an automated "Ghost Clicker" that will handle UI confirmations for you. Just trigger the extension in your reply!
`;

        return { systemPrompt: systemPrompt + superProtocol, skillMemoryText };
    }
}

module.exports = ProtocolFormatter;
