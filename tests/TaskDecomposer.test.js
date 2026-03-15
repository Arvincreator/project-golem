const TaskDecomposer = require('../src/core/TaskDecomposer');

describe('TaskDecomposer', () => {
    test('topologicalSort handles simple DAG', () => {
        const td = new TaskDecomposer({});
        const tasks = [
            { id: 't3', desc: 'deploy', deps: ['t1', 't2'], level: 'L2' },
            { id: 't1', desc: 'build', deps: [], level: 'L0' },
            { id: 't2', desc: 'test', deps: ['t1'], level: 'L0' },
        ];
        const sorted = td.topologicalSort(tasks);
        const ids = sorted.map(t => t.id);
        expect(ids.indexOf('t1')).toBeLessThan(ids.indexOf('t2'));
        expect(ids.indexOf('t2')).toBeLessThan(ids.indexOf('t3'));
    });

    test('topologicalSort handles single task', () => {
        const td = new TaskDecomposer({});
        const sorted = td.topologicalSort([{ id: 't1', desc: 'solo', deps: [], level: 'L0' }]);
        expect(sorted).toHaveLength(1);
        expect(sorted[0].id).toBe('t1');
    });

    test('topologicalSort handles no dependencies', () => {
        const td = new TaskDecomposer({});
        const tasks = [
            { id: 'a', desc: 'a', deps: [], level: 'L0' },
            { id: 'b', desc: 'b', deps: [], level: 'L0' },
        ];
        const sorted = td.topologicalSort(tasks);
        expect(sorted).toHaveLength(2);
    });
});
