const fs = require('fs');
const os = require('os');
const path = require('path');
const AgentKernel = require('../src/managers/AgentKernel');

describe('AgentKernel', () => {
    let tempDir;
    let kernel;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'golem-agent-kernel-'));
        kernel = new AgentKernel({
            golemId: 'test_golem',
            logDir: tempDir,
            maxWorkers: 3,
            strictMode: true,
        });
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('create session and complete worker transitions session to completed', () => {
        const session = kernel.createSession({
            objective: 'Implement feature',
        }).session;

        const worker = kernel.spawnWorker({
            sessionId: session.id,
            role: 'research',
            prompt: 'analyze',
        }).worker;

        kernel.updateWorker(worker.id, {
            status: 'running',
            progress: { phase: 'running', percent: 25 },
        });

        const result = kernel.updateWorker(worker.id, {
            status: 'completed',
            progress: { phase: 'done', percent: 100 },
        });

        expect(result.worker.status).toBe('completed');
        expect(result.session.status).toBe('completed');
        expect(kernel.getSession(session.id).status).toBe('completed');
    });

    test('resume promotes failed session and worker back to running/pending', () => {
        const session = kernel.createSession({
            objective: 'Recover flow',
        }).session;
        const worker = kernel.spawnWorker({
            sessionId: session.id,
            role: 'research',
            prompt: 'do work',
        }).worker;

        kernel.updateWorker(worker.id, {
            status: 'failed',
            lastError: 'boom',
        });

        const resumed = kernel.resume({ sessionId: session.id });
        expect(resumed.resumed).toBe(true);
        expect(resumed.session.status).toBe('running');

        const workerAfterResume = kernel.getWorker(worker.id);
        expect(workerAfterResume.status).toBe('pending');
    });

    test('budget hard limit raises AGENT_BUDGET_HARD_LIMIT and records violation event', () => {
        kernel.setBudgetPolicy({
            enabled: true,
            worker: {
                tokenHardLimit: 10,
                costHardLimitUsd: 0,
            },
            session: {
                tokenHardLimit: 0,
                costHardLimitUsd: 0,
            },
        });

        const session = kernel.createSession({
            objective: 'Budget guard',
        }).session;
        const worker = kernel.spawnWorker({
            sessionId: session.id,
            role: 'research',
            prompt: 'consume tokens',
        }).worker;

        expect(() => {
            kernel.updateWorker(worker.id, {
                usage: {
                    totalTokens: 99,
                    replace: true,
                },
            });
        }).toThrow('Worker budget hard limit exceeded');

        const events = kernel.getAuditEvents({ limit: 20 });
        expect(events.some((event) => event.type === 'agent.violation')).toBe(true);
    });

    test('persists and restores sessions across kernel restart', () => {
        const created = kernel.createSession({
            objective: 'Persist me',
        }).session;

        const nextKernel = new AgentKernel({
            golemId: 'test_golem',
            logDir: tempDir,
            maxWorkers: 3,
            strictMode: true,
        });

        const restored = nextKernel.getSession(created.id);
        expect(restored).toBeTruthy();
        expect(restored.objective).toBe('Persist me');
    });

    test('decision mode=deny blocks mutation with explicit error code', () => {
        try {
            kernel.createSession({
                objective: 'Denied mutation',
            }, {
                decision: {
                    mode: 'deny',
                    reason: 'policy',
                },
            });
        } catch (error) {
            expect(error.code).toBe('AGENT_MUTATION_DENIED');
            expect(error.statusCode).toBe(403);
            return;
        }
        throw new Error('Expected AGENT_MUTATION_DENIED to be thrown');
    });
});
