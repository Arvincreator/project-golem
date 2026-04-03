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

function validateMutationLineage(events = []) {
    const violations = [];
    for (const event of events) {
        const action = String(event && event.action ? event.action : '').trim();
        const isMutation = action.includes('.created')
            || action.includes('.updated')
            || action.includes('.stopped')
            || action.includes('.resume');
        if (!isMutation) continue;

        const actor = String(event && event.actor ? event.actor : '').trim();
        const source = String(event && event.source ? event.source : '').trim();
        const correlationId = String(event && event.correlationId ? event.correlationId : '').trim();

        if (!actor || !source || !correlationId) {
            violations.push({
                code: 'MUTATION_LINEAGE_MISSING',
                message: `lineage fields missing for ${action || 'unknown_action'}`,
                eventId: event && event.eventId ? event.eventId : null,
            });
        }
    }
    return violations;
}

module.exports = {
    validatePhaseChain,
    validateMutationLineage,
    PHASE_ORDER,
};
