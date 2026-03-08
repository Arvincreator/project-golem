/**
 * CircuitBreaker — Production-grade circuit breaker for external service calls
 *
 * Prevents cascading failures by tracking errors and short-circuiting
 * requests when a service becomes unhealthy.
 *
 * States:
 *   CLOSED  → Normal operation, requests pass through
 *   OPEN    → Service is down, requests fail immediately
 *   HALF    → Testing recovery, allows limited requests
 *
 * @example
 *   const cb = new CircuitBreaker('gemini-api', { threshold: 3, timeout: 30000 });
 *   const result = await cb.execute(() => callGeminiAPI(prompt));
 */

class CircuitBreaker {
    /**
     * @param {string} name - Identifier for this circuit
     * @param {object} options
     * @param {number} options.threshold - Failures before opening (default: 5)
     * @param {number} options.timeout - Time in OPEN before trying HALF (default: 30000ms)
     * @param {number} options.halfOpenMax - Max requests in HALF state (default: 2)
     * @param {function} options.onStateChange - Callback on state transitions
     */
    constructor(name, options = {}) {
        this.name = name;
        this.threshold = options.threshold || 5;
        this.timeout = options.timeout || 30000;
        this.halfOpenMax = options.halfOpenMax || 2;
        this.onStateChange = options.onStateChange || null;

        this._state = 'CLOSED';
        this._failures = 0;
        this._successes = 0;
        this._lastFailureTime = 0;
        this._halfOpenAttempts = 0;
        this._totalRequests = 0;
        this._totalFailures = 0;
    }

    get state() { return this._state; }

    /**
     * Execute a function with circuit breaker protection
     * @param {function} fn - Async function to execute
     * @returns {*} Result from fn
     * @throws {Error} If circuit is OPEN or fn fails
     */
    async execute(fn) {
        this._totalRequests++;

        if (this._state === 'OPEN') {
            // Check if timeout has elapsed → move to HALF
            if (Date.now() - this._lastFailureTime >= this.timeout) {
                this._transition('HALF');
            } else {
                throw new CircuitBreakerError(
                    `Circuit "${this.name}" is OPEN. Service unavailable. Retry after ${Math.ceil((this.timeout - (Date.now() - this._lastFailureTime)) / 1000)}s`,
                    this.name
                );
            }
        }

        if (this._state === 'HALF') {
            this._halfOpenAttempts++;
            if (this._halfOpenAttempts > this.halfOpenMax) {
                this._transition('OPEN');
                this._lastFailureTime = Date.now();
                throw new CircuitBreakerError(
                    `Circuit "${this.name}" exceeded half-open limit`,
                    this.name
                );
            }
        }

        try {
            const result = await fn();
            this._onSuccess();
            return result;
        } catch (error) {
            this._onFailure();
            throw error;
        }
    }

    /**
     * Force the circuit to a specific state (for recovery/testing)
     */
    reset() {
        this._failures = 0;
        this._successes = 0;
        this._halfOpenAttempts = 0;
        this._transition('CLOSED');
    }

    /**
     * Get circuit statistics
     */
    stats() {
        return {
            name: this.name,
            state: this._state,
            failures: this._failures,
            threshold: this.threshold,
            totalRequests: this._totalRequests,
            totalFailures: this._totalFailures,
            lastFailure: this._lastFailureTime ? new Date(this._lastFailureTime).toISOString() : null,
        };
    }

    // --- Internal ---

    _onSuccess() {
        this._successes++;
        if (this._state === 'HALF') {
            // Recovery confirmed
            this._transition('CLOSED');
            this._failures = 0;
            this._halfOpenAttempts = 0;
        } else {
            // Decay failures on success (gradual recovery)
            if (this._failures > 0) this._failures--;
        }
    }

    _onFailure() {
        this._failures++;
        this._totalFailures++;
        this._lastFailureTime = Date.now();

        if (this._state === 'HALF') {
            this._transition('OPEN');
        } else if (this._failures >= this.threshold) {
            this._transition('OPEN');
        }
    }

    _transition(newState) {
        const oldState = this._state;
        if (oldState === newState) return;

        this._state = newState;
        console.log(`⚡ [CircuitBreaker:${this.name}] ${oldState} → ${newState}`);

        if (this.onStateChange) {
            try {
                this.onStateChange(this.name, oldState, newState);
            } catch (e) {
                // Don't let callback errors break the circuit breaker
            }
        }

        if (newState === 'HALF') {
            this._halfOpenAttempts = 0;
        }
    }
}

/**
 * Custom error for circuit breaker events
 */
class CircuitBreakerError extends Error {
    constructor(message, circuitName) {
        super(message);
        this.name = 'CircuitBreakerError';
        this.circuit = circuitName;
    }
}

/**
 * CircuitBreakerRegistry — Manage multiple circuit breakers
 */
class CircuitBreakerRegistry {
    constructor() {
        this._breakers = new Map();
    }

    /**
     * Get or create a circuit breaker by name
     */
    get(name, options = {}) {
        if (!this._breakers.has(name)) {
            this._breakers.set(name, new CircuitBreaker(name, options));
        }
        return this._breakers.get(name);
    }

    /**
     * Get stats for all circuits
     */
    stats() {
        const result = {};
        for (const [name, breaker] of this._breakers) {
            result[name] = breaker.stats();
        }
        return result;
    }

    /**
     * Reset all circuits
     */
    resetAll() {
        for (const breaker of this._breakers.values()) {
            breaker.reset();
        }
    }
}

// Singleton registry
const registry = new CircuitBreakerRegistry();

module.exports = { CircuitBreaker, CircuitBreakerError, CircuitBreakerRegistry, registry };
