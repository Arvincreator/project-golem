// src/core/BenchmarkEngine.js
// BenchmarkEngine — 系統基準快照 + 改善對比引擎
// 收集: 系統指標 / RAG 統計 / 測試結果 / Brain 策略

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DEFAULT_HISTORY_FILE = path.join(process.cwd(), 'benchmark_history.json');
const MAX_SNAPSHOTS = 100;

class BenchmarkEngine {
    constructor(options = {}) {
        this._historyFile = options.historyFile || DEFAULT_HISTORY_FILE;
        this._maxSnapshots = options.maxSnapshots || MAX_SNAPSHOTS;
    }

    /**
     * Take a system snapshot
     * @param {string} label - Snapshot label (e.g. 'before', 'after')
     * @returns {{ label, timestamp, system, rag, tests, brain }}
     */
    async snapshot(label = 'snapshot') {
        const timestamp = new Date().toISOString();

        const [system, rag, tests, brain] = await Promise.all([
            this._collectSystemMetrics(),
            this._collectRAGMetrics(),
            this._collectTestMetrics(),
            this._collectBrainMetrics(),
        ]);

        return { label, timestamp, system, rag, tests, brain };
    }

    /**
     * Compute delta between two snapshots
     * @returns {{ deltas, improvement_pct, improved, degraded, summary }}
     */
    computeDelta(before, after) {
        const deltas = {};
        const improved = [];
        const degraded = [];

        // System metrics (lower RSS = better)
        if (before.system && after.system) {
            this._addDelta(deltas, 'rss_mb', before.system.rss, after.system.rss, 'lower');
            this._addDelta(deltas, 'heap_used_mb', before.system.heapUsed, after.system.heapUsed, 'lower');
        }

        // RAG metrics (higher = better)
        if (before.rag && after.rag && before.rag.available !== false && after.rag.available !== false) {
            if (before.rag.entities !== undefined) this._addDelta(deltas, 'rag_entities', before.rag.entities, after.rag.entities, 'higher');
            if (before.rag.vectors !== undefined) this._addDelta(deltas, 'rag_vectors', before.rag.vectors, after.rag.vectors, 'higher');
        }

        // Test metrics (higher passed = better, lower failed = better)
        if (before.tests && after.tests && before.tests.available !== false && after.tests.available !== false) {
            this._addDelta(deltas, 'tests_passed', before.tests.passed, after.tests.passed, 'higher');
            this._addDelta(deltas, 'tests_failed', before.tests.failed, after.tests.failed, 'lower');
            this._addDelta(deltas, 'tests_total', before.tests.total, after.tests.total, 'higher');
        }

        // Classify improved/degraded
        for (const [metric, d] of Object.entries(deltas)) {
            if (d.improved) improved.push(metric);
            else if (d.degraded) degraded.push(metric);
        }

        // Overall improvement percentage
        const metricCount = Object.keys(deltas).length;
        const improvement_pct = metricCount > 0
            ? Math.round((improved.length / metricCount) * 100)
            : 0;

        const summary = `改善: ${improved.length}/${metricCount} 指標 (${improvement_pct}%)` +
            (degraded.length > 0 ? ` | 退化: ${degraded.join(', ')}` : '');

        return { deltas, improvement_pct, improved, degraded, summary };
    }

    /**
     * Save snapshot to history (bounded)
     */
    saveSnapshot(snapshot) {
        const history = this.loadHistory();
        history.push(snapshot);
        if (history.length > this._maxSnapshots) {
            history.splice(0, history.length - this._maxSnapshots);
        }
        fs.writeFileSync(this._historyFile, JSON.stringify(history, null, 2));
    }

    /**
     * Load snapshot history
     */
    loadHistory() {
        try {
            if (fs.existsSync(this._historyFile)) {
                return JSON.parse(fs.readFileSync(this._historyFile, 'utf-8'));
            }
        } catch (e) {
            console.warn('[BenchmarkEngine] loadHistory error:', e.message);
        }
        return [];
    }

    // ─── Private Collectors ───

    _collectSystemMetrics() {
        try {
            const mem = process.memoryUsage();
            return {
                rss: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
                heapUsed: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
                heapTotal: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
                uptime: Math.round(process.uptime()),
            };
        } catch (e) {
            return { rss: 0, heapUsed: 0, heapTotal: 0, uptime: 0 };
        }
    }

    async _collectRAGMetrics() {
        try {
            const rag = require('../skills/core/rag');
            const result = await rag.execute({ task: 'stats' });
            if (typeof result === 'string') {
                // Parse stats from text output
                const entities = (result.match(/實體[：:]\s*(\d+)/)?.[1]) || 0;
                const vectors = (result.match(/向量[：:]\s*(\d+)/)?.[1]) || 0;
                return { entities: Number(entities), vectors: Number(vectors), raw: result.substring(0, 500), available: true };
            }
            return { entities: 0, vectors: 0, available: true };
        } catch (e) {
            return { available: false, error: e.message };
        }
    }

    _collectTestMetrics() {
        // Skip in test mode to prevent recursive jest spawning
        if (process.env.GOLEM_TEST_MODE === 'true') {
            return { available: false, reason: 'skipped-in-test-mode' };
        }
        try {
            const output = execSync('npx jest --json --silent 2>/dev/null', {
                timeout: 60000,
                cwd: process.cwd(),
                stdio: ['pipe', 'pipe', 'pipe'],
                encoding: 'utf-8',
            });

            const json = JSON.parse(output);
            return {
                total: json.numTotalTests || 0,
                passed: json.numPassedTests || 0,
                failed: json.numFailedTests || 0,
                suites: json.numTotalTestSuites || 0,
                available: true,
            };
        } catch (e) {
            // Try to parse partial JSON from stderr/stdout
            try {
                const text = e.stdout || e.stderr || '';
                const jsonMatch = text.match(/\{[\s\S]*"numTotalTests"[\s\S]*\}/);
                if (jsonMatch) {
                    const json = JSON.parse(jsonMatch[0]);
                    return {
                        total: json.numTotalTests || 0,
                        passed: json.numPassedTests || 0,
                        failed: json.numFailedTests || 0,
                        suites: json.numTotalTestSuites || 0,
                        available: true,
                    };
                }
            } catch (_) { /* ignore */ }
            return { available: false, error: e.message?.substring(0, 200) };
        }
    }

    async _collectBrainMetrics() {
        try {
            const SelfEvolution = require('./SelfEvolution');
            if (typeof SelfEvolution.getStrategies === 'function') {
                const strategies = SelfEvolution.getStrategies();
                return { strategies: strategies?.length || 0 };
            }
            return { strategies: 0 };
        } catch (e) {
            return { strategies: 0 };
        }
    }

    // ─── Helpers ───

    _addDelta(deltas, metric, before, after, direction) {
        if (before === undefined || after === undefined) return;
        const bVal = Number(before) || 0;
        const aVal = Number(after) || 0;
        const change = aVal - bVal;
        const pct = bVal !== 0 ? Math.round((change / Math.abs(bVal)) * 100) : (change !== 0 ? 100 : 0);

        const improved = direction === 'higher' ? change > 0 : change < 0;
        const degraded = direction === 'higher' ? change < 0 : change > 0;

        deltas[metric] = { before: bVal, after: aVal, change, pct, improved, degraded };
    }
}

module.exports = BenchmarkEngine;
