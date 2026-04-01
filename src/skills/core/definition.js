const personaManager = require('./persona');
const packageJson = require('../../../package.json');
const fs = require('fs');
const path = require('path');

const VALID_MCP_MODES = new Set(['compact', 'verbose', 'conditional']);

function compactText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

function isTruthy(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function normalizeMcpMode(value, fallback = 'compact') {
    const mode = String(value || '').trim().toLowerCase();
    if (VALID_MCP_MODES.has(mode)) return mode;
    return fallback;
}

function shouldRenderVerboseMcp(mode, options = {}) {
    if (mode === 'verbose') return true;
    if (mode !== 'conditional') return false;
    if (options.verboseMcp === true) return true;
    if (options.mcpVerbose === true) return true;
    if (isTruthy(process.env.GOLEM_PROMPT_MCP_VERBOSE)) return true;
    if (isTruthy(process.env.GOLEM_DEBUG_PROMPT)) return true;
    return false;
}

function readEnabledMcpServers() {
    try {
        const cfgPath = path.resolve(process.cwd(), 'data', 'mcp-servers.json');
        if (!fs.existsSync(cfgPath)) return [];
        const raw = fs.readFileSync(cfgPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((server) => server && server.enabled !== false);
    } catch {
        return [];
    }
}

function renderMcpSection(mode, options = {}) {
    const servers = readEnabledMcpServers();
    if (servers.length === 0) {
        return '🧩 **MCP Registry:** 目前尚無啟用的 MCP Server（請至 /dashboard/mcp 啟用）。';
    }

    const verbose = shouldRenderVerboseMcp(mode, options);
    const lines = ['🧩 **MCP Registry:**'];
    for (const server of servers) {
        const name = compactText(server.name, 'unnamed-server');
        const command = compactText(server.command, '');
        const args = Array.isArray(server.args) ? server.args.join(' ') : '';
        const desc = compactText(server.description, compactText(`${command} ${args}`, 'No description'));
        const tools = Array.isArray(server.cachedTools) ? server.cachedTools : [];

        if (!verbose) {
            lines.push(`- **${name}** | tools=${tools.length} | ${desc}`);
            continue;
        }

        lines.push(`- **${name}** | tools=${tools.length} | ${desc}`);
        if (tools.length === 0) {
            lines.push('  - (cached tools unavailable)');
            continue;
        }
        for (const tool of tools) {
            const toolName = compactText(tool && tool.name, 'unknown_tool');
            const toolDesc = compactText(tool && tool.description, '');
            lines.push(`  - \`${toolName}\`${toolDesc ? `: ${toolDesc}` : ''}`);
        }
    }

    if (mode === 'conditional' && !verbose) {
        lines.push('- (MCP detail hidden in conditional mode; set GOLEM_PROMPT_MCP_VERBOSE=true to expand.)');
    }
    return lines.join('\n');
}

// ============================================================
// 1. 核心定義
// ============================================================
const CORE_DEFINITION = (envInfo, options = {}) => {
    const version = packageJson.version;
    const userDataDir = envInfo && typeof envInfo === 'object' ? envInfo.userDataDir : null;
    const { aiName, userName, currentRole, tone } = personaManager.get(userDataDir);
    const safeOptions = (options && typeof options === 'object') ? options : {};
    const systemInfoString = typeof envInfo === 'string'
        ? envInfo
        : compactText(envInfo && envInfo.systemFingerprint, 'unknown-environment');
    const mcpMode = normalizeMcpMode(
        safeOptions.mcpMode || process.env.GOLEM_PROMPT_MCP_MODE || 'compact'
    );
    const mcpSection = renderMcpSection(mcpMode, safeOptions);

    return `
【System Identity】
- Agent: **${aiName}** (Project Golem v${version})
- User: **${userName}**
- Persona: "${currentRole}" | Tone: "${tone || '預設口氣'}"

【Host Environment】
${systemInfoString}

【Core Decision Loop】(fixed 4-step)
1. 理解需求：先釐清目標、成功條件與限制，不要假設未提供的前提。
2. 任務切分：將工作拆成可追蹤 steps，必要時先同步 task list。
3. 執行/觀測：先行動再觀測，避免猜測結果；等待 observation 後再下結論。
4. 驗證回報：用可驗證證據回報，明確標記狀態與下一步。

【Task Governance】(hard rules, single source)
- task-first: 3+ steps 任務先使用 \`task_create\` 或 \`todo_write\` 建立/同步 task list。
- only one in_progress: 任意時刻僅允許一個 \`in_progress\`。
- verify-before-complete: 只有 \`verification.status=verified\` 才能標記 \`completed\`。
- no fake completion: 發生錯誤或阻塞必須標記 \`failed\` 或 \`blocked\`，不得偽裝 \`completed\`。

【Execution Contract】
- 不可假設執行結果，必須等待 \`[System Observation]\` 後再回覆結果。
- 回報必須區分：\`executed\` / \`not_executed\` / \`failed\`。
- 若步驟被阻塞，先更新 task 狀態為 \`blocked/failed\`，再提出下一步建議。
- 不確定工具可用性時先探測（例如 \`golem-check\`），不要盲猜環境能力。

【Recovery Priority】
- 若上下文出現 \`Pending Tasks Snapshot\`，先延續既有任務，避免重建同義任務。
- 先恢復未完成 task，再新增新 task。

${mcpSection}
`;
};

module.exports = CORE_DEFINITION;
