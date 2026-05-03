const fs = require('fs');
const path = require('path');
const SkillPackageRegistry = require('./SkillPackageRegistry');
const { toolsetManager } = require('./ToolsetManager');
const ToolUsePolicy = require('./ToolUsePolicy');
const MCPToolCatalog = require('../mcp/MCPToolCatalog');

const MCP_CONFIG_PATH = path.resolve(process.cwd(), 'data', 'mcp-servers.json');
const STOPWORDS = new Set([
    'the', 'and', 'for', 'with', 'from', 'this', 'that', 'what', 'when', 'where', 'how',
    '你', '我', '他', '她', '它', '我們', '你們', '請', '幫我', '可以', '一下', '這個', '那個',
]);

function normalizeText(value) {
    return String(value || '').toLowerCase();
}

function extractTerms(input) {
    const text = normalizeText(input);
    const terms = [];

    const ascii = text.match(/[a-z0-9_-]{2,}/g) || [];
    for (const term of ascii) {
        if (!STOPWORDS.has(term)) terms.push(term);
    }

    const cjk = text.match(/[\u4e00-\u9fff]{2,}/g) || [];
    for (const chunk of cjk) {
        if (!STOPWORDS.has(chunk)) terms.push(chunk);
        for (let i = 0; i < chunk.length - 1; i += 1) terms.push(chunk.slice(i, i + 2));
        for (let i = 0; i < chunk.length - 2; i += 1) terms.push(chunk.slice(i, i + 3));
    }

    return [...new Set(terms)].slice(0, 80);
}

function inferIntentBoosts(text) {
    const boosts = [];
    const t = normalizeText(text);

    const add = (needle, ids) => {
        if (needle.test(t)) boosts.push(...ids);
    };

    add(/(log|logs|error|錯誤|報錯|日誌|紀錄|debug|除錯)/i, ['log-reader', 'log-archive']);
    add(/(browser|chrome|devtools|網頁|頁面|點擊|輸入|表單|console|network|lighthouse|截圖|瀏覽器)/i, ['chrome-devtools']);
    add(/(git|commit|branch|diff|pull request|pr|版本|分支)/i, ['git']);
    add(/(記憶|memory|回憶|以前|之前|歷史|找對話|搜尋對話)/i, ['memory', 'session-search']);
    add(/(排程|提醒|schedule|定時|每天|明天|下週|cron)/i, ['chronos', 'schedule', 'list-schedules']);
    add(/(圖片|影像|畫圖|生成圖|image|prompt)/i, ['image-prompt']);
    add(/(youtube|影片|字幕)/i, ['youtube']);
    add(/(spotify|音樂|播放清單)/i, ['spotify']);
    add(/(代理|agent|multi-agent|協作|委派|delegate)/i, ['multi-agent', 'delegate-task']);
    add(/(檔案|附件|參考資料|reference)/i, ['reference-files']);
    add(/(股票|股市|股價|台股|美股|個股|行情|看板|stockboard|stock dashboard|market analysis|台積電|聯發科|鴻海|輝達|nvda|aapl|tsm)/i, ['stock-dashboard']);

    return boosts;
}

function scoreCandidate(query, candidate) {
    const haystack = normalizeText([
        candidate.id,
        candidate.name,
        candidate.description,
        candidate.action,
        ...(candidate.triggers || []),
        candidate.content || '',
    ].join('\n'));
    const terms = extractTerms(query);
    let score = 0;

    for (const term of terms) {
        if (!term) continue;
        if (haystack.includes(term)) score += term.length >= 3 ? 2 : 1;
    }

    for (const id of inferIntentBoosts(query)) {
        if (candidate.id === id || candidate.action === id || candidate.server === id) score += 8;
    }

    if ((candidate.triggers || []).some(trigger => normalizeText(query).includes(normalizeText(trigger)))) {
        score += 10;
    }

    return score;
}

function loadMcpServers() {
    try {
        if (!fs.existsSync(MCP_CONFIG_PATH)) return [];
        const servers = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf8'));
        return Array.isArray(servers) ? servers.filter(server => server.enabled !== false) : [];
    } catch (_) {
        return [];
    }
}

function summarizeSchema(schema) {
    if (!schema || typeof schema !== 'object') return '';
    const properties = schema.properties && typeof schema.properties === 'object' ? Object.keys(schema.properties) : [];
    const required = Array.isArray(schema.required) ? schema.required : [];
    const bits = [];
    if (properties.length > 0) bits.push(`params: ${properties.slice(0, 8).join(', ')}`);
    if (required.length > 0) bits.push(`required: ${required.slice(0, 8).join(', ')}`);
    return bits.join('; ');
}

function compactJson(value) {
    return JSON.stringify(value, null, 2).replace(/\n/g, '\n  ');
}

class ToolRouter {
    constructor(options = {}) {
        this.userDataDir = options.userDataDir || null;
        this.activeTools = Array.isArray(options.activeTools) ? options.activeTools : null;
        this.activeScene = options.activeScene || toolsetManager.getActiveScene();
        this.policy = options.policy || new ToolUsePolicy();
    }

    route(query, options = {}) {
        const maxSkills = Number(options.maxSkills || 5);
        const maxMcpTools = Number(options.maxMcpTools || 6);
        const activeTools = new Set(this.activeTools || toolsetManager.getActiveTools());

        const skillCandidates = SkillPackageRegistry.listSkillPackages({ userDataDir: this.userDataDir })
            .filter(pkg => pkg.enabled !== false)
            .map(pkg => {
                const content = SkillPackageRegistry.readPackagePrompt(pkg).slice(0, 2500);
                const manifest = pkg.manifest || {};
                return {
                    kind: 'skill',
                    id: pkg.id,
                    name: pkg.name || pkg.id,
                    description: pkg.description || '',
                    action: pkg.action || pkg.id,
                    triggers: manifest.triggers || [],
                    hasRuntime: fs.existsSync(pkg.indexPath),
                    allowed: activeTools.has(pkg.id) || activeTools.has(pkg.action),
                    content,
                    score: 0,
                };
            });

        for (const candidate of skillCandidates) {
            candidate.score = scoreCandidate(query, candidate);
            if (candidate.allowed) candidate.score += 2;
        }

        const skills = this.policy.filter(query, skillCandidates)
            .sort((a, b) => b.score - a.score)
            .slice(0, maxSkills);

        const mcpTools = [];
        for (const server of loadMcpServers()) {
            const serverDesc = String(server.description || '').trim();
            for (const tool of server.cachedTools || []) {
                const catalogTool = MCPToolCatalog.findTool(server.name, tool.name, [server]);
                const candidate = {
                    kind: 'mcp',
                    server: server.name,
                    id: `${server.name}/${tool.name}`,
                    name: tool.name,
                    description: tool.description || '',
                    inputSchema: tool.inputSchema || tool.schema || null,
                    example: catalogTool?.example || MCPToolCatalog.buildActionExample(server.name, tool.name, tool.inputSchema || tool.schema || {}),
                    content: `${server.name} ${serverDesc} ${tool.name} ${tool.description || ''}`,
                    score: 0,
                };
                candidate.score = scoreCandidate(query, candidate);
                mcpTools.push(candidate);
            }
        }

        const filteredMcpTools = this.policy.filter(query, mcpTools)
            .sort((a, b) => b.score - a.score);

        return {
            skills,
            mcpTools: filteredMcpTools.slice(0, maxMcpTools),
            activeScene: this.activeScene,
        };
    }

    buildRoutingHint(query, options = {}) {
        const result = this.route(query, options);
        if (result.skills.length === 0 && result.mcpTools.length === 0) return '';

        const lines = [
            '<tool-routing>',
            `[System note: 以下是本輪依使用者訊息自動產生的工具建議。若任務符合，優先使用；若不符合，可以忽略。當工具能取得事實、操作外部系統或執行專門能力時，不要只用文字猜測。Active scene: ${result.activeScene}]`,
        ];

        if (result.skills.length > 0) {
            lines.push('Relevant skills:');
            for (const skill of result.skills) {
                const runtime = skill.hasRuntime ? `action: ${skill.action}` : 'prompt-only';
                const disabled = skill.allowed ? '' : ' (目前 toolset 可能未啟用，必要時請引導切換 toolset)';
                const policy = skill.policy ? ` [${skill.policy.strength}; risk=${skill.policy.risk}${skill.policy.requiresConfirmation ? '; confirm first' : ''}]` : '';
                lines.push(`- ${skill.id}: ${runtime}. ${skill.description || skill.name}${disabled}${policy}`);
            }
        }

        if (result.mcpTools.length > 0) {
            lines.push('Relevant MCP tools:');
            for (const tool of result.mcpTools) {
                const schemaSummary = summarizeSchema(tool.inputSchema);
                const policy = tool.policy ? ` [${tool.policy.strength}; risk=${tool.policy.risk}${tool.policy.requiresConfirmation ? '; confirm first' : ''}]` : '';
                lines.push(`- mcp_call server="${tool.server}" tool="${tool.name}": ${tool.description || 'no description'}${schemaSummary ? ` (${schemaSummary})` : ''}${policy}`);
                lines.push(`  Use this exact action shape:\n  ${compactJson(tool.example)}`);
            }
        }

        lines.push('Decision rules:');
        lines.push(...this.policy.buildRules());
        lines.push('- 若推薦工具不足以完成任務，先用可用工具探測，不要杜撰不存在的工具。');
        lines.push('</tool-routing>');
        return lines.join('\n');
    }
}

module.exports = ToolRouter;
