jest.mock('../src/core/GolemBrain', () => jest.fn());

const GolemBrain = require('../src/core/GolemBrain');
const delegateTask = require('../src/skills/core/delegate-task');

describe('delegate-task skill', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('uses ephemeral worker from parent brain and disposes it after completion', async () => {
        const subBrain = {
            init: jest.fn().mockResolvedValue(),
            sendMessage: jest.fn().mockResolvedValue({ text: 'child report' }),
            dispose: jest.fn().mockResolvedValue()
        };
        const brain = {
            userDataDir: '/tmp/test',
            createEphemeralWorker: jest.fn().mockResolvedValue(subBrain)
        };

        const result = await delegateTask.run({
            args: {
                subtask: 'analyze project architecture',
                toolset: 'research',
                context: 'focus on delegated worker flow'
            },
            brain
        });

        expect(brain.createEphemeralWorker).toHaveBeenCalledWith(expect.objectContaining({
            toolset: 'research'
        }));
        expect(subBrain.init).toHaveBeenCalledWith(true);
        expect(subBrain.sendMessage).toHaveBeenCalledTimes(1);
        expect(subBrain.dispose).toHaveBeenCalledWith({ closeContext: false });
        expect(result).toContain('child report');
    });

    test('falls back to standalone GolemBrain when parent cannot create worker', async () => {
        const fallbackWorker = {
            init: jest.fn().mockResolvedValue(),
            sendMessage: jest.fn().mockResolvedValue({ text: 'fallback report' }),
            dispose: jest.fn().mockResolvedValue()
        };
        GolemBrain.mockImplementationOnce(() => fallbackWorker);

        const result = await delegateTask.run({
            args: {
                subtask: 'lint repo',
                toolset: 'safe'
            },
            brain: { userDataDir: '/tmp/test' }
        });

        expect(GolemBrain).toHaveBeenCalledWith(expect.objectContaining({
            toolsetScene: 'safe',
            disableHistoricalMemoryInjection: true
        }));
        expect(fallbackWorker.init).toHaveBeenCalledWith(true);
        expect(fallbackWorker.dispose).toHaveBeenCalledWith({ closeContext: false });
        expect(result).toContain('fallback report');
    });

    test('rejects unknown toolset', async () => {
        const result = await delegateTask.run({
            args: {
                subtask: 'do something',
                toolset: 'unknown-scene'
            },
            brain: {}
        });

        expect(result).toContain('未知的場景');
    });
});
