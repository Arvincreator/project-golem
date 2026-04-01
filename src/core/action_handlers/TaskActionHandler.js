const TASK_ACTIONS = new Set([
    'task_create',
    'task_list',
    'task_get',
    'task_resume',
    'task_focus',
    'task_update',
    'task_stop',
    'task_metrics',
    'task_integrity',
    'todo_write',
]);

function compactText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

function truncate(value, max = 80) {
    const text = String(value || '');
    if (text.length <= max) return text;
    return `${text.slice(0, max - 3)}...`;
}

function renderTaskLine(task) {
    if (!task) return '- (missing)';
    return `- [${task.id}] (${task.status}) ${truncate(task.subject, 90)}`;
}

function extractPatch(action) {
    if (action.patch && typeof action.patch === 'object') return action.patch;
    if (action.update && typeof action.update === 'object') return action.update;
    if (action.task && typeof action.task === 'object') return action.task;
    const clone = { ...action };
    delete clone.action;
    delete clone.id;
    delete clone.taskId;
    return clone;
}

class TaskActionHandler {
    static isTaskAction(actionName) {
        return TASK_ACTIONS.has(String(actionName || '').trim().toLowerCase());
    }

    static isDetailMode(act = {}) {
        if (!act || typeof act !== 'object') return false;
        const options = (act.options && typeof act.options === 'object') ? act.options : {};
        if (act.silent === true || options.silent === true) return false;
        if (act.verbose === true || act.detail === true) return true;
        if (options.verbose === true || options.detail === true) return true;
        const responseMode = compactText(
            act.responseMode || act.userVisible || options.responseMode || options.userVisible,
            ''
        ).toLowerCase();
        if (!responseMode) return false;
        return responseMode === 'detail' || responseMode === 'verbose';
    }

    static summarizeStatus(task = {}) {
        const status = compactText(task.status, 'pending');
        if (status === 'in_progress') return '這項任務正在進行中，我會持續更新進度。';
        if (status === 'blocked') return '這項任務目前有阻塞，我會先排除卡點。';
        if (status === 'failed') return '這項任務先前失敗，我會先定位原因再重試。';
        if (status === 'completed') return '這項任務已完成。';
        if (status === 'killed') return '這項任務已停止。';
        return '這項任務已排入待辦，準備執行。';
    }

    static async execute(ctx, act, controller) {
        const action = String(act && act.action ? act.action : '').trim().toLowerCase();
        if (!TaskActionHandler.isTaskAction(action)) return false;
        if (!controller) {
            await ctx.reply('⚠️ Task controller is unavailable.');
            return true;
        }

        const actor = compactText((ctx && ctx.senderName) || 'system', 'system');
        const detailMode = TaskActionHandler.isDetailMode(act);

        try {
            if (action === 'task_create') {
                const input = (act.input && typeof act.input === 'object')
                    ? act.input
                    : (act.task && typeof act.task === 'object' ? act.task : act);
                const result = controller.taskCreate(input, { actor, source: 'task_action' });
                if (detailMode) {
                    await ctx.reply(`📌 任務已建立\n${renderTaskLine(result.task)}`);
                } else {
                    await ctx.reply('我已把這件事記下來，接下來會直接處理。');
                }
                return true;
            }

            if (action === 'task_list') {
                const filters = (act.filters && typeof act.filters === 'object') ? act.filters : act;
                const tasks = controller.taskList(filters || {});
                if (detailMode) {
                    const max = Math.min(tasks.length, 12);
                    const lines = tasks.slice(0, max).map((task) => renderTaskLine(task));
                    await ctx.reply(`📋 任務列表（${tasks.length}）\n${lines.length > 0 ? lines.join('\n') : '- (empty)'}`);
                } else {
                    await ctx.reply(tasks.length > 0
                        ? `我已整理目前待辦，共 ${tasks.length} 項，會優先處理最重要的項目。`
                        : '目前沒有未完成任務。');
                }
                return true;
            }

            if (action === 'task_get') {
                const taskId = compactText(act.taskId || act.id, '');
                if (!taskId) {
                    await ctx.reply('⚠️ task_get 需要 taskId。');
                    return true;
                }
                const task = controller.taskGet(taskId);
                if (!task) {
                    await ctx.reply(`⚠️ 找不到任務：${taskId}`);
                    return true;
                }
                if (detailMode) {
                    await ctx.reply(`📍 任務詳情\n${renderTaskLine(task)}\nversion=${task.version} owner=${task.owner || 'n/a'}`);
                } else {
                    await ctx.reply(TaskActionHandler.summarizeStatus(task));
                }
                return true;
            }

            if (action === 'task_resume' || action === 'task_focus') {
                if (typeof controller.taskResume !== 'function') {
                    await ctx.reply('⚠️ task_resume 尚未啟用。');
                    return true;
                }
                const options = {
                    actor,
                    taskId: compactText(act.taskId || act.id, ''),
                };
                const result = controller.taskResume(options);
                if (!result || result.resumed !== true || !result.task) {
                    await ctx.reply('目前沒有需要接續的未完成任務。');
                    return true;
                }
                if (detailMode) {
                    const brief = result.brief || {};
                    const nextId = brief && brief.nextTask && brief.nextTask.id ? brief.nextTask.id : 'none';
                    await ctx.reply([
                        `🔄 任務已恢復`,
                        renderTaskLine(result.task),
                        `promoted=${result.promoted ? 'yes' : 'no'} next=${nextId}`,
                    ].join('\n'));
                } else {
                    await ctx.reply('我已接續先前進度，現在繼續往下執行。');
                }
                return true;
            }

            if (action === 'task_update') {
                const taskId = compactText(act.taskId || act.id, '');
                if (!taskId) {
                    await ctx.reply('⚠️ task_update 需要 taskId。');
                    return true;
                }
                const patch = extractPatch(act);
                const options = (act.options && typeof act.options === 'object') ? act.options : {};
                const result = controller.taskUpdate(taskId, patch, { actor, ...options });
                if (detailMode) {
                    await ctx.reply(`🛠️ 任務已更新\n${renderTaskLine(result.task)}`);
                } else {
                    await ctx.reply('任務狀態已更新，我會依照新進度繼續處理。');
                }
                return true;
            }

            if (action === 'task_stop') {
                const taskId = compactText(act.taskId || act.id, '');
                if (!taskId) {
                    await ctx.reply('⚠️ task_stop 需要 taskId。');
                    return true;
                }
                const options = {
                    actor,
                    reason: compactText(act.reason, 'manual-stop'),
                };
                const result = controller.taskStop(taskId, options);
                if (detailMode) {
                    await ctx.reply(`🛑 任務已停止\n${renderTaskLine(result.task)}`);
                } else {
                    await ctx.reply('已停止該任務。');
                }
                return true;
            }

            if (action === 'task_metrics') {
                if (typeof controller.taskMetrics !== 'function') {
                    await ctx.reply('⚠️ Task metrics 尚未啟用。');
                    return true;
                }
                const metrics = controller.taskMetrics() || {};
                const totals = metrics.totals || {};
                const status = totals.byStatus || {};
                if (detailMode) {
                    await ctx.reply([
                        '📈 任務遙測',
                        `total=${totals.totalTasks || 0} completed=${status.completed || 0} failed=${status.failed || 0} blocked=${status.blocked || 0}`,
                        `completionRate=${metrics.completionRate || 0} terminalSuccessRate=${metrics.terminalSuccessRate || 0}`,
                        `fakeCompletionIntercepts=${metrics.fakeCompletionIntercepts || 0} versionConflicts=${metrics.versionConflicts || 0}`,
                    ].join('\n'));
                } else {
                    const failed = Number(status.failed || 0);
                    const blocked = Number(status.blocked || 0);
                    if (failed > 0 || blocked > 0) {
                        await ctx.reply('我已檢查任務健康度，目前有需要處理的阻塞或失敗項目。');
                    } else {
                        await ctx.reply('我已檢查任務健康度，目前整體進度穩定。');
                    }
                }
                return true;
            }

            if (action === 'task_integrity') {
                if (typeof controller.taskIntegrity !== 'function') {
                    await ctx.reply('⚠️ Task integrity report 尚未啟用。');
                    return true;
                }
                const report = controller.taskIntegrity(
                    (act.options && typeof act.options === 'object') ? act.options : {}
                ) || {};
                const violations = Number(report.violationCount || 0);
                if (detailMode) {
                    await ctx.reply([
                        `🧪 任務一致性檢查：${report.ok ? 'OK' : 'FAILED'}`,
                        `violations=${violations}`,
                        `in_progress=${report.stats && report.stats.inProgressCount ? report.stats.inProgressCount : 0}`,
                    ].join('\n'));
                } else {
                    await ctx.reply(report.ok
                        ? '我已完成一致性檢查，目前狀態正常。'
                        : `我已發現 ${violations} 個一致性問題，會先修正再繼續。`);
                }
                return true;
            }

            if (action === 'todo_write') {
                const items = Array.isArray(act.items) ? act.items : [];
                const options = (act.options && typeof act.options === 'object') ? act.options : {};
                const result = controller.todoWrite(items, { actor, ...options });
                const changed = Array.isArray(result.changed) ? result.changed : [];
                if (detailMode) {
                    const lines = changed.slice(0, 10).map((task) => renderTaskLine(task));
                    await ctx.reply(`🧾 todo_write 完成（${changed.length} 項）\n${lines.length > 0 ? lines.join('\n') : '- (no changes)'}`);
                } else {
                    await ctx.reply(changed.length > 0
                        ? `待辦進度已同步，共更新 ${changed.length} 項。`
                        : '待辦清單已確認，暫時沒有需要變更的項目。');
                }
                return true;
            }
        } catch (error) {
            await ctx.reply(`❌ Task action 失敗：${error.message}`);
            return true;
        }

        return false;
    }
}

module.exports = TaskActionHandler;
