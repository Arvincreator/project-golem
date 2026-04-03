const { normalizeHarnessEvent } = require('./HarnessEventSchema');
const { HarnessTraceStore } = require('./HarnessTraceStore');

function normalizeText(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim();
}

function phaseFromEvent(event = {}) {
    if (normalizeText(event.phase)) {
        return normalizeText(event.phase);
    }

    const sessionPhase = event.session
        && event.session.metadata
        && event.session.metadata.workflow
        && event.session.metadata.workflow.phase;
    if (normalizeText(sessionPhase)) {
        return normalizeText(sessionPhase);
    }

    if (normalizeText(event.worker && event.worker.role)) {
        return normalizeText(event.worker.role);
    }

    return 'research';
}

function statusFromEvent(event = {}) {
    if (normalizeText(event.status)) {
        return normalizeText(event.status);
    }

    if (normalizeText(event.worker && event.worker.status)) {
        return normalizeText(event.worker.status);
    }

    if (normalizeText(event.session && event.session.status)) {
        return normalizeText(event.session.status);
    }

    return 'unknown';
}

function versionFromEvent(event = {}) {
    const workerVersion = event.worker && event.worker.version;
    const sessionVersion = event.session && event.session.version;
    return workerVersion !== undefined && workerVersion !== null
        ? workerVersion
        : (sessionVersion !== undefined && sessionVersion !== null ? sessionVersion : 0);
}

class HarnessRecorder {
    constructor(options = {}) {
        this.golemId = normalizeText(options.golemId) || 'golem_A';
        this.store = new HarnessTraceStore({
            baseDir: options.baseDir,
            golemId: this.golemId
        });
    }

    recordAgentEvent(event = {}) {
        const source = (event && typeof event === 'object') ? event : {};
        const sessionId = normalizeText(source.sessionId)
            || normalizeText(source.session && source.session.id);

        if (!sessionId) {
            return null;
        }

        const action = normalizeText(source.type) || 'agent.event';
        const traceId = this.store.ensureTraceId(sessionId);
        const normalized = normalizeHarnessEvent({
            ts: source.ts || new Date().toISOString(),
            traceId,
            golemId: this.golemId,
            sessionId,
            workerId: source.workerId || (source.worker && source.worker.id) || null,
            action,
            phase: phaseFromEvent(source),
            status: statusFromEvent(source),
            actor: normalizeText(source.actor) || 'system',
            source: normalizeText(source.source) || 'agent_action',
            idempotencyKey: source.idempotencyKey || null,
            version: versionFromEvent(source),
            usageSnapshot: (source.worker && source.worker.usage)
                || (source.session && source.session.usage)
                || null,
            errorCode: source.errorCode || source.code || null,
            correlationId: normalizeText(source.correlationId) || `${sessionId}:${action}`,
            detail: source
        });

        this.store.appendEvent(traceId, normalized);
        return normalized;
    }

    readSessionTrace(sessionId) {
        const traceId = this.store.ensureTraceId(sessionId);
        return this.store.readTrace(traceId);
    }
}

module.exports = {
    HarnessRecorder,
    phaseFromEvent,
    statusFromEvent
};
