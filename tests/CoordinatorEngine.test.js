const fs = require('fs');
const os = require('os');
const path = require('path');

const AgentKernel = require('../src/managers/AgentKernel');
const CoordinatorEngine = require('../src/core/CoordinatorEngine');

describe('CoordinatorEngine orchestration parity', () => {
    let tempDir;
    let kernel;
    let coordinator;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'golem-coordinator-test-'));
        kernel = new AgentKernel({
            golemId: 'coordinator_test',
            logDir: tempDir,
            maxWorkers: 8,
            strictMode: true,
        });
        coordinator = new CoordinatorEngine({
            agentKernel: kernel,
            strictMode: true,
        });
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('strict mode blocks implementation spawn before synthesis worker', () => {
        const session = coordinator.createSession({
            objective: 'Deliver feature with phase discipline',
        }).session;

        const researchWorker = coordinator.spawnWorker({
            sessionId: session.id,
            role: 'research',
            prompt: 'collect requirements',
        }).worker;

        coordinator.updateWorker(researchWorker.id, {
            status: 'completed',
            progress: { phase: 'done', percent: 100 },
        });

        expect(() => coordinator.spawnWorker({
            sessionId: session.id,
            role: 'implementation',
            prompt: 'start coding directly',
        })).toThrow(/synthesis/i);
    });

    test('full research -> synthesis -> implementation -> verification workflow reaches completed', () => {
        const session = coordinator.createSession({
            objective: 'End-to-end orchestration run',
        }).session;

        const researchWorker = coordinator.spawnWorker({
            sessionId: session.id,
            role: 'research',
            prompt: 'research first',
        }).worker;
        coordinator.updateWorker(researchWorker.id, {
            status: 'completed',
            progress: { phase: 'done', percent: 100 },
        });

        const synthesisWorker = coordinator.spawnWorker({
            sessionId: session.id,
            role: 'synthesis',
            prompt: 'build an actionable plan',
        }).worker;
        coordinator.updateWorker(synthesisWorker.id, {
            status: 'completed',
            progress: { phase: 'done', percent: 100 },
        });

        const implementationWorker = coordinator.spawnWorker({
            sessionId: session.id,
            role: 'implementation',
            prompt: 'implement plan',
        }).worker;
        coordinator.updateWorker(implementationWorker.id, {
            status: 'completed',
            progress: { phase: 'done', percent: 100 },
        });

        const verificationWorker = coordinator.spawnWorker({
            sessionId: session.id,
            role: 'verification',
            prompt: 'verify output',
        }).worker;
        const finalResult = coordinator.updateWorker(verificationWorker.id, {
            status: 'completed',
            progress: { phase: 'done', percent: 100 },
        });

        expect(finalResult.session.status).toBe('completed');
        expect(finalResult.session.metadata.verification.status).toBe('verified');

        const sessionDetail = coordinator.getSession(session.id);
        expect(sessionDetail.orchestration.currentPhase).toBe('verification');
        expect(sessionDetail.session.status).toBe('completed');
    });

    test('orchestration state suggests next action for empty research phase', () => {
        const session = coordinator.createSession({
            objective: 'Need guidance',
        }).session;

        const state = coordinator.getOrchestrationState(session.id);
        expect(state).toBeTruthy();
        expect(state.currentPhase).toBe('research');
        expect(state.nextAction).toBeTruthy();
        expect(state.nextAction.action).toBe('agent_worker_spawn');
        expect(state.nextAction.input.role).toBe('research');
    });

    test('emits orchestration decision callback when evaluating next action', () => {
        const decisions = [];
        const callbackCoordinator = new CoordinatorEngine({
            agentKernel: kernel,
            strictMode: true,
            onOrchestrationEvent: (event) => decisions.push(event),
        });

        const session = callbackCoordinator.createSession({
            objective: 'decision event test',
        }).session;

        callbackCoordinator.getOrchestrationState(session.id);

        expect(decisions.length).toBeGreaterThan(0);
        expect(decisions[0].type).toBe('agent.orchestration.decision');
        expect(decisions[0].sessionId).toBe(session.id);
    });

    test('synthesis failure marks session failed with explicit reason', () => {
        const session = coordinator.createSession({
            objective: 'Handle synthesis failure',
        }).session;

        const researchWorker = coordinator.spawnWorker({
            sessionId: session.id,
            role: 'research',
            prompt: 'collect baseline',
        }).worker;
        coordinator.updateWorker(researchWorker.id, {
            status: 'completed',
            progress: { phase: 'done', percent: 100 },
        });

        const synthesisWorker = coordinator.spawnWorker({
            sessionId: session.id,
            role: 'synthesis',
            prompt: 'summarize baseline',
        }).worker;

        const result = coordinator.updateWorker(synthesisWorker.id, {
            status: 'failed',
            lastError: 'insufficient evidence',
        });

        expect(result.session.status).toBe('failed');
        expect(result.session.lastError).toBe('synthesis_failed');
    });
});
