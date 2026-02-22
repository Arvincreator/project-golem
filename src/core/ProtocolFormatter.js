// ============================================================
// 📡 ProtocolFormatter - Golem 協議格式化
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
     * 包裝每回合發送的 payload (含強制洗腦引擎)
     * @param {string} text - 使用者/系統訊息
     * @param {string} reqId - 請求 ID
     * @returns {string}
     */
    static buildEnvelope(text, reqId) {
        const TAG_START = ProtocolFormatter.buildStartTag(reqId);
        const TAG_END = ProtocolFormatter.buildEndTag(reqId);

        return `[SYSTEM: CRITICAL PROTOCOL REMINDER FOR THIS TURN]
1. ENVELOPE: Wrap your ENTIRE response between ${TAG_START} and ${TAG_END}.
2. TAGS: Use [GOLEM_MEMORY], [GOLEM_ACTION], and [GOLEM_REPLY]. Do not output raw text outside tags.
3. STRICT JSON: [GOLEM_ACTION] must be perfectly valid JSON. ESCAPE ALL DOUBLE QUOTES (\\\") inside string values!
4. ReAct (NO HALLUCINATION): If you use [GOLEM_ACTION], DO NOT guess the command result in [GOLEM_REPLY]. Wait for the upcoming [System Observation] before answering.

[USER INPUT / SYSTEM MESSAGE]
${text}`;
    }

    /**
     * 組裝完整的系統 Prompt (含技能注入 + Super Protocol)
     * @returns {{ systemPrompt: string, skillMemoryText: string|null }}
     */
    static buildSystemPrompt() {
        let systemPrompt = skills.getSystemPrompt(getSystemFingerprint());
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
\n\n【⚠️ GOLEM PROTOCOL v9.0.2 - TITAN CHRONOS + MULTIAGENT + SKILLS】
You act as a middleware OS. You MUST strictly follow this output format.
DO NOT use emojis in tags. DO NOT output raw text outside of these blocks.

1. **Format Structure**:
Your response must be parsed into 3 sections using these specific tags:

[GOLEM_MEMORY]
(Write long-term memories here. If none, leave empty or write "null")

[GOLEM_ACTION]
(Write JSON execution plan here. MUST be perfectly valid JSON Array or Object.)
\`\`\`json
[
{"action": "command", "parameter": "ls -la"}
]
\`\`\`

[GOLEM_REPLY]
(Write the actual response to the user here. Pure text.)

2. **CRITICAL RULES FOR JSON (MUST OBEY)**:
- 🚨 JSON ESCAPING: If your action values contain double quotes ("), you MUST escape them (\\\\"). Unescaped quotes will crash the JSON parser!
- 🛠️ SKILL USAGE: For complex skills requiring long text, DO NOT write raw CLI commands. Output a structured JSON object. (e.g., {"action": "reincarnate", "summary": "..."})

3. **🧠 ReAct PROTOCOL (WAIT FOR OBSERVATION - EXTREMELY IMPORTANT)**:
- If your task requires executing a [GOLEM_ACTION] to gather information (e.g., reading a file, checking a folder, fetching an API), **YOU MUST NOT GUESS OR HALLUCINATE THE RESULT IN [GOLEM_REPLY]!**
- Instead, output the [GOLEM_ACTION], and set [GOLEM_REPLY] to a simple acknowledgment like: "正在為您執行指令查詢，請稍候..." or "我正在查看資料夾，請批准操作...".
- The system will pause, execute your action, and send the actual result back to you as a "[System Observation]".
- ONLY AFTER you receive the "[System Observation]" in the NEXT turn, you can analyze it and output the final answer in a new [GOLEM_REPLY].
`;

        return { systemPrompt: systemPrompt + superProtocol, skillMemoryText };
    }
}

module.exports = ProtocolFormatter;
