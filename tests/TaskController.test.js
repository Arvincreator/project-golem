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

    test('runSequence should assemble sys_admin through package runtime path', async () => {
        const controller = new TaskController({ golemId: 'test-golem' });
        const ctx = { reply: jest.fn().mockResolvedValue(undefined) };

        const result = await controller.runSequence(ctx, [
            { action: 'sys_admin', parameters: { command: 'echo hello' } }
        ]);

        controller.destroy();

        expect(result).toContain('[Step 1 Success]');
        expect(result).toContain('src/skills/modules/sys-admin/index.js');
        expect(result).not.toContain('src/skills/core/sys-admin.js');
    });

    test('runSequence should preserve complex sys_admin payload for approval', async () => {
        const controller = new TaskController({ golemId: 'test-golem' });
        const ctx = { reply: jest.fn().mockResolvedValue(undefined) };

        const result = await controller.runSequence(ctx, [
            { action: 'sys_admin', parameters: { command: 'ps -Aro %cpu,%mem,comm | grep -iE "node|zombie" | head -n 10' } }
        ]);

        controller.destroy();

        expect(result).toBeNull();
        expect(ctx.reply).toHaveBeenCalledWith(
            expect.stringContaining('src/skills/modules/sys-admin/index.js'),
            expect.any(Object)
        );
        expect(ctx.reply.mock.calls[0][0]).toContain('node|zombie');
        expect(ctx.reply.mock.calls[0][0]).not.toContain('src/skills/core/sys-admin.js');
    });
});
