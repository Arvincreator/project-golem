const SOPMultiAgent = require('../SOPMultiAgent');

class MultiAgentHandler {
    static async execute(ctx, act, controller, brain) {
        // Phase 4A: SOP preset routing
        const enableSOP = process.env.ENABLE_SOP_AGENTS === 'true';
        if (enableSOP && act.sop_preset) {
            const validPresets = Object.keys(SOPMultiAgent.PRESETS);
            const preset = act.sop_preset.toUpperCase();
            if (validPresets.includes(preset)) {
                console.log(`[MultiAgentHandler] SOP mode: ${preset}`);
                const sopAgent = new SOPMultiAgent(brain, { golemId: act.golemId });
                await sopAgent.run(ctx, act.task || act.goal || '', preset);
                return;
            } else {
                console.warn(`[MultiAgentHandler] Unknown SOP preset: ${act.sop_preset}. Available: ${validPresets.join(', ')}`);
            }
        }

        // Default: delegate to controller's multi-agent handler
        await controller._handleMultiAgent(ctx, act, brain);
    }
}

module.exports = MultiAgentHandler;
