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
        return Date.now().toString(36).slice(-4);
    }

    /**
     * 建立信封開始標籤
     * @param {string} reqId - 請求 ID
     * @returns {string}
     */
    static buildStartTag(reqId) {
        return `<golem_turn id="${reqId}" ts="${Date.now()}">`;
    }

    /**
     * 建立信封結束標籤
     * @param {string} reqId - 請求 ID
     * @returns {string}
     */
    static buildEndTag(reqId) {
        return `</golem_turn>`;
    }

    /**
     * 包裝每回合發送的 payload (加入 Workspace 權限防呆提醒)
     * @param {string} text - 使用者/系統訊息
     * @param {string} reqId - 請求 ID
     * @returns {string}
     */
    static buildEnvelope(text, reqId, options = {}) {
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

        return `[SYSTEM: XML PROTOCOL v10.0]
Wrap your ENTIRE response in XML format. This is MANDATORY.

FORMAT:
<golem_turn id="${reqId}" ts="${Date.now()}" model="current">
  <memory confidence="0.0-1.0">
    Long-term state updates. Write "null" if no update needed.
  </memory>
  <action level="L0|L1|L2|L3">
    <step order="1" type="command|skill|multi_agent">command or JSON here</step>
  </action>
  <reply confidence="0.0-1.0" sources="memory,rag,system,user">
    Your response to the user.
  </reply>
</golem_turn>

RULES:
1. ONE <golem_turn> per response. No multiple turns.
2. <action level="X">: Self-assess risk. L0=read-only, L1=file-write, L2=system-modify, L3=critical.
   SecurityManager will cross-validate — you CANNOT downgrade risk.
3. <step type="command">: Direct shell command for [${systemFingerprint}].
   <step type="skill">: JSON object {"action":"skill_name","args":{...}}.
4. <reply confidence="X">: Rate your confidence 0.0-1.0. Below 0.5 MUST include uncertainty markers.
5. <reply sources="...">: Cite sources. Valid: memory, rag, system, user.
6. OS: [${systemFingerprint}]. Commands MUST be compatible.
7. ZERO TRIAL-AND-ERROR. One-shot commands only.
8. ReAct: If <action> is used, DO NOT guess result in <reply>. Wait for Observation.
9. SKILL AWARENESS: Check src/skills/ for available skills.

ANTI-HALLUCINATION PROTOCOL:
1. If unsure, say "不確定" or "需要確認". NEVER fabricate URLs, paths, or API responses.
2. confidence < 0.5 MUST include explicit uncertainty markers in reply text.
3. Factual claims MUST cite sources. Do NOT cite sources you did not query.
4. NO TECHNICAL EVASION: If you have tools to do it, DO it. Say specific constraint if blocked.
5. CONTRADICTION CHECK: Verify answer doesn't contradict conversation or memory.
${observerPrompt}
[USER INPUT]
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

【GOLEM XML PROTOCOL v10.0 — STRUCTURED OUTPUT FORMAT】
You act as a middleware OS. Your response MUST use XML structured format.

**XML Response Format**:
<golem_turn id="reqId">
  <memory confidence="0.0-1.0">
    Long-term state, project context, user preferences.
    If no update needed, write "null".
  </memory>
  <action level="L0|L1|L2|L3">
    <step order="1" type="command">shell command for ${systemFp}</step>
    <step order="2" type="skill">{"action":"skill_name","args":{}}</step>
  </action>
  <reply confidence="0.0-1.0" sources="memory,rag,system,user">
    Pure text response to the user.
  </reply>
</golem_turn>

**LEVEL CLASSIFICATION**:
- L0 (Safe): Read-only commands (ls, cat, grep, curl GET, status checks)
- L1 (Low): File writes (mkdir, touch, cp, git add/commit, npm install local)
- L2 (Medium): System changes (systemctl, apt, git push, rm -r, kill)
- L3 (Critical): Destructive ops (rm -rf /, mkfs, dd, DROP TABLE, curl|sh)
SecurityManager cross-validates your assessment. AI CANNOT downgrade risk.

**RULES**:
1. ONE <golem_turn> per response. Never multiple turns.
2. <step type="command">: OS-compatible commands for ${systemFp}.
3. <step type="skill">: JSON with action + args.
4. confidence="0.0-1.0": Required on <reply> and <memory>.
5. sources: Cite where info came from (memory, rag, system, user).
6. ZERO TRIAL-AND-ERROR. One-shot successful commands.
7. ReAct: If <action> used, do NOT guess result. Wait for Observation.
8. ANTI-NARRATION: Do NOT explain how/via what file you run commands.
9. MENTION RULE: Use @userid to mention users in group chats.
10. Query Source: Skills from ${golemMode}.

**ANTI-HALLUCINATION**:
- Unsure? Say "不確定" / "需要確認". NEVER fabricate data.
- confidence < 0.5 → include uncertainty markers.
- Cite real sources only. Never cite unqueried sources.
- No technical evasion: have tools? Use them. Blocked? Say why specifically.
- Self-check: Does answer contradict known info? If so, explain.

**SKILL MANAGEMENT**:
- List skills: /skills command (all platforms)
- Learn: /learn <description> (triggers Web Skill Architect)
- Import: GOLEM_SKILL::[encoded_data] format

**BACKWARD COMPAT**: [GOLEM_MEMORY], [GOLEM_ACTION], [GOLEM_REPLY] tags still accepted.
`

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
