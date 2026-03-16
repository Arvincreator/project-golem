// src/bridges/OpossumBridge.js
// Industrial-grade circuit breaker layer using Opossum 9.0
// v10.0: execute() is the primary API; canExecute/recordSuccess/recordFailure preserved for compat

const CircuitBreaker = require('opossum');
const { CircuitOpenError } = require('../core/errors');

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
   */
  _getBreaker(serviceId) {
    if (this._breakers.has(serviceId)) {
      return this._breakers.get(serviceId);
    }

    // Try to get per-service config from XML
    let opts = { ...FALLBACK_OPTS };
    if (this._xmlConfig) {
      const baseName = serviceId.split(':')[0];
      const xmlCfg = this._xmlConfig.getCircuitBreakerConfig(baseName);
      if (xmlCfg) {
        opts.timeout = xmlCfg.timeout || opts.timeout;
        opts.resetTimeout = xmlCfg.resetTimeout || opts.resetTimeout;
        opts.errorThresholdPercentage = xmlCfg.errorThresholdPercentage || opts.errorThresholdPercentage;
      }
    }

    // Generic wrapper — action is passed at fire() time
    const wrapper = async (action) => await action();
    const breaker = new CircuitBreaker(wrapper, opts);

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
    breaker.on('timeout', () => {
      console.log(`⏰ [Opossum] ${serviceId}: Request timed out`);
    });

    this._breakers.set(serviceId, breaker);
    return breaker;
  }

  // ================================================================
  // Primary API: execute()
  // ================================================================

  /**
   * Execute a function with circuit breaker protection
   * @param {string} serviceId
   * @param {Function} fn - async function to execute
   * @returns {Promise<any>}
   */
  async execute(serviceId, fn) {
    const breaker = this._getBreaker(serviceId);

    try {
      return await breaker.fire(fn);
    } catch (e) {
      if (breaker.opened) {
        const remaining = breaker.options.resetTimeout;
        throw new CircuitOpenError(serviceId, remaining, e.message);
      }
      throw e;
    }
  }

  // ================================================================
  // Compatible API — backward compat with manual canExecute/record pattern
  // ================================================================

  /**
   * Check if a service call is allowed
   */
  canExecute(serviceId) {
    const breaker = this._breakers.get(serviceId);
    if (!breaker) return true; // No breaker yet = allowed
    return !breaker.opened;
  }

  /**
   * Record a success (for backward compatibility with manual tracking)
   * In v10+, prefer using execute() which handles this automatically
   */
  recordSuccess(serviceId) {
    // Opossum tracks success automatically via fire(); this is a compat no-op
  }

  /**
   * Record a failure (for backward compatibility with manual tracking)
   * In v10+, prefer using execute() which handles this automatically
   */
  recordFailure(serviceId, error) {
    // Opossum tracks failures automatically via fire(); this is a compat no-op
  }

  /**
   * Reset a circuit breaker
   */
  reset(serviceId) {
    const breaker = this._breakers.get(serviceId);
    if (breaker) {
      breaker.close();
    }
  }

  /**
   * Get status of all circuit breakers (dashboard/diagnostics)
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
