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

function normalizeNullableText(value) {
    const compacted = compactText(value);
    if (compacted === undefined || compacted === null || compacted === '') {
        return null;
    }
    return compacted;
}

function normalizeRequiredText(value) {
    const compacted = compactText(value);
    return typeof compacted === 'string' && compacted !== '' ? compacted : null;
}

function normalizeVersion(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    const compacted = compactText(value);
    if (typeof compacted !== 'string' || compacted === '') {
        return null;
    }

    const parsed = Number(compacted);
    return Number.isFinite(parsed) ? parsed : null;
}

function sha256(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return crypto.createHash('sha256').update(text).digest('hex');
}

function canonicalize(value) {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }

    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((acc, key) => {
            acc[key] = canonicalize(value[key]);
            return acc;
        }, {});
    }

    return value;
}

function stableStringify(value) {
    return JSON.stringify(canonicalize(value));
}

function normalizeHarnessEvent(event = {}) {
    const normalized = { ...event };

    normalized.eventId = compactText(normalized.eventId);
    normalized.ts = compactText(normalized.ts) || new Date().toISOString();
    normalized.traceId = normalizeRequiredText(normalized.traceId);
    normalized.golemId = normalizeRequiredText(normalized.golemId);
    normalized.sessionId = normalizeRequiredText(normalized.sessionId);
    normalized.workerId = normalizeNullableText(normalized.workerId);
    normalized.action = normalizeRequiredText(normalized.action);
    normalized.phase = normalizeRequiredText(normalized.phase);
    normalized.status = normalizeRequiredText(normalized.status);
    normalized.actor = normalizeRequiredText(normalized.actor);
    normalized.source = normalizeRequiredText(normalized.source);
    normalized.idempotencyKey = normalizeNullableText(normalized.idempotencyKey);
    normalized.version = normalizeVersion(normalized.version);
    normalized.usageSnapshot = normalized.usageSnapshot === undefined ? null : normalized.usageSnapshot;
    normalized.errorCode = normalizeNullableText(normalized.errorCode);
    normalized.correlationId = normalizeRequiredText(normalized.correlationId);
    normalized.detail = typeof normalized.detail === 'string'
        ? compactText(normalized.detail)
        : normalized.detail;

    const requiredFields = [
        'traceId',
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
        normalized.eventId = `harness_evt_${sha256(stableStringify({ ...digestBase, kind: 'eventId' })).slice(0, 16)}`;
    } else if (!normalized.eventId.startsWith('harness_evt_')) {
        normalized.eventId = `harness_evt_${normalized.eventId}`;
    }

    normalized.payloadDigest = sha256(stableStringify(digestBase));

    return normalized;
}

module.exports = {
    compactText,
    sha256,
    canonicalize,
    stableStringify,
    normalizeHarnessEvent
};
