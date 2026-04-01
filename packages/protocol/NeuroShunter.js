const ResponseParser = require('../../src/utils/ResponseParser');
const SkillHandler = require('../../src/core/action_handlers/SkillHandler');
const CommandHandler = require('../../src/core/action_handlers/CommandHandler');
const TaskActionHandler = require('../../src/core/action_handlers/TaskActionHandler');
const AgentActionHandler = require('../../src/core/action_handlers/AgentActionHandler');

function summarizeActions(actions = []) {
    if (!Array.isArray(actions) || actions.length === 0) return '- (none)';
    const counts = {};
    for (const act of actions) {
        const name = String(act && act.action ? act.action : 'unknown').trim().toLowerCase() || 'unknown';
        counts[name] = Number(counts[name] || 0) + 1;
    }
    return Object.entries(counts)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, count]) => `- ${name} x${count}`)
        .join('\n');
}

// ============================================================
// 🧬 NeuroShunter (神經分流中樞 - 核心路由器)
// ============================================================
class NeuroShunter {
    static async dispatch(ctx, rawResponse, brain, controller, options = {}) {
        let textToParse = rawResponse;
        let attachments = options.attachments || [];

        // 📥 [v9.1.10] 支援結構化回應物件 { text, attachments }
        if (rawResponse && typeof rawResponse === 'object' && !Array.isArray(rawResponse)) {
            textToParse = rawResponse.text || "";
            attachments = [...attachments, ...(rawResponse.attachments || [])];
        }

        const parsed = ResponseParser.parse(textToParse);
        let shouldSuppressReply = options.suppressReply === true;

        // 🎯 [v9.1.13] 靜默模式自癒：如果沒有後續動作 (Action)，代表任務結束，強制解除靜默以顯示最終回覆
        if (shouldSuppressReply && parsed.actions.length === 0) {
            console.log(`📢 [NeuroShunter] 偵測到任務結束或無後續動作，自動解除靜默模式。`);
            shouldSuppressReply = false;
        }

        // 核心：偵測 [INTERVENE] 標籤以實現觀察者模式自主介入
        if (textToParse.includes('[INTERVENE]')) {
            console.log(`🚀 [NeuroShunter] 偵測到 AI 自主介入請求 [INTERVENE]！`);
            shouldSuppressReply = false;
        }

        if (parsed.reply && parsed.reply.includes('[INTERVENE]')) {
            parsed.reply = parsed.reply.replace(/\[INTERVENE\]/g, '').trim();
        }

        // 1. 處理長期記憶寫入
        if (parsed.memory) {
            console.log(`[GOLEM_MEMORY]\n${parsed.memory}`);
            await brain.memorize(parsed.memory, { type: 'fact', timestamp: Date.now() });
        }

        // 1. 處理直接回覆 (讓 AI 的解說文字在行動之前出現)
        if (parsed.reply && !shouldSuppressReply) {
            let finalReply = parsed.reply;
            if (ctx.platform === 'telegram' && ctx.shouldMentionSender) {
                finalReply = `${ctx.senderMention} ${parsed.reply}`;
            }
            console.log(`[TERMINAL] 🤖 [Golem] 說: ${finalReply}${attachments.length > 0 ? ' 📎 含有附件' : ''}`);

            // ✨ [Log] 記錄 AI 回應
            if (brain && typeof brain._appendChatLog === 'function') {
                brain._appendChatLog({
                    sender: 'Golem',
                    content: finalReply,
                    type: 'ai',
                    role: 'Assistant',
                    isSystem: false,
                    attachments: attachments
                });
            }

            // 附件處理：若無附件則維持單參數呼叫，相容既有上下文與測試
            if (attachments.length > 0) {
                await ctx.reply(finalReply, { attachments: attachments });
            } else {
                await ctx.reply(finalReply);
            }
        } else if (parsed.reply && shouldSuppressReply) {
            console.log(`🤫 [NeuroShunter] 檢測到靜默模式，已攔截回覆內容。`);
        }

        // 2. 處理結構化 Action 分配 (讓批准視窗在回覆之後彈出)
        if (parsed.actions.length > 0) {
            const debugActionJson = String(process.env.GOLEM_DEBUG_ACTION_JSON || '').trim().toLowerCase() === 'true';
            if (debugActionJson) {
                console.log(`[GOLEM_ACTION] (${shouldSuppressReply ? 'Silent' : 'Normal'})\n${JSON.stringify(parsed.actions, null, 2)}`);
            } else {
                console.log(`[GOLEM_ACTION] (${shouldSuppressReply ? 'Silent' : 'Normal'})\n${summarizeActions(parsed.actions)}`);
            }
            const normalActions = [];

            for (const act of parsed.actions) {
                if (TaskActionHandler.isTaskAction(act.action)) {
                    await TaskActionHandler.execute(ctx, act, controller);
                    continue;
                }

                if (AgentActionHandler.isAgentAction(act.action)) {
                    await AgentActionHandler.execute(ctx, act, controller);
                    continue;
                }

                switch (act.action) {
                    case 'multi_agent':
                        if (controller && typeof controller._handleMultiAgent === 'function') {
                            try {
                                await controller._handleMultiAgent(ctx, act, brain);
                            } catch (legacyError) {
                                const code = legacyError && legacyError.code ? legacyError.code : 'AGENT_PROTOCOL_UNSUPPORTED';
                                const status = Number(legacyError && (legacyError.statusCode || legacyError.status) || 422);
                                console.warn(`[NeuroShunter] legacy multi_agent rejected [${code}] status=${status}: ${legacyError.message}`);
                            }
                        } else {
                            await ctx.reply('❌ [AGENT_PROTOCOL_UNSUPPORTED] multi_agent is removed. Use agent_session_create / agent_worker_spawn / agent_message / agent_wait / agent_stop / agent_list / agent_get / agent_resume.');
                        }
                        break;
                    default:
                        // 檢查是否為動態擴充技能
                        const isSkillHandled = await SkillHandler.execute(ctx, act, brain);
                        if (!isSkillHandled) {
                            // 若不是已知框架 Action 和非動態技能，則視為底層 Shell 指令
                            normalActions.push(act);
                        }
                        break;
                }
            }

            // 處理剩餘的終端指令序列並自動啟動回饋循環 (Feedback Loop)
            if (normalActions.length > 0) {
                await CommandHandler.execute(ctx, normalActions, controller, brain, (c, r, b, ctrl) => this.dispatch(c, r, b, ctrl, options));
            }
        }
    }
}

module.exports = NeuroShunter;
