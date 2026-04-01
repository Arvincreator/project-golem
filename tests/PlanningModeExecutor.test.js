const PlanningModeExecutor = require('../src/core/PlanningModeExecutor');

function createControllerMock() {
    let workerSeq = 0;
    const session = {
        id: 'agent_session_000001',
        objective: '測試目標',
        status: 'running',
        metadata: {
            workflow: {
                phase: 'research',
            },
        },
    };

    return {
        agentResume: jest.fn(() => ({ resumed: false, resumedCount: 0, session: null })),
        agentSessionCreate: jest.fn(() => ({ session: { ...session } })),
        agentWorkerSpawn: jest.fn(({ role }) => {
            workerSeq += 1;
            return {
                session: { ...session },
                worker: {
                    id: `agent_worker_${String(workerSeq).padStart(6, '0')}`,
                    sessionId: session.id,
                    role,
                    status: 'pending',
                },
            };
        }),
        agentWorkerUpdate: jest.fn(() => ({})),
        agentMessage: jest.fn(() => ({})),
        agentSessionUpdate: jest.fn(() => ({ session: { ...session } })),
        agentGetSession: jest.fn(() => ({
            session: { ...session },
            workers: [],
        })),
    };
}

describe('PlanningModeExecutor', () => {
    test('runs four phases and replies once with summary', async () => {
        const controller = createControllerMock();
        const brain = {
            sendMessage: jest
                .fn()
                .mockResolvedValueOnce({ text: '[[BEGIN:x]][GOLEM_REPLY]research done[[END:x]]' })
                .mockResolvedValueOnce({ text: '[[BEGIN:x]][GOLEM_REPLY]synthesis done[[END:x]]' })
                .mockResolvedValueOnce({ text: '[[BEGIN:x]][GOLEM_REPLY]implementation done[[END:x]]' })
                .mockResolvedValueOnce({ text: '[[BEGIN:x]][GOLEM_REPLY]verification done[[END:x]]' }),
            runInIsolatedTab: jest.fn(async (callback) => callback()),
        };
        const ctx = {
            senderName: 'tester',
            reply: jest.fn(async () => {}),
        };

        const executor = new PlanningModeExecutor({ brain, controller });
        const result = await executor.execute({
            ctx,
            userInput: '請規劃並完成多步任務',
            routeDecision: { usePlanning: true, score: 9 },
        });

        expect(result.success).toBe(true);
        expect(controller.agentWorkerSpawn).toHaveBeenCalledTimes(4);
        expect(ctx.reply).toHaveBeenCalledTimes(1);
        expect(ctx.reply.mock.calls[0][0]).toContain('Planning Mode');
    });

    test('marks failure and returns blocker reply when worker execution throws', async () => {
        const controller = createControllerMock();
        const brain = {
            sendMessage: jest.fn(async () => {
                throw new Error('network timeout');
            }),
            runInIsolatedTab: jest.fn(async (callback) => callback()),
        };
        const ctx = {
            senderName: 'tester',
            reply: jest.fn(async () => {}),
        };

        const executor = new PlanningModeExecutor({ brain, controller });
        const result = await executor.execute({
            ctx,
            userInput: '請做規劃',
            routeDecision: { usePlanning: true, score: 8 },
        });

        expect(result.success).toBe(false);
        expect(ctx.reply).toHaveBeenCalledTimes(1);
        expect(ctx.reply.mock.calls[0][0]).toContain('遇到阻塞');
        expect(controller.agentSessionUpdate).toHaveBeenCalledWith(
            'agent_session_000001',
            expect.objectContaining({ status: 'failed' }),
            expect.any(Object)
        );
    });
});
