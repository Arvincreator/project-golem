// ============================================================
// Circuit Breaker — Entry point (delegates to OpossumBridge)
// v10.0: Simplified to re-export OpossumBridge (Opossum 9.0)
// Maintains backward compatibility: require('./circuit_breaker') still works
// ============================================================

let _instance;
try {
    _instance = require('../bridges/OpossumBridge');
} catch (e) {
    // Fallback: minimal in-memory circuit breaker if Opossum unavailable
    console.warn('[CircuitBreaker] Opossum unavailable, using minimal fallback:', e.message);
    _instance = {
        canExecute: () => true,
        recordSuccess: () => {},
        recordFailure: () => {},
        reset: () => {},
        getStatus: () => ({}),
        execute: async (serviceId, fn) => fn(),
        shutdown: () => {},
    };
}

module.exports = _instance;
