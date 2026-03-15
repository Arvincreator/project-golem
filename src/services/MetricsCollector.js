// ============================================================
// MetricsCollector — Real-time system metrics with ring buffer
// Collects 14 metrics every 10 seconds, stores 1 hour of history
// ============================================================

class MetricsCollector {
    constructor(options = {}) {
        this._history = []; // Ring buffer
        this._maxHistory = 360; // 1 hour at 10s intervals
        this._interval = null;
        this._counters = {
            tasksCompleted: 0,
            tasksFailed: 0,
            errors1h: [],
            ragConfidenceRecent: [],
        };
        this._refs = {
            actionQueue: options.actionQueue || null,
            threeLayerMemory: options.threeLayerMemory || null,
            skillManager: options.skillManager || null,
        };
        this._lastCpuUsage = process.cpuUsage();
        this._lastCpuTime = Date.now();
    }

    start() {
        if (this._interval) return;
        this._collect(); // immediate first
        this._interval = setInterval(() => this._collect(), 10000);
        console.log('[MetricsCollector] Started (10s intervals, 1h buffer)');
    }

    stop() {
        if (this._interval) { clearInterval(this._interval); this._interval = null; }
    }

    _collect() {
        const mem = process.memoryUsage();
        const now = Date.now();

        // CPU calculation
        const cpuUsage = process.cpuUsage(this._lastCpuUsage);
        const elapsed = (now - this._lastCpuTime) * 1000; // microseconds
        const cpuPct = elapsed > 0 ? Math.round(((cpuUsage.user + cpuUsage.system) / elapsed) * 100 * 10) / 10 : 0;
        this._lastCpuUsage = process.cpuUsage();
        this._lastCpuTime = now;

        // Event loop lag
        const lagStart = Date.now();
        // We approximate lag from collection overhead

        // Clean old errors (keep 1h window)
        const oneHourAgo = now - 3600000;
        this._counters.errors1h = this._counters.errors1h.filter(t => t > oneHourAgo);

        // Queue depth
        let queueDepth = 0;
        if (this._refs.actionQueue) {
            queueDepth = this._refs.actionQueue.queue?.length || 0;
        }

        // Skills loaded
        let skillsLoaded = 0;
        if (this._refs.skillManager) {
            skillsLoaded = this._refs.skillManager.skills?.size || 0;
        }

        // Memory layers
        let memoryWorking = 0, memoryEpisodic = 0;
        if (this._refs.threeLayerMemory) {
            try {
                const stats = this._refs.threeLayerMemory.getStats();
                memoryWorking = stats.working || 0;
                memoryEpisodic = stats.episodic || 0;
            } catch (e) { /* optional */ }
        }

        // Circuit breakers
        let cbOpen = 0;
        try {
            const cb = require('../core/circuit_breaker');
            const status = cb.getStatus();
            cbOpen = Object.values(status).filter(v => v.state === 'OPEN').length;
        } catch (e) { /* optional */ }

        // RAG confidence average
        const ragScores = this._counters.ragConfidenceRecent.slice(-10);
        const ragConfidenceAvg = ragScores.length > 0
            ? Math.round((ragScores.reduce((a, b) => a + b, 0) / ragScores.length) * 100) / 100
            : 0;

        const snapshot = {
            time: now,
            rss_mb: Math.round(mem.rss / 1024 / 1024),
            heap_mb: Math.round(mem.heapUsed / 1024 / 1024),
            heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
            cpu_pct: cpuPct,
            uptime_sec: Math.floor(process.uptime()),
            event_loop_lag_ms: Date.now() - lagStart,
            queue_depth: queueDepth,
            tasks_completed: this._counters.tasksCompleted,
            tasks_failed: this._counters.tasksFailed,
            errors_1h: this._counters.errors1h.length,
            skills_loaded: skillsLoaded,
            memory_working: memoryWorking,
            memory_episodic: memoryEpisodic,
            circuit_breakers_open: cbOpen,
            rag_confidence_avg: ragConfidenceAvg,
        };

        this._history.push(snapshot);
        if (this._history.length > this._maxHistory) this._history.shift();
    }

    // --- Public API ---

    getSnapshot() {
        if (this._history.length === 0) this._collect();
        return this._history[this._history.length - 1] || {};
    }

    getHistory(minutes = 60) {
        const cutoff = Date.now() - minutes * 60000;
        return this._history.filter(s => s.time >= cutoff);
    }

    // --- External event recording ---

    recordTaskComplete() { this._counters.tasksCompleted++; }
    recordTaskFailed() { this._counters.tasksFailed++; }
    recordError() { this._counters.errors1h.push(Date.now()); }
    recordRagConfidence(score) {
        this._counters.ragConfidenceRecent.push(score);
        if (this._counters.ragConfidenceRecent.length > 50) this._counters.ragConfidenceRecent.shift();
    }

    setRef(name, ref) {
        if (this._refs.hasOwnProperty(name)) this._refs[name] = ref;
    }
}

module.exports = MetricsCollector;
