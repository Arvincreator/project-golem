const { normalizeHarnessEvent } = require('../src/harness/HarnessEventSchema');

describe('normalizeHarnessEvent', () => {
    test('normalizes required fields, preserves lineage keys, and derives canonical digests', () => {
        const event = normalizeHarnessEvent({
            eventId: 'evt-plain-1',
            golemId: '  golem-01  ',
            sessionId: '  session-99 ',
            action: '  task_create  ',
            phase: '  emit ',
            status: '  ok  ',
            actor: '  harness ',
            source: '  runtime ',
            version: ' 1.0.0 ',
            correlationId: '  corr-123 ',
            traceId: '  trace-abc ',
            workerId: '  worker-7 ',
            idempotencyKey: '  idem-1 ',
            usageSnapshot: { promptTokens: 4, completionTokens: 2 },
            errorCode: '  E42 ',
            detail: '  payload   with   extra spaces ',
            parentEventId: 'evt_parent_1',
            rootEventId: 'evt_root_1'
        });

        expect(event.golemId).toBe('golem-01');
        expect(event.sessionId).toBe('session-99');
        expect(event.action).toBe('task_create');
        expect(event.phase).toBe('emit');
        expect(event.status).toBe('ok');
        expect(event.actor).toBe('harness');
        expect(event.source).toBe('runtime');
        expect(event.version).toBe('1.0.0');
        expect(event.correlationId).toBe('corr-123');
        expect(event.traceId).toBe('trace-abc');
        expect(event.workerId).toBe('worker-7');
        expect(event.idempotencyKey).toBe('idem-1');
        expect(event.errorCode).toBe('E42');
        expect(event.detail).toBe('payload with extra spaces');
        expect(event.parentEventId).toBe('evt_parent_1');
        expect(event.rootEventId).toBe('evt_root_1');
        expect(event.eventId).toBe('harness_evt_evt-plain-1');
        expect(event.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
    });

    test('produces the same payloadDigest regardless of object key order', () => {
        const first = normalizeHarnessEvent({
            golemId: 'golem-01',
            sessionId: 'session-99',
            action: 'task_create',
            phase: 'emit',
            status: 'ok',
            actor: 'harness',
            source: 'runtime',
            version: '1.0.0',
            correlationId: 'corr-123',
            traceId: 'trace-abc',
            usageSnapshot: {
                alpha: 1,
                beta: 2,
                nested: { z: 3, a: 4 }
            }
        });

        const second = normalizeHarnessEvent({
            correlationId: 'corr-123',
            source: 'runtime',
            actor: 'harness',
            status: 'ok',
            phase: 'emit',
            action: 'task_create',
            sessionId: 'session-99',
            golemId: 'golem-01',
            traceId: 'trace-abc',
            version: '1.0.0',
            usageSnapshot: {
                nested: { a: 4, z: 3 },
                beta: 2,
                alpha: 1
            }
        });

        expect(first.payloadDigest).toBe(second.payloadDigest);
    });

    test('throws when traceId is missing', () => {
        expect(() => normalizeHarnessEvent({
            golemId: 'golem-01',
            sessionId: 'session-99',
            action: 'task_create',
            phase: 'emit',
            status: 'ok',
            actor: 'harness',
            source: 'runtime',
            version: '1.0.0',
            correlationId: 'corr-123'
        })).toThrow(/missing required fields/i);
    });

    test('throws when required fields are missing', () => {
        expect(() => normalizeHarnessEvent({
            sessionId: 'session-99',
            action: 'task_create',
            phase: 'emit',
            status: 'ok',
            actor: 'harness',
            source: 'runtime',
            version: '1.0.0',
            traceId: 'trace-abc',
            correlationId: 'corr-123'
        })).toThrow(/missing required fields/i);
    });
});
