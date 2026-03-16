const WorldModel = require('../src/core/WorldModel');

const mockBrain = {
    sendMessage: jest.fn().mockResolvedValue('{"predictions": [{"stepId": "t1", "expectedOutcome": "success", "riskLevel": "LOW", "confidence": 0.8}]}'),
};

describe('WorldModel', () => {
    let wm;

    beforeEach(() => {
        wm = new WorldModel(mockBrain, { golemId: 'test' });
        mockBrain.sendMessage.mockClear();
    });

    test('simulate returns predictions for steps', async () => {
        const steps = [{ id: 't1', desc: 'deploy', level: 'L1' }];
        const predictions = await wm.simulate('deploy app', steps);
        expect(predictions.length).toBe(1);
        expect(predictions[0].expectedOutcome).toBeDefined();
        expect(predictions[0].confidence).toBeGreaterThan(0);
    });

    test('simulate caches results', async () => {
        const steps = [{ id: 't1', desc: 'test', level: 'L0' }];
        await wm.simulate('test goal', steps);
        await wm.simulate('test goal', steps);
        expect(mockBrain.sendMessage).toHaveBeenCalledTimes(1); // cached
    });

    test('simulate falls back to heuristics on error', async () => {
        mockBrain.sendMessage.mockRejectedValueOnce(new Error('brain offline'));
        const steps = [{ id: 't1', desc: 'test', level: 'L0' }];
        const predictions = await wm.simulate('goal', steps);
        expect(predictions.length).toBe(1);
        expect(predictions[0].riskLevel).toBe('LOW'); // L0 = LOW
    });

    test('valueFunction returns score between 0 and 1', () => {
        const score = wm.valueFunction({}, { desc: 'test', level: 'L0' });
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
    });

    test('valueFunction adjusts by security level', () => {
        const l0 = wm.valueFunction({}, { level: 'L0' });
        const l3 = wm.valueFunction({}, { level: 'L3' });
        expect(l0).toBeGreaterThan(l3);
    });

    test('valueFunction uses episodic memory when available', () => {
        const mockMemory = {
            queryEpisodesSync: jest.fn().mockReturnValue([
                { reward: 0.9 },
                { reward: 0.8 },
            ]),
        };
        wm.threeLayerMemory = mockMemory;
        const score = wm.valueFunction({}, { desc: 'deploy', level: 'L1' });
        expect(score).toBeGreaterThan(0.5);
        expect(mockMemory.queryEpisodesSync).toHaveBeenCalled();
    });

    test('lookahead computes cumulative value', async () => {
        const actions = [
            { desc: 'step1', level: 'L0' },
            { desc: 'step2', level: 'L1' },
        ];
        const result = await wm.lookahead({}, actions, 2);
        expect(result.totalValue).toBeGreaterThan(0);
        expect(result.trajectory.length).toBe(2);
        expect(result.depth).toBe(2);
    });

    test('_heuristicSimulate returns predictions without LLM', () => {
        const steps = [
            { id: 't1', desc: 'safe', level: 'L0' },
            { id: 't2', desc: 'risky', level: 'L3' },
        ];
        const preds = wm._heuristicSimulate(steps);
        expect(preds[0].riskLevel).toBe('LOW');
        expect(preds[1].riskLevel).toBe('HIGH');
        expect(preds[0].confidence).toBeGreaterThan(preds[1].confidence);
    });

    test('getStats returns simulation metrics', async () => {
        const steps = [{ id: 't1', desc: 'test', level: 'L0' }];
        await wm.simulate('goal', steps);
        const stats = wm.getStats();
        expect(stats.simulationCount).toBe(1);
        expect(stats.cacheSize).toBe(1);
    });

    // v9.5: EMA value function
    test('valueFunction uses EMA values when set', () => {
        wm.setEmaValues({ L0: 0.95, L1: 0.8, L2: 0.4, L3: 0.2 });
        const l0 = wm.valueFunction({}, { level: 'L0' });
        const l3 = wm.valueFunction({}, { level: 'L3' });
        expect(l0).toBeGreaterThan(l3);
        // Should use EMA values, not hardcoded
        expect(l0).toBeCloseTo(0.95, 1);
    });

    test('valueFunction falls back to hardcoded without EMA', () => {
        wm._emaValues = null; // Ensure no EMA
        const l0 = wm.valueFunction({}, { level: 'L0' });
        expect(l0).toBeCloseTo(0.9, 1); // hardcoded fallback
    });

    test('setEmaValues stores EMA reference', () => {
        const ema = { L0: 0.7, L1: 0.6, L2: 0.5, L3: 0.4 };
        wm.setEmaValues(ema);
        expect(wm._emaValues).toEqual(ema);
    });
});
