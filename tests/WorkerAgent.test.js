const WorkerAgent = require('../src/core/agents/WorkerAgent');
const AgentBus = require('../src/core/AgentBus');

describe('WorkerAgent', () => {
    let bus, agent, mockBrain;

    beforeEach(() => {
        bus = new AgentBus();
        mockBrain = { sendMessage: jest.fn().mockResolvedValue('Task completed') };
        agent = new WorkerAgent({ bus, brain: mockBrain, oodaIntervalMs: 100000, name: 'test-worker' });
    });

    afterEach(async () => {
        await agent.stop();
    });

    test('has correct type and defaults', () => {
        expect(agent.type).toBe('worker');
        expect(agent._tokenBudgetMax).toBe(3000);
    });

    test('collects non-analysis task requests', () => {
        bus.publish('task.request', { type: 'generic', prompt: 'do thing' }, 'sender');
        expect(agent._pendingTasks).toHaveLength(1);
    });

    test('ignores analysis task requests', () => {
        bus.publish('task.request', { type: 'analysis', payload: 'test' }, 'sender');
        expect(agent._pendingTasks).toHaveLength(0);
    });

    test('decide returns noop when no tasks', async () => {
        const obs = await agent._observe();
        const analysis = agent._orient(obs);
        const decision = agent._decide(analysis);
        expect(decision.action).toBe('noop');
    });

    test('decide returns execute_task when pending', () => {
        agent._pendingTasks.push({ type: 'generic', prompt: 'test' });
        const obs = { pendingTasks: agent._pendingTasks };
        const analysis = agent._orient(obs);
        const decision = agent._decide(analysis);
        expect(decision.action).toBe('execute_task');
    });

    test('act calls brain with prompt', async () => {
        await agent._act({
            action: 'execute_task', level: 'L0', reason: 'test',
            payload: { task: { type: 'generic', prompt: 'do the thing' } }
        });

        expect(mockBrain.sendMessage).toHaveBeenCalledWith('do the thing');
    });

    test('act publishes task.result', async () => {
        const handler = jest.fn();
        bus.subscribe('task.result', handler, 'listener');

        agent._pendingTasks.push({ type: 'generic', prompt: 'test' });
        await agent._act({
            action: 'execute_task', level: 'L0', reason: 'test',
            payload: { task: { type: 'generic', prompt: 'test' } }
        });

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].payload.type).toBe('task_execution');
    });

    test('act without brain still processes task', async () => {
        const noBrainAgent = new WorkerAgent({ bus, brain: null, oodaIntervalMs: 100000, name: 'no-brain' });
        noBrainAgent._pendingTasks.push({ type: 'simple' });

        await noBrainAgent._act({
            action: 'execute_task', level: 'L0', reason: 'test',
            payload: { task: { type: 'simple' } }
        });

        const log = noBrainAgent.getActivityLog();
        expect(log.some(e => e.event === 'task_complete')).toBe(true);
        await noBrainAgent.stop();
    });

    test('act handles brain error gracefully', async () => {
        const failBrain = { sendMessage: jest.fn().mockRejectedValue(new Error('brain error')) };
        const errorAgent = new WorkerAgent({ bus, brain: failBrain, oodaIntervalMs: 100000, name: 'err-worker' });
        errorAgent._pendingTasks.push({ type: 'generic', prompt: 'fail' });

        await errorAgent._act({
            action: 'execute_task', level: 'L0', reason: 'test',
            payload: { task: { type: 'generic', prompt: 'fail' } }
        });

        const log = errorAgent.getActivityLog();
        expect(log.some(e => e.event === 'task_error')).toBe(true);
        await errorAgent.stop();
    });
});
