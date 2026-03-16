const SentinelAgent = require('../src/core/agents/SentinelAgent');
const AgentBus = require('../src/core/AgentBus');

// Mock circuit_breaker
jest.mock('../src/core/circuit_breaker', () => ({
    getStatus: () => ({})
}), { virtual: true });

// Mock warroom-client
jest.mock('../src/utils/warroom-client', () => ({
    getStatus: () => Promise.resolve(null)
}), { virtual: true });

describe('SentinelAgent', () => {
    let bus, agent;

    beforeEach(() => {
        bus = new AgentBus();
        agent = new SentinelAgent({ bus, oodaIntervalMs: 100000, name: 'test-sentinel' });
    });

    afterEach(async () => {
        await agent.stop();
    });

    test('has correct type and defaults', () => {
        expect(agent.type).toBe('sentinel');
        expect(agent.id).toBe('sentinel:test-sentinel');
    });

    test('observe returns system metrics', async () => {
        const obs = await agent._observe();
        expect(obs.rss).toBeGreaterThan(0);
        expect(obs.heapUsed).toBeGreaterThan(0);
        expect(obs.uptime).toBeGreaterThanOrEqual(0);
    });

    test('orient detects high memory', () => {
        const analysis = agent._orient({ rss: 500, heapUsed: 300, uptime: 100 });
        expect(analysis.alerts).toHaveLength(1);
        expect(analysis.alerts[0].type).toBe('memory');
        expect(analysis.alerts[0].severity).toBe('high');
    });

    test('orient returns no alerts when healthy', () => {
        const analysis = agent._orient({ rss: 100, heapUsed: 50, uptime: 100 });
        expect(analysis.alerts).toHaveLength(0);
    });

    test('orient detects open circuit breakers', () => {
        const analysis = agent._orient({
            rss: 100, heapUsed: 50, uptime: 100,
            circuitBreakerStatus: { 'brain': { state: 'OPEN' } }
        });
        expect(analysis.alerts.some(a => a.type === 'circuit_breaker')).toBe(true);
    });

    test('decide returns noop when no alerts', () => {
        const decision = agent._decide({ alerts: [] });
        expect(decision.action).toBe('noop');
    });

    test('decide returns alert_critical for high severity', () => {
        const decision = agent._decide({
            alerts: [{ type: 'memory', severity: 'high', detail: 'RSS 500MB > 400MB' }]
        });
        expect(decision.action).toBe('alert_critical');
        expect(decision.payload.triggerGC).toBe(true);
    });

    test('decide returns alert_warning for medium severity', () => {
        const decision = agent._decide({
            alerts: [{ type: 'circuit_breaker', severity: 'medium', detail: 'brain=OPEN' }]
        });
        expect(decision.action).toBe('alert_warning');
    });

    test('act publishes alert to bus', async () => {
        const handler = jest.fn();
        bus.subscribe('alert', handler, 'test-listener');

        await agent._act({
            action: 'alert_critical',
            reason: 'test',
            payload: { alerts: [{ type: 'memory' }], triggerGC: false }
        });

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].payload.source).toBe('sentinel:test-sentinel');
    });
});
