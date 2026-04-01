const AgentActionHandler = require('../src/core/action_handlers/AgentActionHandler');

describe('AgentActionHandler', () => {
    let ctx;
    let controller;

    beforeEach(() => {
        ctx = {
            senderName: 'tester',
            reply: jest.fn().mockResolvedValue(undefined),
        };

        controller = {
            agentSessionCreate: jest.fn().mockReturnValue({
                session: {
                    id: 'agent_session_000001',
                    status: 'pending',
                    objective: 'test objective',
                    metadata: { workflow: { phase: 'research' } },
                },
            }),
            agentWorkerSpawn: jest.fn().mockReturnValue({
                session: {
                    id: 'agent_session_000001',
                    status: 'running',
                    objective: 'test objective',
                    metadata: { workflow: { phase: 'research' } },
                },
                worker: {
                    id: 'agent_worker_000001',
                    sessionId: 'agent_session_000001',
                    role: 'research',
                    status: 'pending',
                },
            }),
            agentMessage: jest.fn().mockReturnValue({
                session: {
                    id: 'agent_session_000001',
                    status: 'running',
                    objective: 'test objective',
                    metadata: { workflow: { phase: 'research' } },
                },
                worker: null,
            }),
            agentWait: jest.fn().mockResolvedValue({
                done: false,
                waitedMs: 1200,
                session: {
                    id: 'agent_session_000001',
                    status: 'running',
                    objective: 'test objective',
                    metadata: { workflow: { phase: 'research' } },
                },
                workers: [],
            }),
            agentStop: jest.fn().mockReturnValue({
                session: {
                    id: 'agent_session_000001',
                    status: 'killed',
                    objective: 'test objective',
                    metadata: { workflow: { phase: 'research' } },
                },
            }),
            agentList: jest.fn().mockReturnValue({
                sessions: [
                    {
                        id: 'agent_session_000001',
                        status: 'running',
                        objective: 'test objective',
                        metadata: { workflow: { phase: 'research' } },
                    },
                ],
                workers: [
                    {
                        id: 'agent_worker_000001',
                        sessionId: 'agent_session_000001',
                        role: 'research',
                        status: 'running',
                    },
                ],
            }),
            agentGetSession: jest.fn().mockReturnValue({
                session: {
                    id: 'agent_session_000001',
                    status: 'running',
                    objective: 'test objective',
                    metadata: { workflow: { phase: 'research' } },
                },
                workers: [],
            }),
            agentGetWorker: jest.fn().mockReturnValue({
                worker: {
                    id: 'agent_worker_000001',
                    sessionId: 'agent_session_000001',
                    role: 'research',
                    status: 'running',
                },
                session: {
                    id: 'agent_session_000001',
                    status: 'running',
                    objective: 'test objective',
                    metadata: { workflow: { phase: 'research' } },
                },
            }),
            agentResume: jest.fn().mockReturnValue({
                resumed: true,
                resumedCount: 1,
                brief: {
                    runningWorkers: 1,
                    nextSession: { id: 'agent_session_000001' },
                },
            }),
        };
    });

    test('recognizes supported actions', () => {
        expect(AgentActionHandler.isAgentAction('agent_session_create')).toBe(true);
        expect(AgentActionHandler.isAgentAction('agent_worker_spawn')).toBe(true);
        expect(AgentActionHandler.isAgentAction('agent_resume')).toBe(true);
        expect(AgentActionHandler.isAgentAction('command')).toBe(false);
    });

    test('executes agent_session_create', async () => {
        const handled = await AgentActionHandler.execute(ctx, {
            action: 'agent_session_create',
            input: { objective: 'test objective' },
        }, controller);

        expect(handled).toBe(true);
        expect(controller.agentSessionCreate).toHaveBeenCalled();
        expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Agent session created'));
    });

    test('executes agent_worker_spawn', async () => {
        const handled = await AgentActionHandler.execute(ctx, {
            action: 'agent_worker_spawn',
            input: {
                sessionId: 'agent_session_000001',
                role: 'research',
                prompt: 'analyze',
            },
        }, controller);

        expect(handled).toBe(true);
        expect(controller.agentWorkerSpawn).toHaveBeenCalled();
        expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Agent worker spawned'));
    });

    test('executes agent_wait', async () => {
        const handled = await AgentActionHandler.execute(ctx, {
            action: 'agent_wait',
            sessionId: 'agent_session_000001',
            timeoutMs: 5000,
        }, controller);

        expect(handled).toBe(true);
        expect(controller.agentWait).toHaveBeenCalledWith('agent_session_000001', expect.objectContaining({ timeoutMs: 5000 }));
        expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('agent_wait'));
    });

    test('executes agent_resume', async () => {
        const handled = await AgentActionHandler.execute(ctx, {
            action: 'agent_resume',
        }, controller);

        expect(handled).toBe(true);
        expect(controller.agentResume).toHaveBeenCalled();
        expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Agent resume'));
    });

    test('executes agent_focus with orchestration hint', async () => {
        const handled = await AgentActionHandler.execute(ctx, {
            action: 'agent_focus',
            sessionId: 'agent_session_000001',
        }, controller);

        expect(handled).toBe(true);
        expect(controller.agentGetSession).toHaveBeenCalledWith('agent_session_000001');
        expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Agent focus'));
    });
});
