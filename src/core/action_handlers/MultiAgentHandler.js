class MultiAgentHandler {
    static async execute(ctx, act, controller, brain) {
        // ✨ [v9.0] 處理多 Agent 請求
        await controller._handleMultiAgent(ctx, act, brain);
    }
}

module.exports = MultiAgentHandler;
