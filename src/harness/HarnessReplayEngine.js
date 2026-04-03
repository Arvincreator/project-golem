const { validatePhaseChain } = require('./HarnessInvariantPack');

function normalizeMode(value) {
    const mode = String(value || 'strict').trim().toLowerCase();
    if (mode === 'lenient') {
        return 'lenient';
    }
    return 'strict';
}

function replayTrace(input = {}) {
    const events = Array.isArray(input.events) ? input.events : [];
    const mode = normalizeMode(input.mode);
    const violations = [
        ...validatePhaseChain(events),
    ];

    if (mode === 'strict') {
        for (const event of events) {
            const status = String(event && event.status ? event.status : '').trim().toLowerCase();
            if (status === 'unknown') {
                violations.push({
                    code: 'UNKNOWN_STATUS',
                    message: 'strict mode does not allow unknown status',
                    eventId: event && event.eventId ? event.eventId : null,
                });
            }
        }
    }

    return {
        passed: violations.length === 0,
        mode,
        totalEvents: events.length,
        violations,
    };
}

module.exports = {
    replayTrace,
};
