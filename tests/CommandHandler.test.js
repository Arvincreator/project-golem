const CommandHandler = require('../src/core/action_handlers/CommandHandler');

jest.mock('../index', () => ({
    getOrCreateGolem: jest.fn()
}), { virtual: true }); // Prevent actual resolution errors if index structure differs in test env

describe('CommandHandler', () => {
    let mockCtx;
    let mockController;
    let mockBrain;
    let mockDispatchFn;
    let mockActionQueue;
    let mockConvoManager;

    beforeEach(() => {
        jest.clearAllMocks();
        mockCtx = {
            reply: jest.fn().mockResolvedValue(),
            sendTyping: jest.fn().mockResolvedValue()
        };
        mockController = {
            runSequence: jest.fn(),
            golemId: 'test-golem'
        };
        mockBrain = {
            sendMessage: jest.fn().mockResolvedValue('brain reply')
        };
        mockDispatchFn = jest.fn().mockResolvedValue();
        mockActionQueue = {
            enqueue: jest.fn(async (ctx, fn) => await fn()) // immediately execute and await
        };
        mockConvoManager = {
            enqueue: jest.fn()
        };

        // Mock index.js
        try {
            require('../index').getOrCreateGolem.mockReturnValue({
                actionQueue: mockActionQueue,
                convoManager: mockConvoManager
            });
        } catch(e) {}
    });

    test('execute should do nothing if no normalActions', async () => {
        await CommandHandler.execute(mockCtx, [], mockController, mockBrain, mockDispatchFn);
        expect(mockController.runSequence).not.toHaveBeenCalled();
    });

    test('execute should handle runSequence error', async () => {
        mockController.runSequence.mockRejectedValue(new Error('Sequence failed'));
        await CommandHandler.execute(mockCtx, [{ action: 'cmd' }], mockController, mockBrain, mockDispatchFn);
        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('Sequence failed'), expect.anything());
    });

    test('execute should handle string observation result', async () => {
        mockController.runSequence.mockResolvedValue('Command output success');
        await CommandHandler.execute(mockCtx, [{ action: 'cmd' }], mockController, mockBrain, mockDispatchFn);
        
        // Should enqueue to convoManager
        expect(mockConvoManager.enqueue).toHaveBeenCalledWith(
            mockCtx,
            expect.stringContaining('Command output success'),
            expect.objectContaining({ isPriority: true })
        );
    });

    test('execute should handle error string observation result', async () => {
        const errorString = `[Step 1 Failed]\ncmd: ls bad\nError:\nNo such file or directory\n\n----------------\n\n`;
        mockController.runSequence.mockResolvedValue(errorString);
        await CommandHandler.execute(mockCtx, [{ action: 'cmd' }], mockController, mockBrain, mockDispatchFn);
        
        // Should reply with error summary
        expect(mockCtx.reply).toHaveBeenCalledWith(
            expect.stringContaining('指令執行失敗'),
            expect.anything()
        );
    });
});
