const fs = require('fs');
const os = require('os');
const path = require('path');

const TaskKernel = require('../src/managers/TaskKernel');

describe('TaskKernel', () => {
    let tempRoot;

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-kernel-test-'));
    });

    afterEach(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    test('creates tasks and enforces strict completion verification', () => {
        const kernel = new TaskKernel({
            golemId: 'test',
            logDir: tempRoot,
            strictMode: true,
        });

        const created = kernel.createTask({
            subject: 'Implement task kernel',
            status: 'in_progress',
        });
        expect(created.task.status).toBe('in_progress');

        expect(() => kernel.updateTask(created.task.id, { status: 'completed' }))
            .toThrow(/verification\.status=verified/i);

        kernel.updateTask(created.task.id, {
            verification: { status: 'verified', note: 'unit tested' },
            clearError: true,
        });

        const completed = kernel.updateTask(created.task.id, {
            status: 'completed',
            clearError: true,
        });
        expect(completed.task.status).toBe('completed');
        expect(completed.task.completedAt).toBeGreaterThan(0);
    });

    test('allows at most one in_progress task in strict mode', () => {
        const kernel = new TaskKernel({
            golemId: 'strict',
            logDir: tempRoot,
            strictMode: true,
        });

        kernel.createTask({
            subject: 'Task A',
            status: 'in_progress',
        });

        expect(() => kernel.createTask({
            subject: 'Task B',
            status: 'in_progress',
        })).toThrow(/another task already in_progress/i);
    });

    test('todo_write promotes first pending task when no in_progress exists', () => {
        const kernel = new TaskKernel({
            golemId: 'todo',
            logDir: tempRoot,
            strictMode: true,
        });

        const result = kernel.applyTodoWrite([
            { content: 'Step 1', status: 'pending' },
            { content: 'Step 2', status: 'pending' },
        ], { actor: 'test' });

        expect(result.changed.length).toBeGreaterThanOrEqual(2);
        const tasks = kernel.listTasks({ includeCompleted: false });
        const inProgress = tasks.filter((task) => task.status === 'in_progress');
        expect(inProgress.length).toBe(1);
    });

    test('persists tasks and approvals across reload', () => {
        const kernelA = new TaskKernel({
            golemId: 'persist',
            logDir: tempRoot,
            strictMode: true,
        });

        const { task } = kernelA.createTask({
            subject: 'Persistent task',
            status: 'pending',
        });

        kernelA.setApproval('approval_1', {
            type: 'COMMAND_APPROVAL',
            taskId: task.id,
            timestamp: Date.now(),
        }, { ttlMs: 60 * 1000 });

        const kernelB = new TaskKernel({
            golemId: 'persist',
            logDir: tempRoot,
            strictMode: true,
        });

        const loadedTask = kernelB.getTask(task.id);
        expect(loadedTask).toBeTruthy();
        expect(loadedTask.subject).toBe('Persistent task');

        const approval = kernelB.getApproval('approval_1');
        expect(approval).toBeTruthy();
        expect(approval.payload.taskId).toBe(task.id);
    });

    test('recovery summary reflects non-terminal tasks', () => {
        const kernel = new TaskKernel({
            golemId: 'recovery',
            logDir: tempRoot,
            strictMode: true,
        });

        kernel.createTask({ subject: 'Pending one', status: 'pending' });
        kernel.createTask({ subject: 'Blocked one', status: 'blocked' });

        const summary = kernel.getRecoverySummary();
        expect(summary.pendingCount).toBeGreaterThanOrEqual(1);
        expect(summary.blockedCount).toBeGreaterThanOrEqual(1);
        expect(summary.nextTaskId).toBeTruthy();
    });

    test('metrics tracks strict intercepts and completion rates', () => {
        const kernel = new TaskKernel({
            golemId: 'metrics',
            logDir: tempRoot,
            strictMode: true,
        });

        const created = kernel.createTask({
            subject: 'Run sequence',
            status: 'in_progress',
        });

        expect(() => kernel.updateTask(created.task.id, { status: 'completed' }))
            .toThrow(/verification/i);

        let metrics = kernel.getMetrics();
        expect(metrics.fakeCompletionIntercepts).toBeGreaterThanOrEqual(1);
        expect(metrics.totals.byStatus.in_progress).toBe(1);

        kernel.updateTask(created.task.id, {
            verification: { status: 'verified', note: 'ok' },
            clearError: true,
        });
        kernel.updateTask(created.task.id, {
            status: 'completed',
            clearError: true,
        });

        metrics = kernel.getMetrics();
        expect(metrics.totals.byStatus.completed).toBe(1);
        expect(metrics.completionRate).toBeGreaterThan(0);
        expect(metrics.terminalSuccessRate).toBeGreaterThan(0);
    });

    test('metrics aggregates usage and version conflicts', () => {
        const kernel = new TaskKernel({
            golemId: 'usage',
            logDir: tempRoot,
            strictMode: true,
        });

        const created = kernel.createTask({
            subject: 'Token accounting',
            status: 'pending',
            usage: {
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
                costUsd: 0.01,
            },
        });

        kernel.updateTask(created.task.id, {
            usage: {
                promptTokens: 20,
                completionTokens: 8,
                costUsd: 0.02,
            },
        }, {
            expectedVersion: created.task.version,
        });

        expect(() => kernel.updateTask(created.task.id, {
            status: 'in_progress',
        }, {
            expectedVersion: created.task.version,
        })).toThrow(/version mismatch/i);

        const metrics = kernel.getMetrics();
        expect(metrics.usage.totalTokens).toBeGreaterThanOrEqual(43);
        expect(metrics.usage.costUsd).toBeCloseTo(0.03, 6);
        expect(metrics.versionConflicts).toBeGreaterThanOrEqual(1);
    });

    test('integrity report detects violations under non-strict data', () => {
        const kernel = new TaskKernel({
            golemId: 'integrity',
            logDir: tempRoot,
            strictMode: false,
        });

        kernel.createTask({
            id: 'task_a',
            subject: 'A',
            status: 'in_progress',
        });
        kernel.createTask({
            id: 'task_b',
            subject: 'B',
            status: 'in_progress',
        });
        kernel.createTask({
            id: 'task_c',
            subject: 'C',
            status: 'completed',
            blockedBy: ['missing_task'],
        });

        const report = kernel.getIntegrityReport({ limit: 20 });
        expect(report.ok).toBe(false);
        expect(report.violationCount).toBeGreaterThan(0);
        expect(report.byType.multiple_in_progress).toBeGreaterThanOrEqual(1);
        expect(report.byType.completed_without_verified).toBeGreaterThanOrEqual(1);
    });
});
