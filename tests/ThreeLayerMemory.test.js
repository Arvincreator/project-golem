const fs = require('fs');
const ThreeLayerMemory = require('../src/memory/ThreeLayerMemory');

describe('ThreeLayerMemory', () => {
    let mem;

    beforeEach(() => {
        mem = new ThreeLayerMemory({ golemId: 'test' });
        mem._episodes = []; // Reset
    });

    afterAll(() => {
        try { fs.unlinkSync('golem_episodes.json'); } catch (e) {}
    });

    test('addToWorking respects cap', () => {
        for (let i = 0; i < 60; i++) {
            mem.addToWorking({ content: `msg ${i}` });
        }
        expect(mem.getWorkingContext(100).length).toBeLessThanOrEqual(50);
    });

    test('recordEpisode creates episode with correct structure', () => {
        const ep = mem.recordEpisode('test situation', ['action1'], 'success', 1);
        expect(ep.id).toMatch(/^ep_/);
        expect(ep.situation).toBe('test situation');
        expect(ep.actions).toEqual(['action1']);
        expect(ep.reward).toBe(1);
    });

    test('queryEpisodes matches by keyword', () => {
        mem.recordEpisode('deploying to production', ['deploy'], 'success', 1);
        mem.recordEpisode('fixing bug in auth', ['debug'], 'fixed', 1);
        const results = mem.queryEpisodes('production deploy');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].situation).toContain('production');
    });

    test('clearWorking empties working memory', () => {
        mem.addToWorking({ content: 'test' });
        expect(mem.getWorkingContext().length).toBe(1);
        mem.clearWorking();
        expect(mem.getWorkingContext().length).toBe(0);
    });

    test('getStats returns correct counts', () => {
        mem.addToWorking({ content: 'a' });
        mem.recordEpisode('sit', [], 'out', 0);
        const stats = mem.getStats();
        expect(stats.working).toBe(1);
        expect(stats.episodic).toBe(1);
    });
});
