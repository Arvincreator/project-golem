const Planner = require('../src/core/Planner');

const mockBrain = {
    sendMessage: jest.fn().mockResolvedValue('{"tasks": [{"id": "t1", "desc": "step1", "deps": [], "level": "L0"}, {"id": "t2", "desc": "step2", "deps": ["t1"], "level": "L1"}]}'),
};

describe('Planner', () => {
    let planner;

    beforeEach(() => {
        planner = new Planner(mockBrain, { golemId: 'test' });
        mockBrain.sendMessage.mockClear();
        mockBrain.sendMessage.mockResolvedValue('{"tasks": [{"id": "t1", "desc": "step1", "deps": [], "level": "L0"}, {"id": "t2", "desc": "step2", "deps": ["t1"], "level": "L1"}]}');
    });

    test('createPlan decomposes goal into steps', async () => {
        const plan = await planner.createPlan('deploy app');
        expect(plan.id).toMatch(/^plan_/);
        expect(plan.steps.length).toBeGreaterThan(0);
        expect(plan.status).toBe('pending');
    });

    test('executePlan runs steps sequentially', async () => {
        await planner.createPlan('test goal');
        const executeStep = jest.fn().mockResolvedValue('done');
        const { plan, results } = await planner.executePlan({}, executeStep);
        expect(results.length).toBeGreaterThan(0);
        expect(plan.status).toBe('completed');
    });

    test('executePlan handles step failure', async () => {
        await planner.createPlan('test goal');
        mockBrain.sendMessage.mockResolvedValueOnce('{"tasks": [{"id": "r1", "desc": "retry", "deps": [], "level": "L0"}]}');
        const executeStep = jest.fn()
            .mockRejectedValueOnce(new Error('step failed'))
            .mockResolvedValue('recovered');
        const { plan } = await planner.executePlan({}, executeStep);
        expect(plan.replanCount).toBeGreaterThan(0);
    });

    test('executeParallel runs independent steps concurrently', async () => {
        mockBrain.sendMessage.mockResolvedValue('{"tasks": [{"id": "a", "desc": "a", "deps": [], "level": "L0"}, {"id": "b", "desc": "b", "deps": [], "level": "L0"}, {"id": "c", "desc": "c", "deps": ["a", "b"], "level": "L1"}]}');
        await planner.createPlan('parallel test');
        const executeStep = jest.fn().mockResolvedValue('done');
        const { results } = await planner.executeParallel({}, executeStep);
        expect(results.length).toBe(3);
    });

    test('_buildParallelLayers groups independent steps', () => {
        const steps = [
            { id: 'a', deps: [] },
            { id: 'b', deps: [] },
            { id: 'c', deps: ['a', 'b'] },
            { id: 'd', deps: ['c'] },
        ];
        const layers = planner._buildParallelLayers(steps);
        expect(layers.length).toBe(3);
        expect(layers[0].map(s => s.id).sort()).toEqual(['a', 'b']);
        expect(layers[1].map(s => s.id)).toEqual(['c']);
    });

    test('cancelPlan cancels active plan', async () => {
        await planner.createPlan('cancel test');
        expect(planner.getActivePlan()).not.toBeNull();
        planner.cancelPlan();
        expect(planner.getActivePlan()).toBeNull();
    });

    test('getPlanHistory tracks created plans', async () => {
        await planner.createPlan('goal 1');
        await planner.createPlan('goal 2');
        expect(planner.getPlanHistory().length).toBe(2);
    });
});
