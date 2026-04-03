const { evaluateGate } = require('../scripts/harness/ci-gate');

describe('Harness CI gate', () => {
    test('returns warning mode for develop', () => {
        const result = evaluateGate({
            branch: 'develop',
            compare: { hardFail: true, warnings: ['FIXED_BASELINE_DEGRADED'] },
        });

        expect(result.mode).toBe('warn');
        expect(result.exitCode).toBe(0);
        expect(result.hardFail).toBe(true);
    });

    test('returns hard fail for main when hardFail=true', () => {
        const result = evaluateGate({
            branch: 'main',
            compare: { hardFail: true, warnings: [] },
        });

        expect(result.mode).toBe('enforce');
        expect(result.exitCode).toBe(1);
    });
});
