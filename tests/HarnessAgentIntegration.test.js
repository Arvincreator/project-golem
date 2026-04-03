const fs = require('fs');
const os = require('os');
const path = require('path');
const TaskController = require('../src/core/TaskController');
const { HarnessRecorder } = require('../src/harness/HarnessRecorder');

describe('Harness agent integration', () => {
    test('records trace across session create -> worker spawn -> session update', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-agent-integration-'));
        const recorder = new HarnessRecorder({ golemId: 'golem_A', baseDir: dir });
        const controller = new TaskController({ golemId: 'golem_A', harnessRecorder: recorder });

        try {
            const created = controller.agentSessionCreate(
                { objective: 'integration test' },
                { actor: 'tester' }
            );

            controller.agentWorkerSpawn(
                { sessionId: created.session.id, role: 'research' },
                { actor: 'tester' }
            );

            controller.agentSessionUpdate(
                created.session.id,
                { status: 'running' },
                { actor: 'tester' }
            );

            const trace = recorder.readSessionTrace(created.session.id);
            expect(trace.length).toBeGreaterThanOrEqual(3);
            expect(trace.some((event) => event.action === 'agent.session.created')).toBe(true);
            expect(trace.some((event) => event.action === 'agent.worker.created')).toBe(true);
        } finally {
            controller.destroy();
        }
    });
});
