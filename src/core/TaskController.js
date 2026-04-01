const { randomUUID } = require('crypto');
const path = require('path');
const Executor = require('./Executor');
const { SecurityManager } = require('../../packages/security');
const ToolScanner = require('../managers/ToolScanner');
const InteractiveMultiAgent = require('./InteractiveMultiAgent');
const TaskKernel = require('../managers/TaskKernel');

const DEFAULT_PENDING_TASK_TTL_MS = 5 * 60 * 1000;

function compactText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

function truncate(value, max = 120) {
    const text = String(value || '');
    if (text.length <= max) return text;
    return `${text.slice(0, max - 3)}...`;
}

function toSerializable(value) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.map((item) => toSerializable(item));
    if (typeof value !== 'object') return undefined;
    const output = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'function') continue;
        if (key === 'ctx' || key === 'instance' || key === 'event') continue;
        const serialized = toSerializable(item);
        if (serialized !== undefined) output[key] = serialized;
    }
    return output;
}

function buildSequenceSubject(steps = []) {
    const first = Array.isArray(steps) ? steps[0] : null;
    const action = compactText(first && first.action, 'command');
    const cmd = compactText(first && (first.cmd || first.parameter || first.command), '');
    if (cmd) return `Execute ${truncate(cmd, 64)}`;
    return `Execute ${action} sequence`;
}

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
        this.memoryPressureGuard = null;
        this.logDir = options.logDir || path.join(process.cwd(), 'logs');
        this._onTaskEvent = typeof options.onTaskEvent === 'function' ? options.onTaskEvent : null;
        this.taskKernel = new TaskKernel({
            golemId: this.golemId,
            logDir: this.logDir,
            strictMode: options.strictTaskMode !== false,
            onEvent: (event) => {
                if (!this._onTaskEvent) return;
                try {
                    this._onTaskEvent(event);
                } catch (error) {
                    console.error(`[TaskController:${this.golemId}] task event callback failed: ${error.message}`);
                }
            },
        });
        this._rehydratePendingApprovals();

        // ✨ [v9.1] 防止記憶體流失: 定期清理過期的待審批任務 (5 分鐘)
        this._cleanupTimer = setInterval(() => {
            this.trimPendingTasks(DEFAULT_PENDING_TASK_TTL_MS);
        }, 60 * 1000);
        if (typeof this._cleanupTimer.unref === 'function') {
            this._cleanupTimer.unref();
        }
    }

    destroy() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
        }
    }

    setMemoryPressureGuard(guard) {
        this.memoryPressureGuard = guard || null;
    }

    _rehydratePendingApprovals() {
        const approvals = this.taskKernel.listApprovals();
        this.pendingTasks.clear();
        for (const entry of approvals) {
            if (!entry || !entry.id) continue;
            const payload = (entry.payload && typeof entry.payload === 'object') ? entry.payload : {};
            this.pendingTasks.set(entry.id, {
                ...payload,
                approvalId: entry.id,
                timestamp: Number(payload.timestamp || entry.updatedAt || entry.createdAt || Date.now()),
            });
        }
    }

    _persistPendingApproval(approvalId, payload, options = {}) {
        const serialized = toSerializable({
            ...payload,
            approvalId,
            timestamp: Number(payload && payload.timestamp) || Date.now(),
        }) || {};
        this.taskKernel.setApproval(approvalId, serialized, {
            actor: compactText(options.actor, 'system'),
            ttlMs: Number(options.ttlMs) || DEFAULT_PENDING_TASK_TTL_MS,
        });
    }

    registerPendingTask(approvalId, payload = {}, options = {}) {
        const id = compactText(approvalId, '');
        if (!id) throw new Error('approvalId is required');
        const stored = {
            ...(payload && typeof payload === 'object' ? payload : {}),
            approvalId: id,
            timestamp: Date.now(),
        };
        this.pendingTasks.set(id, stored);
        this._persistPendingApproval(id, stored, options);
        return stored;
    }

    getPendingTask(approvalId) {
        const id = compactText(approvalId, '');
        if (!id) return null;
        if (this.pendingTasks.has(id)) return this.pendingTasks.get(id);

        const persisted = this.taskKernel.getApproval(id);
        if (!persisted) return null;
        const payload = (persisted.payload && typeof persisted.payload === 'object') ? persisted.payload : {};
        const merged = {
            ...payload,
            approvalId: id,
            timestamp: Number(payload.timestamp || persisted.updatedAt || persisted.createdAt || Date.now()),
        };
        this.pendingTasks.set(id, merged);
        return merged;
    }

    deletePendingTask(approvalId, options = {}) {
        const id = compactText(approvalId, '');
        if (!id) return false;
        const existedInMap = this.pendingTasks.delete(id);
        const removedPersisted = this.taskKernel.removeApproval(id, {
            actor: compactText(options.actor, 'system'),
            reason: compactText(options.reason, 'manual'),
        });
        return existedInMap || removedPersisted;
    }

    trimPendingTasks(maxAgeMs = DEFAULT_PENDING_TASK_TTL_MS) {
        const now = Date.now();
        let removed = 0;
        for (const [id, task] of this.pendingTasks.entries()) {
            if (!task || !task.timestamp || (now - task.timestamp) > maxAgeMs) {
                this.deletePendingTask(id, { reason: 'expired', actor: 'system' });
                removed++;
            }
        }
        removed += this.taskKernel.trimExpiredApprovals(now);
        return removed;
    }

    getPendingTaskSummary(approvalId) {
        const task = this.getPendingTask(approvalId);
        if (!task) return null;
        if (!task.steps || !task.steps[task.nextIndex]) {
            return {
                approvalId,
                taskId: task.taskId || null,
                type: task.type || 'unknown',
            };
        }
        const step = task.steps[task.nextIndex];
        return {
            approvalId,
            taskId: task.taskId || null,
            type: task.type || 'unknown',
            cmd: step.cmd || step.parameter || step.command || '',
            nextIndex: task.nextIndex,
        };
    }

    taskCreate(input = {}, options = {}) {
        return this.taskKernel.createTask(input, {
            actor: compactText(options.actor, 'system'),
            source: compactText(options.source, 'task_action'),
            idempotencyKey: compactText(options.idempotencyKey, ''),
        });
    }

    taskList(filters = {}) {
        return this.taskKernel.listTasks(filters);
    }

    taskGet(taskId) {
        return this.taskKernel.getTask(taskId);
    }

    taskUpdate(taskId, update = {}, options = {}) {
        return this.taskKernel.updateTask(taskId, update, {
            actor: compactText(options.actor, 'system'),
            expectedVersion: options.expectedVersion,
            idempotencyKey: compactText(options.idempotencyKey, ''),
        });
    }

    taskStop(taskId, options = {}) {
        return this.taskKernel.stopTask(taskId, {
            actor: compactText(options.actor, 'system'),
            reason: compactText(options.reason, 'manual-stop'),
            idempotencyKey: compactText(options.idempotencyKey, ''),
        });
    }

    todoWrite(items = [], options = {}) {
        return this.taskKernel.applyTodoWrite(items, {
            actor: compactText(options.actor, 'system'),
            idempotencyKey: compactText(options.idempotencyKey, ''),
        });
    }

    taskAudit(filters = {}) {
        return this.taskKernel.getAuditEvents(filters);
    }

    taskMetrics() {
        return this.taskKernel.getMetrics();
    }

    taskIntegrity(options = {}) {
        return this.taskKernel.getIntegrityReport(options);
    }

    getTaskRecoverySummary() {
        return this.taskKernel.getRecoverySummary();
    }

    getPendingContextSummary(limit = 12) {
        return this.taskKernel.buildPendingContextSummary(limit);
    }

    _ensureTrackedSequenceTask(steps = [], options = {}) {
        const actor = compactText(options.actor, 'system');
        const taskId = compactText(options.taskId, '');
        if (taskId) {
            const existing = this.taskGet(taskId);
            if (existing) {
                if (existing.status === 'pending') {
                    try {
                        return this.taskUpdate(taskId, { status: 'in_progress' }, { actor }).task;
                    } catch {
                        return existing;
                    }
                }
                return existing;
            }
        }

        const runningTasks = this.taskList({
            includeCompleted: false,
            statuses: ['in_progress'],
        });
        if (runningTasks.length === 1) {
            return runningTasks[0];
        }

        const baseInput = {
            subject: compactText(options.subject, buildSequenceSubject(steps)),
            description: compactText(options.description, ''),
            activeForm: compactText(options.activeForm, ''),
            status: 'in_progress',
            source: compactText(options.source, 'command_sequence'),
            owner: compactText(options.owner, ''),
            metadata: {
                ...(options.metadata && typeof options.metadata === 'object' ? options.metadata : {}),
                totalSteps: Array.isArray(steps) ? steps.length : 0,
            },
        };

        try {
            return this.taskCreate(baseInput, { actor }).task;
        } catch (error) {
            if (!String(error.message || '').includes('in_progress')) {
                throw error;
            }
            const fallback = this.taskCreate({
                ...baseInput,
                status: 'pending',
            }, { actor }).task;
            return fallback;
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
            const options = { maxRounds: action.rounds || 3 };
            await this.multiAgent.startConversation(ctx, task, agentConfigs, options);
        } catch (e) {
            console.error('[TaskController] MultiAgent 執行失敗:', e);
            await ctx.reply(`❌ 執行失敗: ${e.message}`);
        }
    }

    async runSequence(ctx, steps, startIndex = 0, options = {}) {
        const actor = compactText(options.actor, ctx && ctx.senderName ? ctx.senderName : 'system');
        const trackedTask = this._ensureTrackedSequenceTask(steps, {
            ...options,
            actor,
            source: options.source || 'command_sequence',
        });
        const trackedTaskId = trackedTask ? trackedTask.id : null;

        if (trackedTaskId && trackedTask.status === 'pending') {
            try {
                this.taskUpdate(trackedTaskId, {
                    status: 'in_progress',
                }, { actor });
            } catch {}
        }

        let reportBuffer = [];
        let failureCount = 0;
        let lastError = '';
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
            const risk = this.security.assess(cmdToRun);
            if (cmdToRun.startsWith('golem-check')) {
                const toolName = cmdToRun.split(' ')[1];
                reportBuffer.push(toolName ? `🔍 [ToolCheck] ${ToolScanner.check(toolName)}` : `⚠️ 缺少參數`);
                continue;
            }
            const evaluatedLevel = this.security.evaluateCommandLevel(cmdToRun);
            if (evaluatedLevel > SecurityManager.currentLevel) {
                console.log(`⛔ [TaskController] 指令風險等級 (L${evaluatedLevel}) 大於當前安全設定 (L${SecurityManager.currentLevel}): ${cmdToRun}`);
                if (trackedTaskId) {
                    try {
                        this.taskUpdate(trackedTaskId, {
                            status: 'failed',
                            error: `Security level blocked L${evaluatedLevel} command`,
                            metadata: {
                                blockedBySecurityLevel: evaluatedLevel,
                            },
                        }, { actor });
                    } catch {}
                }
                return `⛔ 安全攔截：該指令風險等級為 L${evaluatedLevel}，但系統目前僅允許執行 L${SecurityManager.currentLevel} (含) 以下的指令。\n請管理員使用 \`/level ${evaluatedLevel}\` 暫時調高權限後重試。`;
            }
            if (risk.level === 'BLOCKED') {
                console.log(`⛔ [TaskController] 指令被系統攔截: ${cmdToRun}`);
                if (trackedTaskId) {
                    try {
                        this.taskUpdate(trackedTaskId, {
                            status: 'failed',
                            error: `Blocked by security policy: ${cmdToRun}`,
                            metadata: {
                                blockedBySecurityPolicy: true,
                            },
                        }, { actor });
                    } catch {}
                }
                return `⛔ 指令被系統攔截：${cmdToRun}`;
            }
            if (risk.level === 'WARNING' || risk.level === 'DANGER') {
                console.log(`⚠️ [TaskController] 指令需審批 (${risk.level}): ${cmdToRun} - ${risk.reason}`);
                const approvalId = randomUUID();
                this.registerPendingTask(approvalId, {
                    type: 'COMMAND_APPROVAL',
                    steps,
                    nextIndex: i,
                    taskId: trackedTaskId,
                    sourceChannel: compactText(ctx && ctx.platform, 'unknown'),
                    timestamp: Date.now(),
                }, {
                    actor,
                    ttlMs: Number(options.approvalTtlMs) || DEFAULT_PENDING_TASK_TTL_MS,
                });

                if (trackedTaskId) {
                    try {
                        this.taskUpdate(trackedTaskId, {
                            status: 'blocked',
                            metadata: {
                                blockedReason: risk.reason,
                                pendingApprovalId: approvalId,
                            },
                        }, { actor });
                    } catch {}
                }

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
                return {
                    status: 'PENDING_APPROVAL',
                    approvalId,
                    taskId: trackedTaskId,
                    cmd: cmdToRun,
                    reason: risk.reason,
                    riskLevel: risk.level,
                    approvalPromptSent: true,
                };
            }

            console.log(`🟢 [TaskController] 指令安全放行: ${cmdToRun}`);
            try {
                if (!this.internalExecutor) this.internalExecutor = new Executor();
                const output = await this.internalExecutor.run(cmdToRun);
                reportBuffer.push(`[Step ${i + 1} Success] cmd: ${cmdToRun}\nResult:\n${(output || "").trim() || "(No stdout)"}`);
            } catch (err) {
                failureCount++;
                lastError = compactText(err && err.message, 'Unknown error');
                reportBuffer.push(`[Step ${i + 1} Failed] cmd: ${cmdToRun}\nError:\n${lastError}`);
            }
        }

        if (trackedTaskId) {
            try {
                if (failureCount > 0) {
                    this.taskUpdate(trackedTaskId, {
                        status: 'failed',
                        error: lastError || `${failureCount} steps failed`,
                        metadata: {
                            failureCount,
                        },
                    }, { actor });
                } else {
                    this.taskUpdate(trackedTaskId, {
                        verification: {
                            status: 'verified',
                            note: 'Command sequence executed successfully',
                        },
                        clearError: true,
                    }, { actor });
                    this.taskUpdate(trackedTaskId, {
                        status: 'completed',
                        clearError: true,
                    }, { actor });
                }
            } catch (error) {
                console.error(`[TaskController:${this.golemId}] failed to finalize task ${trackedTaskId}: ${error.message}`);
            }
        }

        return reportBuffer.join('\n\n----------------\n\n');
    }
}

module.exports = TaskController;
