const crypto = require('crypto');

function compactText(value) {
    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value !== 'string') {
        return value;
    }

    return value.trim().replace(/\s+/g, ' ');
}

function sha256(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return crypto.createHash('sha256').update(text).digest('hex');
}

function normalizeHarnessEvent(event = {}) {
    const normalized = { ...event };

    normalized.eventId = compactText(normalized.eventId);
    normalized.ts = compactText(normalized.ts) || new Date().toISOString();
    normalized.traceId = compactText(normalized.traceId);
    normalized.golemId = compactText(normalized.golemId);
    normalized.sessionId = compactText(normalized.sessionId);
    normalized.workerId = compactText(normalized.workerId);
    normalized.action = compactText(normalized.action);
    normalized.phase = compactText(normalized.phase);
    normalized.status = compactText(normalized.status);
    normalized.actor = compactText(normalized.actor);
    normalized.source = compactText(normalized.source);
    normalized.idempotencyKey = compactText(normalized.idempotencyKey);
    normalized.version = compactText(normalized.version);
    normalized.usageSnapshot = normalized.usageSnapshot === undefined ? null : normalized.usageSnapshot;
    normalized.errorCode = compactText(normalized.errorCode);
    normalized.correlationId = compactText(normalized.correlationId);
    normalized.detail = typeof normalized.detail === 'string'
        ? compactText(normalized.detail)
        : normalized.detail;

    const requiredFields = [
        'golemId',
        'sessionId',
        'action',
        'phase',
        'status',
        'actor',
        'source',
        'version',
        'correlationId'
    ];

    const missingRequiredFields = requiredFields.filter((field) => {
        const value = normalized[field];
        return value === undefined || value === null || value === '';
    });

    if (missingRequiredFields.length > 0) {
        throw new Error(`missing required fields: ${missingRequiredFields.join(', ')}`);
    }

    const digestBase = { ...normalized };
    delete digestBase.eventId;
    delete digestBase.payloadDigest;

    if (!normalized.eventId) {
        normalized.eventId = `harness_evt_${sha256({ ...digestBase, kind: 'eventId' }).slice(0, 16)}`;
    } else if (!normalized.eventId.startsWith('harness_evt_')) {
        normalized.eventId = `harness_evt_${normalized.eventId}`;
    }

    normalized.payloadDigest = sha256(digestBase);

    return normalized;
}

module.exports = {
    compactText,
    sha256,
    normalizeHarnessEvent
};
