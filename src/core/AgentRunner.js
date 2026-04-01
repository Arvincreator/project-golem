const AgentKernel = require('../managers/AgentKernel');

function compactText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

class AgentRunner {
    constructor(options = {}) {
        this.agentKernel = options.agentKernel || null;
        this.summaryIntervalMs = Math.max(
            5000,
            Number(options.summaryIntervalMs || process.env.GOLEM_AGENT_SUMMARY_INTERVAL_MS || 30000) || 30000
        );
        this._workerTimers = new Map();
    }

    _ensureKernel() {
        if (!this.agentKernel) {
            throw new Error('AgentRunner requires agentKernel');
        }
    }

    _safeUpdateWorker(workerId, patch = {}, options = {}) {
        try {
            return this.agentKernel.updateWorker(workerId, patch, options);
        } catch (error) {
            // Worker may already be terminal or removed; keep runner robust.
            return null;
        }
    }

    startWorker(workerId, options = {}) {
        this._ensureKernel();
        const worker = this.agentKernel.getWorker(workerId);
        if (!worker) return null;
        if (worker.status === 'completed' || worker.status === 'failed' || worker.status === 'killed') {
            this.stopWorker(workerId);
            return worker;
        }

        if (worker.status === 'pending') {
            this._safeUpdateWorker(workerId, {
                status: 'running',
                progress: {
                    phase: 'running',
                    percent: 0,
                },
            }, {
                actor: compactText(options.actor, 'runner'),
                source: compactText(options.source, 'agent_runner'),
            });
        }

        this.stopWorker(workerId);
        const timer = setInterval(() => {
            const current = this.agentKernel.getWorker(workerId);
            if (!current) {
                this.stopWorker(workerId);
                return;
            }
            if (current.status !== 'running' && current.status !== 'pending') {
                this.stopWorker(workerId);
                return;
            }

            const currentPercent = Number(current.progress && current.progress.percent);
            const nextPercent = Number.isFinite(currentPercent)
                ? Math.min(95, Math.max(0, Math.floor(currentPercent)) + 5)
                : 5;

            this._safeUpdateWorker(workerId, {
                progress: {
                    phase: 'running',
                    percent: nextPercent,
                },
            }, {
                actor: 'runner',
                source: 'agent_runner',
            });
        }, this.summaryIntervalMs);

        if (typeof timer.unref === 'function') timer.unref();
        this._workerTimers.set(workerId, timer);
        return this.agentKernel.getWorker(workerId);
    }

    onWorkerSpawn(worker, options = {}) {
        if (!worker || !worker.id) return null;
        if (worker.runInBackground !== true) return worker;
        return this.startWorker(worker.id, options);
    }

    stopWorker(workerId) {
        const timer = this._workerTimers.get(workerId);
        if (timer) {
            clearInterval(timer);
            this._workerTimers.delete(workerId);
        }
    }

    stopSession(sessionId) {
        this._ensureKernel();
        const workers = this.agentKernel.listWorkers({ sessionId });
        for (const worker of workers) {
            this.stopWorker(worker.id);
        }
    }

    handleResume(result = {}, options = {}) {
        const workers = Array.isArray(result.workers) ? result.workers : [];
        for (const worker of workers) {
            if (!worker || worker.runInBackground !== true) continue;
            if (worker.status === 'pending' || worker.status === 'running') {
                this.startWorker(worker.id, options);
            }
        }
    }

    stopAll() {
        for (const workerId of Array.from(this._workerTimers.keys())) {
            this.stopWorker(workerId);
        }
    }
}

module.exports = AgentRunner;
