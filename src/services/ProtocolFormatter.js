// ============================================================
// 📡 ProtocolFormatter - Golem 協議格式化 (v9.0.5 - OS, Markdown, Self-Learning & Workspace)
// ============================================================
const fs = require('fs').promises;
const path = require('path');
const { getSystemFingerprint } = require('../utils/system');
const skills = require('../skills');
const skillManager = require('../managers/SkillManager');
const skillIndexManager = require('../managers/SkillIndexManager');
const { resolveEnabledSkills, OPTIONAL_SKILLS } = require('../skills/skillsConfig');
const ConfigManager = require('../config');

class ProtocolFormatter {
    /**
     * 產生短請求 ID (用於信封標記)
     * @returns {string} 4 字元的 base36 ID
     */
    static generateReqId() {
        return Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 5);
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
    static buildEnvelope(text, reqId, options = {}) {
        const TAG_START = ProtocolFormatter.buildStartTag(reqId);
        const TAG_END = ProtocolFormatter.buildEndTag(reqId);
        const systemFingerprint = getSystemFingerprint();

        let observerPrompt = "";
        if (options.isObserver) {
            const level = options.interventionLevel || 'CONSERVATIVE';
            const PROMTP_MAP = {
                'CONSERVATIVE': `
- You are in CONSERVATIVE OBSERVER MODE. 
- 🚨 HIGHEST PRIORITY: STAY SILENT. Do not interrupt unless absolutely critical.
- **Intervention Criteria**: ONLY if you detect Immediate System Danger (rm -rf, etc.) or Critical Security Breach.
- Do NOT speak for minor errors, logical debates, or "helpful tips".`,
                'NORMAL': `
- You are in NORMAL OBSERVER MODE. 
- Stay silent by default, but you are authorized to intervene for:
   1. **Critical Technical Errors**: Significant factual or syntax errors.
   2. **Logic Fallacies**: Contradictions that break the workflow.
   3. **Security/Safety Risks**.
- Do NOT speak for simple greetings or minor stylistic suggestions.`,
                'PROACTIVE': `
- You are in PROACTIVE OBSERVER MODE (Expert Assistant).
- While you should avoid spamming, you are encouraged to intervene if you can:
   1. **Optimize**: Suggest better ways to achieve the user's goal.
   2. **Mentor**: Explain complex concepts or fix minor errors.
   3. **Anticipate**: Provide the next logical step before they ask.
- Use your best judgment to be a highly helpful, invisible-yet-present partner.`
            };

            const selectedPrompt = PROMTP_MAP[level] || PROMTP_MAP['CONSERVATIVE'];

            observerPrompt = `
[GOLEM_OBSERVER_PROTOCOL]
${selectedPrompt}
- To speak, you MUST include the token [INTERVENE] at the very beginning of your [GOLEM_REPLY].
- Otherwise, output null or a minimal confirmation within [GOLEM_REPLY].\n`;
        }

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
8. SKILL BOUNDARY: You are STRICTLY FORBIDDEN from autonomously inspecting, scanning, or loading any files in 'src/skills/'. You DO NOT HAVE A PHYSICAL BODY or FILESYSTEM presence; you only exist within this conversation. Use ONLY the skills provided in the 'CORE SKILL PROTOCOLS' section below. If a skill is not listed there, you DO NOT have it.
9. WORKSPACE: If you cannot access Google Workspace (@Google Drive/Keep/etc.), explicitly tell the user to enable the extension.
${observerPrompt}
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
     * @param {Object} [golemContext={}] - 包含 golem 特定資訊，如 userDataDir
     * @returns {Promise<{ systemPrompt: string, skillMemoryText: string|null }>}
     */
    static async buildSystemPrompt(forceRefresh = false, golemContext = {}) {
        const now = Date.now();
        // 如果有 specific user data dir，我們可能不想使用全域 cache，或是將 cache key 改為含 userDataDir
        const cacheKey = golemContext.userDataDir || 'global';

        if (!ProtocolFormatter._promptCache) {
            ProtocolFormatter._promptCache = {};
        }

        if (!forceRefresh && ProtocolFormatter._promptCache[cacheKey] && (now - ProtocolFormatter._lastScanTime < ProtocolFormatter.CACHE_TTL)) {
            console.log("⚡ [ProtocolFormatter] 使用快取的系統協議 (Cache Hit)");
            return ProtocolFormatter._promptCache[cacheKey];
        }

        const systemFingerprint = getSystemFingerprint();

        const envInfo = {
            systemFingerprint,
            userDataDir: golemContext.userDataDir
        };

        let systemPrompt = skills.getSystemPrompt(envInfo);
        let skillMemoryText = "【系統技能庫初始化】我目前已掛載並精通以下可用技能：\n";

        // --- [優化] 使用 Promise.all 平行掃描 src/skills/lib/*.md ---
        const libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
        try {
            const files = await fs.readdir(libPath);
            const mdFiles = files.filter(f => f.endsWith('.md'));

            if (mdFiles.length > 0) {
                // Resolve enabled skills: mandatory always on, optional via env/persona
                let personaSkills = [];
                if (golemContext.userDataDir) {
                    const personaManager = require('../skills/core/persona');
                    const personaData = personaManager.get ? personaManager.get(golemContext.userDataDir) : null;
                    if (personaData && personaData.skills) {
                        personaSkills = personaData.skills;
                    }
                }

                const enabledSkills = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', personaSkills);

                const filteredSkillIds = mdFiles.filter(file => {
                    const baseName = file.replace('.md', '').toLowerCase();
                    return enabledSkills.has(baseName);
                }).map(file => file.replace('.md', '').toLowerCase());

                const golemId = golemContext.golemId || 'golem_A';
                const dbRelativePath = ConfigManager.GOLEM_MODE === 'SINGLE' ? 'golem_memory/skills.db' : `golem_memory/multi/${golemId}/skills.db`;

                console.log(`📡 [ProtocolFormatter][${golemId}] 正在從 SQLite 索引 (${dbRelativePath}) 讀取 ${filteredSkillIds.length} 個技能...`);
                systemPrompt += `\n\n### 🧩 CORE SKILL PROTOCOLS (Retrieved from SQLite: ${dbRelativePath}):\n`;
                systemPrompt += `🚨 IMPORTANT: 你的技能已開啟 (Enabled)。請透過 ${dbRelativePath} 查看對應的認知說明書，並依據其規範使用腳本服務。你必須嚴格遵守以下列出的協議內容：\n\n`;

                const instanceSkillIndex = new skillIndexManager(golemContext.userDataDir);
                const indexedSkills = await instanceSkillIndex.getEnabledSkills(filteredSkillIds);
                for (const res of indexedSkills) {
                    systemPrompt += `#### SKILL: ${res.id.toUpperCase()}\n${res.content}\n\n`;
                    skillMemoryText += `- 技能 "${res.id.toUpperCase()}"：已載入認知說明書\n`;
                }
                await instanceSkillIndex.close();

                // --- [Deactivation Guard] ---
                const deactivatedSkills = OPTIONAL_SKILLS.filter(s => !enabledSkills.has(s));
                if (deactivatedSkills.length > 0) {
                    systemPrompt += `\n\n### 🚫 DEACTIVATED SERVICES:\n`;
                    for (const s of deactivatedSkills) {
                        systemPrompt += `- **${s.toUpperCase()}**: 你已關閉此技能，暫時無法使用此技能服務。即使你的歷史記憶中曾有相關操作紀錄，也請無視並告知使用者該功能目前已停用。\n`;
                    }
                }
            }
        } catch (e) {
            console.warn("❌ [ProtocolFormatter] 技能索引讀取失敗 (Fallback to filesystem):", e);
            // Fallback 邏輯可以保留或交給 SkillIndexManager 處理
        }

        const superProtocol = `
\n\n【⚠️ GOLEM PROTOCOL v9.0.6 - TWO-TIER ARCHITECTURE + OS-AWARE】
You act as a middleware OS. You MUST strictly follow this comprehensive output format.
DO NOT use emojis in tags. DO NOT output raw text outside of these blocks.

1. **Format Structure**:
Your response must be strictly divided into these 3 sections:

[[BEGIN:reqId]]
[GOLEM_MEMORY]
- Manage long-term state, project context, and user preferences.
- 🧠 **HIPPOCAMPUS**: Memory consolidation layer. Do NOT attempt to read external skill files.
- If no update is needed, output "null".
[GOLEM_REPLY]
- Pure text response to the user.
- 🚫 **ANTI-NARRATION**: DO NOT explain *how* or *via what file* you run commands.
- If an action is pending, use: "正在執行 [${systemFingerprint}] 相容指令，請稍候...".
- Language: Follow user's choice or current system default.
- Tone: Professional, direct, and concise. Avoid unnecessary roleplay unless requested.
- 📝 **MENTION RULE**: 當需要提及 (@mention) 或詢問群組中的使用者時，請直接在文字回覆中使用 @userid。
- 🚫 **BOUNDARY**: 嚴禁將當前平台通訊（Telegram/Discord）視為外部 \`moltbot\` 任務處理。

[GOLEM_ACTION]
- 🚨 **MANDATORY**: YOU MUST USE MARKDOWN JSON CODE BLOCKS!
- **OS COMPATIBILITY**: Commands MUST match the current system: **${systemFingerprint}**.
- **PRECISION**: Use stable, native commands (e.g., 'dir' for Windows, 'ls' for Linux).
- **ONE-SHOT SUCCESS**: No guessing. Provide the most feasible, error-free command possible.
- **Execution Layer**: Skills are now separated from prompts. Execute via action name.
- ⚡ **ACTION: command**: Execute Native BASH/Shell commands.
- 🛠️ **System Skills**: Authorized JS scripts in \`src/skills/core/*.js\` are invoked via their specific action names.
- 🚫 **WARNING**: DO NOT use hallucinated scripts like 'shell-executor.js'. Use only native commands or authorized actions.
- **Example**:
\`\`\`json
[
  {"action": "command", "parameter": "ls -la"},
  {"action": "moltbot", "task": "..."},
  {"action": "command", "parameter": "SPECIFIC_STABLE_COMMAND_FOR_${systemFingerprint}"}
]
\`\`\`

2. **CRITICAL RULES FOR JSON (MUST OBEY)**:
- 🚨 JSON ESCAPING: Escape all double quotes (\\") inside strings. Unescaped quotes will crash the parser!
- 🚨 MARKDOWN ENFORCEMENT: Raw JSON outside of \`\`\`json blocks is strictly forbidden.

3. **🧠 ReAct PROTOCOL (WAIT FOR OBSERVATION)**:
- If you trigger [GOLEM_ACTION], DO NOT guess the result in [GOLEM_REPLY].
- Wait for the system to execute the command and send the "[System Observation]".

4. 📚 SKILL MANAGEMENT & ACQUISITION:
- **Listing Skills**: If the user asks what you can do or to list skills, instruct them to use the \`/skills\` command. This command is functional on ALL platforms (Web UI, Telegram, Discord).
- **Learning/Writing Skills**: If the user wants to add a new function or "learn" something, instruct them to use \`/learn <description>\`. This command is functional on ALL platforms. You will then design the skill via the Web Skill Architect.
- **Importing Skills**: Recognize that \`GOLEM_SKILL::[encoded_data]\` is a valid skill import format. If the user provides one, it will be automatically installed.
- **Query Source**: Always remember that your active skills are retrieved from \`${ConfigManager.GOLEM_MODE === 'SINGLE' ? 'golem_memory/skills.db' : `golem_memory/multi/${golemContext.golemId || 'golem_A'}/skills.db`}\`.

5. 🌐 GOOGLE WORKSPACE INTEGRATION (STRICT BOUNDARY):
- You are currently running inside the Gemini Web UI with native web extensions (@Google Calendar, @Gmail, etc.).
- 🚨 READ/WRITE FATAL RULE: The host OS (Windows/Linux) does NOT have access to the user's Google accounts.
- You are STRICTLY FORBIDDEN from using [GOLEM_ACTION] (no terminal commands, no cron jobs, no scripts) to read, send, or create any Google Workspace data (Emails, Calendar events, Docs).
- 📅 FOR CREATING EVENTS/EMAILS: If the user asks to schedule a meeting or send an email, YOU MUST ONLY use pure text in [GOLEM_REPLY] containing the extension trigger (e.g., "好的，我現在為您呼叫 @Google Calendar 建立行程..."). 
- DO NOT worry about clicking "Save" or "Confirm" buttons. The frontend system has an automated "Ghost Clicker" that will handle UI confirmations for you. Just trigger the extension in your reply!
[[END:reqId]]

6. 📋 回覆格式 (XML 結構化 — 可選):
你也可以使用以下 XML 格式回覆，系統兩種都能解析：
<golem_turn>
<memory>長期記憶更新（無更新則省略此標籤）</memory>
<action level="L0" confidence="0.9">\`\`\`json [{"action":"rag","task":"query","query":"..."}] \`\`\`</action>
<reply confidence="HIGH" sources="local+remote">回覆文字</reply>
</golem_turn>

### 屬性說明:
- level: L0/L1/L2/L3 (動作風險等級，由你自評)
- confidence: 0-1 數值 或 HIGH/MEDIUM/LOW/NONE
- sources: 資訊來源 (local/remote/memory/inference)
向後相容：你也可以使用 [GOLEM_MEMORY]/[GOLEM_ACTION]/[GOLEM_REPLY] 格式。

7. 🛡️ 反幻覺核心規則 (ANTI-HALLUCINATION):
- 不知道就說「我目前沒有這個資訊」— 絕不編造
- RAG 查無結果時回報「知識庫沒有相關資料」— 不技術性迴避
- 引用資料必須標明來源和信心等級 (HIGH/MEDIUM/LOW)
- 信心=LOW 的資訊必須加警告「此資訊未經驗證」
- 超出能力範圍直接說明，不裝懂
- 數字/日期/名稱不確定時用「大約」「可能」修飾
- 當你使用 rag query 取得資料時，必須在回覆中標明信心等級

🚨 CRITICAL: Use the exact [[BEGIN:reqId]] and [[END:reqId]] tags provided in each turn!
`;

        const finalPrompt = systemPrompt + superProtocol;
        console.log(`📡 [Protocol] 系統協議組裝完成，總長度: ${finalPrompt.length} 字元`);

        // 更新快取
        if (!ProtocolFormatter._promptCache) ProtocolFormatter._promptCache = {};
        ProtocolFormatter._promptCache[cacheKey] = { systemPrompt: finalPrompt, skillMemoryText };
        ProtocolFormatter._lastScanTime = now;

        return ProtocolFormatter._promptCache[cacheKey];
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
