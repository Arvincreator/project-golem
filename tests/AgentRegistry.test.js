const AgentRegistry = require('../src/core/AgentRegistry');
const SubAgent = require('../src/core/SubAgent');
const { AgentSpawnError } = require('../src/core/errors');

class MockAgent extends SubAgent {
    constructor(options = {}) {
        super({ ...options, type: 'mock', name: options.name || 'mock-0', oodaIntervalMs: 100000 });
    }
}

class MockAgent2 extends SubAgent {
    constructor(options = {}) {
        super({ ...options, type: 'other', name: options.name || 'other-0', oodaIntervalMs: 100000 });
    }
}

describe('AgentRegistry', () => {
    let registry;

    beforeEach(() => {
        registry = new AgentRegistry({ golemId: 'test-golem' });
    });

    afterEach(async () => {
        await registry.stopAll();
    });

    describe('spawn', () => {
        test('spawns and starts an agent', () => {
            const agent = registry.spawn(MockAgent, { name: 'a1' });
            expect(agent.id).toBe('mock:a1');
            expect(agent.status).toBe('running');
        });

        test('inherits golemId from registry', () => {
            const agent = registry.spawn(MockAgent);
            expect(agent.golemId).toBe('test-golem');
        });

        test('throws on duplicate agent id', () => {
            registry.spawn(MockAgent, { name: 'dup' });
            expect(() => registry.spawn(MockAgent, { name: 'dup' })).toThrow(AgentSpawnError);
        });

        test('throws when maxAgents exceeded', () => {
            const small = new AgentRegistry({ maxAgents: 2 });
            small.spawn(MockAgent, { name: 'a1' });
            small.spawn(MockAgent, { name: 'a2' });
            expect(() => small.spawn(MockAgent, { name: 'a3' })).toThrow(AgentSpawnError);
            small.stopAll();
        });
    });

    describe('stop', () => {
        test('stops and removes agent', async () => {
            registry.spawn(MockAgent, { name: 'a1' });
            await registry.stop('mock:a1');
            expect(registry.get('mock:a1')).toBeUndefined();
        });

        test('stop non-existent agent is safe', async () => {
            await expect(registry.stop('nonexistent')).resolves.not.toThrow();
        });
    });

    describe('stopAll', () => {
        test('stops all agents', async () => {
            registry.spawn(MockAgent, { name: 'a1' });
            registry.spawn(MockAgent, { name: 'a2' });
            await registry.stopAll();
            expect(registry.list()).toHaveLength(0);
        });
    });

    describe('get/getByType', () => {
        test('get returns agent by id', () => {
            registry.spawn(MockAgent, { name: 'a1' });
            expect(registry.get('mock:a1')).toBeDefined();
            expect(registry.get('mock:a1').id).toBe('mock:a1');
        });

        test('getByType filters by type', () => {
            registry.spawn(MockAgent, { name: 'a1' });
            registry.spawn(MockAgent, { name: 'a2' });
            registry.spawn(MockAgent2, { name: 'b1' });
            expect(registry.getByType('mock')).toHaveLength(2);
            expect(registry.getByType('other')).toHaveLength(1);
        });
    });

    describe('list', () => {
        test('returns summary for all agents', () => {
            registry.spawn(MockAgent, { name: 'a1' });
            registry.spawn(MockAgent2, { name: 'b1' });
            const list = registry.list();
            expect(list).toHaveLength(2);
            expect(list[0]).toHaveProperty('id');
            expect(list[0]).toHaveProperty('type');
            expect(list[0]).toHaveProperty('status');
            expect(list[0]).toHaveProperty('metrics');
        });
    });

    describe('getHealth', () => {
        test('returns health summary', () => {
            registry.spawn(MockAgent, { name: 'a1' });
            registry.spawn(MockAgent, { name: 'a2' });
            const health = registry.getHealth();
            expect(health.total).toBe(2);
            expect(health.byType.mock).toBe(2);
            expect(health.byStatus.running).toBe(2);
        });
    });

    describe('getBus', () => {
        test('returns shared bus instance', () => {
            const bus = registry.getBus();
            expect(bus).toBeDefined();
            expect(typeof bus.publish).toBe('function');
        });

        test('spawned agents share the same bus', () => {
            const handler = jest.fn();
            const bus = registry.getBus();
            bus.subscribe('test.topic', handler, 'external');

            const agent = registry.spawn(MockAgent, { name: 'a1' });
            agent.publish('test.topic', { hello: true });

            expect(handler).toHaveBeenCalledTimes(1);
        });
    });
});
