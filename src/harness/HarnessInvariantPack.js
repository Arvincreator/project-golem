const PHASE_ORDER = ['research', 'synthesis', 'implementation', 'verification'];

function normalizePhase(value) {
    return String(value || '').trim().toLowerCase();
}

function validatePhaseChain(events = []) {
    let lastIndex = 0;
    const violations = [];

    for (const event of events) {
        const phase = normalizePhase(event && event.phase);
        const index = PHASE_ORDER.indexOf(phase);
        if (index === -1) {
            continue;
        }

        if (index > lastIndex + 1) {
            violations.push({
                code: 'PHASE_CHAIN_VIOLATION',
                message: `phase jumped from ${PHASE_ORDER[lastIndex]} to ${phase}`,
                eventId: event && event.eventId ? event.eventId : null,
            });
        }

        if (index > lastIndex) {
            lastIndex = index;
        }
    }

    return violations;
}

module.exports = {
    validatePhaseChain,
    PHASE_ORDER,
};
