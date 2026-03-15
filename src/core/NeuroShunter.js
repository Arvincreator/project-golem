const ResponseParser = require('../utils/ResponseParser');
const SecurityManager = require('../managers/SecurityManager');

// Graph RAG client for knowledge building
let aragClient = null;
try {
    const AragClient = require('../services/AragClient');
    aragClient = new AragClient();
} catch (e) { }
const MultiAgentHandler = require('./action_handlers/MultiAgentHandler');
const SkillHandler = require('./action_handlers/SkillHandler');
const CommandHandler = require('./action_handlers/CommandHandler');

// ============================================================
// NeuroShunter v10.0 — Level-aware dispatch + confidence check
// ============================================================
class NeuroShunter {
    static async dispatch(ctx, rawResponse, brain, controller, options = {}) {
        const parsed = ResponseParser.parse(rawResponse);
        let shouldSuppressReply = options.suppressReply === true;
        const consoleMode = process.env.TELEGRAM_MODE === 'console';

        // Detect [INTERVENE] for observer mode self-intervention
        if (rawResponse.includes('[INTERVENE]')) {
            console.log(`[NeuroShunter] AI self-intervention detected [INTERVENE]`);
            shouldSuppressReply = false;
        }

        if (parsed.reply && parsed.reply.includes('[INTERVENE]')) {
            parsed.reply = parsed.reply.replace(/\[INTERVENE\]/g, '').trim();
        }

        // ═══ Cross-validate action level with SecurityManager ═══
        if (parsed.actions.length > 0) {
            const security = new SecurityManager();
            for (const act of parsed.actions) {
                const cmd = act.parameter || act.cmd || act.command || '';
                if (cmd) {
                    const assessment = security.assess(cmd);
                    // Use the MORE restrictive level (AI cannot downgrade risk)
                    const escalated = SecurityManager.maxLevel(parsed.actionLevel, assessment.level);
                    if (escalated !== parsed.actionLevel) {
                        console.log(`[NeuroShunter] Level escalation: AI=${parsed.actionLevel} → SecurityManager=${assessment.level} → using ${escalated}`);
                        parsed.actionLevel = escalated;
                    }
                }
            }
        }

        // 1. Handle memory write
        if (parsed.memory) {
            const confTag = parsed.memoryConfidence !== null ? ` (confidence: ${parsed.memoryConfidence})` : '';
            console.log(`[GOLEM_MEMORY]${confTag}\n${parsed.memory}`);
            await brain.memorize(parsed.memory, {
                type: 'fact',
                timestamp: Date.now(),
                confidence: parsed.memoryConfidence
            });
        }

        // 2. Handle reply
        if (parsed.reply && !shouldSuppressReply) {
            let finalReply = parsed.reply;

            // Console mode: strip excessive emoji and filler phrases
            if (consoleMode) {
                // Remove consecutive emoji (keep at most 1 per segment)
                finalReply = finalReply.replace(/([\u{1F600}-\u{1F9FF}\u{1F300}-\u{1F5FF}\u{2600}-\u{27BF}\u{1F680}-\u{1F6FF}])\s*([\u{1F600}-\u{1F9FF}\u{1F300}-\u{1F5FF}\u{2600}-\u{27BF}\u{1F680}-\u{1F6FF}])+/gu, '$1');
                // Remove common filler
                finalReply = finalReply.replace(/^(好的[！!，,]?\s*|了解[！!，,]?\s*|沒問題[！!，,]?\s*|收到[！!，,]?\s*)/gm, '');
                finalReply = finalReply.trim();
            }

            // Low confidence warning
            if (parsed.replyConfidence !== null && parsed.replyConfidence < 0.3) {
                console.warn(`[NeuroShunter] Low confidence reply (${parsed.replyConfidence})`);
                if (!finalReply.includes('不確定') && !finalReply.includes('需要確認')) {
                    finalReply += '\n\n[Low confidence — verification recommended]';
                }
            }

            // Validate source citations
            if (parsed.replySources && parsed.replySources.length > 0) {
                const validSources = ['memory', 'rag', 'system', 'user', 'user_provided', 'graph-rag', 'local'];
                const invalid = parsed.replySources.filter(s => !validSources.includes(s));
                if (invalid.length > 0) {
                    console.warn(`[NeuroShunter] Invalid source citations: ${invalid.join(', ')}`);
                }
            }

            if (ctx.platform === 'telegram' && ctx.shouldMentionSender) {
                finalReply = `${ctx.senderMention} ${finalReply}`;
            }
            console.log(`[Golem] ${finalReply.substring(0, 200)}`);

            // Log AI response
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

            // Auto-push to Graph RAG (fire-and-forget)
            if (aragClient && finalReply.length > 20) {
                aragClient.ingest({
                    type: 'conversation',
                    source: 'rendan',
                    content: finalReply.substring(0, 500),
                    metadata: {
                        golemId: brain ? brain.golemId : 'unknown',
                        model: brain && brain.apiClient ? brain.apiClient.getModel() : 'unknown',
                        confidence: parsed.replyConfidence,
                        sources: parsed.replySources,
                        timestamp: Date.now(),
                    }
                }).catch(() => {});
            }
        } else if (parsed.reply && shouldSuppressReply) {
            console.log(`[NeuroShunter] Silent mode — reply suppressed`);
        }

        // 3. Handle actions (level-aware routing)
        if (parsed.actions.length > 0 && !shouldSuppressReply) {
            console.log(`[GOLEM_ACTION] level=${parsed.actionLevel} count=${parsed.actions.length}`);
            const normalActions = [];

            for (const act of parsed.actions) {
                switch (act.action) {
                    case 'multi_agent':
                        await MultiAgentHandler.execute(ctx, act, controller, brain);
                        break;
                    default:
                        const isSkillHandled = await SkillHandler.execute(ctx, act, brain);
                        if (!isSkillHandled) {
                            normalActions.push(act);
                        }
                        break;
                }
            }

            // Execute remaining shell commands through TaskController (L0-L3 aware)
            if (normalActions.length > 0) {
                await CommandHandler.execute(ctx, normalActions, controller, brain, (c, r, b, ctrl) => NeuroShunter.dispatch(c, r, b, ctrl, options));
            }
        } else if (parsed.actions.length > 0 && shouldSuppressReply) {
            console.log(`[NeuroShunter] Silent mode — ${parsed.actions.length} actions skipped`);
        }
    }
}

module.exports = NeuroShunter;
