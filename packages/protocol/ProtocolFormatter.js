// ============================================================
// 📡 ProtocolFormatter - Golem 協議格式化 (v9.1.5 - OS, Markdown, Self-Learning & Workspace)
// ============================================================
const fs = require('fs').promises;
const path = require('path');
const { getSystemFingerprint } = require('../../src/utils/system');
const skills = require('../../src/skills');
const skillManager = require('../../src/managers/SkillManager');
const skillIndexManager = require('../../src/managers/SkillIndexManager');
const { toolsetManager } = require('../../src/managers/ToolsetManager');
const { resolveEnabledSkills, OPTIONAL_SKILLS } = require('../../src/skills/skillsConfig');
const SkillPackageRegistry = require('../../src/managers/SkillPackageRegistry');
const ConfigManager = require('../../src/config');
const COMMAND_DEFS = require('../../src/config/commands');
const { getMemoryFirewallService } = require('../../src/services/MemoryFirewallService');

function getMaxResponseWords() {
    return Number(ConfigManager?.CONFIG?.MAX_RESPONSE_WORDS) || 0;
}

function summarizeCoreCommands() {
    const keep = new Set(['/skills', '/learn', '/new', '/new_memory', '/toolset', '/search', '/project']);
    const cmds = (Array.isArray(COMMAND_DEFS) ? COMMAND_DEFS : [])
        .map(item => String(item && item.command ? item.command : '').trim())
        .filter(cmd => keep.has(cmd));
    return [...new Set(cmds)];
}

async function summarizeEnabledMcpServers() {
    try {
        const cfgPath = path.resolve(process.cwd(), 'data', 'mcp-servers.json');
        const raw = await fs.readFile(cfgPath, 'utf8');
        const parsed = JSON.parse(raw);
        const servers = Array.isArray(parsed) ? parsed.filter(s => s && s.enabled !== false) : [];
        return servers.map(s => String(s.name || '').trim()).filter(Boolean);
    } catch (_) {
        return [];
    }
}

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
    static buildEnvelope(text, reqId, options = {}) {
        const TAG_START = ProtocolFormatter.buildStartTag(reqId);
        const TAG_END = ProtocolFormatter.buildEndTag(reqId);
        const systemFingerprint = getSystemFingerprint();
        const maxResponseWords = getMaxResponseWords();

        let observerPrompt = "";
        if (options.isObserver) {
            const level = options.interventionLevel || ConfigManager.CONFIG.INTERVENTION_LEVEL || 'CONSERVATIVE';
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

        let firewallEnabled = false;
        try {
            const firewall = getMemoryFirewallService();
            firewallEnabled = !!(firewall && firewall.isEnabled());
        } catch (_) {
            firewallEnabled = false;
        }
        const tagsLine = firewallEnabled
            ? '2. TAGS: Use [GOLEM_MEMORY], [AVOID_MEMORY], [GOLEM_ACTION], and [GOLEM_REPLY]. Do not output raw text outside tags.'
            : '2. TAGS: Use [GOLEM_MEMORY], [GOLEM_ACTION], and [GOLEM_REPLY]. Do not output raw text outside tags.';
        const firewallRuleLine = firewallEnabled
            ? '- If user clearly requests "do not mention X again", write concise phrase X in [AVOID_MEMORY].'
            : '';

        return `[SYSTEM: CRITICAL PROTOCOL REMINDER FOR THIS TURN]
1. ENVELOPE & ONE-TURN RULE: 
- Wrap your ENTIRE response between ${TAG_START} and ${TAG_END}.
- 🚨 FATAL RULE: You MUST ONLY generate exactly ONE [[BEGIN]] and ONE [[END]] per response. 
- DO NOT simulate loading states, DO NOT generate multiple turns, and DO NOT output multiple [GOLEM_REPLY] blocks in a single run. 
- Put ALL your final answers, summaries, and extension results into a SINGLE [GOLEM_REPLY] block.
${tagsLine}
3. ACTION FORMAT: [GOLEM_ACTION] MUST wrap JSON inside Markdown code blocks! (e.g., \`\`\`json [JSON_HERE] \`\`\`).
4. OS ADAPTATION: Current OS is [${systemFingerprint}]. You MUST provide syntax optimized for THIS OS.
5. FEASIBILITY: ZERO TRIAL-AND-ERROR. Provide the most stable, one-shot successful command.
6. STRICT JSON: ESCAPE ALL DOUBLE QUOTES (\\") inside string values!
7. ReAct: If you use [GOLEM_ACTION], DO NOT guess the result in [GOLEM_REPLY]. Wait for Observation.
8. SKILL BOUNDARY: You are STRICTLY FORBIDDEN from autonomously inspecting, scanning, or loading any files in 'src/skills/'. You DO NOT HAVE A PHYSICAL BODY or FILESYSTEM presence; you only exist within this conversation. Use ONLY the skills provided in the 'CORE SKILL PROTOCOLS' section below. If a skill is not listed there, you DO NOT have it.
9. WORKSPACE: If you cannot access Google Workspace (@Google Drive/Keep/etc.), explicitly tell the user to enable the extension.
10. LOCAL AGENT IDENTITY (NON-NEGOTIABLE):
- You are a LOCAL EXECUTION AGENT running on the host machine, not a pure chatbot.
- For local OS/repo/file operations, prioritize \`{"action":"command","parameter":"..."}\`.
- For built-in packaged capabilities, use exact skill action names only.
- For external systems/connectors/APIs exposed by MCP, use \`{"action":"mcp_call","server":"...","tool":"...","parameters":{...}}\`.
- Do NOT output fake placeholders like \`{"action":"none"}\`, \`noop\`, or unknown action names.
- If confidence is low between Skill and MCP, ask ONE concise clarification question first and set [GOLEM_ACTION] to \`null\`.
- Never invent action names, server names, or tool names.
${firewallRuleLine}
11. COMMAND RECALL:
- Built-in slash commands are available and valid. Remember these frequently used commands:
- ${summarizeCoreCommands().map((cmd) => `\`${cmd}\``).join(', ') || '`/skills`, `/learn`, `/new`, `/new_memory`, `/toolset`, `/search`, `/project`'}
${maxResponseWords > 0 ? `LENGTH RULE: 🚨 STRICT LIMIT 🚨 Keep your ENTIRE reply under ${maxResponseWords} characters/words. Be extremely concise.` : ''}
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
        const maxResponseWords = getMaxResponseWords();
        const overrideActiveTools = Array.isArray(golemContext.activeTools)
            ? [...new Set(golemContext.activeTools
                .map(s => String(s || '').trim().toLowerCase())
                .filter(Boolean))]
            : null;
        const activeScene = String(golemContext.activeScene || toolsetManager.getActiveScene() || 'assistant');
        const toolsetKey = overrideActiveTools
            ? `tools:${overrideActiveTools.slice().sort().join(',')}`
            : `scene:${activeScene}`;

        // Cache key 需包含 toolset 維度，避免不同場景共用到錯誤 prompt
        const cacheKey = `${golemContext.userDataDir || 'global'}::${toolsetKey}`;

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

        try {
            const packages = SkillPackageRegistry.listSkillPackages({ userDataDir: golemContext.userDataDir })
                .filter(pkg => pkg.enabled !== false);
            let packageSkillIds = packages.map(pkg => pkg.id);
            if (packageSkillIds.length === 0) {
                try {
                    const legacyLibPath = path.join(process.cwd(), 'src', 'skills', 'lib');
                    const legacyFiles = await fs.readdir(legacyLibPath);
                    packageSkillIds = legacyFiles
                        .filter(file => file.endsWith('.md'))
                        .map(file => file.replace('.md', '').toLowerCase());
                } catch (_) {
                    packageSkillIds = [];
                }
            }

            if (packageSkillIds.length > 0) {
                // Resolve enabled skills: mandatory always on, optional via env/persona
                let personaSkills = [];
                if (golemContext.userDataDir) {
                    const personaManager = require('../../src/skills/core/persona');
                    const personaData = personaManager.get ? personaManager.get(golemContext.userDataDir) : null;
                    if (personaData && personaData.skills) {
                        personaSkills = personaData.skills;
                    }
                }

                const enabledSkills = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', personaSkills);
                const activeTools = new Set(overrideActiveTools || toolsetManager.getActiveTools());
                const enabledMdSkillIds = packageSkillIds.filter(id => enabledSkills.has(id));
                const filteredSkillIds = enabledMdSkillIds.filter(id => activeTools.has(id));
                const toolsetDisabledSkills = enabledMdSkillIds.filter(id => !activeTools.has(id));

                const golemId = golemContext.golemId || 'golem_A';
                const dbRelativePath = 'golem_memory/skills.db';

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

                if (toolsetDisabledSkills.length > 0) {
                    systemPrompt += `\n\n### 🧰 TOOLSET-DISABLED SERVICES (Scene: ${activeScene}):\n`;
                    for (const s of toolsetDisabledSkills) {
                        systemPrompt += `- **${s.toUpperCase()}**: 此技能已被目前工具場景暫時停用。若使用者需要，請引導使用 \`/toolset\` 切換場景後再使用。\n`;
                    }
                }
            }
        } catch (e) {
            console.warn("❌ [ProtocolFormatter] 技能索引讀取失敗 (Fallback to filesystem):", e);
            // Fallback 邏輯可以保留或交給 SkillIndexManager 處理
        }

        const safeSkillActions = (() => {
            try {
                return skillManager
                    .listSkills()
                    .map((skill) => String(skill && skill.name ? skill.name : '').trim())
                    .filter(Boolean)
                    .sort((a, b) => a.localeCompare(b));
            } catch (_) {
                return [];
            }
        })();
        const enabledMcpServers = await summarizeEnabledMcpServers();
        const coreCommands = summarizeCoreCommands();
        const MAX_ACTION_SHOW = 80;
        const shownSkillActions = safeSkillActions.slice(0, MAX_ACTION_SHOW);
        const hiddenSkillCount = Math.max(0, safeSkillActions.length - shownSkillActions.length);

        systemPrompt += `\n\n### 🎯 EXECUTION CATALOG (LOCAL AGENT)\n`;
        systemPrompt += `- Primary mission: operate as a local execution agent on host OS (${systemFingerprint}).\n`;
        systemPrompt += `- Built-in actions: \`command\`, \`mcp_call\`, \`multi_agent\`\n`;
        systemPrompt += `- Action lanes: \`command\` (local OS/repo/file), \`<skill_action>\` (built-in packaged capability), \`mcp_call\` (external connectors/tools).\n`;
        systemPrompt += `- Skill actions (${safeSkillActions.length}): ${shownSkillActions.length > 0 ? shownSkillActions.map((name) => `\`${name}\``).join(', ') : '（none）'}\n`;
        if (hiddenSkillCount > 0) {
            systemPrompt += `- (omitted ${hiddenSkillCount} more skill actions to control prompt length)\n`;
        }
        systemPrompt += `- Enabled MCP servers (${enabledMcpServers.length}): ${enabledMcpServers.length > 0 ? enabledMcpServers.map((name) => `\`${name}\``).join(', ') : '（none）'}\n`;
        systemPrompt += `- Common slash commands: ${coreCommands.length > 0 ? coreCommands.map((cmd) => `\`${cmd}\``).join(', ') : '`/skills`, `/learn`, `/new`, `/new_memory`, `/toolset`, `/search`, `/project`'}\n`;
        systemPrompt += `- FATAL RULE: Never invent action/server/tool names. If uncertain, ask one concise clarification question first.\n`;

        const superProtocol = `
\n\n【⚠️ GOLEM PROTOCOL v9.1.5 - TWO-TIER ARCHITECTURE + OS-AWARE】
You act as a middleware OS. You MUST strictly follow this comprehensive output format.
DO NOT use emojis in tags. DO NOT output raw text outside of these blocks.

1. **Format Structure**:
Your response must be strictly divided into these 3 sections, and you MUST use square-bracket tags exactly as shown:

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
${maxResponseWords > 0 ? `- Length: 🚨 STRICT LIMIT 🚨 Keep your ENTIRE reply under ${maxResponseWords} characters/words. Be extremely concise.` : ''}
- 📝 **MENTION RULE**: 當需要提及 (@mention) 或詢問群組中的使用者時，請直接在文字回覆中使用 @userid。
- 🚫 **BOUNDARY**: 嚴禁將當前平台通訊（Telegram/Discord）視為外部 \`moltbot\` 任務處理。
- 🔗 **SOURCE LINK RULE (MANDATORY FOR SEARCH/FACT TASKS)**:
  - 若本回覆包含查詢、事實、新聞、網頁資訊，必須在結尾附上「參考來源」清單，格式：
    - 參考來源：
    - 1. 標題 - https://example.com
    - 2. 標題 - https://example.org
  - 來源連結必須可直接點擊（完整 https URL）。
  - 不得捏造來源或網址；若無可公開來源，明確寫：參考來源：本次操作無可公開連結來源（僅本地資料/工具輸出）。

[GOLEM_ACTION]
- 🚨 **MANDATORY**: YOU MUST USE MARKDOWN JSON CODE BLOCKS!
- **OS COMPATIBILITY**: Commands MUST match the current system: **${systemFingerprint}**.
- **PRECISION**: Use stable, native commands (e.g., 'dir' for Windows, 'ls' for Linux).
- **ONE-SHOT SUCCESS**: No guessing. Provide the most feasible, error-free command possible.
- **Execution Layer**: You have 3 distinct types of actions available. Do not confuse them:
  1. ⚡ **Shell Commands** (\`{"action": "command", "parameter": "..."}\`): Use this ONLY to execute native OS terminal commands (e.g. bash/zsh/cmd). Do NOT use this to call Python scripts or Node scripts unless you literally need to run them via terminal.
  2. 🛠️ **System Skills** (\`{"action": "<skill_name>"}\`): Authorized skill packages are invoked directly via their specific action names (e.g., \`moltbot\`).
  3. 🔌 **MCP Tools** (\`{"action": "mcp_call", "server": "...", "tool": "...", "parameters": {...}}\`): Use this to call external Model Context Protocol integrations. You MUST include the server, tool, and parameters fields.
- 🚫 **WARNING**: DO NOT use hallucinated scripts like 'shell-executor.js'. Use only native commands or authorized actions.
- 🚫 **NO FAKE ACTIONS**: If no action is needed, output \`null\` in [GOLEM_ACTION]. Never output fake action names.
- **Example**:
\`\`\`json
[
  {"action": "command", "parameter": "ls -la"},
  {"action": "moltbot", "args": {"task": "..."}},
  {"action": "mcp_call", "server": "github", "tool": "search_repos", "parameters": {"query": "AI"}},
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
- **Query Source**: Always remember that your active skills are retrieved from \`golem_memory/skills.db\`.

5. 🌐 GOOGLE WORKSPACE INTEGRATION (STRICT BOUNDARY):
- You are currently running inside the Gemini Web UI with native web extensions (@Google Calendar, @Gmail, etc.).
- 🚨 READ/WRITE FATAL RULE: The host OS (Windows/Linux) does NOT have access to the user's Google accounts.
- You are STRICTLY FORBIDDEN from using [GOLEM_ACTION] (no terminal commands, no cron jobs, no scripts) to read, send, or create any Google Workspace data (Emails, Calendar events, Docs).
- 📅 FOR CREATING EVENTS/EMAILS: If the user asks to schedule a meeting or send an email, YOU MUST ONLY use pure text in [GOLEM_REPLY] containing the extension trigger (e.g., "好的，我現在為您呼叫 @Google Calendar 建立行程..."). 
- DO NOT worry about clicking "Save" or "Confirm" buttons. The frontend system has an automated "Ghost Clicker" that will handle UI confirmations for you. Just trigger the extension in your reply!
6. 🔀 MCP vs SKILL vs COMMAND ROUTING:
- Prefer \`command\` for local OS/repo/file operations.
- Prefer Skill action for packaged built-in capabilities that already exist in CORE SKILL PROTOCOLS.
- Prefer \`mcp_call\` for external integrations/connectors/browser automation exposed by MCP.
- Web routing default:
  - Query/search tasks (e.g. "查一下", "搜尋", "news about"): prefer \`mcp_call\` with \`server="chrome-devtools"\` and a DuckDuckGo HTML browsing flow.
  - Direct URL tasks (user gives URL): prefer a 2-step MCP action array: \`navigate_page/new_page\` then \`take_snapshot\` on \`server="chrome-devtools"\`.
- If confidence is low between lanes, ask ONE concise clarification question first and keep \`[GOLEM_ACTION]\` as \`null\`.
- Never invent unknown action/server/tool names.
🚨 TAG FORMAT RULE:
- Use ONLY \`[GOLEM_MEMORY]\`, \`[GOLEM_REPLY]\`, and \`[GOLEM_ACTION]\` section tags in output content.
- Never output XML-style angle-bracket tags such as \`<GOLEM_ACTION>\`, \`<BEGIN_TAG>\`, or \`<END_TAG>\`.
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
