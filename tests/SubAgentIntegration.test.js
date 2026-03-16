const AgentRegistry = require('../src/core/AgentRegistry');
const SentinelAgent = require('../src/core/agents/SentinelAgent');
const AnalystAgent = require('../src/core/agents/AnalystAgent');
const WorkerAgent = require('../src/core/agents/WorkerAgent');
const AgentBus = require('../src/core/AgentBus');

// Mock circuit_breaker
jest.mock('../src/core/circuit_breaker', () => ({
    getStatus: () => ({})
}), { virtual: true });

// Mock warroom-client
jest.mock('../src/utils/warroom-client', () => ({
    getStatus: () => Promise.resolve(null)
}), { virtual: true });

describe('SubAgent Integration', () => {
    let registry, mockBrain;

    beforeEach(() => {
        registry = new AgentRegistry({ golemId: 'integration-test' });
        mockBrain = { sendMessage: jest.fn().mockResolvedValue('Analysis complete') };
    });

    afterEach(async () => {
        await registry.stopAll();
    });

    test('full agent fleet spawns correctly', () => {
        registry.spawn(SentinelAgent, { name: 'sentinel-1' });
        registry.spawn(AnalystAgent, { name: 'analyst-1', brain: mockBrain });
        registry.spawn(WorkerAgent, { name: 'worker-1', brain: mockBrain });

        const health = registry.getHealth();
        expect(health.total).toBe(3);
        expect(health.byType.sentinel).toBe(1);
        expect(health.byType.analyst).toBe(1);
        expect(health.byType.worker).toBe(1);
        expect(health.byStatus.running).toBe(3);
    });

    test('sentinel alert reaches analyst via bus', () => {
        const sentinel = registry.spawn(SentinelAgent, { name: 'sentinel-1' });
        const analyst = registry.spawn(AnalystAgent, { name: 'analyst-1', brain: mockBrain });

        // Sentinel publishes alert
        sentinel.publish('alert', {
            source: sentinel.id,
            action: 'alert_critical',
            reason: 'test alert',
            alerts: [{ type: 'memory', severity: 'high', detail: 'RSS 500MB' }]
        });

        expect(analyst._pendingAlerts).toHaveLength(1);
    });

    test('OODA delegation reaches analyst', () => {
        const analyst = registry.spawn(AnalystAgent, { name: 'analyst-1', brain: mockBrain });
        const bus = registry.getBus();

        // Simulate OODA loop delegation
        bus.publish('task.request', {
            type: 'analysis', source: 'ooda',
            payload: 'Multiple patterns detected'
        }, 'ooda:integration-test');

        expect(analyst._pendingTasks).toHaveLength(1);
    });

    test('task request reaches worker (non-analysis)', () => {
        const worker = registry.spawn(WorkerAgent, { name: 'worker-1', brain: mockBrain });
        const bus = registry.getBus();

        bus.publish('task.request', {
            type: 'generic', prompt: 'do something'
        }, 'external');

        expect(worker._pendingTasks).toHaveLength(1);
    });

    test('analyst does not pick up non-analysis tasks', () => {
        const analyst = registry.spawn(AnalystAgent, { name: 'analyst-1', brain: mockBrain });
        const bus = registry.getBus();

        bus.publish('task.request', { type: 'generic', prompt: 'test' }, 'external');
        expect(analyst._pendingTasks).toHaveLength(0);
    });

    test('worker does not pick up analysis tasks', () => {
        const worker = registry.spawn(WorkerAgent, { name: 'worker-1', brain: mockBrain });
        const bus = registry.getBus();

        bus.publish('task.request', { type: 'analysis', payload: 'test' }, 'external');
        expect(worker._pendingTasks).toHaveLength(0);
    });

    test('stopAll stops all agents', async () => {
        registry.spawn(SentinelAgent, { name: 'sentinel-1' });
        registry.spawn(AnalystAgent, { name: 'analyst-1', brain: mockBrain });
        registry.spawn(WorkerAgent, { name: 'worker-1', brain: mockBrain });

        await registry.stopAll();
        expect(registry.list()).toHaveLength(0);
    });

    test('agent.started events are visible on bus', () => {
        const handler = jest.fn();
        registry.getBus().subscribe('agent.started', handler, 'monitor');

        registry.spawn(SentinelAgent, { name: 'sentinel-1' });
        registry.spawn(AnalystAgent, { name: 'analyst-1', brain: mockBrain });

        expect(handler).toHaveBeenCalledTimes(2);
    });

    test('message log captures cross-agent communication', () => {
        const sentinel = registry.spawn(SentinelAgent, { name: 'sentinel-1' });
        registry.spawn(AnalystAgent, { name: 'analyst-1', brain: mockBrain });

        sentinel.publish('alert', { test: true });

        const log = registry.getBus().getMessageLog();
        const alertMsgs = log.filter(m => m.topic === 'alert');
        expect(alertMsgs.length).toBeGreaterThan(0);
    });

    test('full lifecycle: spawn → pause → resume → stop', async () => {
        const sentinel = registry.spawn(SentinelAgent, { name: 'sentinel-1' });
        expect(sentinel.status).toBe('running');

        sentinel.pause();
        expect(sentinel.status).toBe('paused');

        sentinel.resume();
        expect(sentinel.status).toBe('running');

        await registry.stop(sentinel.id);
        expect(registry.get(sentinel.id)).toBeUndefined();
    });
});
