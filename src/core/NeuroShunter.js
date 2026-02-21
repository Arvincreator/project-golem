const ResponseParser = require('../utils/ResponseParser');
const ScheduleHandler = require('./action_handlers/ScheduleHandler');
const MultiAgentHandler = require('./action_handlers/MultiAgentHandler');
const SkillHandler = require('./action_handlers/SkillHandler');
const CommandHandler = require('./action_handlers/CommandHandler');

// ============================================================
// 🧬 NeuroShunter (神經分流中樞 - 核心路由器)
// ============================================================
class NeuroShunter {
    static async dispatch(ctx, rawResponse, brain, controller) {
        const parsed = ResponseParser.parse(rawResponse);

        // 1. 處理長期記憶寫入
        if (parsed.memory) {
            console.log(`🧠 [Memory] 寫入: ${parsed.memory.substring(0, 20)}...`);
            await brain.memorize(parsed.memory, { type: 'fact', timestamp: Date.now() });
        }

        // 2. 處理直接回覆
        if (parsed.reply) {
            await ctx.reply(parsed.reply);
        }

        // 3. 處理結構化 Action 分配 (Strategy Pattern)
        if (parsed.actions.length > 0) {
            const normalActions = [];

            for (const act of parsed.actions) {
                switch (act.action) {
                    case 'schedule':
                        await ScheduleHandler.execute(ctx, act, brain);
                        break;
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

            // 4. 處理剩餘的終端指令序列並自動啟動回饋循環 (Feedback Loop)
            if (normalActions.length > 0) {
                await CommandHandler.execute(ctx, normalActions, controller, brain, this.dispatch.bind(this));
            }
        }
    }
}

module.exports = NeuroShunter;
