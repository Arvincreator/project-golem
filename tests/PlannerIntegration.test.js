const Planner = require('../src/core/Planner');

describe('Planner Integration (Phase 1B)', () => {
    let planner, mockBrain;

    beforeEach(() => {
        mockBrain = {
            sendMessage: jest.fn().mockResolvedValue('{"tasks": [{"id": "t1", "desc": "Step 1", "deps": [], "level": "L1"}]}'),
        };
        planner = new Planner(mockBrain, { golemId: 'test' });
    });

    test('should auto-checkpoint on plan creation', async () => {
        const saveSpy = jest.spyOn(planner.checkpoint, 'save');
        await planner.createPlan('Test goal');

        expect(saveSpy).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ goal: 'Test goal' }),
            expect.objectContaining({ event: 'created' })
        );
    });

    test('should checkpoint on step completion during executePlan', async () => {
        await planner.createPlan('Test goal');
        const saveSpy = jest.spyOn(planner.checkpoint, 'save');

        const executeStep = jest.fn().mockResolvedValue('done');
        await planner.executePlan({}, executeStep);

        const stepDoneCalls = saveSpy.mock.calls.filter(c => c[2]?.event === 'step_done');
        expect(stepDoneCalls.length).toBeGreaterThan(0);
    });

    test('should checkpoint before and after replan', async () => {
        const plan = await planner.createPlan('Test goal');
        const saveSpy = jest.spyOn(planner.checkpoint, 'save');
        saveSpy.mockClear();

        mockBrain.sendMessage.mockResolvedValueOnce('{"tasks": [{"id": "r1", "desc": "Replacement step"}]}');
        await planner._replan(plan, plan.steps[0], 'test error');

        const preReplan = saveSpy.mock.calls.filter(c => c[2]?.event === 'pre_replan');
        const postReplan = saveSpy.mock.calls.filter(c => c[2]?.event === 'post_replan');
        expect(preReplan.length).toBe(1);
        expect(postReplan.length).toBe(1);
    });
});
