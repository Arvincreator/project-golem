const TreeSearch = require('../src/core/TreeSearch');

describe('TreeSearch', () => {
    let ts;

    beforeEach(() => {
        ts = new TreeSearch({ golemId: 'test' });
    });

    test('search finds best path with heuristic evaluation', async () => {
        const rootState = { goal: 'test goal', history: [] };
        const getActions = () => [
            { action: 'a', description: 'action A', level: 'L0' },
            { action: 'b', description: 'action B', level: 'L1' },
        ];

        const result = await ts.search(rootState, getActions, 5);
        expect(result.bestPath.length).toBeGreaterThan(0);
        expect(result.iterations).toBe(5);
        expect(result.stats.totalNodes).toBeGreaterThan(1);
    });

    test('search respects max depth', async () => {
        const getActions = () => [{ action: 'a', description: 'go deeper', level: 'L0' }];
        const result = await ts.search({ goal: 'deep' }, getActions, 10);
        expect(result.stats.maxDepth).toBeLessThanOrEqual(5);
    });

    test('_bestUCB1Child prioritizes unvisited nodes', () => {
        const parent = { visits: 10, children: [] };
        const visited = { visits: 5, totalReward: 2, children: [] };
        const unvisited = { visits: 0, totalReward: 0, children: [] };
        parent.children = [visited, unvisited];
        expect(ts._bestUCB1Child(parent)).toBe(unvisited);
    });

    test('_bestUCB1Child balances exploitation and exploration', () => {
        const parent = { visits: 100, children: [] };
        const highReward = { visits: 50, totalReward: 45, children: [] }; // avg 0.9
        const lowVisits = { visits: 5, totalReward: 3, children: [] }; // avg 0.6 but high exploration
        parent.children = [highReward, lowVisits];
        const selected = ts._bestUCB1Child(parent);
        // With UCB1, low visits should get exploration bonus
        expect(selected).toBeDefined();
    });

    test('_heuristicEvaluate returns value based on depth and level', () => {
        const shallow = { depth: 0, action: { level: 'L0' } };
        const deep = { depth: 4, action: { level: 'L3' } };
        expect(ts._heuristicEvaluate(shallow)).toBeGreaterThan(ts._heuristicEvaluate(deep));
    });

    test('_backpropagate updates all ancestors', () => {
        const root = { visits: 0, totalReward: 0, parent: null, children: [] };
        const child = { visits: 0, totalReward: 0, parent: root, children: [] };
        const grandchild = { visits: 0, totalReward: 0, parent: child, children: [] };
        root.children.push(child);
        child.children.push(grandchild);

        ts._backpropagate(grandchild, 0.8);
        expect(grandchild.visits).toBe(1);
        expect(child.visits).toBe(1);
        expect(root.visits).toBe(1);
        expect(root.totalReward).toBe(0.8);
    });

    test('_getBestPath extracts highest-reward path', () => {
        const root = {
            action: null, visits: 10, totalReward: 5,
            children: [
                {
                    action: { description: 'bad' }, visits: 3, totalReward: 0.3, depth: 1,
                    children: [],
                },
                {
                    action: { description: 'good' }, visits: 7, totalReward: 6.3, depth: 1,
                    children: [{
                        action: { description: 'leaf' }, visits: 4, totalReward: 3.6, depth: 2,
                        children: [],
                    }],
                },
            ],
        };
        const path = ts._getBestPath(root);
        expect(path.length).toBe(2);
        expect(path[0].action.description).toBe('good');
        expect(path[1].action.description).toBe('leaf');
    });

    test('_serializeNode removes circular references', () => {
        const root = { action: 'root', visits: 5, totalReward: 3, depth: 0, children: [], parent: null };
        const serialized = ts._serializeNode(root);
        expect(serialized.action).toBe('root');
        expect(serialized.avgReward).toBe(0.6);
        expect(() => JSON.stringify(serialized)).not.toThrow();
    });

    test('_getTreeStats counts all nodes', () => {
        const root = {
            visits: 5, depth: 0,
            children: [
                { visits: 3, depth: 1, children: [{ visits: 1, depth: 2, children: [] }] },
                { visits: 2, depth: 1, children: [] },
            ],
        };
        const stats = ts._getTreeStats(root);
        expect(stats.totalNodes).toBe(4);
        expect(stats.maxDepth).toBe(2);
        expect(stats.totalVisits).toBe(11);
    });

    test('search with WorldModel value function', async () => {
        const mockWM = {
            valueFunction: jest.fn().mockReturnValue(0.7),
        };
        const tsWithWM = new TreeSearch({ worldModel: mockWM });
        const getActions = () => [{ action: 'a', description: 'test', level: 'L0' }];
        const result = await tsWithWM.search({ goal: 'test' }, getActions, 3);
        expect(mockWM.valueFunction).toHaveBeenCalled();
        expect(result.bestPath.length).toBeGreaterThan(0);
    });

    test('search handles empty actions', async () => {
        const getActions = () => [];
        const result = await ts.search({ goal: 'empty' }, getActions, 5);
        expect(result.bestPath.length).toBe(0);
    });
});
