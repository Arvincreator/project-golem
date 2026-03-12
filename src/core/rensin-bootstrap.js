// ============================================================
// 🚀 Rensin Bootstrap — 非侵入式掛載 YEDAN 整合 + 回調路由
// 在 index.js 載入後自動 monkey-patch callback handler
// ============================================================

const RensinCallbackRouter = require('./RensinCallbackRouter');

let _patched = false;

function patchCallbackHandler() {
    if (_patched) return;

    // 等待 global.handleUnifiedCallback 被設定
    const checkInterval = setInterval(() => {
        if (typeof global.handleUnifiedCallback === 'function' && !_patched) {
            const originalHandler = global.handleUnifiedCallback;

            global.handleUnifiedCallback = async function (ctx, actionData, forceTargetId) {
                // 先檢查是否是 Rensin 主控台回調
                if (actionData && actionData.startsWith('RENSIN_')) {
                    try {
                        // 取得 brain
                        const { activeGolems, getOrCreateGolem } = require('../../index');
                        const targetId = forceTargetId || 'golem_A';
                        const instance = activeGolems.get(targetId) || getOrCreateGolem(targetId);
                        const brain = instance.brain;

                        const handled = await RensinCallbackRouter.handle(ctx, actionData, brain);
                        if (handled) return;
                    } catch (e) {
                        console.error('[RensinBootstrap] Callback intercept error:', e.message);
                    }
                }

                // 走原有流程
                return originalHandler(ctx, actionData, forceTargetId);
            };

            _patched = true;
            console.log('🎮 [RensinBootstrap] Callback interceptor installed');
            clearInterval(checkInterval);
        }
    }, 1000);

    // 30秒後停止檢查
    setTimeout(() => clearInterval(checkInterval), 30000);
}

module.exports = { patchCallbackHandler };
