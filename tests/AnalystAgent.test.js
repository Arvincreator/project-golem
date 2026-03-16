const AnalystAgent = require('../src/core/agents/AnalystAgent');
const AgentBus = require('../src/core/AgentBus');

describe('AnalystAgent', () => {
    let bus, agent, mockBrain;

    beforeEach(() => {
        bus = new AgentBus();
        mockBrain = { sendMessage: jest.fn().mockResolvedValue('Analysis result: all clear') };
        agent = new AnalystAgent({ bus, brain: mockBrain, oodaIntervalMs: 100000, name: 'test-analyst' });
    });

    afterEach(async () => {
        await agent.stop();
    });

    test('has correct type and defaults', () => {
        expect(agent.type).toBe('analyst');
        expect(agent._tokenBudgetMax).toBe(5000);
    });

    test('collects alerts from bus', () => {
        bus.publish('alert', { alerts: [{ type: 'memory', detail: 'high' }] }, 'sentinel:s');
        expect(agent._pendingAlerts).toHaveLength(1);
    });

    test('does not collect own alerts', () => {
        bus.publish('alert', { test: true }, agent.id);
        expect(agent._pendingAlerts).toHaveLength(0);
    });

    test('collects analysis task requests', () => {
        bus.publish('task.request', { type: 'analysis', payload: 'test' }, 'ooda:default');
        expect(agent._pendingTasks).toHaveLength(1);
    });

    test('decide returns noop when nothing pending', () => {
        const obs = { pendingAlerts: [], pendingTasks: [] };
        const analysis = agent._orient(obs);
        const decision = agent._decide(analysis);
        expect(decision.action).toBe('noop');
    });

    test('decide returns analyze when pending items', async () => {
        agent._pendingAlerts.push({ alerts: [{ detail: 'test' }] });
        const obs = await agent._observe();
        const analysis = agent._orient(obs);
        const decision = agent._decide(analysis);
        expect(decision.action).toBe('analyze');
    });

    test('act calls brain.sendMessage', async () => {
        agent._pendingAlerts.push({ alerts: [{ detail: 'test alert' }] });

        await agent._act({
            action: 'analyze', level: 'L0', reason: 'test',
            payload: { items: [{ alerts: [{ detail: 'test alert' }] }] }
        });

        expect(mockBrain.sendMessage).toHaveBeenCalledTimes(1);
        expect(mockBrain.sendMessage.mock.calls[0][0]).toContain('Analysis Request');
    });

    test('act publishes task.result', async () => {
        const handler = jest.fn();
        bus.subscribe('task.result', handler, 'listener');

        await agent._act({
            action: 'analyze', level: 'L0', reason: 'test',
            payload: { items: [{ alerts: [{ detail: 'test' }] }] }
        });

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].payload.type).toBe('analysis');
    });

    test('act skips when no brain', async () => {
        const noBrainAgent = new AnalystAgent({ bus, brain: null, oodaIntervalMs: 100000, name: 'no-brain' });
        await noBrainAgent._act({ action: 'analyze', payload: { items: [] } });
        const log = noBrainAgent.getActivityLog();
        expect(log.some(e => e.event === 'skip_no_brain')).toBe(true);
        await noBrainAgent.stop();
    });

    test('budget enforcement prevents brain call', async () => {
        const smallBudgetAgent = new AnalystAgent({
            bus, brain: mockBrain, oodaIntervalMs: 100000,
            name: 'small-budget', tokenBudget: 100
        });

        await smallBudgetAgent._act({
            action: 'analyze', level: 'L0', reason: 'test',
            payload: { items: [{ alerts: [{ detail: 'test' }] }] }
        });

        expect(mockBrain.sendMessage).not.toHaveBeenCalled();
        const log = smallBudgetAgent.getActivityLog();
        expect(log.some(e => e.event === 'budget_exceeded')).toBe(true);
        await smallBudgetAgent.stop();
    });
});
