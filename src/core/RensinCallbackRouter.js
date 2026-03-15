// ============================================================
// 🎮 Rensin Callback Router — 攔截 RENSIN_ 前綴的 inline keyboard 回調
// 在 index.js 的 handleUnifiedCallback 之前攔截
// ============================================================

const NodeRouter = require('./NodeRouter');

class RensinCallbackRouter {
    /**
     * 嘗試處理 RENSIN_ 開頭的 callback_data
     * @returns {boolean} true = 已處理, false = 繼續原有流程
     */
    static async handle(ctx, actionData, brain) {
        if (!actionData || !actionData.startsWith('RENSIN_')) return false;

        const cmd = actionData.replace('RENSIN_', '');
        console.log(`🎮 [RensinCallback] 處理: ${cmd}`);

        try {
            const reply = async (message, options = {}) => {
                await ctx.reply(message, options);
                return message;
            };

            await NodeRouter._handleRensinCallback(ctx, brain, cmd, reply, false);
        } catch (e) {
            console.error(`❌ [RensinCallback] 錯誤:`, e.message);
            try { await ctx.reply(`❌ 執行失敗: ${e.message}`); } catch (e2) { console.warn('[RensinCallbackRouter] Failed to send error reply:', e2.message); }
        }
        return true;
    }
}

module.exports = RensinCallbackRouter;
