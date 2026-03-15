const { v4: uuidv4 } = require('uuid');
const Executor = require('./Executor');
const SecurityManager = require('../managers/SecurityManager');
const ToolScanner = require('../managers/ToolScanner');
const InteractiveMultiAgent = require('./InteractiveMultiAgent');

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

        // ✨ [v9.1] 防止記憶體流失: 定期清理過期的待審批任務 (5 分鐘)
        setInterval(() => {
            const now = Date.now();
            for (const [id, task] of this.pendingTasks.entries()) {
                if (now - task.timestamp > 5 * 60 * 1000) {
                    this.pendingTasks.delete(id);
                }
            }
        }, 60 * 1000);
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
            let cmdToRun = step.cmd || step.parameter || step.command || "";

            // ✨ [v9.0 Hybrid Object Fix] 如果 cmd 為空但 action 存在，則自動組裝
            if (!cmdToRun && step.action && step.action !== 'command') {
                // 安全: 嚴格限制 actionName 為英數字和連字號，防止 path traversal
                const actionName = String(step.action).toLowerCase().replace(/_/g, '-').replace(/[^a-z0-9-]/g, '');
                if (!actionName || actionName.includes('..')) {
                    console.warn(`[TaskController] 非法技能名稱: ${step.action}`);
                    reportBuffer.push(`[Step ${i + 1} Blocked] Invalid skill name: ${step.action}`);
                    continue;
                }
                // 安全: 驗證技能檔案確實存在
                const skillPath = require('path').join(process.cwd(), 'src', 'skills', 'core', `${actionName}.js`);
                if (!require('fs').existsSync(skillPath)) {
                    console.warn(`[TaskController] 技能不存在: ${actionName}`);
                    reportBuffer.push(`[Step ${i + 1} Blocked] Skill not found: ${actionName}`);
                    continue;
                }
                // 安全: 使用 Base64 編碼 payload，避免 shell injection
                const { action, ...params } = step;
                const payloadB64 = Buffer.from(JSON.stringify(params)).toString('base64');
                cmdToRun = `node src/skills/core/${actionName}.js --base64 ${payloadB64}`;
                console.log(`[TaskController] 自動組裝技能指令: node src/skills/core/${actionName}.js --base64 <payload>`);
            }
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
                console.log(`⚠️ [TaskController] 指令需審批 (${risk.level}): ${cmdToRun} - ${risk.reason}`);
                const approvalId = uuidv4();
                this.pendingTasks.set(approvalId, {
                    steps, nextIndex: i, ctx, timestamp: Date.now()
                });
                const cmdBlock = cmdToRun ? `\n\`\`\`shell\n${cmdToRun}\n\`\`\`` : "";
                await ctx.reply(
                    `⚠️ ${risk.level === 'DANGER' ? '🔴 危險指令' : '🟡 警告'}\n${cmdBlock}\n\n${risk.reason}`,
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
