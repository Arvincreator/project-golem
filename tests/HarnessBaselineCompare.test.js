const { compareReports } = require('../scripts/harness/compare-baseline');

describe('Harness baseline compare', () => {
    test('flags hard fail when rolling success-rate degrades > 5%', () => {
        const result = compareReports({
            current: { successRate: 0.84 },
            rolling: { successRate: 0.90 },
            fixed: { successRate: 0.93 },
            threshold: 0.05,
        });

        expect(result.rolling.degrade).toBeCloseTo(0.06, 5);
        expect(result.hardFail).toBe(true);
        expect(result.warnings).toContain('FIXED_BASELINE_DEGRADED');
    });
});
