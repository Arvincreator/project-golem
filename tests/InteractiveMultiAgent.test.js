const InteractiveMultiAgent = require('../src/core/InteractiveMultiAgent');

describe('InteractiveMultiAgent worker tabs', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    test('startConversation creates per-agent workers and disposes them on cleanup', async () => {
        const workerA = { init: jest.fn().mockResolvedValue(), dispose: jest.fn().mockResolvedValue() };
        const workerB = { init: jest.fn().mockResolvedValue(), dispose: jest.fn().mockResolvedValue() };
        const brain = {
            createEphemeralWorker: jest.fn()
                .mockResolvedValueOnce(workerA)
                .mockResolvedValueOnce(workerB),
            sendMessage: jest.fn(),
            _appendChatLog: jest.fn()
        };

        const multi = new InteractiveMultiAgent(brain);
        const loopSpy = jest.spyOn(multi, '_interactiveLoop').mockImplementation(async () => {
            multi.activeConversation.status = 'completed';
        });
        const summarySpy = jest.spyOn(multi, '_generateSummary').mockResolvedValue();

        const ctx = {
            chatId: 'chat-1',
            reply: jest.fn().mockResolvedValue(),
            sendTyping: jest.fn().mockResolvedValue()
        };
        const agents = [
            { name: 'Alex', role: 'FE', personality: 'p', expertise: ['react'] },
            { name: 'Bob', role: 'BE', personality: 'p', expertise: ['node'] }
        ];

        await multi.startConversation(ctx, 'build a feature', agents, { toolset: 'research', maxRounds: 1 });

        expect(brain.createEphemeralWorker).toHaveBeenCalledTimes(2);
        expect(brain.createEphemeralWorker).toHaveBeenNthCalledWith(1, expect.objectContaining({ toolset: 'research' }));
        expect(brain.createEphemeralWorker).toHaveBeenNthCalledWith(2, expect.objectContaining({ toolset: 'research' }));
        expect(workerA.init).toHaveBeenCalledWith(true);
        expect(workerB.init).toHaveBeenCalledWith(true);
        expect(workerA.dispose).toHaveBeenCalledWith({ closeContext: false });
        expect(workerB.dispose).toHaveBeenCalledWith({ closeContext: false });
        expect(loopSpy).toHaveBeenCalledTimes(1);
        expect(summarySpy).toHaveBeenCalledTimes(1);
    });

    test('agent speech routes through worker brain when available', async () => {
        const workerBrain = {
            sendMessage: jest.fn().mockResolvedValue('[GOLEM_REPLY] worker response')
        };
        const brain = {
            sendMessage: jest.fn(),
            _appendChatLog: jest.fn()
        };
        const multi = new InteractiveMultiAgent(brain);
        const agent = { name: 'Alex', role: 'FE', personality: 'p', expertise: ['react'] };
        multi.activeConversation = {
            task: 'task',
            agents: [agent],
            context: '',
            messages: [],
            sharedMemory: [],
            maxRounds: 1,
            agentWorkers: new Map([['alex', { brain: workerBrain, toolset: 'assistant' }]])
        };
        const ctx = {
            reply: jest.fn().mockResolvedValue(),
            sendTyping: jest.fn().mockResolvedValue()
        };

        await multi._agentSpeak(ctx, agent, 1);

        expect(workerBrain.sendMessage).toHaveBeenCalledTimes(1);
        expect(brain.sendMessage).not.toHaveBeenCalled();
    });

    test('default toolset mapping infers FE=creative and BE=coding', () => {
        const multi = new InteractiveMultiAgent({ sendMessage: jest.fn() });
        multi.activeConversation = {
            options: {},
            agentWorkers: new Map()
        };

        const fe = { name: 'Alex', role: '前端工程師', expertise: ['UI', 'React'] };
        const be = { name: 'Bob', role: '後端工程師', expertise: ['API', 'Database'] };
        const pm = { name: 'Carol', role: '產品經理', expertise: ['market'] };

        expect(multi._resolveAgentToolset(fe)).toBe('creative');
        expect(multi._resolveAgentToolset(be)).toBe('coding');
        expect(multi._resolveAgentToolset(pm)).toBe('research');
    });

    test('worker timeout triggers recovery and retries once on a new tab', async () => {
        jest.useFakeTimers();
        const staleWorker = {
            sendMessage: jest.fn(() => new Promise(() => {})),
            dispose: jest.fn().mockResolvedValue()
        };
        const recoveredWorker = {
            init: jest.fn().mockResolvedValue(),
            sendMessage: jest.fn().mockResolvedValue('[GOLEM_REPLY] recovered'),
            dispose: jest.fn().mockResolvedValue()
        };
        const brain = {
            createEphemeralWorker: jest.fn().mockResolvedValue(recoveredWorker),
            sendMessage: jest.fn().mockResolvedValue('[GOLEM_REPLY] main'),
            _appendChatLog: jest.fn()
        };
        const multi = new InteractiveMultiAgent(brain);
        const agent = { name: 'Alex', role: '前端工程師', expertise: ['React'] };
        multi.activeConversation = {
            id: 'conv_test',
            options: { workerSendTimeoutMs: 1200, workerDraftCheckIntervalMs: 10000 },
            workerSendTimeoutMs: 1200,
            workerDraftCheckIntervalMs: 10000,
            agentWorkers: new Map([[
                'alex',
                {
                    brain: staleWorker,
                    toolset: 'creative',
                    createdAt: Date.now(),
                    lastUsedAt: Date.now(),
                    busy: false
                }
            ]])
        };

        const pending = multi._sendViaAgent(agent, 'prompt', 'round_speak');
        jest.advanceTimersByTime(1300);
        await Promise.resolve();
        const response = await pending;

        expect(staleWorker.dispose).toHaveBeenCalledWith({ closeContext: false });
        expect(brain.createEphemeralWorker).toHaveBeenCalledTimes(1);
        expect(recoveredWorker.init).toHaveBeenCalledWith(true);
        expect(recoveredWorker.sendMessage).toHaveBeenCalledTimes(1);
        expect(response).toBe('[GOLEM_REPLY] recovered');
        expect(brain.sendMessage).not.toHaveBeenCalled();
    });

    test('supports split send timeout and idle timeout values', () => {
        const multi = new InteractiveMultiAgent({ sendMessage: jest.fn() });
        const options = {
            workerSendTimeoutMs: 30000,
            workerIdleTimeoutMs: 180000,
            workerDraftCheckIntervalMs: 10000,
        };
        expect(multi._resolveWorkerSendTimeoutMs(options)).toBe(30000);
        expect(multi._resolveWorkerIdleTimeoutMs(options)).toBe(180000);
        expect(multi._resolveWorkerDraftCheckIntervalMs(options)).toBe(10000);
    });

    test('checks pending draft while sending message on interval', async () => {
        const workerBrain = {
            sendMessage: jest.fn(() => new Promise(resolve => setTimeout(() => resolve('[GOLEM_REPLY] ok'), 80))),
            page: {
                isClosed: jest.fn(() => false),
                evaluate: jest.fn().mockResolvedValue({ hasDraft: true, length: 12 })
            }
        };
        const brain = {
            sendMessage: jest.fn(),
            _appendChatLog: jest.fn()
        };
        const multi = new InteractiveMultiAgent(brain);
        const agent = { name: 'Alex', role: 'FE', personality: 'p', expertise: ['react'] };
        const draftSpy = jest.spyOn(multi, '_checkPendingDraft');

        multi.activeConversation = {
            options: { workerSendTimeoutMs: 5000, workerDraftCheckIntervalMs: 10 },
            workerSendTimeoutMs: 5000,
            workerDraftCheckIntervalMs: 10,
            agentWorkers: new Map([[
                'alex',
                {
                    brain: workerBrain,
                    toolset: 'creative',
                    createdAt: Date.now(),
                    lastUsedAt: Date.now(),
                    busy: false
                }
            ]])
        };

        const pending = multi._sendViaAgent(agent, 'prompt', 'round_speak');
        const response = await pending;

        expect(workerBrain.sendMessage).toHaveBeenCalledTimes(1);
        expect(draftSpy).toHaveBeenCalled();
        expect(response).toBe('[GOLEM_REPLY] ok');
        expect(brain.sendMessage).not.toHaveBeenCalled();
    });
});
