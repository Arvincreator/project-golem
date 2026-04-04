jest.mock('../src/core/Executor', () => {
    return jest.fn().mockImplementation(() => ({
        run: jest.fn().mockResolvedValue('ok'),
    }));
});

const TaskController = require('../src/core/TaskController');

describe('TaskController', () => {
    beforeEach(() => {
        delete process.env.COMMAND_WHITELIST;
        delete process.env.GOLEM_TRUST_SYSTEM_COMMANDS;
        delete process.env.GOLEM_AUTO_APPROVE_ALL;
    });

    afterEach(() => {
        delete process.env.COMMAND_WHITELIST;
        delete process.env.GOLEM_TRUST_SYSTEM_COMMANDS;
        delete process.env.GOLEM_AUTO_APPROVE_ALL;
    });

    test('runSequence should execute basic ls command from GOLEM_ACTION without approval gate', async () => {
        const controller = new TaskController({ golemId: 'test-golem' });
        const ctx = { reply: jest.fn().mockResolvedValue(undefined) };

        const result = await controller.runSequence(ctx, [
            { action: 'command', parameter: 'ls -laG' }
        ]);

        controller.destroy();

        expect(result).toContain('[Step 1 Success]');
        expect(result).toContain('cmd: ls -laG');
        expect(ctx.reply).not.toHaveBeenCalled();
        expect(controller.pendingTasks.size).toBe(0);
    });

    test('runSequence should still require approval for complex command', async () => {
        const controller = new TaskController({ golemId: 'test-golem' });
        const ctx = { reply: jest.fn().mockResolvedValue(undefined) };

        const result = await controller.runSequence(ctx, [
            { action: 'command', parameter: 'cat $(ls)' }
        ]);

        controller.destroy();

        expect(result).toBeNull();
        expect(ctx.reply).toHaveBeenCalledWith(
            expect.stringContaining('⚠️ 🟡 警告'),
            expect.any(Object)
        );
        expect(controller.pendingTasks.size).toBe(1);
    });
});
