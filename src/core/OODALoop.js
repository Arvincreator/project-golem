// ============================================================
// OODA Loop — Observe -> Orient -> Decide -> Act
// ============================================================
const warroom = require('../utils/warroom-client');
const endpoints = require('../config/endpoints');

class OODALoop {
    constructor(brain, options = {}) {
        this.brain = brain;
        this.golemId = options.golemId || 'default';
        this._metrics = { loopCount: 0, totalTimeMs: 0, decisions: [] };
    }

    async observe() {
        const observations = { systemMetrics: null, warRoomStatus: null, ragContext: null };

        // System metrics
        const mem = process.memoryUsage();
        observations.systemMetrics = {
            rss: Math.round(mem.rss / 1024 / 1024),
            uptime: Math.floor(process.uptime()),
            timestamp: Date.now()
        };

        // War room status (non-blocking)
        observations.warRoomStatus = await warroom.getStatus().catch(() => null);

        // RAG context (if available)
        try {
            if (endpoints.RAG_URL) {
                const { getToken } = require('../utils/yedan-auth');
                const token = getToken();
                if (token) {
                    const res = await fetch(`${endpoints.RAG_URL}/query`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ query: 'recent events status', max_hops: 1, limit: 5 }),
                        signal: AbortSignal.timeout(8000)
                    });
                    if (res.ok) observations.ragContext = await res.json();
                }
            }
        } catch (e) { /* non-blocking */ }

        return observations;
    }

    orient(observations, experienceMemory) {
        const analysis = {
            memoryPressure: (observations.systemMetrics?.rss || 0) > 400 ? 'HIGH' : 'NORMAL',
            warRoomAlerts: observations.warRoomStatus?.alerts?.length || 0,
            patterns: []
        };

        // Check experience memory for patterns
        if (experienceMemory && typeof experienceMemory.getAdvice === 'function') {
            const advice = experienceMemory.getAdvice();
            if (advice) analysis.patterns.push(advice);
        }

        return analysis;
    }

    decide(analysis) {
        const decision = { action: 'noop', level: 'L0', reason: '' };

        if (analysis.memoryPressure === 'HIGH') {
            decision.action = 'gc_hint';
            decision.level = 'L0';
            decision.reason = 'Memory pressure detected';
        } else if (analysis.warRoomAlerts > 0) {
            decision.action = 'investigate_alerts';
            decision.level = 'L1';
            decision.reason = `${analysis.warRoomAlerts} pending alerts`;
        }

        this._metrics.decisions.push({ action: decision.action, time: Date.now() });
        if (this._metrics.decisions.length > 100) this._metrics.decisions.shift();

        return decision;
    }

    async act(decision, actionQueue, ctx) {
        if (decision.action === 'noop') return { executed: false };

        if (decision.action === 'gc_hint') {
            if (global.gc) global.gc();
            return { executed: true, result: 'GC hint sent' };
        }

        return { executed: false, reason: `Action ${decision.action} requires higher-level dispatch` };
    }

    async runLoop(experienceMemory, actionQueue, ctx) {
        const start = Date.now();
        this._metrics.loopCount++;

        const observations = await this.observe();
        const analysis = this.orient(observations, experienceMemory);
        const decision = this.decide(analysis);
        const result = await this.act(decision, actionQueue, ctx);

        this._metrics.totalTimeMs += Date.now() - start;

        return { observations, analysis, decision, result };
    }

    getMetrics() {
        return {
            loopCount: this._metrics.loopCount,
            avgLoopTimeMs: this._metrics.loopCount > 0
                ? Math.round(this._metrics.totalTimeMs / this._metrics.loopCount) : 0,
            recentDecisions: this._metrics.decisions.slice(-10)
        };
    }
}

module.exports = OODALoop;
