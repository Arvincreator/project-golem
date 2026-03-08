const { TaskQueue, PRIORITY } = require('../src/utils/TaskQueue');

describe('TaskQueue', () => {
    let queue;

    afterEach(async () => {
        if (queue) {
            queue.clear();
        }
    });

    describe('add() + execution', () => {
        test('executes tasks and returns results', async () => {
            queue = new TaskQueue({ concurrency: 1 });
            const result = await queue.add(() => Promise.resolve(42));
            expect(result).toBe(42);
        });

        test('rejects on task failure', async () => {
            queue = new TaskQueue({ concurrency: 1 });
            await expect(
                queue.add(() => Promise.reject(new Error('fail')))
            ).rejects.toThrow('fail');
        });

        test('executes tasks concurrently', async () => {
            queue = new TaskQueue({ concurrency: 3 });
            const started = [];
            const delay = (ms, id) => new Promise(r => {
                started.push(id);
                setTimeout(() => r(id), ms);
            });

            const p1 = queue.add(() => delay(50, 'a'));
            const p2 = queue.add(() => delay(50, 'b'));
            const p3 = queue.add(() => delay(50, 'c'));

            // All should start immediately with concurrency=3
            await new Promise(r => setTimeout(r, 10));
            expect(started).toContain('a');
            expect(started).toContain('b');
            expect(started).toContain('c');

            await Promise.all([p1, p2, p3]);
        });

        test('respects concurrency limit', async () => {
            queue = new TaskQueue({ concurrency: 1 });
            const order = [];
            const delay = (ms, id) => new Promise(r => {
                order.push(`start-${id}`);
                setTimeout(() => { order.push(`end-${id}`); r(); }, ms);
            });

            const p1 = queue.add(() => delay(30, 'a'));
            const p2 = queue.add(() => delay(30, 'b'));

            await Promise.all([p1, p2]);
            // With concurrency=1, b should start after a ends
            expect(order.indexOf('start-b')).toBeGreaterThan(order.indexOf('end-a'));
        });
    });

    describe('priority ordering', () => {
        test('processes higher priority first', async () => {
            queue = new TaskQueue({ concurrency: 1 });
            const order = [];

            // Block the queue with a running task
            const blocker = queue.add(
                () => new Promise(r => setTimeout(r, 50)),
                { label: 'blocker' }
            );

            // Add tasks with different priorities while blocked
            const pLow = queue.add(() => { order.push('low'); }, { priority: 'low' });
            const pHigh = queue.add(() => { order.push('high'); }, { priority: 'high' });
            const pCrit = queue.add(() => { order.push('critical'); }, { priority: 'critical' });

            await blocker;
            await Promise.all([pLow, pHigh, pCrit]);

            expect(order).toEqual(['critical', 'high', 'low']);
        });

        test('accepts numeric priorities', async () => {
            queue = new TaskQueue({ concurrency: 1 });
            const order = [];

            const blocker = queue.add(() => new Promise(r => setTimeout(r, 30)));
            const p1 = queue.add(() => { order.push('p3'); }, { priority: 3 });
            const p2 = queue.add(() => { order.push('p0'); }, { priority: 0 });

            await blocker;
            await Promise.all([p1, p2]);
            expect(order).toEqual(['p0', 'p3']);
        });
    });

    describe('timeout', () => {
        test('rejects task on timeout', async () => {
            queue = new TaskQueue({ concurrency: 1 });
            await expect(
                queue.add(
                    () => new Promise(r => setTimeout(r, 500)),
                    { timeout: 30, label: 'slow' }
                )
            ).rejects.toThrow('timed out');
        });

        test('uses default timeout', async () => {
            queue = new TaskQueue({ concurrency: 1, defaultTimeout: 30 });
            await expect(
                queue.add(() => new Promise(r => setTimeout(r, 500)))
            ).rejects.toThrow('timed out');
        });
    });

    describe('backpressure', () => {
        test('rejects when queue full', async () => {
            queue = new TaskQueue({ concurrency: 1, maxSize: 2 });
            // Block with running task
            const blocker = queue.add(() => new Promise(r => setTimeout(r, 100)));
            // Fill queue (catch to avoid unhandled rejections on clear)
            const fill1 = queue.add(() => {}).catch(() => {});
            const fill2 = queue.add(() => {}).catch(() => {});

            await expect(
                queue.add(() => {}, { label: 'overflow' })
            ).rejects.toThrow('Queue full');

            queue.clear();
            await blocker.catch(() => {});
            await fill1;
            await fill2;
        });
    });

    describe('pause/resume', () => {
        test('pauses processing', async () => {
            queue = new TaskQueue({ concurrency: 1 });
            queue.pause();
            const order = [];
            const p = queue.add(() => order.push('done'));

            await new Promise(r => setTimeout(r, 30));
            expect(order).toEqual([]);

            queue.resume();
            await p;
            expect(order).toEqual(['done']);
        });
    });

    describe('clear()', () => {
        test('rejects all pending tasks', async () => {
            queue = new TaskQueue({ concurrency: 1 });
            queue.pause();
            const p1 = queue.add(() => {}).catch(e => e.message);
            const p2 = queue.add(() => {}).catch(e => e.message);

            const cleared = queue.clear('test clear');
            expect(cleared).toBe(2);

            const msg1 = await p1;
            expect(msg1).toBe('test clear');
        });
    });

    describe('size()', () => {
        test('returns pending and running counts', async () => {
            queue = new TaskQueue({ concurrency: 1 });
            const blocker = queue.add(() => new Promise(r => setTimeout(r, 100)));
            const p1 = queue.add(() => {}, { priority: 'high' }).catch(() => {});
            const p2 = queue.add(() => {}, { priority: 'low' }).catch(() => {});

            await new Promise(r => setTimeout(r, 10));
            const size = queue.size();
            expect(size.running).toBe(1);
            expect(size.pending).toBe(2);
            expect(size.byPriority.high).toBe(1);
            expect(size.byPriority.low).toBe(1);

            queue.clear();
            await blocker.catch(() => {});
            await p1;
            await p2;
        });
    });

    describe('stats()', () => {
        test('tracks completed and failed', async () => {
            queue = new TaskQueue({ concurrency: 2 });
            await queue.add(() => 'ok');
            await queue.add(() => { throw new Error('x'); }).catch(() => {});

            const stats = queue.stats();
            expect(stats.totalAdded).toBe(2);
            expect(stats.totalCompleted).toBe(1);
            expect(stats.totalFailed).toBe(1);
        });
    });

    describe('callbacks', () => {
        test('onComplete called on success', async () => {
            const onComplete = jest.fn();
            queue = new TaskQueue({ concurrency: 1, onComplete });
            await queue.add(() => 'result', { label: 'my-task' });
            expect(onComplete).toHaveBeenCalledWith('my-task', 'result');
        });

        test('onError called on failure', async () => {
            const onError = jest.fn();
            queue = new TaskQueue({ concurrency: 1, onError });
            await queue.add(() => { throw new Error('boom'); }, { label: 'bad' }).catch(() => {});
            expect(onError).toHaveBeenCalledWith('bad', expect.any(Error));
        });
    });

    describe('isIdle()', () => {
        test('returns true when empty', () => {
            queue = new TaskQueue();
            expect(queue.isIdle()).toBe(true);
        });

        test('returns false when tasks running', async () => {
            queue = new TaskQueue({ concurrency: 1 });
            const p = queue.add(() => new Promise(r => setTimeout(r, 50)));
            await new Promise(r => setTimeout(r, 10));
            expect(queue.isIdle()).toBe(false);
            await p;
        });
    });

    describe('PRIORITY constants', () => {
        test('has correct values', () => {
            expect(PRIORITY.CRITICAL).toBe(0);
            expect(PRIORITY.HIGH).toBe(1);
            expect(PRIORITY.NORMAL).toBe(2);
            expect(PRIORITY.LOW).toBe(3);
            expect(PRIORITY.BACKGROUND).toBe(4);
        });
    });
});
