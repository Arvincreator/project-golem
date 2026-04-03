const fs = require('fs');
const os = require('os');
const path = require('path');
const { HarnessTraceStore } = require('../src/harness/HarnessTraceStore');

describe('HarnessTraceStore', () => {
    test('appends jsonl events and reloads session->trace mapping', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-store-'));
        const storeA = new HarnessTraceStore({ baseDir: dir, golemId: 'golem_A' });
        const traceId = storeA.ensureTraceId('agent_session_000001');

        storeA.appendEvent(traceId, {
            eventId: 'evt_1',
            sessionId: 'agent_session_000001',
            action: 'agent.session.created'
        });

        const storeB = new HarnessTraceStore({ baseDir: dir, golemId: 'golem_A' });
        expect(storeB.ensureTraceId('agent_session_000001')).toBe(traceId);

        const loaded = storeB.readTrace(traceId);
        expect(loaded).toHaveLength(1);
        expect(loaded[0]).toMatchObject({
            eventId: 'evt_1',
            sessionId: 'agent_session_000001',
            action: 'agent.session.created'
        });
    });

    test('throws when ensureTraceId receives empty sessionId', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-store-'));
        const store = new HarnessTraceStore({ baseDir: dir, golemId: 'golem_A' });
        expect(() => store.ensureTraceId('')).toThrow(/sessionId is required/i);
        expect(() => store.ensureTraceId()).toThrow(/sessionId is required/i);
    });

    test('falls back to empty mapping when trace-map.json is malformed', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-store-'));
        const root = path.join(dir, 'golem_A');
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(path.join(root, 'trace-map.json'), '{bad-json', 'utf8');

        const store = new HarnessTraceStore({ baseDir: dir, golemId: 'golem_A' });
        const traceId = store.ensureTraceId('agent_session_000002');

        expect(traceId).toMatch(/^trace_/);
        expect(store.traceMap.agent_session_000002).toBe(traceId);
    });
});
