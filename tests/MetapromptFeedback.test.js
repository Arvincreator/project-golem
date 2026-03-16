const MetapromptAgent = require('../src/core/MetapromptAgent');

describe('MetapromptAgent Feedback Loop (Phase 1D)', () => {
    let agent;

    beforeEach(() => {
        // Prevent file I/O in tests
        agent = new MetapromptAgent({ golemId: 'test' });
        agent._save = jest.fn();
        agent._load = jest.fn();
        agent._versions = [];
        agent._activeVersion = null;
    });

    test('should record performance metrics', () => {
        agent.register('Test prompt v1', { author: 'test' });
        agent.recordPerformance(3.5, 1200);
        agent.recordPerformance(2.5, 800);

        const stats = agent.getStats();
        expect(stats.totalUses).toBe(2);
    });

    test('should auto-select best version after enough samples', () => {
        const v1 = agent.register('Prompt A', { author: 'test' });
        const v2 = agent.register('Prompt B', { author: 'test' });

        // Give v1 low grades
        agent.activate(v1.id);
        for (let i = 0; i < 6; i++) {
            agent.recordPerformance(1.5, 1000);
        }

        // Give v2 high grades
        agent.activate(v2.id);
        for (let i = 0; i < 6; i++) {
            agent.recordPerformance(3.8, 500);
        }

        const best = agent.autoSelect();
        expect(best).toBeDefined();
        expect(best.id).toBe(v2.id);
    });

    test('should calibrate when avg grade below threshold', () => {
        const v1 = agent.register('Low prompt', { author: 'test' });
        agent.activate(v1.id);

        // Record low grades
        for (let i = 0; i < 10; i++) {
            agent.recordPerformance(2.0, 1000);
        }

        const stats = agent.getStats();
        expect(stats.activeAvgGrade).toBeLessThan(2.5);
    });

    test('should compare versions', () => {
        const v1 = agent.register('Prompt A');
        const v2 = agent.register('Prompt B');

        agent.activate(v1.id);
        for (let i = 0; i < 6; i++) agent.recordPerformance(2.0, 500);
        agent.activate(v2.id);
        for (let i = 0; i < 6; i++) agent.recordPerformance(3.5, 500);

        const comparison = agent.compareVersions(v1.id, v2.id);
        expect(comparison).toBeDefined();
        expect(comparison.result).toBe('b_better');
    });
});
