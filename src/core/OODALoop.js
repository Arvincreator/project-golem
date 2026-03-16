// ============================================================
// OODA Loop — Observe -> Orient -> Decide -> Act
// ============================================================
const warroom = require('../utils/warroom-client');
const endpoints = require('../config/endpoints');

class OODALoop {
    constructor(brain, options = {}) {
        this.brain = brain;
        this.golemId = options.golemId || 'default';
        this._agentBus = options.agentBus || null;
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
        } else if (analysis.patterns.length > 1 && this._agentBus) {
            decision.action = 'delegate_to_analyst';
            decision.level = 'L0';
            decision.reason = `Multiple patterns (${analysis.patterns.length}), delegating to analyst`;
        } else if (analysis.patterns.length > 0) {
            decision.action = 'experience_reflect';
            decision.level = 'L0';
            decision.reason = `Pattern detected: ${analysis.patterns[0].substring ? analysis.patterns[0].substring(0, 50) : 'recurring'}`;
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

        if (decision.action === 'investigate_alerts') {
            console.log(`[OODA] Investigating ${decision.reason}`);
            return { executed: true, result: `Alert investigation logged: ${decision.reason}` };
        }

        if (decision.action === 'delegate_to_analyst') {
            this._agentBus.publish('task.request', {
                type: 'analysis', source: 'ooda',
                payload: decision.reason
            }, `ooda:${this.golemId}`);
            return { executed: true, result: 'Delegated to analyst agent' };
        }

        if (decision.action === 'experience_reflect') {
            console.log(`[OODA] Experience reflection triggered: ${decision.reason}`);
            return { executed: true, result: 'Experience reflection queued' };
        }

        return { executed: false, reason: `Action ${decision.action} requires higher-level dispatch` };
    }

    /**
     * Record execution result back to the most recent decision
     * Called after act() to track success/failure for getActionSuccessRate()
     */
    _recordResult(decision, result) {
        const last = this._metrics.decisions[this._metrics.decisions.length - 1];
        if (last && last.action === decision.action) {
            last.failed = !result.executed;
        }
    }

    async runLoop(experienceMemory, actionQueue, ctx) {
        const start = Date.now();
        this._metrics.loopCount++;

        const observations = await this.observe();
        const analysis = this.orient(observations, experienceMemory);
        const decision = this.decide(analysis);
        const result = await this.act(decision, actionQueue, ctx);
        this._recordResult(decision, result);

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

    /**
     * Get success rate for a specific action type
     * @param {string} action - Action name to check
     * @returns {{ rate: number, total: number }}
     */
    getActionSuccessRate(action) {
        const matching = this._metrics.decisions.filter(d => d.action === action);
        if (matching.length === 0) return { rate: 0.5, total: 0 };
        const successes = matching.filter(d => !d.failed).length;
        return { rate: successes / matching.length, total: matching.length };
    }

    /**
     * Beta distribution sampling (mean + noise for exploration)
     * @param {number} alpha - Success count + 1
     * @param {number} beta - Failure count + 1
     * @returns {number} Sample in [0, 1]
     */
    static betaSample(alpha, beta) {
        const mean = alpha / (alpha + beta);
        const noise = (Math.random() - 0.5) * 0.1;
        return Math.max(0, Math.min(1, mean + noise));
    }
}

module.exports = OODALoop;
