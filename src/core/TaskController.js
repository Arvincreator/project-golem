const { v4: uuidv4 } = require('uuid');
const Executor = require('./Executor');
const SecurityManager = require('../managers/SecurityManager');
const ToolScanner = require('../managers/ToolScanner');
const InteractiveMultiAgent = require('./InteractiveMultiAgent');
const TaskDecomposer = require('./TaskDecomposer');

// ============================================================
// ⚡ Task Controller (閉環回饋版)
// ============================================================
class TaskController {
    constructor(options = {}) {
        this.golemId = options.golemId || 'default';
        this.executor = new Executor();
        this.security = new SecurityManager();
        this.multiAgent = null; // ✨ [v9.0]
        this.pendingTasks = new Map(); // Moved from global to here
        this.brain = options.brain || null;
        this.taskDecomposer = null;

        // ✨ [v9.1] 防止記憶體流失: 定期清理過期的待審批任務 (5 分鐘)
        this._cleanupTimer = setInterval(() => {
            const now = Date.now();
            for (const [id, task] of this.pendingTasks.entries()) {
                if (now - task.timestamp > 5 * 60 * 1000) {
                    this.pendingTasks.delete(id);
                }
            }
        }, 60 * 1000);
    }

    stop() {
        if (this._cleanupTimer) { clearInterval(this._cleanupTimer); this._cleanupTimer = null; }
        console.log(`[TaskController:${this.golemId}] Cleanup timer stopped.`);
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

    async runDecomposed(ctx, goal, autonomy) {
        if (!this.brain) {
            await ctx.reply('⚠️ Brain not available for task decomposition.');
            return null;
        }
        if (!this.taskDecomposer) {
            this.taskDecomposer = new TaskDecomposer(this.brain, { golemId: this.golemId });
        }
        return this.taskDecomposer.execute(goal, ctx, this, autonomy);
    }

    async checkFollowUp(result, ctx, brain) {
        if (!brain || !result) return null;
        const resultStr = String(result);

        // Check for follow-up indicators
        const indicators = ['TODO', '下一步', 'recommend', '建議', 'next step', 'follow-up', '待處理'];
        const hasFollowUp = indicators.some(ind => resultStr.toLowerCase().includes(ind.toLowerCase()));

        if (!hasFollowUp) return null;

        try {
            const prompt = `根據以下執行結果，判斷是否有 follow-up 任務需要建議（不要自動執行，只建議）：\n${resultStr.substring(0, 1000)}\n\n如有建議，用 [GOLEM_REPLY] 簡述。如無，回覆 [GOLEM_REPLY] 無需跟進。`;
            const raw = await brain.sendMessage(prompt, true);
            return raw;
        } catch (e) {
            console.warn('[TaskController] Follow-up check failed:', e.message);
            return null;
        }
    }

    async runSequence(ctx, steps, startIndex = 0) {
        let reportBuffer = [];
        for (let i = startIndex; i < steps.length; i++) {
            const step = steps[i];
            let cmdToRun = step.cmd || step.parameter || step.command || "";

            // ✨ [v9.0 Hybrid Object Fix] 如果 cmd 為空但 action 存在，則自動組裝
            if (!cmdToRun && step.action && step.action !== 'command') {
                const actionName = String(step.action).toLowerCase().replace(/_/g, '-');
                const { action, ...params } = step;
                const payloadB64 = Buffer.from(JSON.stringify(params)).toString('base64');
                const skillPath = require('path').resolve(process.cwd(), 'src', 'skills', 'core', `${actionName}.js`);
                cmdToRun = `node "${skillPath}" --base64 ${payloadB64}`;
                console.log(`🔧 [TaskController] 自動組裝技能指令: ${cmdToRun}`);
            }

            // L0-L3 分級: 先用 classifyAction 判定技能等級
            const actionLevel = this.security.classifyAction(step);

            // 重複錯誤檢查 — 同樣錯誤不犯第二次
            if (this.security.isRepeatedError(step)) {
                console.warn(`🛑 [TaskController] 重複錯誤偵測! 跳過: ${step.action}:${step.task}`);
                reportBuffer.push(`[Step ${i + 1} Skipped] 重複錯誤已跳過: ${step.action}:${step.task || ''}`);
                continue;
            }

            if (actionLevel === 'L0' || actionLevel === 'L1') {
                const actionDesc = `${step.action || 'cmd'}${step.task ? ':' + step.task : ''}`;
                console.log(`🟢 [TaskController] ${actionLevel} 自動放行: ${actionDesc}`);
                try {
                    if (!this.internalExecutor) this.internalExecutor = new Executor();
                    const output = await this.internalExecutor.run(cmdToRun);
                    const resultStr = (output || "").trim() || "(No stdout)";
                    reportBuffer.push(`[Step ${i + 1} Success] cmd: ${cmdToRun}\nResult:\n${resultStr}`);
                    this.security.logAction(step, actionLevel, resultStr, true);
                } catch (err) {
                    reportBuffer.push(`[Step ${i + 1} Failed] cmd: ${cmdToRun}\nError:\n${err.message}`);
                    this.security.logAction(step, actionLevel, err.message, false);
                }
                continue;
            }

            // L2+ 走原有的安全審核流程
            const risk = this.security.assess(cmdToRun);
            if (cmdToRun.startsWith('golem-check')) {
                const toolName = cmdToRun.split(' ')[1];
                reportBuffer.push(toolName ? `🔍 [ToolCheck] ${ToolScanner.check(toolName)}` : `⚠️ 缺少參數`);
                continue;
            }
            if (risk.level === 'BLOCKED') {
                console.log(`⛔ [TaskController] 指令被系統攔截: ${cmdToRun}`);
                return `⛔ 指令被系統攔截：${cmdToRun}`;
            }
            if (risk.level === 'WARNING' || risk.level === 'DANGER') {
                console.log(`⚠️ [TaskController] 指令需審批 (${risk.level}, ${actionLevel}): ${cmdToRun} - ${risk.reason}`);
                const approvalId = uuidv4();
                this.pendingTasks.set(approvalId, {
                    steps, nextIndex: i, ctx, timestamp: Date.now()
                });
                const cmdBlock = cmdToRun ? `\n\`\`\`shell\n${cmdToRun}\n\`\`\`` : "";
                const levelBadge = actionLevel === 'L3' ? '🔴 L3 高風險' : (risk.level === 'DANGER' ? '🔴 危險指令' : '🟡 警告');
                await ctx.reply(
                    `⚠️ ${levelBadge}\n${cmdBlock}\n\n${risk.reason}`,
                    {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true,
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

            console.log(`🟢 [TaskController] 指令安全放行: ${cmdToRun}`);
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
