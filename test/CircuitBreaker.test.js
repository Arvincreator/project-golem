const { CircuitBreaker, CircuitBreakerError, registry } = require('../src/utils/CircuitBreaker');
const { retry, withRetry } = require('../src/utils/RetryHelper');

describe('CircuitBreaker', () => {
    let cb;

    beforeEach(() => {
        cb = new CircuitBreaker('test-service', { threshold: 3, timeout: 100 });
    });

    describe('CLOSED state', () => {
        test('starts in CLOSED state', () => {
            expect(cb.state).toBe('CLOSED');
        });

        test('passes through successful calls', async () => {
            const result = await cb.execute(() => Promise.resolve('ok'));
            expect(result).toBe('ok');
            expect(cb.state).toBe('CLOSED');
        });

        test('tolerates failures below threshold', async () => {
            // 2 failures, threshold is 3
            for (let i = 0; i < 2; i++) {
                await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
            }
            expect(cb.state).toBe('CLOSED');
        });

        test('opens after reaching threshold', async () => {
            for (let i = 0; i < 3; i++) {
                await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
            }
            expect(cb.state).toBe('OPEN');
        });
    });

    describe('OPEN state', () => {
        beforeEach(async () => {
            // Force open
            for (let i = 0; i < 3; i++) {
                await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            }
        });

        test('rejects requests immediately', async () => {
            await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow(CircuitBreakerError);
        });

        test('transitions to HALF after timeout', async () => {
            await new Promise(r => setTimeout(r, 150)); // Wait for timeout
            // Next call should go through (HALF state)
            const result = await cb.execute(() => Promise.resolve('recovered'));
            expect(result).toBe('recovered');
        });
    });

    describe('HALF state', () => {
        test('closes on success', async () => {
            // Open the circuit
            for (let i = 0; i < 3; i++) {
                await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            }
            await new Promise(r => setTimeout(r, 150));

            // Success in HALF → should close
            await cb.execute(() => Promise.resolve('ok'));
            expect(cb.state).toBe('CLOSED');
        });

        test('reopens on failure', async () => {
            for (let i = 0; i < 3; i++) {
                await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            }
            await new Promise(r => setTimeout(r, 150));

            // Failure in HALF → should reopen
            await expect(cb.execute(() => Promise.reject(new Error('still broken')))).rejects.toThrow();
            expect(cb.state).toBe('OPEN');
        });
    });

    describe('reset()', () => {
        test('resets to CLOSED', async () => {
            for (let i = 0; i < 3; i++) {
                await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            }
            expect(cb.state).toBe('OPEN');

            cb.reset();
            expect(cb.state).toBe('CLOSED');
            expect(cb.stats().failures).toBe(0);
        });
    });

    describe('stats()', () => {
        test('returns statistics', async () => {
            await cb.execute(() => Promise.resolve('ok'));
            const stats = cb.stats();
            expect(stats.name).toBe('test-service');
            expect(stats.state).toBe('CLOSED');
            expect(stats.totalRequests).toBe(1);
        });
    });

    describe('onStateChange callback', () => {
        test('fires on state transition', async () => {
            const changes = [];
            const cb2 = new CircuitBreaker('callback-test', {
                threshold: 2,
                onStateChange: (name, from, to) => changes.push({ name, from, to }),
            });

            await cb2.execute(() => Promise.reject(new Error('1'))).catch(() => {});
            await cb2.execute(() => Promise.reject(new Error('2'))).catch(() => {});

            expect(changes).toEqual([{ name: 'callback-test', from: 'CLOSED', to: 'OPEN' }]);
        });
    });
});

describe('CircuitBreakerRegistry', () => {
    test('creates and retrieves breakers', () => {
        const cb1 = registry.get('service-a', { threshold: 5 });
        const cb2 = registry.get('service-a');
        expect(cb1).toBe(cb2); // Same instance
    });

    test('stats returns all breaker stats', () => {
        registry.get('stat-test');
        const stats = registry.stats();
        expect(stats['stat-test']).toBeDefined();
    });
});

describe('RetryHelper', () => {
    describe('retry()', () => {
        test('succeeds on first try', async () => {
            const result = await retry(() => Promise.resolve('ok'), { maxRetries: 3, label: 'test' });
            expect(result).toBe('ok');
        });

        test('retries on failure then succeeds', async () => {
            let attempt = 0;
            const result = await retry(
                () => {
                    attempt++;
                    if (attempt < 3) throw new Error('transient');
                    return Promise.resolve('recovered');
                },
                { maxRetries: 3, baseDelay: 10, label: 'retry-test' }
            );
            expect(result).toBe('recovered');
            expect(attempt).toBe(3);
        });

        test('throws after max retries', async () => {
            await expect(
                retry(() => Promise.reject(new Error('permanent')), { maxRetries: 2, baseDelay: 10, label: 'fail-test' })
            ).rejects.toThrow('permanent');
        });

        test('calls onRetry callback', async () => {
            const retries = [];
            await retry(
                () => {
                    if (retries.length < 2) throw new Error('fail');
                    return Promise.resolve('ok');
                },
                {
                    maxRetries: 3,
                    baseDelay: 10,
                    onRetry: (err, attempt, delay) => retries.push(attempt),
                    label: 'callback-test',
                }
            );
            expect(retries).toEqual([1, 2]);
        });
    });

    describe('withRetry()', () => {
        test('wraps function with retry', async () => {
            let calls = 0;
            const fn = withRetry(
                async () => {
                    calls++;
                    if (calls < 2) throw new Error('once');
                    return 'done';
                },
                { maxRetries: 3, baseDelay: 10, label: 'wrap-test' }
            );
            const result = await fn();
            expect(result).toBe('done');
            expect(calls).toBe(2);
        });
    });
});
