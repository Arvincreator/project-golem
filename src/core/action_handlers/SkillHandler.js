const skillManager = require('../../managers/SkillManager');
const MCPManager   = require('../../mcp/MCPManager');
const ResponseParser = require('../../utils/ResponseParser');

const RELAY_TO_BRAIN_SKILLS = new Set(['opencli_search']);
const RELAY_TO_BRAIN_ACTIONS = new Set(['mcp_call']);
const MAX_RESULT_LENGTH = 3800;
const MAX_OBSERVATION_LENGTH = Number(process.env.GOLEM_SKILL_OBSERVATION_MAX_CHARS || 12000);

function toDisplayResult(result) {
    const text = String(result || '');
    return text.length > MAX_RESULT_LENGTH
        ? text.slice(0, MAX_RESULT_LENGTH) + '\n...(已截斷)'
        : text;
}

function toObservationText(result) {
    const text = String(result || '');
    return text.length > MAX_OBSERVATION_LENGTH
        ? text.slice(0, MAX_OBSERVATION_LENGTH) + '\n...(Observation 已截斷)'
        : text;
}

function extractResponseText(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return String(raw.text || '');
    }
    return String(raw || '');
}

function extractAttachments(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.attachments)) {
        return raw.attachments;
    }
    return [];
}

async function relaySkillResultToBrain(ctx, brain, skillName, result) {
    if (!brain || typeof brain.sendMessage !== 'function') return false;

    const feedbackPrompt = [
        '[System Observation]',
        `來源技能: ${skillName}`,
        toObservationText(result),
        '',
        '請根據以上 Observation 回覆使用者。',
        '請輸出 [GOLEM_REPLY]。除非使用者明確要求，否則不要再輸出 [GOLEM_ACTION]。'
    ].join('\n');

    const brainRaw = await brain.sendMessage(feedbackPrompt);
    const responseText = extractResponseText(brainRaw);
    const parsed = ResponseParser.parse(responseText);
    const finalReply = parsed.reply || responseText;

    if (!finalReply) return true;

    const attachments = extractAttachments(brainRaw);
    if (attachments.length > 0) {
        await ctx.reply(finalReply, { attachments });
    } else {
        await ctx.reply(finalReply);
    }

    return true;
}

function formatMcpResult(result) {
    if (result && result.content && Array.isArray(result.content)) {
        return result.content
            .map(c => c.type === 'text' ? c.text : JSON.stringify(c))
            .join('\n');
    }
    return JSON.stringify(result, null, 2);
}

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

                let displayResult = formatMcpResult(result);
                displayResult = toDisplayResult(displayResult);

                const shouldRelayAction = RELAY_TO_BRAIN_ACTIONS.has(act.action);
                if (shouldRelayAction) {
                    const observation = [
                        `Server: ${server}`,
                        `Tool: ${tool}`,
                        `Parameters: ${JSON.stringify(parameters || {})}`,
                        'Result:',
                        displayResult,
                    ].join('\n');
                    try {
                        await relaySkillResultToBrain(ctx, brain, `mcp_call:${server}/${tool}`, observation);
                    } catch (e) {
                        console.warn(`[SkillHandler] relay mcp_call ${server}/${tool} result to brain failed: ${e.message}`);
                        await ctx.reply(`✅ [MCP:${server}/${tool}]\n${displayResult}`);
                    }
                } else {
                    await ctx.reply(`✅ [MCP:${server}/${tool}]\n${displayResult}`);
                }
            } catch (e) {
                await ctx.reply(`❌ [MCP] 執行錯誤: ${e.message}`);
            }
            return true;
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
                    const shouldRelay = RELAY_TO_BRAIN_SKILLS.has(dynamicSkill.name);
                    if (shouldRelay) {
                        try {
                            await relaySkillResultToBrain(ctx, brain, dynamicSkill.name, result);
                        } catch (e) {
                            // 降級：若二次回灌失敗，仍把技能結果直接回給使用者，避免無回覆
                            console.warn(`[SkillHandler] relay ${dynamicSkill.name} result to brain failed: ${e.message}`);
                            const displayResult = toDisplayResult(result);
                            await ctx.reply(`✅ 技能回報: ${displayResult}`);
                        }
                    } else {
                        const displayResult = toDisplayResult(result);
                        await ctx.reply(`✅ 技能回報: ${displayResult}`);
                    }
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
