// src/bridges/TelegramHealthWatchdog.js
// Proactive Telegram polling health monitor
// Reads thresholds from golem-config.xml <telegram><health>
// Tracks: polling success rate, response latency, uptime

class TelegramHealthWatchdog {
  constructor() {
    this._stats = {
      pollAttempts: 0,
      pollSuccesses: 0,
      pollFailures: 0,
      lastPollTime: 0,
      startTime: Date.now(),
      latencies: [],           // Rolling window of last 100 latencies
      consecutiveErrors: 0,
      maxConsecutiveErrors: 0,
      lastError: null,
      lastErrorTime: 0,
      restarts: 0,
    };
    this._config = this._loadConfig();
    this._checkInterval = null;
    this._alertCallback = null;
  }

  _loadConfig() {
    try {
      const { getConfig } = require('../config/xml-config-loader');
      const cfg = getConfig();
      const tg = cfg.getTelegramConfig();
      return {
        checkIntervalSec: 300,
        pollingSuccessRateMin: 95,
        responseLatencyMaxMs: 5000,
        uptimeMinSec: 300,
        maxConsecutiveErrors: tg.maxConsecutiveErrors || 10,
        backoffMaxSec: tg.backoffMax || 60,
      };
    } catch {
      return {
        checkIntervalSec: 300,
        pollingSuccessRateMin: 95,
        responseLatencyMaxMs: 5000,
        uptimeMinSec: 300,
        maxConsecutiveErrors: 10,
        backoffMaxSec: 60,
      };
    }
  }

  /**
   * Start periodic health checking
   * @param {Function} alertCallback - Called with (level, message) when issues detected
   */
  start(alertCallback) {
    this._alertCallback = alertCallback;
    if (this._checkInterval) return;
    this._checkInterval = setInterval(() => this._runCheck(), this._config.checkIntervalSec * 1000);
    console.log(`[TG Health] Watchdog started (check every ${this._config.checkIntervalSec}s)`);
  }

  stop() {
    if (this._checkInterval) {
      clearInterval(this._checkInterval);
      this._checkInterval = null;
    }
  }

  // ── Tracking Methods (called by GrammyBridge or polling handler) ──

  recordPollSuccess(latencyMs) {
    this._stats.pollAttempts++;
    this._stats.pollSuccesses++;
    this._stats.consecutiveErrors = 0;
    this._stats.lastPollTime = Date.now();

    // Rolling latency window (keep last 100)
    this._stats.latencies.push(latencyMs);
    if (this._stats.latencies.length > 100) {
      this._stats.latencies.shift();
    }
  }

  recordPollFailure(error) {
    this._stats.pollAttempts++;
    this._stats.pollFailures++;
    this._stats.consecutiveErrors++;
    this._stats.lastError = error;
    this._stats.lastErrorTime = Date.now();

    if (this._stats.consecutiveErrors > this._stats.maxConsecutiveErrors) {
      this._stats.maxConsecutiveErrors = this._stats.consecutiveErrors;
    }

    // Critical: consecutive errors exceed threshold
    if (this._stats.consecutiveErrors >= this._config.maxConsecutiveErrors) {
      this._alert('critical', `連續 ${this._stats.consecutiveErrors} 次 polling 失敗: ${error}`);
    }
  }

  recordRestart() {
    this._stats.restarts++;
  }

  // ── Health Check ──

  _runCheck() {
    const { pollAttempts, pollSuccesses, consecutiveErrors, latencies, startTime } = this._stats;
    const uptimeSec = (Date.now() - startTime) / 1000;

    // Skip check if uptime too short
    if (uptimeSec < this._config.uptimeMinSec) return;

    // 1. Success rate check
    if (pollAttempts > 10) {
      const successRate = (pollSuccesses / pollAttempts) * 100;
      if (successRate < this._config.pollingSuccessRateMin) {
        this._alert('warning', `Polling 成功率 ${successRate.toFixed(1)}% < ${this._config.pollingSuccessRateMin}%`);
      }
    }

    // 2. Latency check
    if (latencies.length > 5) {
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      if (avgLatency > this._config.responseLatencyMaxMs) {
        this._alert('warning', `平均延遲 ${avgLatency.toFixed(0)}ms > ${this._config.responseLatencyMaxMs}ms`);
      }
    }

    // 3. Stale polling check (no poll in 2 minutes)
    if (this._stats.lastPollTime > 0) {
      const silenceSec = (Date.now() - this._stats.lastPollTime) / 1000;
      if (silenceSec > 120) {
        this._alert('critical', `Polling 靜默 ${silenceSec.toFixed(0)}s — 可能已斷線`);
      }
    }
  }

  _alert(level, message) {
    console.log(`🚨 [TG Health] [${level.toUpperCase()}] ${message}`);
    if (this._alertCallback) {
      try { this._alertCallback(level, message); } catch (e) { /* non-critical */ }
    }
  }

  /**
   * Get current health snapshot (for /health endpoint)
   */
  getHealth() {
    const { pollAttempts, pollSuccesses, pollFailures, consecutiveErrors,
            latencies, startTime, restarts, lastError, lastErrorTime } = this._stats;
    const uptimeSec = (Date.now() - startTime) / 1000;
    const successRate = pollAttempts > 0 ? (pollSuccesses / pollAttempts) * 100 : 100;
    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

    let status = 'healthy';
    if (consecutiveErrors >= this._config.maxConsecutiveErrors) status = 'critical';
    else if (successRate < this._config.pollingSuccessRateMin) status = 'degraded';
    else if (avgLatency > this._config.responseLatencyMaxMs) status = 'degraded';

    return {
      status,
      uptime: Math.floor(uptimeSec),
      polling: {
        attempts: pollAttempts,
        successes: pollSuccesses,
        failures: pollFailures,
        successRate: Number(successRate.toFixed(2)),
        consecutiveErrors,
        avgLatencyMs: Math.round(avgLatency),
      },
      restarts,
      lastError: lastError ? { message: lastError, time: lastErrorTime } : null,
    };
  }
}

// Singleton
module.exports = new TelegramHealthWatchdog();
