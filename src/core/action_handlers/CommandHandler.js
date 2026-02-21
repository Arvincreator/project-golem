class CommandHandler {
    static async execute(ctx, normalActions, controller, brain, dispatchFn) {
        if (!normalActions || normalActions.length === 0) return; // 提早結束，減少巢狀深度

        const result = await controller.runSequence(ctx, normalActions);
        if (!result) return;

        // 1. 處理需要外部審批的情況
        if (typeof result === 'object') {
            if (result.status === 'PENDING_APPROVAL') {
                await ctx.reply(
                    `⚠️ ${result.riskLevel === 'DANGER' ? '🔴 危險指令' : '🟡 警告'}\n\`${result.cmd}\`\n${result.reason}`,
                    {
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '✅ 批准', callback_data: `APPROVE_${result.approvalId}` },
                                { text: '❌ 拒絕', callback_data: `DENY_${result.approvalId}` }
                            ]]
                        }
                    }
                );
                return; // 等待使用者點擊按鈕，流程中斷
            } else {
                // 防呆：如果未來有其他 object 狀態，可以在這裡 log，避免安靜失敗
                console.warn('[CommandHandler] 未知的 Object 回傳狀態:', result);
                return;
            }
        }

        // 2. 處理正常的執行回報 (String Observation)
        if (typeof result === 'string') {
            if (ctx.sendTyping) await ctx.sendTyping();
            const feedbackPrompt = `[System Observation]\n${result}\n\nPlease reply to user naturally using [GOLEM_REPLY].`;
            const finalRes = await brain.sendMessage(feedbackPrompt);
            await dispatchFn(ctx, finalRes, brain, controller);
        }
    }
}

module.exports = CommandHandler;