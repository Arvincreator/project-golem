const { v4: uuidv4 } = require('uuid');
const Executor = require('./Executor');
const SecurityManager = require('../managers/SecurityManager');
const ToolScanner = require('../managers/ToolScanner');
const InteractiveMultiAgent = require('./InteractiveMultiAgent');

// ============================================================
// ⚡ Task Controller (閉環回饋版)
// ============================================================
class TaskController {
    constructor() {
        this.executor = new Executor();
        this.security = new SecurityManager();
        this.multiAgent = null; // ✨ [v9.0]
        this.pendingTasks = new Map(); // Moved from global to here
    }

    // ✨ [v9.0] 處理多 Agent 請求
    async _handleMultiAgent(ctx, action, brain) {
        try {
            if (!this.multiAgent) {
                this.multiAgent = new InteractiveMultiAgent(brain);
            }
            const presetName = action.preset || 'TECH_TEAM';
            const agentConfigs = InteractiveMultiAgent.PRESETS[presetName];
            if (!agentConfigs) {
                const available = Object.keys(InteractiveMultiAgent.PRESETS).join(', ');
                await ctx.reply(`⚠️ 未知團隊: ${presetName}。可用: ${available}`);
                return;
            }
            const task = action.task || '討論專案';
            const options = { maxRounds: action.rounds || 3 };
            await this.multiAgent.startConversation(ctx, task, agentConfigs, options);
        } catch (e) {
            console.error('[TaskController] MultiAgent 執行失敗:', e);
            await ctx.reply(`❌ 執行失敗: ${e.message}`);
        }
    }

    async runSequence(ctx, steps, startIndex = 0) {
        let reportBuffer = [];
        for (let i = startIndex; i < steps.length; i++) {
            const step = steps[i];
            const cmdToRun = step.cmd || step.parameter || step.command || "";
            const risk = this.security.assess(cmdToRun);
            if (cmdToRun.startsWith('golem-check')) {
                const toolName = cmdToRun.split(' ')[1];
                reportBuffer.push(toolName ? `🔍 [ToolCheck] ${ToolScanner.check(toolName)}` : `⚠️ 缺少參數`);
                continue;
            }
            if (risk.level === 'BLOCKED') return `⛔ 指令被系統攔截：${cmdToRun}`;
            if (risk.level === 'WARNING' || risk.level === 'DANGER') {
                const approvalId = uuidv4();
                this.pendingTasks.set(approvalId, {
                    steps, nextIndex: i, ctx, timestamp: Date.now()
                });
                await ctx.reply(
                    `⚠️ ${risk.level === 'DANGER' ? '🔴 危險指令' : '🟡 警告'}\n\`${cmdToRun}\`\n${risk.reason}`,
                    {
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '✅ 批准', callback_data: `APPROVE_${approvalId}` },
                                { text: '❌ 拒絕', callback_data: `DENY_${approvalId}` }
                            ]]
                        }
                    }
                );
                return null;
            }
            try {
                if (!this.internalExecutor) this.internalExecutor = new Executor();
                const output = await this.internalExecutor.run(cmdToRun);
                reportBuffer.push(`[Step ${i + 1} Success] cmd: ${cmdToRun}\nResult:\n${(output || "").trim() || "(No stdout)"}`);
            } catch (err) { reportBuffer.push(`[Step ${i + 1} Failed] cmd: ${cmdToRun}\nError:\n${err.message}`); }
        }
        return reportBuffer.join('\n\n----------------\n\n');
    }
}

module.exports = TaskController;
