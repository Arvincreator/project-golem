const TaskActionHandler = require('../src/core/action_handlers/TaskActionHandler');

describe('TaskActionHandler', () => {
    let ctx;
    let controller;

    beforeEach(() => {
        ctx = {
            senderName: 'tester',
            reply: jest.fn().mockResolvedValue(),
        };
        controller = {
            taskCreate: jest.fn().mockReturnValue({ task: { id: 'task_1', status: 'pending', subject: 'A' } }),
            taskList: jest.fn().mockReturnValue([{ id: 'task_1', status: 'pending', subject: 'A' }]),
            taskGet: jest.fn().mockReturnValue({ id: 'task_1', status: 'pending', subject: 'A', version: 1 }),
            taskResume: jest.fn().mockReturnValue({
                resumed: true,
                promoted: true,
                task: { id: 'task_1', status: 'in_progress', subject: 'A' },
                brief: { nextTask: { id: 'task_1' } },
            }),
            taskUpdate: jest.fn().mockReturnValue({ task: { id: 'task_1', status: 'in_progress', subject: 'A' } }),
            taskStop: jest.fn().mockReturnValue({ task: { id: 'task_1', status: 'killed', subject: 'A' } }),
            taskMetrics: jest.fn().mockReturnValue({
                totals: {
                    totalTasks: 3,
                    byStatus: { completed: 1, failed: 1, blocked: 0 },
                },
                completionRate: 0.33,
                terminalSuccessRate: 0.5,
                fakeCompletionIntercepts: 2,
                versionConflicts: 1,
            }),
            taskIntegrity: jest.fn().mockReturnValue({
                ok: true,
                violationCount: 0,
                stats: { inProgressCount: 1 },
            }),
            todoWrite: jest.fn().mockReturnValue({ changed: [{ id: 'task_1', status: 'in_progress', subject: 'A' }] }),
        };
    });

    test('isTaskAction recognizes supported actions', () => {
        expect(TaskActionHandler.isTaskAction('task_create')).toBe(true);
        expect(TaskActionHandler.isTaskAction('task_resume')).toBe(true);
        expect(TaskActionHandler.isTaskAction('task_focus')).toBe(true);
        expect(TaskActionHandler.isTaskAction('task_metrics')).toBe(true);
        expect(TaskActionHandler.isTaskAction('todo_write')).toBe(true);
        expect(TaskActionHandler.isTaskAction('command')).toBe(false);
    });

    test('executes task_create', async () => {
        const handled = await TaskActionHandler.execute(ctx, {
            action: 'task_create',
            input: { subject: 'A' },
        }, controller);
        expect(handled).toBe(true);
        expect(controller.taskCreate).toHaveBeenCalled();
        expect(ctx.reply).toHaveBeenCalled();
    });

    test('executes task_update', async () => {
        const handled = await TaskActionHandler.execute(ctx, {
            action: 'task_update',
            taskId: 'task_1',
            patch: { status: 'in_progress' },
        }, controller);
        expect(handled).toBe(true);
        expect(controller.taskUpdate).toHaveBeenCalledWith('task_1', { status: 'in_progress' }, expect.any(Object));
    });

    test('executes task_resume', async () => {
        const handled = await TaskActionHandler.execute(ctx, {
            action: 'task_resume',
            taskId: 'task_1',
        }, controller);
        expect(handled).toBe(true);
        expect(controller.taskResume).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task_1' }));
        expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('接續先前進度'));
    });

    test('executes todo_write', async () => {
        const handled = await TaskActionHandler.execute(ctx, {
            action: 'todo_write',
            items: [{ content: 'A' }],
        }, controller);
        expect(handled).toBe(true);
        expect(controller.todoWrite).toHaveBeenCalled();
        expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('待辦進度已同步'));
    });

    test('executes task_metrics', async () => {
        const handled = await TaskActionHandler.execute(ctx, {
            action: 'task_metrics',
        }, controller);
        expect(handled).toBe(true);
        expect(controller.taskMetrics).toHaveBeenCalled();
        expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('任務健康度'));
    });

    test('executes task_integrity', async () => {
        const handled = await TaskActionHandler.execute(ctx, {
            action: 'task_integrity',
            options: { limit: 10 },
        }, controller);
        expect(handled).toBe(true);
        expect(controller.taskIntegrity).toHaveBeenCalledWith({ limit: 10 });
        expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('一致性檢查'));
    });

    test('supports detail mode for explicit task detail output', async () => {
        const handled = await TaskActionHandler.execute(ctx, {
            action: 'task_get',
            taskId: 'task_1',
            detail: true,
        }, controller);
        expect(handled).toBe(true);
        expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('任務詳情'));
    });
});
