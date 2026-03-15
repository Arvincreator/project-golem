const { EventBus, eventBus } = require('../src/utils/EventBus');

describe('EventBus', () => {
    let bus;

    beforeEach(() => {
        bus = new EventBus();
    });

    describe('on() + emit()', () => {
        test('calls listener when event is emitted', () => {
            const fn = jest.fn();
            bus.on('test', fn);
            bus.emit('test', { value: 42 });
            expect(fn).toHaveBeenCalledWith({ value: 42 });
        });

        test('supports multiple listeners', () => {
            const fn1 = jest.fn();
            const fn2 = jest.fn();
            bus.on('test', fn1);
            bus.on('test', fn2);
            bus.emit('test');
            expect(fn1).toHaveBeenCalled();
            expect(fn2).toHaveBeenCalled();
        });

        test('returns unsubscribe function', () => {
            const fn = jest.fn();
            const unsub = bus.on('test', fn);
            unsub();
            bus.emit('test');
            expect(fn).not.toHaveBeenCalled();
        });

        test('returns count of listeners called', () => {
            bus.on('test', () => {});
            bus.on('test', () => {});
            expect(bus.emit('test')).toBe(2);
        });

        test('returns 0 for events with no listeners', () => {
            expect(bus.emit('nothing')).toBe(0);
        });

        test('throws for non-function listener', () => {
            expect(() => bus.on('test', 'not-a-fn')).toThrow(TypeError);
        });
    });

    describe('once()', () => {
        test('fires only once', () => {
            const fn = jest.fn();
            bus.once('test', fn);
            bus.emit('test', 'a');
            bus.emit('test', 'b');
            expect(fn).toHaveBeenCalledTimes(1);
            expect(fn).toHaveBeenCalledWith('a');
        });

        test('returns unsubscribe function', () => {
            const fn = jest.fn();
            const unsub = bus.once('test', fn);
            unsub();
            bus.emit('test');
            expect(fn).not.toHaveBeenCalled();
        });
    });

    describe('off()', () => {
        test('removes a specific listener', () => {
            const fn = jest.fn();
            bus.on('test', fn);
            bus.off('test', fn);
            bus.emit('test');
            expect(fn).not.toHaveBeenCalled();
        });

        test('ignores unknown events', () => {
            expect(() => bus.off('nope', () => {})).not.toThrow();
        });
    });

    describe('onAny()', () => {
        test('receives all events', () => {
            const fn = jest.fn();
            bus.onAny(fn);
            bus.emit('foo', 1);
            bus.emit('bar', 2);
            expect(fn).toHaveBeenCalledTimes(2);
            expect(fn).toHaveBeenCalledWith('foo', 1);
            expect(fn).toHaveBeenCalledWith('bar', 2);
        });

        test('returns unsubscribe function', () => {
            const fn = jest.fn();
            const unsub = bus.onAny(fn);
            unsub();
            bus.emit('test');
            expect(fn).not.toHaveBeenCalled();
        });
    });

    describe('namespace listeners', () => {
        test('brain:* catches brain:ready', () => {
            const fn = jest.fn();
            bus.on('brain:*', fn);
            bus.emit('brain:ready', { model: 'gemini' });
            expect(fn).toHaveBeenCalledWith({ model: 'gemini' }, 'brain:ready');
        });

        test('brain:* does not catch skill:loaded', () => {
            const fn = jest.fn();
            bus.on('brain:*', fn);
            bus.emit('skill:loaded');
            expect(fn).not.toHaveBeenCalled();
        });
    });

    describe('waitFor()', () => {
        test('resolves when event fires', async () => {
            setTimeout(() => bus.emit('ready', 'ok'), 10);
            const result = await bus.waitFor('ready', 1000);
            expect(result).toBe('ok');
        });

        test('rejects on timeout', async () => {
            await expect(bus.waitFor('never', 50))
                .rejects.toThrow('Timeout waiting for event "never"');
        });
    });

    describe('history()', () => {
        test('records emitted events', () => {
            bus.emit('a', 1);
            bus.emit('b', 2);
            const h = bus.history();
            expect(h).toHaveLength(2);
            expect(h[0].event).toBe('a');
            expect(h[1].event).toBe('b');
        });

        test('filters by event name', () => {
            bus.emit('a', 1);
            bus.emit('b', 2);
            bus.emit('a', 3);
            const h = bus.history('a');
            expect(h).toHaveLength(2);
        });

        test('respects history limit', () => {
            const small = new EventBus({ historyLimit: 3 });
            small.emit('1'); small.emit('2'); small.emit('3'); small.emit('4');
            expect(small.history()).toHaveLength(3);
            expect(small.history()[0].event).toBe('2');
        });
    });

    describe('listenerCount()', () => {
        test('returns count for specific event', () => {
            bus.on('test', () => {});
            bus.on('test', () => {});
            bus.once('test', () => {});
            expect(bus.listenerCount('test')).toBe(3);
        });

        test('returns counts for all events', () => {
            bus.on('a', () => {});
            bus.on('b', () => {});
            bus.on('b', () => {});
            const counts = bus.listenerCount();
            expect(counts.a).toBe(1);
            expect(counts.b).toBe(2);
        });
    });

    describe('removeAllListeners()', () => {
        test('removes listeners for specific event', () => {
            bus.on('a', () => {});
            bus.on('b', () => {});
            bus.removeAllListeners('a');
            expect(bus.listenerCount('a')).toBe(0);
            expect(bus.listenerCount('b')).toBe(1);
        });

        test('removes all listeners', () => {
            bus.on('a', () => {});
            bus.on('b', () => {});
            bus.onAny(() => {});
            bus.removeAllListeners();
            expect(bus.emit('a')).toBe(0);
            expect(bus.emit('b')).toBe(0);
        });
    });

    describe('eventNames()', () => {
        test('returns registered event names', () => {
            bus.on('a', () => {});
            bus.once('b', () => {});
            const names = bus.eventNames();
            expect(names).toContain('a');
            expect(names).toContain('b');
        });
    });

    describe('stats()', () => {
        test('returns bus statistics', () => {
            bus.on('a', () => {});
            bus.on('b', () => {});
            bus.onAny(() => {});
            bus.emit('a');
            const s = bus.stats();
            expect(s.events).toBe(2);
            expect(s.listeners).toBe(2);
            expect(s.wildcardListeners).toBe(1);
            expect(s.historySize).toBe(1);
        });
    });

    describe('error handling', () => {
        test('does not crash on listener error', () => {
            bus.on('test', () => { throw new Error('boom'); });
            bus.on('test', jest.fn());
            expect(() => bus.emit('test')).not.toThrow();
        });

        test('calls custom error handler', () => {
            const onError = jest.fn();
            const safe = new EventBus({ onError });
            safe.on('test', () => { throw new Error('boom'); });
            safe.emit('test');
            expect(onError).toHaveBeenCalledWith('test', expect.any(Error));
        });
    });

    describe('singleton', () => {
        test('exports a shared instance', () => {
            expect(eventBus).toBeInstanceOf(EventBus);
        });
    });
});
