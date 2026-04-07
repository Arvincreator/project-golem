const skillManager = require('../../managers/SkillManager');
const MCPManager   = require('../../mcp/MCPManager');

class SkillHandler {
    static _extractImplicitMcpParameters(act) {
        const nested = (act && act.parameters && typeof act.parameters === 'object' && !Array.isArray(act.parameters))
            ? act.parameters
            : {};
        const flat = { ...(act || {}) };
        delete flat.action;
        delete flat.server;
        delete flat.tool;
        delete flat.parameters;
        return { ...flat, ...nested };
    }

    static async _resolveImplicitMcpCall(act, mcpManager) {
        const toolName = String((act && act.action) || '').trim();
        if (!toolName || toolName === 'command' || toolName === 'mcp_call') return null;

        const servers = Array.isArray(mcpManager.getServers()) ? mcpManager.getServers() : [];
        for (const serverCfg of servers) {
            if (!serverCfg || serverCfg.enabled === false) continue;
            if (act.server && act.server !== serverCfg.name) continue;

            let tools = Array.isArray(serverCfg.cachedTools) ? serverCfg.cachedTools : [];
            if (serverCfg.connected) {
                try {
                    tools = await mcpManager.listTools(serverCfg.name);
                } catch (_) { /* noop */ }
            }

            if (tools.some((tool) => tool && tool.name === toolName)) {
                return {
                    server: serverCfg.name,
                    tool: toolName,
                    parameters: SkillHandler._extractImplicitMcpParameters(act)
                };
            }
        }

        return null;
    }

    static async _executeMcpCall(ctx, mcpManager, server, tool, parameters = {}) {
        if (!server || !tool) {
            await ctx.reply('❌ mcp_call 缺少必要欄位 server 或 tool');
            return true;
        }

        await ctx.reply(`🔌 [MCP] 調用 **${server}** → **${tool}**...`);
        try {
            const result = await mcpManager.callTool(server, tool, parameters);

            // 格式化結果
            let displayResult = '';
            if (result && result.content && Array.isArray(result.content)) {
                displayResult = result.content
                    .map(c => c.type === 'text' ? c.text : JSON.stringify(c))
                    .join('\n');
            } else {
                displayResult = JSON.stringify(result, null, 2);
            }

            const MAX_LEN = 3800;
            if (displayResult.length > MAX_LEN) {
                displayResult = displayResult.slice(0, MAX_LEN) + '\n...(已截斷)';
            }
            await ctx.reply(`✅ [MCP:${server}/${tool}]\n${displayResult}`);
        } catch (e) {
            await ctx.reply(`❌ [MCP] 執行錯誤: ${e.message}`);
        }
        return true;
    }

    static async execute(ctx, act, brain) {
        const mcpManager = MCPManager.getInstance();

        // ─── MCP Tool Call ─────────────────────────────────────────────
        if (act.action === 'mcp_call') {
            const { server, tool, parameters = {} } = act;
            await mcpManager.load(); // 確保 servers 已連線（load 內部有冪等保護）
            return await SkillHandler._executeMcpCall(ctx, mcpManager, server, tool, parameters);
        }

        // ─── Dynamic Skills ────────────────────────────────────────────
        const skillName = act.action;
        const dynamicSkill = skillManager.getSkill(skillName);

        if (dynamicSkill) {
            await ctx.reply(`🔌 執行技能: **${dynamicSkill.name}**...`);
            try {
                const result = await dynamicSkill.run({
                    page: brain.page,
                    browser: brain.browser,
                    brain: brain,
                    log: console,
                    io: { ask: (q) => ctx.reply(q) },
                    args: act
                });
                // ✅ [L-3 Fix] 截斷過長回傳，避免超過 Telegram 4096 字元上限
                if (result) {
                    const MAX_RESULT_LENGTH = 3800;
                    const displayResult = result.length > MAX_RESULT_LENGTH
                        ? result.slice(0, MAX_RESULT_LENGTH) + '\n...(已截斷)'
                        : result;
                    await ctx.reply(`✅ 技能回報: ${displayResult}`);
                }
            } catch (e) {
                await ctx.reply(`❌ 技能執行錯誤: ${e.message}`);
            }
            return true; // Indicates the skill was handled
        }

        // ─── Implicit MCP Tool Call ───────────────────────────────────
        // 允許 AI 直接輸出 {"action":"mempalace_status"}，自動路由至 mcp_call
        await mcpManager.load();
        const implicitMcp = await SkillHandler._resolveImplicitMcpCall(act, mcpManager);
        if (implicitMcp) {
            return await SkillHandler._executeMcpCall(
                ctx,
                mcpManager,
                implicitMcp.server,
                implicitMcp.tool,
                implicitMcp.parameters
            );
        }

        return false; // Not a dynamic skill, indicates pass-through
    }
}

module.exports = SkillHandler;
