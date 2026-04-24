const { v4: uuidv4 } = require('uuid');
const Executor = require('./Executor');
const { SecurityManager } = require('../../packages/security');
const ToolScanner = require('../managers/ToolScanner');
const InteractiveMultiAgent = require('./InteractiveMultiAgent');
const NodeRouter = require('./NodeRouter');

// Golem 內建斜線指令前綴（以 /wiki、/learn、/skills … 開頭的指令）
// 凡是符合此清單的指令，直接由 NodeRouter 處理，不送進 shell。
const GOLEM_SLASH_PREFIXES = [
    '/wiki', '/learn', '/skills', '/callme', '/help', '/menu',
    '/export', '/donate', '/support', '/update', '/reset',
    '/model', '/reload', '/patch',
];

// ============================================================
// ⚡ Task Controller (閉環回饋版)
// ============================================================
class TaskController {
    constructor(options = {}) {
        this.golemId = options.golemId || 'default';
        this.executor = new Executor();
        this.security = new SecurityManager();
        this.multiAgent = null; // ✨ [v9.1]
        this.pendingTasks = new Map(); // Moved from global to here

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

    destroy() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
        }
    }

    // ✨ [v9.1] 處理多 Agent 請求
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
            const options = {
                maxRounds: action.rounds || 3,
                toolset: action.toolset || 'assistant',
                agentToolsets: action.agentToolsets || action.agent_toolsets || {},
                workerSendTimeoutMs: action.workerSendTimeoutMs || action.worker_send_timeout_ms || action.workerTimeoutMs || action.worker_timeout_ms,
                workerIdleTimeoutMs: action.workerIdleTimeoutMs || action.worker_idle_timeout_ms || action.workerTimeoutMs || action.worker_timeout_ms,
                workerDraftCheckIntervalMs: action.workerDraftCheckIntervalMs || action.worker_draft_check_interval_ms,
            };
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

            // ✨ [v9.1 Hybrid Object Fix] 如果 cmd 為空但 action 存在，則自動組裝
            if (!cmdToRun && step.action && step.action !== 'command') {
                if (step.parameters && step.parameters.command) {
                    cmdToRun = step.parameters.command;
                } else if (step.parameters && typeof step.parameters === 'string') {
                    cmdToRun = step.parameters;
                } else {
                    const actionName = String(step.action).toLowerCase().replace(/_/g, '-');
                    const { action, ...params } = step;

                    const fs = require('fs');
                    const path = require('path');
                    const skillPath = path.join(process.cwd(), 'src/skills/core', `${actionName}.js`);

                    if (fs.existsSync(skillPath)) {
                        let payloadObj = params;
                        if (params.parameters && typeof params.parameters === 'object') {
                            payloadObj = params.parameters; // 去除多層嵌套，方便腳本解析
                        }
                        const payload = JSON.stringify(payloadObj).replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
                        cmdToRun = `node src/skills/core/${actionName}.js "${payload}"`;
                        console.log(`🔧 [TaskController] 自動組裝技能指令: ${cmdToRun}`);
                    } else {
                        console.warn(`⚠️ [TaskController] 找不到實體技能檔: ${skillPath}`);
                        cmdToRun = `echo "⛔ [系統攔截] 找不到實體技能檔: src/skills/core/${actionName}.js (可能為虛擬技能)。請改用 {\\\"action\\\": \\\"command\\\", \\\"command\\\": \\\"你的 shell 指令\\\"}。"`;
                    }
                }
            }
            // ── Golem 內建斜線指令攔截 ──────────────────────────────
            // /wiki、/learn 等指令不屬於 shell，直接由 NodeRouter 內部處理。
            const isGolemSlash = cmdToRun.startsWith('/') &&
                GOLEM_SLASH_PREFIXES.some(prefix => cmdToRun.startsWith(prefix));

            if (isGolemSlash) {
                console.log(`🔀 [TaskController] Golem 內建指令攔截: ${cmdToRun}`);
                try {
                    const result = await NodeRouter.handle({ text: cmdToRun, isAdmin: true }, ctx.brain);
                    const output = result || '（指令已執行，無輸出）';
                    reportBuffer.push(`[Step ${i + 1} Success] cmd: ${cmdToRun}\nResult:\n${output}`);
                } catch (e) {
                    reportBuffer.push(`[Step ${i + 1} Failed] cmd: ${cmdToRun}\nError:\n${e.message}`);
                }
                continue; // 跳過後續 shell 執行邏輯
            }

            const risk = this.security.assess(cmdToRun);
            if (cmdToRun.startsWith('golem-check')) {
                const toolName = cmdToRun.split(' ')[1];
                reportBuffer.push(toolName ? `🔍 [ToolCheck] ${ToolScanner.check(toolName)}` : `⚠️ 缺少參數`);
                continue;
            }
            const evaluatedLevel = this.security.evaluateCommandLevel(cmdToRun);
            if (evaluatedLevel > SecurityManager.currentLevel) {
                console.log(`⛔ [TaskController] 指令風險等級 (L${evaluatedLevel}) 大於當前安全設定 (L${SecurityManager.currentLevel}): ${cmdToRun}`);
                return `⛔ 安全攔截：該指令風險等級為 L${evaluatedLevel}，但系統目前僅允許執行 L${SecurityManager.currentLevel} (含) 以下的指令。\n請管理員使用 \`/level ${evaluatedLevel}\` 暫時調高權限後重試。`;
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
