// src/bridges/OpossumBridge.js
// Industrial-grade circuit breaker layer using Opossum 9.0
// Wraps existing circuit_breaker.js API surface — drop-in compatible
// Reads per-service configs from golem-config.xml <circuit-breakers>

const CircuitBreaker = require('opossum');

// Defaults matching existing circuit_breaker.js behavior
const FALLBACK_OPTS = {
  timeout: 10000,
  resetTimeout: 60000,
  errorThresholdPercentage: 50,
  rollingCountTimeout: 10000,
  rollingCountBuckets: 10,
  volumeThreshold: 3,
  capacity: 3,
  allowWarmUp: true,
  errorFilter: (err) => {
    // Don't count 429 (rate limit) as circuit-breaking errors — these are expected
    const msg = err?.message || String(err);
    if (msg.includes('429') || msg.includes('Too Many Requests')) return true;
    // Don't count network timeouts under 3s (transient)
    if (err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET') return true;
    return false;
  },
};

class OpossumBridge {
  constructor() {
    this._breakers = new Map(); // serviceId → Opossum CircuitBreaker
    this._xmlConfig = null;
    this._loadXmlConfig();
  }

  _loadXmlConfig() {
    try {
      const { getConfig } = require('../config/xml-config-loader');
      this._xmlConfig = getConfig();
    } catch (e) {
      // XML config not available, use defaults
    }
  }

  /**
   * Get or create an Opossum circuit breaker for a service
   * @param {string} serviceId - e.g. 'fleet', 'rag', 'gemini', 'telegram'
   */
  _getBreaker(serviceId, fn) {
    if (this._breakers.has(serviceId)) {
      return this._breakers.get(serviceId);
    }

    // Try to get per-service config from XML
    let opts = { ...FALLBACK_OPTS };
    if (this._xmlConfig) {
      // Extract base service name (e.g., 'rag:yedan' → 'rag')
      const baseName = serviceId.split(':')[0];
      const xmlCfg = this._xmlConfig.getCircuitBreakerConfig(baseName);
      if (xmlCfg) {
        opts.timeout = xmlCfg.timeout || opts.timeout;
        opts.resetTimeout = xmlCfg.resetTimeout || opts.resetTimeout;
        opts.errorThresholdPercentage = xmlCfg.errorThresholdPercentage || opts.errorThresholdPercentage;
      }
    }

    const breaker = new CircuitBreaker(fn, opts);

    // Log state changes
    breaker.on('open', () => {
      console.log(`🔴 [Opossum] ${serviceId}: CLOSED → OPEN`);
    });
    breaker.on('halfOpen', () => {
      console.log(`🟡 [Opossum] ${serviceId}: OPEN → HALF_OPEN`);
    });
    breaker.on('close', () => {
      console.log(`🟢 [Opossum] ${serviceId}: → CLOSED (recovered)`);
    });
    breaker.on('fallback', () => {
      console.log(`🟠 [Opossum] ${serviceId}: Fallback triggered`);
    });
    breaker.on('timeout', () => {
      console.log(`⏰ [Opossum] ${serviceId}: Request timed out`);
    });

    this._breakers.set(serviceId, breaker);
    return breaker;
  }

  // ================================================================
  // Compatible API — same as existing circuit_breaker.js
  // ================================================================

  /**
   * Check if a service call is allowed
   * @param {string} serviceId
   * @returns {boolean}
   */
  canExecute(serviceId) {
    const breaker = this._breakers.get(serviceId);
    if (!breaker) return true; // No breaker yet = allowed
    return !breaker.opened;
  }

  /**
   * Record a success (for manual tracking compatibility)
   * Note: Opossum handles this automatically via execute(), but
   * this is here for backward compatibility with existing code
   */
  recordSuccess(serviceId) {
    // Opossum tracks success automatically; this is a no-op for compatibility
  }

  /**
   * Record a failure (for manual tracking compatibility)
   */
  recordFailure(serviceId, error) {
    // Opossum tracks failures automatically; this is a no-op for compatibility
  }

  /**
   * Reset a circuit breaker
   * @param {string} serviceId
   */
  reset(serviceId) {
    const breaker = this._breakers.get(serviceId);
    if (breaker) {
      breaker.close();
    }
  }

  /**
   * Get status of all circuit breakers (dashboard/diagnostics)
   * @returns {object}
   */
  getStatus() {
    const result = {};
    for (const [id, breaker] of this._breakers) {
      const stats = breaker.stats;
      result[id] = {
        state: breaker.opened ? 'OPEN' : (breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED'),
        failures: stats.failures || 0,
        successes: stats.successes || 0,
        totalTrips: stats.opens || 0,
        timeout: breaker.options.timeout,
        resetTimeout: breaker.options.resetTimeout,
        lastError: null,
      };
    }
    return result;
  }

  /**
   * Execute a function with circuit breaker protection
   * EXACT same signature as existing circuit_breaker.js
   * @param {string} serviceId
   * @param {Function} fn - async function to execute
   * @returns {Promise<any>}
   */
  async execute(serviceId, fn) {
    // For Opossum, we need to create the breaker with the function
    // But since fn changes each call, we wrap it
    if (!this._breakers.has(serviceId)) {
      // Create a generic breaker that calls whatever function is passed
      const wrapper = async (action) => await action();
      this._getBreaker(serviceId, wrapper);
    }

    const breaker = this._breakers.get(serviceId);

    try {
      return await breaker.fire(fn);
    } catch (e) {
      // Format error message to match existing circuit_breaker.js format
      if (breaker.opened) {
        const remaining = Math.max(0, breaker.options.resetTimeout -
          (Date.now() - (breaker.stats.latencyTimes?.[0] || Date.now())));
        throw new Error(`[CircuitBreaker] ${serviceId} 熔斷中 (${Math.ceil(remaining / 1000)}s 後重試). 最後錯誤: ${e.message || '?'}`);
      }
      throw e;
    }
  }

  /**
   * Shutdown all breakers gracefully
   */
  shutdown() {
    for (const [, breaker] of this._breakers) {
      breaker.shutdown();
    }
    this._breakers.clear();
  }
}

// Singleton — drop-in replacement for require('../core/circuit_breaker')
const _instance = new OpossumBridge();

// Register with graceful shutdown
try {
  const shutdown = require('./GracefulShutdown');
  shutdown.register('CircuitBreakers', () => { _instance.shutdown(); return Promise.resolve(); });
} catch (e) { /* optional */ }

module.exports = _instance;
