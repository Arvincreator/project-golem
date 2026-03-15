const fs = require('fs');
const SelfEvolution = require('../src/core/SelfEvolution');

describe('SelfEvolution', () => {
    let evo;

    beforeEach(() => {
        evo = new SelfEvolution({ golemId: 'test' });
        evo._strategies = {};
    });

    afterAll(() => {
        try { fs.unlinkSync('golem_strategies.json'); } catch (e) {}
    });

    test('recordAction tracks success rate', () => {
        evo.recordAction('deploy:prod', true);
        evo.recordAction('deploy:prod', true);
        evo.recordAction('deploy:prod', false);
        expect(evo.getSuccessRate('deploy:prod')).toBeCloseTo(2 / 3);
    });

    test('low success rate promotes level', () => {
        for (let i = 0; i < 5; i++) evo.recordAction('risky:op', false);
        expect(evo._strategies['risky:op'].level).toBe('L2');
    });

    test('high success rate demotes level', () => {
        evo._strategies['safe:op'] = { total: 0, success: 0, level: 'L2' };
        for (let i = 0; i < 10; i++) evo.recordAction('safe:op', true);
        expect(evo._strategies['safe:op'].level).toBe('L1');
    });

    test('trackSequence detects recurring patterns', () => {
        const steps = [{ action: 'build' }, { action: 'test' }, { action: 'deploy' }];
        evo.trackSequence(steps);
        evo.trackSequence(steps);
        const result = evo.trackSequence(steps);
        expect(result).not.toBeNull();
        expect(result.suggestSkill).toBe(true);
        expect(result.occurrences).toBe(3);
    });

    test('getStats returns correct data', () => {
        evo.recordAction('a:b', true);
        const stats = evo.getStats();
        expect(stats.totalStrategies).toBe(1);
    });
});
