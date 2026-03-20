const skillManager  = require('../../managers/SkillManager');
const MCPManager    = require('../../mcp/MCPManager');
const CodexHandler  = require('./CodexHandler');

class SkillHandler {
    static async execute(ctx, act, brain) {
        // ─── MCP Tool Call ─────────────────────────────────────────────
        if (act.action === 'mcp_call') {
            const { server, tool, parameters = {} } = act;
            if (!server || !tool) {
                await ctx.reply(`❌ mcp_call 缺少必要欄位 server 或 tool`);
                return true;
            }
            await ctx.reply(`🔌 [MCP] 調用 **${server}** → **${tool}**...`);
            try {
                const mcpManager = MCPManager.getInstance();
                await mcpManager.load();   // 確保 servers 已連線（load 內部有冪等保護）
                const result     = await mcpManager.callTool(server, tool, parameters);

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

        // ─── Codex Sub-Agent ──────────────────────────────────────────────
        if (act.action === 'codex_task') {
            return await CodexHandler.execute(ctx, act);
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
        return false; // Not a dynamic skill, indicates pass-through
    }
}

module.exports = SkillHandler;
