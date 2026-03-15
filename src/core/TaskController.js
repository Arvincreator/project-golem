const { v4: uuidv4 } = require('uuid');
const Executor = require('./Executor');
const SecurityManager = require('../managers/SecurityManager');
const ToolScanner = require('../managers/ToolScanner');
const InteractiveMultiAgent = require('./InteractiveMultiAgent');

// ============================================================
// Task Controller v10.0 — L0-L3 Level-Aware Execution
// ============================================================
class TaskController {
    constructor(options = {}) {
        this.golemId = options.golemId || 'default';
        this.executor = new Executor();
        this.security = new SecurityManager();
        this.multiAgent = null;
        this.pendingTasks = new Map();
        this.l1Buffer = [];           // L1 digest buffer
        this.actionLog = [];          // Action history for dashboard
        this.autonomyManager = null;  // Set externally

        // Cleanup expired approval tasks (5 min TTL)
        setInterval(() => {
            const now = Date.now();
            for (const [id, task] of this.pendingTasks.entries()) {
                if (now - task.timestamp > 5 * 60 * 1000) {
                    this.pendingTasks.delete(id);
                }
            }
        }, 60 * 1000);

        // Flush L1 digest every 5 minutes
        setInterval(() => this._flushL1Digest(), 5 * 60 * 1000);
    }

    setAutonomyManager(am) {
        this.autonomyManager = am;
    }

    // ✨ [v9.0] Multi-Agent handling
    async _handleMultiAgent(ctx, action, brain) {
        try {
            if (!this.multiAgent) {
                this.multiAgent = new InteractiveMultiAgent(brain);
            }
            const presetName = action.preset || 'TECH_TEAM';
            const agentConfigs = InteractiveMultiAgent.PRESETS[presetName];
            if (!agentConfigs) {
                const available = Object.keys(InteractiveMultiAgent.PRESETS).join(', ');
                await ctx.reply(`Unknown team: ${presetName}. Available: ${available}`);
                return;
            }
            const task = action.task || 'Discussion';
            const options = { maxRounds: action.rounds || 3 };
            await this.multiAgent.startConversation(ctx, task, agentConfigs, options);
        } catch (e) {
            console.error('[TaskController] MultiAgent failed:', e);
            await ctx.reply(`Execution failed: ${e.message}`);
        }
    }

    /**
     * Run a sequence of action steps with L0-L3 level-aware execution
     */
    async runSequence(ctx, steps, startIndex = 0) {
        let reportBuffer = [];
        for (let i = startIndex; i < steps.length; i++) {
            const step = steps[i];
            let cmdToRun = step.cmd || step.parameter || step.command || "";

            // Auto-assemble skill command if action is not 'command'
            if (!cmdToRun && step.action && step.action !== 'command') {
                const actionName = String(step.action).toLowerCase().replace(/_/g, '-');
                const { action, ...params } = step;
                const payload = JSON.stringify(params).replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
                cmdToRun = `node src/skills/core/${actionName}.js "${payload}"`;
                console.log(`[TaskController] Auto-assembled skill command: ${cmdToRun}`);
            }

            // Tool check bypass
            if (cmdToRun.startsWith('golem-check')) {
                const toolName = cmdToRun.split(' ')[1];
                reportBuffer.push(toolName ? `[ToolCheck] ${ToolScanner.check(toolName)}` : `Missing parameter`);
                continue;
            }

            // ═══ L0-L3 Risk Assessment ═══
            const risk = this.security.assess(cmdToRun);
            const startTime = Date.now();

            // L3 CRITICAL — detailed approval with consequences
            if (risk.level === 'L3') {
                console.log(`[TaskController] L3 CRITICAL: ${cmdToRun}`);
                const approvalId = uuidv4();
                this.pendingTasks.set(approvalId, {
                    steps, nextIndex: i, ctx, timestamp: Date.now()
                });
                await ctx.reply(
                    `<b>[L3 CRITICAL]</b> ${risk.reason}\n<pre>${cmdToRun}</pre>\n\nThis operation is irreversible. Approve?`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: 'APPROVE', callback_data: `APPROVE_${approvalId}` },
                                { text: 'DENY', callback_data: `DENY_${approvalId}` }
                            ]]
                        }
                    }
                );
                this._logAction(risk.level, cmdToRun, 'pending_approval', 0);
                return null;
            }

            // L2 MEDIUM — approval required
            if (risk.level === 'L2') {
                console.log(`[TaskController] L2 MEDIUM: ${cmdToRun}`);
                const approvalId = uuidv4();
                this.pendingTasks.set(approvalId, {
                    steps, nextIndex: i, ctx, timestamp: Date.now()
                });
                await ctx.reply(
                    `<b>[L2 APPROVAL]</b> ${risk.reason}\n<pre>${cmdToRun}</pre>`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: 'APPROVE', callback_data: `APPROVE_${approvalId}` },
                                { text: 'DENY', callback_data: `DENY_${approvalId}` }
                            ]]
                        }
                    }
                );
                this._logAction(risk.level, cmdToRun, 'pending_approval', 0);
                return null;
            }

            // L0 & L1 — auto-execute
            console.log(`[TaskController] ${risk.level} auto-execute: ${cmdToRun}`);
            try {
                if (!this.internalExecutor) this.internalExecutor = new Executor();
                const output = await this.internalExecutor.run(cmdToRun);
                const duration = Date.now() - startTime;
                const result = (output || "").trim() || "(No stdout)";
                reportBuffer.push(`[Step ${i + 1}] ${cmdToRun}\n${result}`);
                this._logAction(risk.level, cmdToRun, 'ok', duration);

                // L1: push to digest buffer for batch notification
                if (risk.level === 'L1') {
                    this.l1Buffer.push({
                        time: new Date().toISOString(),
                        cmd: cmdToRun,
                        status: 'ok',
                        duration
                    });
                }
            } catch (err) {
                const duration = Date.now() - startTime;
                reportBuffer.push(`[Step ${i + 1} FAIL] ${cmdToRun}\n${err.message}`);
                this._logAction(risk.level, cmdToRun, 'fail', duration);

                if (risk.level === 'L1') {
                    this.l1Buffer.push({
                        time: new Date().toISOString(),
                        cmd: cmdToRun,
                        status: 'fail',
                        duration
                    });
                }
            }
        }
        return reportBuffer.join('\n\n----------------\n\n');
    }

    /**
     * Log action for dashboard action_log
     */
    _logAction(level, cmd, status, duration) {
        this.actionLog.push({
            ts: new Date().toISOString(),
            level,
            cmd: cmd.substring(0, 200),
            status,
            duration
        });
        // Keep last 100 entries
        if (this.actionLog.length > 100) {
            this.actionLog = this.actionLog.slice(-100);
        }
    }

    /**
     * Flush L1 digest buffer — sends batch notification via Telegram
     */
    async _flushL1Digest() {
        if (this.l1Buffer.length === 0) return;
        const items = this.l1Buffer.splice(0);
        const lines = items.map(i => {
            const t = i.time.slice(11, 19);
            const s = i.status === 'ok' ? 'OK' : 'FAIL';
            return `${t} [${s}] ${i.cmd.substring(0, 60)}`;
        });
        const msg = `<pre>[L1 Digest: ${items.length} actions]\n${lines.join('\n')}</pre>`;

        if (this.autonomyManager) {
            try {
                await this.autonomyManager.sendNotification(msg, 'HTML');
            } catch (e) {
                console.error('[TaskController] L1 digest send failed:', e.message);
            }
        }
    }

    /**
     * Get action log for dashboard
     */
    getActionLog(limit = 50) {
        return this.actionLog.slice(-limit);
    }

    // BabyAGI-inspired: auto-generate follow-up tasks
    async processFollowUp(result, ctx) {
        if (!result || !result.followUp) return;
        const level = process.env.INTERVENTION_LEVEL || 'MANUAL';
        if (level === 'MANUAL') return;

        console.log(`[TaskController] Follow-up task queued: ${result.followUp.substring(0, 80)}`);
        if (this.queue) {
            this.queue.push({
                action: 'skill',
                skill: 'auto-task',
                args: { task: result.followUp },
                source: 'follow-up',
                timestamp: Date.now(),
            });
        }
    }
}

module.exports = TaskController;
