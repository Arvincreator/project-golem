const SubAgent = require('../src/core/SubAgent');
const AgentBus = require('../src/core/AgentBus');

class TestAgent extends SubAgent {
    constructor(options = {}) {
        super({ ...options, type: 'test', name: options.name || 'test-0' });
        this.observeResult = options.observeResult || {};
        this.orientResult = options.orientResult || {};
        this.decideResult = options.decideResult || { action: 'noop', level: 'L0', reason: 'test' };
        this.actCalls = [];
    }

    async _observe() { return this.observeResult; }
    _orient(obs) { return this.orientResult; }
    _decide(analysis) { return this.decideResult; }
    async _act(decision) { this.actCalls.push(decision); }
}

describe('SubAgent', () => {
    let bus;

    beforeEach(() => {
        bus = new AgentBus();
    });

    describe('identity', () => {
        test('id is type:name', () => {
            const agent = new TestAgent({ bus });
            expect(agent.id).toBe('test:test-0');
        });

        test('initial status is idle', () => {
            const agent = new TestAgent({ bus });
            expect(agent.status).toBe('idle');
        });
    });

    describe('lifecycle', () => {
        test('start sets status to running', async () => {
            const agent = new TestAgent({ bus, oodaIntervalMs: 100000 });
            await agent.start();
            expect(agent.status).toBe('running');
            await agent.stop();
        });

        test('stop sets status to stopped and clears timer', async () => {
            const agent = new TestAgent({ bus, oodaIntervalMs: 100000 });
            await agent.start();
            await agent.stop();
            expect(agent.status).toBe('stopped');
        });

        test('stop is idempotent', async () => {
            const agent = new TestAgent({ bus, oodaIntervalMs: 100000 });
            await agent.start();
            await agent.stop();
            await agent.stop(); // no error
            expect(agent.status).toBe('stopped');
        });

        test('pause/resume', async () => {
            const agent = new TestAgent({ bus, oodaIntervalMs: 100000 });
            await agent.start();
            agent.pause();
            expect(agent.status).toBe('paused');
            agent.resume();
            expect(agent.status).toBe('running');
            await agent.stop();
        });

        test('pause only works from running', async () => {
            const agent = new TestAgent({ bus, oodaIntervalMs: 100000 });
            agent.pause(); // idle → should not change
            expect(agent.status).toBe('idle');
        });

        test('resume only works from paused', async () => {
            const agent = new TestAgent({ bus, oodaIntervalMs: 100000 });
            await agent.start();
            agent.resume(); // running → should stay running
            expect(agent.status).toBe('running');
            await agent.stop();
        });

        test('publishes agent.started on start', async () => {
            const handler = jest.fn();
            bus.subscribe('agent.started', handler, 'test-sub');
            const agent = new TestAgent({ bus, oodaIntervalMs: 100000 });
            await agent.start();
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler.mock.calls[0][0].payload.id).toBe('test:test-0');
            await agent.stop();
        });

        test('publishes agent.stopped on stop', async () => {
            const handler = jest.fn();
            bus.subscribe('agent.stopped', handler, 'test-sub');
            const agent = new TestAgent({ bus, oodaIntervalMs: 100000 });
            await agent.start();
            await agent.stop();
            expect(handler).toHaveBeenCalledTimes(1);
        });
    });

    describe('token budget', () => {
        test('consumeTokenBudget respects limit', () => {
            const agent = new TestAgent({ bus, tokenBudget: 100 });
            expect(agent._consumeTokenBudget(50)).toBe(true);
            expect(agent._consumeTokenBudget(60)).toBe(false);
        });

        test('zero budget means unlimited', () => {
            const agent = new TestAgent({ bus, tokenBudget: 0 });
            expect(agent._consumeTokenBudget(999999)).toBe(true);
        });

        test('resetTokenBudget clears usage', () => {
            const agent = new TestAgent({ bus, tokenBudget: 100 });
            agent._consumeTokenBudget(90);
            agent._resetTokenBudget();
            expect(agent._consumeTokenBudget(90)).toBe(true);
        });
    });

    describe('communication', () => {
        test('publish sends through bus', () => {
            const handler = jest.fn();
            bus.subscribe('test.topic', handler, 'listener');
            const agent = new TestAgent({ bus });
            agent.publish('test.topic', { data: 1 });
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler.mock.calls[0][0].senderId).toBe('test:test-0');
        });

        test('publish without bus is safe', () => {
            const agent = new TestAgent({}); // no bus
            expect(() => agent.publish('test', {})).not.toThrow();
        });
    });

    describe('activity log', () => {
        test('logs activity entries', async () => {
            const agent = new TestAgent({ bus, oodaIntervalMs: 100000 });
            await agent.start();
            const log = agent.getActivityLog();
            expect(log.length).toBeGreaterThan(0);
            expect(log[0].event).toBe('started');
            await agent.stop();
        });

        test('respects limit', async () => {
            const agent = new TestAgent({ bus, oodaIntervalMs: 100000 });
            for (let i = 0; i < 5; i++) agent._logActivity({ event: `e${i}` });
            expect(agent.getActivityLog(2)).toHaveLength(2);
            await agent.stop();
        });
    });

    describe('metrics', () => {
        test('returns metrics object', async () => {
            const agent = new TestAgent({ bus, oodaIntervalMs: 100000, tokenBudget: 500 });
            await agent.start();
            const metrics = agent.getMetrics();
            expect(metrics.id).toBe('test:test-0');
            expect(metrics.type).toBe('test');
            expect(metrics.status).toBe('running');
            expect(metrics.tokenBudget).toBe(500);
            expect(metrics.uptime).toBeGreaterThanOrEqual(0);
            await agent.stop();
        });
    });

    describe('tick timeout', () => {
        test('tick timeout triggers error', async () => {
            class SlowAgent extends SubAgent {
                constructor(opts) { super({ ...opts, type: 'slow', name: 'slow-0', timeoutMs: 50 }); }
                async _observe() { await new Promise(r => setTimeout(r, 200)); return {}; }
            }

            const agent = new SlowAgent({ bus, oodaIntervalMs: 100000 });
            await expect(agent._tick()).rejects.toThrow('Tick timeout');
            await agent.stop();
        });
    });
});
