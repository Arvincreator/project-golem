const ActionQueue = require('../src/core/ActionQueue');

describe('ActionQueue', () => {
    let queue;

    beforeEach(() => {
        queue = new ActionQueue({ golemId: 'test' });
    });

    afterEach(() => {
        queue = null;
    });

    test('creates instance with golemId', () => {
        expect(queue).toBeDefined();
        expect(queue.golemId).toBe('test');
    });

    test('enqueue and execute a task', async () => {
        const mockCtx = { chatId: 'test', reply: jest.fn().mockResolvedValue(), sendTyping: jest.fn().mockResolvedValue() };
        let executed = false;

        await queue.enqueue(mockCtx, async () => {
            executed = true;
        });

        // Wait for async processing
        await new Promise(r => setTimeout(r, 100));
        expect(executed).toBe(true);
    });

    test('handles errors and stores in DLQ', async () => {
        const mockCtx = { chatId: 'test', reply: jest.fn().mockResolvedValue(), sendTyping: jest.fn().mockResolvedValue() };

        await queue.enqueue(mockCtx, async () => {
            throw new Error('Test error');
        });

        await new Promise(r => setTimeout(r, 100));
        const dlq = queue.getDLQ();
        expect(dlq.length).toBe(1);
        expect(dlq[0].error).toBe('Test error');
    });

    test('deduplicates tasks within window', async () => {
        const mockCtx = { chatId: 'test', reply: jest.fn().mockResolvedValue(), sendTyping: jest.fn().mockResolvedValue() };
        let count = 0;

        await queue.enqueue(mockCtx, async () => { count++; }, { dedupKey: 'same-key' });
        await queue.enqueue(mockCtx, async () => { count++; }, { dedupKey: 'same-key' });

        await new Promise(r => setTimeout(r, 100));
        expect(count).toBe(1);
    });

    test('getStatus returns queue info', () => {
        const status = queue.getStatus();
        expect(status).toHaveProperty('depth');
        expect(status).toHaveProperty('maxDepth');
        expect(status).toHaveProperty('isProcessing');
        expect(status).toHaveProperty('dlqSize');
    });

    test('rejects tasks when queue is full', async () => {
        const mockCtx = { chatId: 'test', reply: jest.fn().mockResolvedValue(), sendTyping: jest.fn().mockResolvedValue() };

        // Fill the queue by pausing processing
        queue.isProcessing = true;
        for (let i = 0; i < 10; i++) {
            await queue.enqueue(mockCtx, async () => {});
        }

        // 11th should be rejected
        await queue.enqueue(mockCtx, async () => {});
        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('佇列已滿'));
    });
});
