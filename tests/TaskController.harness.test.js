const TaskController = require('../src/core/TaskController');

describe('TaskController harness wiring', () => {
    test('forwards agent events into harness recorder', () => {
        const calls = [];
        const controller = new TaskController({
            golemId: 'golem_A',
            harnessRecorder: {
                recordAgentEvent: (event) => calls.push(event),
            },
        });

        try {
            controller.agentSessionCreate({ objective: 'test harness forward' }, { actor: 'tester' });
            expect(calls.length).toBeGreaterThan(0);
            expect(calls.some((event) => event.type === 'agent.session.created')).toBe(true);
        } finally {
            controller.destroy();
        }
    });
});
