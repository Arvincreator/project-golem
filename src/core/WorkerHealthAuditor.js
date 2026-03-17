// ============================================================
// WorkerHealthAuditor — CF Worker 健康審計
// v11.5: 檢查所有 workers 狀態, 延遲, 建議重部署
// ============================================================

const path = require('path');
const fs = require('fs');
const DebouncedWriter = require('../utils/DebouncedWriter');

const MAX_HISTORY = 200;
const HEALTH_TIMEOUT_MS = 5000;
const CONSECUTIVE_FAIL_THRESHOLD = 3;
const DATA_FILE = 'worker_health_history.json';

// Known worker URLs from cloudflare-workers.md + endpoints.js
const KNOWN_WORKERS = [
    { name: 'rag', url: 'rag.yagami8095.workers.dev' },
    { name: 'notion-warroom', url: 'notion-warroom.yagami8095.workers.dev' },
    { name: 'health-commander', url: 'health-commander.yagami8095.workers.dev' },
    { name: 'intel-ops', url: 'intel-ops.yagami8095.workers.dev' },
    { name: 'orchestrator', url: 'orchestrator.yagami8095.workers.dev' },
    { name: 'content-engine', url: 'content-engine.yagami8095.workers.dev' },
    { name: 'revenue-sentinel', url: 'revenue-sentinel.yagami8095.workers.dev' },
    { name: 'analytics-dashboard', url: 'analytics-dashboard.yagami8095.workers.dev' },
    { name: 'auto-agent', url: 'auto-agent-worker.yagami8095.workers.dev' },
];

class WorkerHealthAuditor {
    constructor(options = {}) {
        this._dataDir = options.dataDir || path.resolve(process.cwd(), 'data');
        this._filePath = path.join(this._dataDir, DATA_FILE);
        this._history = [];
        this._failCounts = {}; // name → consecutive fail count
        this._customWorkers = options.workers || [];
        this._timeoutMs = options.timeoutMs || HEALTH_TIMEOUT_MS;
        this._writer = new DebouncedWriter(this._filePath, 3000);
        this._load();
    }

    /**
     * Get the full list of workers to audit
     * @returns {Array<{ name, url }>}
     */
    getWorkerList() {
        const workers = [...KNOWN_WORKERS, ...this._customWorkers];
        // Add workers from endpoints config if available
        try {
            const { WORKERS, MCP_SERVERS } = require('../config/endpoints');
            for (const [name, url] of Object.entries(WORKERS)) {
                if (url && !workers.some(w => w.url === url)) {
                    workers.push({ name: `worker-${name}`, url });
                }
            }
            for (const [name, srv] of Object.entries(MCP_SERVERS)) {
                if (srv.url && !workers.some(w => w.url === srv.url)) {
                    workers.push({ name: `mcp-${name}`, url: srv.url });
                }
            }
        } catch (e) { /* endpoints not available */ }

        return workers.filter(w => w.url);
    }

    /**
     * Audit all workers
     * @returns {Object} { workers: [{ name, url, status, latencyMs, error }], summary }
     */
    async auditAll() {
        const workers = this.getWorkerList();
        const results = [];

        for (const worker of workers) {
            const result = await this._checkWorker(worker);
            results.push(result);

            // Track consecutive failures
            if (result.status !== 'ok') {
                this._failCounts[worker.name] = (this._failCounts[worker.name] || 0) + 1;
            } else {
                this._failCounts[worker.name] = 0;
            }
        }

        const summary = {
            timestamp: new Date().toISOString(),
            total: results.length,
            healthy: results.filter(r => r.status === 'ok').length,
            unhealthy: results.filter(r => r.status !== 'ok').length,
            avgLatencyMs: results.filter(r => r.latencyMs > 0).length > 0
                ? Math.round(results.filter(r => r.latencyMs > 0).reduce((sum, r) => sum + r.latencyMs, 0) / results.filter(r => r.latencyMs > 0).length)
                : 0,
        };

        // Append to history
        this._history.push({ ...summary, details: results.map(r => ({ name: r.name, status: r.status, latencyMs: r.latencyMs })) });
        if (this._history.length > MAX_HISTORY) {
            this._history = this._history.slice(-MAX_HISTORY);
        }
        this._save();

        return { workers: results, summary };
    }

    /**
     * Get recommendations based on failure history
     * @returns {Array<{ name, recommendation, consecutiveFails }>}
     */
    getRecommendations() {
        const recs = [];
        for (const [name, count] of Object.entries(this._failCounts)) {
            if (count >= CONSECUTIVE_FAIL_THRESHOLD) {
                recs.push({
                    name,
                    recommendation: `Worker "${name}" has failed ${count} consecutive health checks — consider redeploying`,
                    consecutiveFails: count,
                });
            }
        }
        return recs;
    }

    /**
     * Get audit history
     */
    getHistory() {
        return [...this._history];
    }

    /**
     * Get stats
     */
    getStats() {
        const lastAudit = this._history.length > 0 ? this._history[this._history.length - 1] : null;
        return {
            totalAudits: this._history.length,
            lastAudit: lastAudit ? lastAudit.timestamp : null,
            lastHealthy: lastAudit ? lastAudit.healthy : 0,
            lastUnhealthy: lastAudit ? lastAudit.unhealthy : 0,
            workersWithIssues: Object.entries(this._failCounts)
                .filter(([, c]) => c > 0)
                .map(([name, count]) => ({ name, consecutiveFails: count })),
        };
    }

    // --- Internal ---

    async _checkWorker(worker) {
        const healthUrl = this._buildHealthUrl(worker.url);
        const start = Date.now();

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this._timeoutMs);

            const response = await fetch(healthUrl, {
                signal: controller.signal,
                headers: { 'User-Agent': 'GolemHealthAuditor/1.0' },
            });
            clearTimeout(timeout);

            const latencyMs = Date.now() - start;
            return {
                name: worker.name,
                url: worker.url,
                status: response.ok ? 'ok' : 'error',
                statusCode: response.status,
                latencyMs,
                error: response.ok ? null : `HTTP ${response.status}`,
            };
        } catch (e) {
            return {
                name: worker.name,
                url: worker.url,
                status: 'unreachable',
                statusCode: 0,
                latencyMs: Date.now() - start,
                error: e.message,
            };
        }
    }

    _buildHealthUrl(url) {
        if (!url) return '';
        // If already a full URL, append /health
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url.replace(/\/+$/, '') + '/health';
        }
        // Otherwise treat as hostname
        return `https://${url}/health`;
    }

    _load() {
        try {
            if (fs.existsSync(this._filePath)) {
                const raw = fs.readFileSync(this._filePath, 'utf-8');
                const data = JSON.parse(raw);
                if (Array.isArray(data)) {
                    this._history = data.slice(-MAX_HISTORY);
                } else if (data && Array.isArray(data.history)) {
                    this._history = data.history.slice(-MAX_HISTORY);
                }
            }
        } catch (e) {
            console.warn('[WorkerHealthAuditor] Load failed:', e.message);
            this._history = [];
        }
    }

    _save() {
        try {
            this._writer.markDirty(JSON.stringify(this._history, null, 2));
        } catch (e) {
            console.warn('[WorkerHealthAuditor] Save failed:', e.message);
        }
    }
}

module.exports = WorkerHealthAuditor;
