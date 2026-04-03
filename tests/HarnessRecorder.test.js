const fs = require('fs');
const os = require('os');
const path = require('path');
const { HarnessRecorder } = require('../src/harness/HarnessRecorder');

describe('HarnessRecorder', () => {
    test('records agent event into trace file with normalized payload', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-recorder-'));
        const recorder = new HarnessRecorder({ baseDir: dir, golemId: 'golem_A' });

        const recorded = recorder.recordAgentEvent({
            type: 'agent.worker.created',
            sessionId: 'agent_session_000001',
            workerId: 'agent_worker_000001',
            actor: 'system',
            source: 'agent_action',
            worker: {
                status: 'pending',
                version: 1,
                role: 'research',
                usage: { totalTokens: 12 }
            }
        });

        expect(recorded).not.toBeNull();
        expect(recorded.action).toBe('agent.worker.created');
        expect(recorded.workerId).toBe('agent_worker_000001');
        expect(recorded.phase).toBe('research');
        expect(recorded.status).toBe('pending');
        expect(recorded.traceId).toMatch(/^trace_/);

        const traces = recorder.readSessionTrace('agent_session_000001');
        expect(traces.length).toBe(1);
        expect(traces[0].action).toBe('agent.worker.created');
        expect(traces[0].workerId).toBe('agent_worker_000001');
        expect(traces[0].eventId).toMatch(/^harness_evt_/);
    });

    test('returns null when session id is missing', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-recorder-'));
        const recorder = new HarnessRecorder({ baseDir: dir, golemId: 'golem_A' });

        expect(recorder.recordAgentEvent({
            type: 'agent.worker.created',
            actor: 'system'
        })).toBeNull();
    });
});
