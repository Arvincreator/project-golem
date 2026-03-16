// ============================================================
// SentinelAgent — System monitoring (60s interval, 0 token budget)
// ============================================================
const SubAgent = require('../SubAgent');

class SentinelAgent extends SubAgent {
    constructor(options = {}) {
        super({
            ...options,
            type: 'sentinel',
            name: options.name || 'sentinel-0',
            tokenBudget: 0,
            oodaIntervalMs: options.oodaIntervalMs || 60000,
            timeoutMs: options.timeoutMs || 10000,
        });

        this._memoryThresholdMB = options.memoryThresholdMB || 400;
    }

    async _observe() {
        const mem = process.memoryUsage();
        const observations = {
            rss: Math.round(mem.rss / 1024 / 1024),
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
            uptime: Math.floor(process.uptime()),
            circuitBreakerStatus: null,
            warRoomStatus: null,
        };

        // Circuit breaker status (non-blocking)
        try {
            const cb = require('../circuit_breaker');
            observations.circuitBreakerStatus = cb.getStatus();
        } catch (e) { /* optional */ }

        // War room status (non-blocking)
        try {
            const warroom = require('../../utils/warroom-client');
            observations.warRoomStatus = await warroom.getStatus().catch(() => null);
        } catch (e) { /* optional */ }

        return observations;
    }

    _orient(observations) {
        const alerts = [];

        if (observations.rss > this._memoryThresholdMB) {
            alerts.push({ type: 'memory', severity: 'high', detail: `RSS ${observations.rss}MB > ${this._memoryThresholdMB}MB` });
        }

        // Check for open circuit breakers
        if (observations.circuitBreakerStatus) {
            const openBreakers = Object.entries(observations.circuitBreakerStatus)
                .filter(([, v]) => v.state && v.state !== 'CLOSED');
            for (const [name, status] of openBreakers) {
                alerts.push({ type: 'circuit_breaker', severity: 'medium', detail: `${name}=${status.state}` });
            }
        }

        // War room alerts
        if (observations.warRoomStatus?.alerts?.length > 0) {
            alerts.push({ type: 'warroom', severity: 'medium', detail: `${observations.warRoomStatus.alerts.length} active alerts` });
        }

        return { observations, alerts };
    }

    _decide(analysis) {
        if (analysis.alerts.length === 0) {
            return { action: 'noop', level: 'L0', reason: 'All clear', payload: null };
        }

        const highSeverity = analysis.alerts.filter(a => a.severity === 'high');
        if (highSeverity.length > 0) {
            return {
                action: 'alert_critical',
                level: 'L0',
                reason: highSeverity.map(a => a.detail).join('; '),
                payload: { alerts: highSeverity, triggerGC: highSeverity.some(a => a.type === 'memory') }
            };
        }

        return {
            action: 'alert_warning',
            level: 'L0',
            reason: analysis.alerts.map(a => a.detail).join('; '),
            payload: { alerts: analysis.alerts }
        };
    }

    async _act(decision) {
        // Publish alert to bus
        this.publish('alert', {
            source: this.id,
            action: decision.action,
            reason: decision.reason,
            alerts: decision.payload?.alerts || [],
        });

        // Trigger GC if memory alert
        if (decision.payload?.triggerGC && global.gc) {
            global.gc();
            this._logActivity({ event: 'gc_triggered', reason: decision.reason });
        }
    }
}

module.exports = SentinelAgent;
