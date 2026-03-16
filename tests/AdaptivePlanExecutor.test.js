const AdaptivePlanExecutor = require('../src/core/AdaptivePlanExecutor');

describe('AdaptivePlanExecutor', () => {
    let executor, mockPlanner, mockWorldModel, mockCheckpoint, mockReplay, mockBrain, mockMetrics;

    beforeEach(() => {
        mockBrain = {
            sendMessage: jest.fn().mockResolvedValue('step result'),
        };
        mockPlanner = {
            createPlan: jest.fn().mockResolvedValue({
                id: 'plan_test',
                goal: 'test goal',
                steps: [
                    { id: 's1', description: 'Step 1', status: 'pending', deps: [], prediction: null, startedAt: null, completedAt: null, result: null, error: null, attempts: 0 },
                    { id: 's2', description: 'Step 2', status: 'pending', deps: [], prediction: null, startedAt: null, completedAt: null, result: null, error: null, attempts: 0 },
                ],
                status: 'pending',
                replanCount: 0,
                observations: [],
                updatedAt: Date.now(),
            }),
            _replan: jest.fn().mockResolvedValue(false),
        };
        mockWorldModel = {
            simulate: jest.fn().mockResolvedValue([null, null]),
        };
        mockCheckpoint = {
            save: jest.fn().mockReturnValue({ version: 1 }),
        };
        mockReplay = {
            recordTrace: jest.fn(),
        };
        mockMetrics = {
            record: jest.fn(),
        };

        executor = new AdaptivePlanExecutor({
            planner: mockPlanner,
            worldModel: mockWorldModel,
            checkpoint: mockCheckpoint,
            experienceReplay: mockReplay,
            metrics: mockMetrics,
        });
    });

    test('should create and execute a plan', async () => {
        const ctx = { reply: jest.fn() };
        const result = await executor.run('test goal', {}, ctx, mockBrain);

        expect(mockPlanner.createPlan).toHaveBeenCalledWith('test goal', {});
        expect(result.plan).toBeDefined();
        expect(result.results.length).toBe(2);
        expect(result.brainCalls).toBe(2);
    });

    test('should checkpoint on creation and step completion', async () => {
        const ctx = { reply: jest.fn() };
        await executor.run('test goal', {}, ctx, mockBrain);

        // created + step_done x2
        expect(mockCheckpoint.save).toHaveBeenCalledTimes(3);
        expect(mockCheckpoint.save.mock.calls[0][2].event).toBe('created');
        expect(mockCheckpoint.save.mock.calls[1][2].event).toBe('step_done');
    });

    test('should record traces in ExperienceReplay', async () => {
        const ctx = { reply: jest.fn() };
        await executor.run('test goal', {}, ctx, mockBrain);

        expect(mockReplay.recordTrace).toHaveBeenCalledTimes(2);
    });

    test('should respect brain call budget', async () => {
        // Budget is read from env at module load time (default 5)
        // Create plan with more steps than budget allows
        mockPlanner.createPlan.mockResolvedValueOnce({
            id: 'plan_budget',
            goal: 'budget test',
            steps: Array.from({ length: 8 }, (_, i) => ({
                id: `s${i}`, description: `Step ${i}`, status: 'pending',
                deps: [], prediction: null, startedAt: null, completedAt: null,
                result: null, error: null, attempts: 0,
            })),
            status: 'pending',
            replanCount: 0,
            observations: [],
            updatedAt: Date.now(),
        });

        const ctx = { reply: jest.fn() };
        const result = await executor.run('budget test', {}, ctx, mockBrain);

        // Should stop at MAX_BRAIN_CALLS_PER_PLAN (default 5)
        expect(result.brainCalls).toBeLessThanOrEqual(5);
        expect(result.results.some(r => r.reason === 'budget_exhausted')).toBe(true);
    });

    test('should handle step failures gracefully', async () => {
        mockBrain.sendMessage.mockRejectedValueOnce(new Error('Network error'));
        const ctx = { reply: jest.fn() };
        const result = await executor.run('test goal', {}, ctx, mockBrain);

        expect(result.results.some(r => r.status === 'failed')).toBe(true);
    });

    test('_computeDivergence returns 0 for identical inputs', () => {
        expect(executor._computeDivergence('hello world', 'hello world')).toBe(0);
    });

    test('_computeDivergence returns high value for different inputs', () => {
        const d = executor._computeDivergence('hello world foo', 'completely different bar');
        expect(d).toBeGreaterThan(0.5);
    });

    test('_computeDivergence handles null inputs', () => {
        expect(executor._computeDivergence(null, 'test')).toBe(0);
        expect(executor._computeDivergence('test', null)).toBe(0);
    });
});
