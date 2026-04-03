const { replayTrace } = require('../src/harness/HarnessReplayEngine');

describe('HarnessReplayEngine', () => {
    test('fails strict replay when phase chain is violated', () => {
        const result = replayTrace({
            mode: 'strict',
            events: [
                { action: 'agent.worker.created', phase: 'research', status: 'completed', sessionId: 's1' },
                { action: 'agent.worker.created', phase: 'implementation', status: 'running', sessionId: 's1' },
            ],
        });

        expect(result.passed).toBe(false);
        expect(result.violations.some((violation) => violation.code === 'PHASE_CHAIN_VIOLATION')).toBe(true);
    });

    test('flags unknown status only in strict mode', () => {
        const strict = replayTrace({
            mode: 'strict',
            events: [
                { action: 'agent.worker.created', phase: 'research', status: 'unknown', sessionId: 's1' },
            ],
        });
        const lenient = replayTrace({
            mode: 'lenient',
            events: [
                { action: 'agent.worker.created', phase: 'research', status: 'unknown', sessionId: 's1' },
            ],
        });

        expect(strict.passed).toBe(false);
        expect(strict.violations.some((violation) => violation.code === 'UNKNOWN_STATUS')).toBe(true);
        expect(lenient.violations.some((violation) => violation.code === 'UNKNOWN_STATUS')).toBe(false);
    });
});
