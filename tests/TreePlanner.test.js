const TreePlanner = require('../src/core/TreePlanner');

// Mock brain
const mockBrain = {
    sendMessage: jest.fn().mockResolvedValue('{"tasks": [{"id": "t1", "desc": "step1", "deps": [], "level": "L0"}]}'),
};

describe('TreePlanner', () => {
    let planner;

    beforeEach(() => {
        planner = new TreePlanner(mockBrain, { golemId: 'test' });
        mockBrain.sendMessage.mockClear();
    });

    test('planTree returns linear plan for simple queries', async () => {
        const result = await planner.planTree('hello');
        expect(result.isSimple).toBe(true);
        expect(result.root).toBeDefined();
        expect(result.root.id).toBeDefined();
    });

    test('planTree generates tree for complex queries', async () => {
        mockBrain.sendMessage.mockResolvedValueOnce(JSON.stringify({
            tasks: [{ id: 't1', desc: 'step1', deps: [], level: 'L0' }]
        })).mockResolvedValueOnce(JSON.stringify({
            plans: [
                { name: 'Plan A', steps: [{ description: 'Step 1', action: 'do A' }] },
                { name: 'Plan B', steps: [{ description: 'Step 1', action: 'do B' }] },
            ]
        }));

        const result = await planner.planTree('try method A or compare with method B and pick alternative');
        expect(result.root).toBeDefined();
    });

    test('_isComplexQuery detects complex queries', () => {
        expect(planner._isComplexQuery('hello')).toBe(false);
        expect(planner._isComplexQuery('try this or that alternative compare')).toBe(true);
        expect(planner._isComplexQuery('嘗試方案A或者方案B比較')).toBe(true);
    });

    test('_scoreNode returns score between 0 and 1', () => {
        const node = { id: 'test', description: 'test action', action: 'test' };
        const { score, confidence } = planner._scoreNode(node);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
        expect(confidence).toBeGreaterThanOrEqual(0);
    });

    test('_scoreNode uses OODA metrics when available', () => {
        const mockOODA = {
            getMetrics: () => ({
                recentDecisions: [
                    { action: 'test', time: Date.now() },
                    { action: 'test', time: Date.now() },
                    { action: 'noop', time: Date.now() },
                ]
            })
        };
        planner.oodaLoop = mockOODA;
        const { score } = planner._scoreNode({ id: 'test', description: 'test' });
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
    });

    test('executeTree handles successful step execution', async () => {
        const root = {
            id: 'root', description: 'root step', action: 'test',
            children: [], score: 0.8, status: 'pending', depth: 0, parentId: null,
        };

        const processStep = jest.fn().mockResolvedValue('success');
        const result = await planner.executeTree({}, root, processStep);
        expect(result.completed).toBe(1);
        expect(result.failed).toBe(0);
        expect(processStep).toHaveBeenCalledTimes(1);
    });

    test('executeTree backtracks on failure', async () => {
        const root = {
            id: 'root', description: 'failing step', action: 'test',
            children: [], score: 0.8, status: 'pending', depth: 0, parentId: null,
        };

        mockBrain.sendMessage.mockResolvedValueOnce(JSON.stringify({
            alternatives: [
                { description: 'alt step', action: 'alternative' },
            ]
        }));

        let callCount = 0;
        const processStep = jest.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) throw new Error('step failed');
            return Promise.resolve('success');
        });

        const result = await planner.executeTree({}, root, processStep);
        expect(result.backtracks).toBeGreaterThan(0);
    });

    test('max backtrack depth is enforced', async () => {
        const root = {
            id: 'root', description: 'always fails', action: 'test',
            children: [], score: 0.8, status: 'pending', depth: 0, parentId: null,
        };

        mockBrain.sendMessage.mockResolvedValue(JSON.stringify({
            alternatives: [{ description: 'alt', action: 'alt' }]
        }));

        const processStep = jest.fn().mockRejectedValue(new Error('always fails'));
        const result = await planner.executeTree({}, root, processStep);
        expect(result.backtracks).toBeLessThanOrEqual(2);
    });

    test('_pruneBranch removes low-scoring branches', () => {
        const root = {
            id: 'root', score: 0.8, status: 'pending',
            children: [
                { id: 'a', score: 0.1, status: 'pending', children: [] },
                { id: 'b', score: 0.5, status: 'pending', children: [] },
            ],
        };
        planner._pruneBranch(root, 0.2);
        expect(root.children.length).toBe(1);
        expect(root.children[0].id).toBe('b');
    });

    test('_flattenBestPath returns ordered steps', () => {
        const root = {
            id: 'root', score: 0.8,
            children: [
                { id: 'a', score: 0.3, children: [] },
                { id: 'b', score: 0.9, children: [
                    { id: 'c', score: 0.7, children: [] },
                ] },
            ],
        };
        const path = planner._flattenBestPath(root);
        expect(path.map(n => n.id)).toEqual(['root', 'b', 'c']);
    });

    test('_linearToTree converts task list to tree', () => {
        const tasks = [
            { id: 't1', desc: 'first' },
            { id: 't2', desc: 'second' },
            { id: 't3', desc: 'third' },
        ];
        const tree = planner._linearToTree(tasks);
        expect(tree.id).toBe('t1');
        expect(tree.children.length).toBe(1);
        expect(tree.children[0].id).toBe('t2');
        expect(tree.children[0].children[0].id).toBe('t3');
    });

    test('graceful fallback to linear planning on error', async () => {
        mockBrain.sendMessage.mockRejectedValueOnce(new Error('brain offline'));
        mockBrain.sendMessage.mockResolvedValueOnce('{"tasks": [{"id": "t1", "desc": "fallback", "deps": [], "level": "L0"}]}');

        const result = await planner.planTree('try A or B compare alternative');
        // Should still return a result (linear fallback)
        expect(result.root).toBeDefined();
    });

    test('betaSample returns value between 0 and 1', () => {
        for (let i = 0; i < 100; i++) {
            const sample = TreePlanner.betaSample(2, 3);
            expect(sample).toBeGreaterThanOrEqual(0);
            expect(sample).toBeLessThanOrEqual(1);
        }
    });
});
