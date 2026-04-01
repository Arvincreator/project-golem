const fs = require('fs');
const os = require('os');
const path = require('path');

const AgentKernel = require('../src/managers/AgentKernel');

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('AgentKernel concurrency stress matrix', () => {
    let tempDir;
    let kernel;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'golem-agent-concurrency-'));
        kernel = new AgentKernel({
            golemId: 'concurrency_test',
            logDir: tempDir,
            maxWorkers: 8,
            strictMode: true,
        });
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('matrix A: stale expectedVersion under concurrent writes yields exactly one success', async () => {
        const session = kernel.createSession({
            objective: 'Version conflict matrix A',
        }).session;
        const worker = kernel.spawnWorker({
            sessionId: session.id,
            role: 'research',
            prompt: 'race update',
        }).worker;

        const baselineVersion = kernel.getWorker(worker.id).version;
        const attempts = 32;
        const results = await Promise.all(
            Array.from({ length: attempts }, async (_, index) => {
                await delay(Math.floor(Math.random() * 6));
                try {
                    kernel.updateWorker(worker.id, {
                        status: 'running',
                        progress: { phase: 'running', percent: index },
                    }, {
                        expectedVersion: baselineVersion,
                        idempotencyKey: `matrix-a-${index}`,
                    });
                    return 'ok';
                } catch (error) {
                    if (error && error.code === 'AGENT_VERSION_CONFLICT') {
                        return 'conflict';
                    }
                    throw error;
                }
            })
        );

        const okCount = results.filter((item) => item === 'ok').length;
        const conflictCount = results.filter((item) => item === 'conflict').length;
        expect(okCount).toBe(1);
        expect(conflictCount).toBe(attempts - 1);

        const finalWorker = kernel.getWorker(worker.id);
        expect(finalWorker.version).toBe(baselineVersion + 1);
        expect(kernel.getMetrics().telemetry.versionConflicts).toBeGreaterThanOrEqual(attempts - 1);
    });

    test('matrix B: concurrent retries with shared idempotency key remain atomic', async () => {
        const session = kernel.createSession({
            objective: 'Idempotency matrix B',
        }).session;
        const worker = kernel.spawnWorker({
            sessionId: session.id,
            role: 'research',
            prompt: 'idempotency',
        }).worker;

        const requests = 24;
        const resultSnapshots = await Promise.all(
            Array.from({ length: requests }, async (_, index) => {
                await delay(Math.floor(Math.random() * 4));
                return kernel.updateWorker(worker.id, {
                    status: 'running',
                    progress: { phase: 'running', percent: index },
                }, {
                    idempotencyKey: 'matrix-b-shared-key',
                });
            })
        );

        const versions = new Set(resultSnapshots.map((item) => item.worker.version));
        expect(versions.size).toBe(1);

        const finalWorker = kernel.getWorker(worker.id);
        expect(finalWorker.version).toBe(2);
        expect(kernel.getMetrics().telemetry.idempotencyHits).toBeGreaterThanOrEqual(requests - 1);
    });

    test('matrix C: multi-worker parallel writes keep final usage and status consistent', async () => {
        const session = kernel.createSession({
            objective: 'Multi-worker matrix C',
        }).session;
        const workers = [
            kernel.spawnWorker({ sessionId: session.id, role: 'research', prompt: 'r' }).worker,
            kernel.spawnWorker({ sessionId: session.id, role: 'synthesis', prompt: 's' }).worker,
            kernel.spawnWorker({ sessionId: session.id, role: 'implementation', prompt: 'i' }).worker,
        ];

        const perWorkerAttempt = 20;

        await Promise.all(workers.map(async (worker) => {
            const baseVersion = kernel.getWorker(worker.id).version;
            await Promise.all(
                Array.from({ length: perWorkerAttempt }, async (_, index) => {
                    await delay(Math.floor(Math.random() * 8));
                    try {
                        kernel.updateWorker(worker.id, {
                            status: 'running',
                            progress: { phase: 'running', percent: index },
                        }, {
                            expectedVersion: baseVersion,
                            idempotencyKey: `matrix-c-${worker.id}-${index}`,
                        });
                    } catch (error) {
                        if (!(error && error.code === 'AGENT_VERSION_CONFLICT')) {
                            throw error;
                        }
                    }
                })
            );

            kernel.updateWorker(worker.id, {
                status: 'completed',
                progress: { phase: 'done', percent: 100 },
                usage: {
                    promptTokens: 40,
                    completionTokens: 60,
                    totalTokens: 100,
                    costUsd: 0.01,
                },
            });
        }));

        const finalSession = kernel.getSession(session.id);
        expect(finalSession.status).toBe('completed');
        expect(finalSession.usage.totalTokens).toBe(300);
        expect(Number(finalSession.usage.costUsd.toFixed(2))).toBe(0.03);

        const telemetry = kernel.getMetrics().telemetry;
        expect(telemetry.versionConflicts).toBeGreaterThanOrEqual((perWorkerAttempt - 1) * workers.length);
    });
});
