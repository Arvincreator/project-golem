const MetapromptAgent = require('../src/core/MetapromptAgent');
const fs = require('fs');

describe('MetapromptAgent', () => {
    let agent;

    beforeEach(() => {
        agent = new MetapromptAgent({ golemId: 'test' });
        agent._versions = [];
        agent._activeVersion = null;
    });

    afterAll(() => {
        try { fs.unlinkSync('golem_prompt_versions.json'); } catch (_) {}
    });

    test('register creates a new version', () => {
        const v = agent.register('You are a helpful assistant.', { author: 'test' });
        expect(v.id).toMatch(/^prompt_v/);
        expect(v.text).toBe('You are a helpful assistant.');
        expect(v.metrics.uses).toBe(0);
    });

    test('activate sets the active version', () => {
        const v1 = agent.register('Prompt v1');
        const v2 = agent.register('Prompt v2');
        agent.activate(v2.id);
        expect(agent.getActivePrompt()).toBe('Prompt v2');
        expect(agent._activeVersion.id).toBe(v2.id);
    });

    test('getActivePrompt falls back to latest', () => {
        agent.register('Prompt A');
        agent.register('Prompt B');
        expect(agent.getActivePrompt()).toBe('Prompt B');
    });

    test('recordPerformance updates metrics', () => {
        const v = agent.register('test prompt');
        agent.activate(v.id);
        agent.recordPerformance(3.5, 200);
        agent.recordPerformance(2.5, 300);
        expect(v.metrics.uses).toBe(2);
        expect(v.metrics.avgGrade).toBe(3.0);
        expect(v.metrics.avgLatency).toBe(250);
    });

    test('compareVersions returns comparison result', () => {
        const a = agent.register('Prompt A');
        const b = agent.register('Prompt B');
        agent.activate(a.id);

        // Add sample data
        for (let i = 0; i < 6; i++) {
            a.metrics.grades.push(2.0);
            b.metrics.grades.push(3.5);
        }
        a.metrics.uses = 6;
        b.metrics.uses = 6;

        const result = agent.compareVersions(a.id, b.id);
        expect(result.result).toBe('b_better');
        expect(result.bAvgGrade).toBeGreaterThan(result.aAvgGrade);
    });

    test('compareVersions returns insufficient_data for few samples', () => {
        const a = agent.register('A');
        const b = agent.register('B');
        const result = agent.compareVersions(a.id, b.id);
        expect(result.result).toBe('insufficient_data');
    });

    test('autoSelect picks best version', () => {
        const a = agent.register('Low quality');
        const b = agent.register('High quality');
        a.metrics.uses = 10;
        a.metrics.grades = Array(10).fill(2.0);
        a.metrics.avgGrade = 2.0;
        b.metrics.uses = 10;
        b.metrics.grades = Array(10).fill(3.8);
        b.metrics.avgGrade = 3.8;

        const best = agent.autoSelect();
        expect(best.id).toBe(b.id);
        expect(agent._activeVersion.id).toBe(b.id);
    });

    test('listVersions returns formatted list', () => {
        agent.register('Prompt 1');
        agent.register('Prompt 2');
        const list = agent.listVersions();
        expect(list.length).toBe(2);
        expect(list[0].textPreview).toBeDefined();
    });

    test('getStats returns correct summary', () => {
        agent.register('test');
        const stats = agent.getStats();
        expect(stats.totalVersions).toBe(1);
        expect(stats.totalUses).toBe(0);
    });
});
