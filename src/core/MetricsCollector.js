// ============================================================
// MetricsCollector — Evidently AI-style observability & benchmarks
// Tracks response quality, latency, success rates, model routing
// ============================================================
const fs = require('fs');
const path = require('path');

const MAX_EVENTS = 10000;
const FLUSH_INTERVAL_MS = 60000;
const METRICS_FILE = 'golem_metrics.json';

class MetricsCollector {
    constructor(options = {}) {
        this.golemId = options.golemId || 'default';
        this._events = [];
        this._counters = {};
        this._histograms = {};
        this._gauges = {};
        this._file = path.join(process.cwd(), METRICS_FILE);
        this._flushTimer = null;
        this._startTime = Date.now();

        // Auto-flush periodically
        if (!options.noAutoFlush) {
            this._flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
        }
    }

    /**
     * Record a metric event
     * @param {string} name - Metric name (e.g. 'response_latency', 'plan_step_success')
     * @param {Object} data - Event data
     */
    record(name, data = {}) {
        const event = {
            name,
            data,
            timestamp: Date.now(),
        };
        this._events.push(event);
        if (this._events.length > MAX_EVENTS) this._events.shift();

        // Auto-increment counters
        this._counters[name] = (this._counters[name] || 0) + 1;

        // Track numeric values as histograms
        if (typeof data.value === 'number') {
            if (!this._histograms[name]) this._histograms[name] = [];
            this._histograms[name].push(data.value);
            if (this._histograms[name].length > 1000) this._histograms[name].shift();
        }
        if (typeof data.durationMs === 'number') {
            const latencyKey = `${name}_latency`;
            if (!this._histograms[latencyKey]) this._histograms[latencyKey] = [];
            this._histograms[latencyKey].push(data.durationMs);
            if (this._histograms[latencyKey].length > 1000) this._histograms[latencyKey].shift();
        }
    }

    /**
     * Set a gauge value (point-in-time measurement)
     */
    gauge(name, value) {
        this._gauges[name] = { value, timestamp: Date.now() };
    }

    /**
     * Increment a counter
     */
    increment(name, amount = 1) {
        this._counters[name] = (this._counters[name] || 0) + amount;
    }

    /**
     * Get histogram statistics for a metric
     */
    getHistogramStats(name) {
        const values = this._histograms[name];
        if (!values || values.length === 0) return null;

        const sorted = [...values].sort((a, b) => a - b);
        const sum = sorted.reduce((s, v) => s + v, 0);
        return {
            count: sorted.length,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            mean: Math.round(sum / sorted.length * 100) / 100,
            p50: sorted[Math.floor(sorted.length * 0.5)],
            p95: sorted[Math.floor(sorted.length * 0.95)],
            p99: sorted[Math.floor(sorted.length * 0.99)],
        };
    }

    /**
     * Get success rate for a metric pair (e.g. plan_step_success / plan_step_failure)
     */
    getSuccessRate(successMetric, failureMetric) {
        const successes = this._counters[successMetric] || 0;
        const failures = this._counters[failureMetric] || 0;
        const total = successes + failures;
        if (total === 0) return null;
        return { rate: Math.round(successes / total * 1000) / 1000, successes, failures, total };
    }

    /**
     * Generate Evidently-style quality report
     */
    generateReport() {
        const uptime = Date.now() - this._startTime;
        const report = {
            golemId: this.golemId,
            uptimeMs: uptime,
            uptimeHuman: `${Math.floor(uptime / 3600000)}h ${Math.floor((uptime % 3600000) / 60000)}m`,
            counters: { ...this._counters },
            gauges: { ...this._gauges },
            histograms: {},
            successRates: {},
            eventCount: this._events.length,
            generatedAt: new Date().toISOString(),
        };

        // Compute histogram stats
        for (const [name] of Object.entries(this._histograms)) {
            report.histograms[name] = this.getHistogramStats(name);
        }

        // Auto-detect success/failure pairs
        const metricNames = Object.keys(this._counters);
        for (const name of metricNames) {
            if (name.endsWith('_success')) {
                const base = name.replace('_success', '');
                const failName = `${base}_failure`;
                if (this._counters[failName] !== undefined) {
                    report.successRates[base] = this.getSuccessRate(name, failName);
                }
            }
        }

        return report;
    }

    /**
     * Get recent events (for debugging / dashboard)
     */
    getRecentEvents(limit = 20) {
        return this._events.slice(-limit);
    }

    /**
     * Flush metrics to disk
     */
    flush() {
        try {
            const report = this.generateReport();
            fs.writeFileSync(this._file, JSON.stringify(report, null, 2));
        } catch (e) {
            console.warn('[MetricsCollector] Flush failed:', e.message);
        }
    }

    /**
     * Load previously persisted metrics
     */
    loadFromDisk() {
        try {
            if (fs.existsSync(this._file)) {
                const data = JSON.parse(fs.readFileSync(this._file, 'utf-8'));
                if (data.counters) {
                    for (const [k, v] of Object.entries(data.counters)) {
                        this._counters[k] = (this._counters[k] || 0) + v;
                    }
                }
            }
        } catch (e) { /* fresh start */ }
    }

    /**
     * Benchmark a function and record its metrics
     */
    async benchmark(name, fn) {
        const start = Date.now();
        try {
            const result = await fn();
            const durationMs = Date.now() - start;
            this.record(`${name}_success`, { durationMs });
            return result;
        } catch (e) {
            const durationMs = Date.now() - start;
            this.record(`${name}_failure`, { durationMs, error: e.message });
            throw e;
        }
    }

    /**
     * Stop auto-flush timer
     */
    stop() {
        if (this._flushTimer) {
            clearInterval(this._flushTimer);
            this._flushTimer = null;
        }
        this.flush();
    }

    /**
     * Reset all metrics
     */
    reset() {
        this._events = [];
        this._counters = {};
        this._histograms = {};
        this._gauges = {};
    }
}

module.exports = MetricsCollector;
