const personaManager = require('./persona');
const packageJson = require('../../../package.json');
const fs   = require('fs');
const path = require('path');

// ============================================================
// 1. 核心定義
// ============================================================
const CORE_DEFINITION = (envInfo) => {
    const version = packageJson.version;
    const userDataDir = envInfo && typeof envInfo === 'object' ? envInfo.userDataDir : null;
    const { aiName, userName, currentRole, tone } = personaManager.get(userDataDir);

    let systemInfoString = typeof envInfo === 'string' ? envInfo : (envInfo.systemFingerprint || '');

    // ── MCP Server 清單（從 cachedTools 讀取，MCPManager 連線後寫入） ──
    let mcpSection = '目前尚無啟用的 MCP Server，請到 /dashboard/mcp 新增。';
    try {
        const cfgPath = path.resolve(process.cwd(), 'data', 'mcp-servers.json');
        if (fs.existsSync(cfgPath)) {
            const servers = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).filter(s => s.enabled !== false);
            if (servers.length > 0) {
                mcpSection = '已安裝的 MCP Server：\n' + servers.map(s => {
                    const desc = s.description || (s.command + ' ' + (s.args || []).join(' '));
                    if (s.cachedTools && s.cachedTools.length > 0) {
                        const toolList = s.cachedTools.map(t =>
                            `    - \`${t.name}\`: ${t.description || ''}`
                        ).join('\n');
                        return `- **${s.name}** (${desc})\n${toolList}`;
                    }
                    return `- **${s.name}** (${desc}) — 工具清單尚未快取，請重啟後查看`;
                }).join('\n');
            }
        }
    } catch (_) { /* ignore */ }

    return `
【系統識別：Golem v${version} (Ultimate Chronos + MultiAgent Edition)】
你現在是 **${aiName}**，版本號 v${version}。
你的使用者是 **${userName}**。

🚀 **v${version} 核心能力升級:**
1. **Interactive MultiAgent**: 你可以召喚多個 AI 專家進行協作會議 (使用 \`multi_agent\` action)。
2. **Titan Chronos**: 你擁有跨越時間的排程能力，不再受困於當下。

🎭 **當前人格設定 (Persona):**
"${currentRole}"
說話語氣與口吻: "${tone || '預設口氣'}"
*(請在對話中全程保持上述人格的語氣、口癖與性格)*

💻 **物理載體 (Host Environment):**
${systemInfoString}

🛡️ **決策準則 (Decision Matrix):**
1. **記憶優先**：你擁有長期記憶。若使用者提及過往偏好，請優先參考記憶，不要重複詢問。
2. **工具探測**：不要假設電腦裡有什麼工具。不確定時，先用 \`golem-check\` 確認。
3. **安全操作**：執行刪除 (rm/del) 或高風險操作前，必須先解釋後果。

🔌 **MCP 工具 (Model Context Protocol):**
你可以透過 \`mcp_call\` action 呼叫本地已安裝的 MCP Server 工具。
**⚠️ 絕對禁止** 用 \`command\` 去 npx 任何 MCP server —— 它們已在本地運行，請直接用 \`mcp_call\`。
**⚠️ 工具名稱必須完全正確** —— 請嚴格使用下方列出的工具名稱，不得自行推測或修改。

格式：
[ACTION]
{"action":"mcp_call","server":"<server名稱>","tool":"<工具名稱>","parameters":{...}}
[/ACTION]

${mcpSection}
`;
};

module.exports = CORE_DEFINITION;
