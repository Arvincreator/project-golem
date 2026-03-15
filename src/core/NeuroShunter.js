const ResponseParser = require('../utils/ResponseParser');
const MultiAgentHandler = require('./action_handlers/MultiAgentHandler');
const SkillHandler = require('./action_handlers/SkillHandler');
const CommandHandler = require('./action_handlers/CommandHandler');

// ============================================================
// 🧬 NeuroShunter (神經分流中樞 - 核心路由器)
// ============================================================
class NeuroShunter {
    static async dispatch(ctx, rawResponse, brain, controller, options = {}) {
        const parsed = ResponseParser.parse(rawResponse);
        let shouldSuppressReply = options.suppressReply === true;

        // 核心：偵測 [INTERVENE] 標籤以實現觀察者模式自主介入
        if (rawResponse.includes('[INTERVENE]')) {
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

            // ✨ [v9.0.9] 信心等級顯示 (from XML protocol or RAG confidence)
            if (parsed.confidence && parsed.confidence !== 'HIGH') {
                const badge = parsed.confidence === 'MEDIUM' ? '🟡' : '🔴';
                finalReply += `\n${badge} 信心: ${parsed.confidence}`;
            }
            if (parsed.sources && parsed.sources.length > 0) {
                finalReply += parsed.confidence ? ` (${parsed.sources.join('+')})` : '';
            }

            if (ctx.platform === 'telegram' && ctx.shouldMentionSender) {
                finalReply = `${ctx.senderMention} ${finalReply}`;
            }
            console.log(`🤖 [Golem] 說: ${finalReply}`);

            // ✨ [Log] 記錄 AI 回應
            if (brain && typeof brain._appendChatLog === 'function') {
                brain._appendChatLog({
                    sender: 'Golem',
                    content: finalReply,
                    type: 'ai',
                    role: 'Assistant',
                    isSystem: false
                });
            }

            await ctx.reply(finalReply);

            // Auto-push AI response to RAG (fire-and-forget)
            try {
                const endpoints = require('../config/endpoints');
                if (endpoints.RAG_URL) {
                    const { getToken } = require('../utils/yedan-auth');
                    const token = getToken();
                    if (token) {
                        fetch(`${endpoints.RAG_URL}/ingest`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                            body: JSON.stringify({
                                entities: [{
                                    id: `reply_${Date.now()}`,
                                    type: 'golem_reply',
                                    name: finalReply.substring(0, 50),
                                    properties: { content: finalReply.substring(0, 300), timestamp: new Date().toISOString() }
                                }]
                            }),
                            signal: AbortSignal.timeout(5000)
                        }).catch(() => {}); // fire-and-forget
                    }
                }
            } catch (e) { /* non-blocking */ }
        } else if (parsed.reply && shouldSuppressReply) {
            console.log(`🤫 [NeuroShunter] 檢測到靜默模式，已攔截回覆內容。`);
        }

        // 2. 處理結構化 Action 分配 (讓批准視窗在回覆之後彈出)
        if (parsed.actions.length > 0 && !shouldSuppressReply) {
            console.log(`[GOLEM_ACTION]\n${JSON.stringify(parsed.actions, null, 2)}`);
            const normalActions = [];

            for (const act of parsed.actions) {
                switch (act.action) {
                    case 'abort':
                        // AI explicitly requests to stop the current action chain
                        console.log(`[NeuroShunter] 🛑 AI requested abort: ${act.reason || 'No reason given'}`);
                        if (act.reason && !shouldSuppressReply) {
                            await ctx.reply(`⚠️ ${act.reason}`);
                        }
                        return; // Stop processing ALL remaining actions
                    case 'noop':
                        // AI explicitly signals no action needed
                        console.log(`[NeuroShunter] ⏭️ AI signaled noop, skipping.`);
                        continue;
                    case 'multi_agent':
                        await MultiAgentHandler.execute(ctx, act, controller, brain);
                        break;
                    default:
                        // 檢查是否為動態擴充技能
                        const isSkillHandled = await SkillHandler.execute(ctx, act, brain);
                        if (!isSkillHandled) {
                            // 若不是已知框架 Action 且非動態技能，則視為底層 Shell 指令
                            normalActions.push(act);
                        }
                        break;
                }
            }

            // 處理剩餘的終端指令序列並自動啟動回饋循環 (Feedback Loop)
            if (normalActions.length > 0) {
                await CommandHandler.execute(ctx, normalActions, controller, brain, (c, r, b, ctrl) => this.dispatch(c, r, b, ctrl, options));
            }
        } else if (parsed.actions.length > 0 && shouldSuppressReply) {
            console.log(`🤫 [NeuroShunter] 靜默模式，跳過 ${parsed.actions.length} 個 Action 的執行。`);
        }
    }
}

module.exports = NeuroShunter;
