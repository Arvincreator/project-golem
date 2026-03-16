const AgentBus = require('../src/core/AgentBus');

describe('AgentBus', () => {
    let bus;

    beforeEach(() => {
        bus = new AgentBus();
    });

    describe('publish/subscribe', () => {
        test('delivers message to subscriber', () => {
            const handler = jest.fn();
            bus.subscribe('alert', handler, 'sub1');
            bus.publish('alert', { text: 'test' }, 'sender1');

            expect(handler).toHaveBeenCalledTimes(1);
            const msg = handler.mock.calls[0][0];
            expect(msg.topic).toBe('alert');
            expect(msg.payload).toEqual({ text: 'test' });
            expect(msg.senderId).toBe('sender1');
            expect(msg.timestamp).toBeDefined();
            expect(msg.id).toBeDefined();
        });

        test('fan-out to multiple subscribers', () => {
            const h1 = jest.fn();
            const h2 = jest.fn();
            bus.subscribe('alert', h1, 'sub1');
            bus.subscribe('alert', h2, 'sub2');
            const delivered = bus.publish('alert', {}, 'sender');

            expect(delivered).toBe(2);
            expect(h1).toHaveBeenCalledTimes(1);
            expect(h2).toHaveBeenCalledTimes(1);
        });

        test('does not cross-deliver between topics', () => {
            const h1 = jest.fn();
            bus.subscribe('alert', h1, 'sub1');
            bus.publish('task.request', {}, 'sender');

            expect(h1).not.toHaveBeenCalled();
        });

        test('returns 0 when no subscribers', () => {
            const delivered = bus.publish('alert', {}, 'sender');
            expect(delivered).toBe(0);
        });
    });

    describe('dead letter queue', () => {
        test('messages with no subscribers go to DLQ', () => {
            bus.publish('orphan.topic', { data: 1 }, 'sender');
            const dlq = bus.getDeadLetterQueue();
            expect(dlq).toHaveLength(1);
            expect(dlq[0].topic).toBe('orphan.topic');
        });

        test('DLQ max size is 50', () => {
            for (let i = 0; i < 60; i++) {
                bus.publish('orphan', { i }, 'sender');
            }
            expect(bus.getDeadLetterQueue().length).toBe(50);
        });
    });

    describe('unsubscribe', () => {
        test('unsubscribe removes specific subscriber', () => {
            const h1 = jest.fn();
            const h2 = jest.fn();
            bus.subscribe('alert', h1, 'sub1');
            bus.subscribe('alert', h2, 'sub2');
            bus.unsubscribe('alert', 'sub1');
            bus.publish('alert', {}, 'sender');

            expect(h1).not.toHaveBeenCalled();
            expect(h2).toHaveBeenCalledTimes(1);
        });

        test('unsubscribeAll removes all subs for a subscriber', () => {
            const handler = jest.fn();
            bus.subscribe('alert', handler, 'sub1');
            bus.subscribe('task.request', handler, 'sub1');
            bus.unsubscribeAll('sub1');

            bus.publish('alert', {}, 'sender');
            bus.publish('task.request', {}, 'sender');

            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('message log', () => {
        test('logs all published messages', () => {
            bus.publish('a', {}, 's');
            bus.publish('b', {}, 's');
            const log = bus.getMessageLog();
            expect(log).toHaveLength(2);
        });

        test('message log max size is 500', () => {
            const handler = jest.fn(); // add subscriber to avoid DLQ
            bus.subscribe('t', handler, 's');
            for (let i = 0; i < 510; i++) {
                bus.publish('t', { i }, 'sender');
            }
            expect(bus.getMessageLog(600).length).toBe(500);
        });

        test('getMessageLog respects limit', () => {
            bus.publish('a', {}, 's');
            bus.publish('b', {}, 's');
            bus.publish('c', {}, 's');
            const log = bus.getMessageLog(2);
            expect(log).toHaveLength(2);
        });
    });

    describe('getSubscriptionCount', () => {
        test('counts all subscriptions', () => {
            bus.subscribe('a', jest.fn(), 's1');
            bus.subscribe('b', jest.fn(), 's2');
            bus.subscribe('a', jest.fn(), 's3');
            expect(bus.getSubscriptionCount()).toBe(3);
        });
    });

    describe('TOPICS', () => {
        test('has expected topic constants', () => {
            expect(AgentBus.TOPICS.AGENT_STARTED).toBe('agent.started');
            expect(AgentBus.TOPICS.ALERT).toBe('alert');
            expect(AgentBus.TOPICS.TASK_REQUEST).toBe('task.request');
            expect(AgentBus.TOPICS.TASK_RESULT).toBe('task.result');
        });
    });

    describe('error handling', () => {
        test('handler error does not break other subscribers', () => {
            const badHandler = jest.fn(() => { throw new Error('boom'); });
            const goodHandler = jest.fn();
            bus.subscribe('alert', badHandler, 'bad');
            bus.subscribe('alert', goodHandler, 'good');

            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
            bus.publish('alert', {}, 'sender');
            consoleSpy.mockRestore();

            expect(goodHandler).toHaveBeenCalledTimes(1);
        });
    });
});
