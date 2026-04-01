class CommandHandler {
    static async execute(ctx, normalActions, controller, brain, dispatchFn) {
        if (!normalActions || normalActions.length === 0) return;

        // ✨ [v9.1] 整合行動產線：將一般任務執行丟入 ActionQueue
        // 注意：這裡假設我們從某處能取得與本回合指令對應的 actionQueue 和 convoManager
        // 為了最小侵入性，我們透過 brain 物件往上追溯，或在 Golem 架構中取得
        let actionQueue = null;
        let convoManager = null;

        try {
            const getOrCreate =
                (typeof global.getOrCreateGolem === 'function' && global.getOrCreateGolem) ||
                require('../../../index').getOrCreateGolem;
            const instance = getOrCreate(controller.golemId);
            actionQueue = instance.actionQueue;
            convoManager = instance.convoManager;
        } catch (e) {
            console.warn('[CommandHandler] 無法取得雙產線系統，退回單產線模式', e.message);
        }

        const runLogic = async () => {
            let result;
            try {
                result = await controller.runSequence(ctx, normalActions, 0, {
                    actor: (ctx && ctx.senderName) || 'system',
                    source: 'command_handler',
                });
            } catch (err) {
                console.error('[CommandHandler] runSequence 拋出例外:', err);
                await ctx.reply(`❌ **指令執行失敗**\n\`\`\`\n${err.message}\n\`\`\``, { parse_mode: 'Markdown' });
                return;
            }

            if (!result) return;

            // 1. 處理需要外部審批的情況
            if (typeof result === 'object') {
                if (result.status === 'PENDING_APPROVAL') {
                    if (result.approvalPromptSent === true) {
                        return;
                    }
                    const cmdBlock = result.cmd ? `\n\`\`\`shell\n${result.cmd}\n\`\`\`` : "";
                    await ctx.reply(
                        `⚠️ ${result.riskLevel === 'DANGER' ? '🔴 危險指令' : '🟡 警告'}${cmdBlock}\n\n${result.reason}`,
                        {
                            parse_mode: 'Markdown',
                            disable_web_page_preview: true,
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '✅ 批准', callback_data: `APPROVE_${result.approvalId}` },
                                    { text: '❌ 拒絕', callback_data: `DENY_${result.approvalId}` }
                                ]]
                            }
                        }
                    );
                    return;
                } else {
                    console.warn('[CommandHandler] 未知的 Object 回傳狀態:', result);
                    return;
                }
            }

            // 2. 處理正常的執行回報 (String Observation)
            if (typeof result === 'string') {
                const failedSteps = result
                    .split('\n\n----------------\n\n')
                    .filter(block => block.includes('[Step') && block.includes(' Failed]'));

                if (failedSteps.length > 0) {
                    const errorSummary = failedSteps.map(block => {
                        const cmdMatch = block.match(/cmd:\s*(.+)/);
                        const errMatch = block.match(/Error:\n([\s\S]+)/);
                        const cmd = cmdMatch ? cmdMatch[1].trim() : '（未知指令）';
                        const errMsg = errMatch ? errMatch[1].trim().slice(0, 300) : block.trim().slice(0, 300);
                        return `🔴 \`${cmd}\`\n\`\`\`\n${errMsg}\n\`\`\``;
                    }).join('\n\n');

                    await ctx.reply(
                        `❌ **指令執行失敗 (${failedSteps.length} 個步驟)**\n\n${errorSummary}`,
                        { parse_mode: 'Markdown' }
                    );
                }

                // 無論成功或失敗，都將完整觀察結果送給大腦分析（讓 AI 知道發生什麼事並作出回應）
                if (ctx.sendTyping) await ctx.sendTyping();
                const feedbackPrompt = `[System Observation]\n${result}\n\nPlease reply to user naturally using [GOLEM_REPLY].`;

                // ✨ [v9.1] 產線串接：將 Observation 放入對話產線
                if (convoManager) {
                    const isAuto = process.env.GOLEM_AUTO_APPROVE_ALL === 'true';
                    const isSilent = process.env.GOLEM_SILENT_AUTO_APPROVE === 'true';
                    const feedbackOptions = { 
                        isPriority: true, 
                        bypassDebounce: true,
                        isSystemFeedback: true, // 🎯 [v9.1.15] Mark as system feedback for turn tracking
                        suppressReply: isAuto && isSilent // 🎯 [v9.1.13] 全自動且靜默時，隱藏中間過程
                    };
                    await convoManager.enqueue(ctx, feedbackPrompt, feedbackOptions);
                } else {
                    // Fallback 對話發送
                    const finalRes = await brain.sendMessage(feedbackPrompt);
                    await dispatchFn(ctx, finalRes, brain, controller);
                }
            }
        };

        if (actionQueue) {
            // ✨ [v9.1] 由於 DialogueQueue 已建立插隊防護，直接正常排隊即可
            await actionQueue.enqueue(ctx, runLogic, { isPriority: false });
        } else {
            // 退火單產線執行
            await runLogic();
        }
    }
}

module.exports = CommandHandler;
