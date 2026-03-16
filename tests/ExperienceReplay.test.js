const ExperienceReplay = require('../src/core/ExperienceReplay');
const fs = require('fs');

describe('ExperienceReplay', () => {
    let er;

    beforeEach(() => {
        er = new ExperienceReplay({ golemId: 'test' });
        er._traces = [];
        er._reflections = [];
    });

    afterAll(() => {
        try { fs.unlinkSync('golem_experience_replay.json'); } catch (_) {}
    });

    test('recordTrace creates trace with correct structure', () => {
        const trace = er.recordTrace({
            goal: 'deploy app',
            action: 'npm run build',
            result: 'success',
            success: true,
            reward: 1.0,
        });
        expect(trace.id).toMatch(/^trace_/);
        expect(trace.goal).toBe('deploy app');
        expect(trace.success).toBe(true);
        expect(trace.reward).toBe(1.0);
    });

    test('recordTrace defaults reward based on success', () => {
        const success = er.recordTrace({ success: true });
        expect(success.reward).toBe(1.0);
        const failure = er.recordTrace({ success: false });
        expect(failure.reward).toBe(0.0);
    });

    test('reflect generates patterns from failures', async () => {
        er.recordTrace({ goal: 'g1', action: 'deploy', result: 'timeout', success: false });
        er.recordTrace({ goal: 'g2', action: 'deploy', result: 'timeout', success: false });
        er.recordTrace({ goal: 'g3', action: 'build', result: 'error', success: false });

        const reflection = await er.reflect();
        expect(reflection).not.toBeNull();
        expect(reflection.patterns.length).toBeGreaterThan(0);
        expect(reflection.actionItems.length).toBeGreaterThan(0);
    });

    test('reflect detects repeated action failures', async () => {
        er.recordTrace({ action: 'same_action', success: false });
        er.recordTrace({ action: 'same_action', success: false });
        const reflection = await er.reflect();
        expect(reflection.patterns.some(p => p.type === 'repeated_failure')).toBe(true);
    });

    test('reflect detects consecutive failures', async () => {
        for (let i = 0; i < 4; i++) {
            er.recordTrace({ action: `action_${i}`, success: false });
        }
        const reflection = await er.reflect();
        expect(reflection.patterns.some(p => p.type === 'consecutive_failures')).toBe(true);
    });

    test('getReflectionContext returns formatted string', async () => {
        er.recordTrace({ action: 'test', success: false });
        await er.reflect();
        const ctx = er.getReflectionContext();
        expect(ctx).toContain('Experience Replay');
    });

    test('sample returns prioritized traces', () => {
        er.recordTrace({ goal: 'a', success: true, reward: 1.0 });
        er.recordTrace({ goal: 'b', success: false, reward: 0.0 });
        er.recordTrace({ goal: 'c', success: true, reward: 0.8 });
        const samples = er.sample(2);
        expect(samples.length).toBe(2);
    });

    test('sample filters by success', () => {
        er.recordTrace({ goal: 'a', success: true });
        er.recordTrace({ goal: 'b', success: false });
        const successes = er.sample(10, { success: true });
        expect(successes.every(t => t.success)).toBe(true);
    });

    test('getSuccessRate computes correctly', () => {
        er.recordTrace({ success: true });
        er.recordTrace({ success: true });
        er.recordTrace({ success: false });
        const rate = er.getSuccessRate();
        expect(rate.rate).toBeCloseTo(0.667, 2);
    });

    test('getStats returns valid stats', () => {
        er.recordTrace({ success: true });
        const stats = er.getStats();
        expect(stats.traces).toBe(1);
        expect(stats.reflections).toBe(0);
    });

    // v9.5: EMA value learning
    test('EMA values update on recordTrace', () => {
        const initial = { ...er._ema };
        er.recordTrace({ action: 'brain_response', success: true, reward: 1.0 });
        // L1 is the default bucket
        expect(er._ema.L1).toBeGreaterThan(initial.L1);
    });

    test('EMA values decrease on failure', () => {
        // Start with known state
        er._ema.L1 = 0.5;
        er.recordTrace({ action: 'brain_response', success: false, reward: 0.0 });
        expect(er._ema.L1).toBeLessThan(0.5);
    });

    test('getEmaValues returns copy of EMA state', () => {
        const ema = er.getEmaValues();
        expect(ema).toHaveProperty('L0');
        expect(ema).toHaveProperty('L1');
        expect(ema).toHaveProperty('plan_step');
        // Verify it's a copy
        ema.L0 = 999;
        expect(er._ema.L0).not.toBe(999);
    });

    // v9.5: reflect → coreMemory
    test('reflect writes to coreMemory.learned_rules', async () => {
        const mockCoreMemory = { append: jest.fn().mockReturnValue(true) };
        er.coreMemory = mockCoreMemory;
        er.recordTrace({ action: 'deploy', success: false });
        er.recordTrace({ action: 'deploy', success: false });
        er.recordTrace({ action: 'deploy', success: false });

        const reflection = await er.reflect();
        expect(reflection).not.toBeNull();
        expect(mockCoreMemory.append).toHaveBeenCalledWith(
            'learned_rules',
            expect.any(String),
            { system: true }
        );
    });

    // v9.5: autoReflectIfNeeded
    test('autoReflectIfNeeded triggers Tier 1 on consecutive failures', async () => {
        const mockCoreMemory = { append: jest.fn().mockReturnValue(true) };
        er.coreMemory = mockCoreMemory;
        for (let i = 0; i < 4; i++) {
            er.recordTrace({ action: `act_${i}`, success: false });
        }

        const result = await er.autoReflectIfNeeded();
        expect(result).not.toBeNull();
        expect(result.tier).toBe(1);
        expect(mockCoreMemory.append).toHaveBeenCalled();
    });

    test('getStats includes EMA values', () => {
        const stats = er.getStats();
        expect(stats.ema).toBeDefined();
        expect(stats.ema.L0).toBeDefined();
    });
});
