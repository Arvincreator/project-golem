const TASK_ACTIONS = new Set([
    'task_create',
    'task_list',
    'task_get',
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

    static async execute(ctx, act, controller) {
        const action = String(act && act.action ? act.action : '').trim().toLowerCase();
        if (!TaskActionHandler.isTaskAction(action)) return false;
        if (!controller) {
            await ctx.reply('⚠️ Task controller is unavailable.');
            return true;
        }

        const actor = compactText((ctx && ctx.senderName) || 'system', 'system');

        try {
            if (action === 'task_create') {
                const input = (act.input && typeof act.input === 'object')
                    ? act.input
                    : (act.task && typeof act.task === 'object' ? act.task : act);
                const result = controller.taskCreate(input, { actor, source: 'task_action' });
                await ctx.reply(`📌 任務已建立\n${renderTaskLine(result.task)}`);
                return true;
            }

            if (action === 'task_list') {
                const filters = (act.filters && typeof act.filters === 'object') ? act.filters : act;
                const tasks = controller.taskList(filters || {});
                const max = Math.min(tasks.length, 12);
                const lines = tasks.slice(0, max).map((task) => renderTaskLine(task));
                await ctx.reply(`📋 任務列表（${tasks.length}）\n${lines.length > 0 ? lines.join('\n') : '- (empty)'}`);
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
                await ctx.reply(`📍 任務詳情\n${renderTaskLine(task)}\nversion=${task.version} owner=${task.owner || 'n/a'}`);
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
                await ctx.reply(`🛠️ 任務已更新\n${renderTaskLine(result.task)}`);
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
                await ctx.reply(`🛑 任務已停止\n${renderTaskLine(result.task)}`);
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
                await ctx.reply([
                    '📈 任務遙測',
                    `total=${totals.totalTasks || 0} completed=${status.completed || 0} failed=${status.failed || 0} blocked=${status.blocked || 0}`,
                    `completionRate=${metrics.completionRate || 0} terminalSuccessRate=${metrics.terminalSuccessRate || 0}`,
                    `fakeCompletionIntercepts=${metrics.fakeCompletionIntercepts || 0} versionConflicts=${metrics.versionConflicts || 0}`,
                ].join('\n'));
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
                await ctx.reply([
                    `🧪 任務一致性檢查：${report.ok ? 'OK' : 'FAILED'}`,
                    `violations=${violations}`,
                    `in_progress=${report.stats && report.stats.inProgressCount ? report.stats.inProgressCount : 0}`,
                ].join('\n'));
                return true;
            }

            if (action === 'todo_write') {
                const items = Array.isArray(act.items) ? act.items : [];
                const options = (act.options && typeof act.options === 'object') ? act.options : {};
                const result = controller.todoWrite(items, { actor, ...options });
                const changed = Array.isArray(result.changed) ? result.changed : [];
                const lines = changed.slice(0, 10).map((task) => renderTaskLine(task));
                await ctx.reply(`🧾 todo_write 完成（${changed.length} 項）\n${lines.length > 0 ? lines.join('\n') : '- (no changes)'}`);
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
