// ============================================================
// ScanQualityTracker — 掃描品質追蹤器
// v11.5: 記錄查詢效果, 自動跳過無效查詢
// ============================================================

const path = require('path');
const fs = require('fs');
const DebouncedWriter = require('../utils/DebouncedWriter');

const MAX_RECORDS = 500;
const WORTHLESS_THRESHOLD = 3; // Consecutive 0-result queries before marking worthless
const DATA_FILE = 'scan_quality_tracker.json';

class ScanQualityTracker {
    constructor(options = {}) {
        this._dataDir = options.dataDir || path.resolve(process.cwd(), 'data');
        this._filePath = path.join(this._dataDir, DATA_FILE);
        this._records = {}; // query → { successes, failures, consecutive_zeros, last_result_count, total_runs }
        this._writer = new DebouncedWriter(this._filePath, 3000);
        this._load();
    }

    /**
     * Record a scan result for a query
     * @param {string} query - The search query
     * @param {string} category - Scan category
     * @param {Object} result - { resultCount, hasSynthesis }
     */
    recordScanResult(query, category, result = {}) {
        const key = this._normalizeQuery(query);
        if (!this._records[key]) {
            this._records[key] = {
                query,
                category,
                successes: 0,
                failures: 0,
                consecutive_zeros: 0,
                total_runs: 0,
                last_result_count: 0,
                lastRun: null,
            };
        }

        const rec = this._records[key];
        rec.total_runs++;
        rec.lastRun = Date.now();
        rec.last_result_count = result.resultCount || 0;

        const hasContent = (result.resultCount > 0) || result.hasSynthesis;
        if (hasContent) {
            rec.successes++;
            rec.consecutive_zeros = 0;
        } else {
            rec.failures++;
            rec.consecutive_zeros++;
        }

        this._capRecords();
        this._save();
    }

    /**
     * Get effectiveness stats for all tracked queries
     * @returns {Array<{ query, category, successRate, totalRuns, consecutive_zeros }>}
     */
    getQueryEffectiveness() {
        return Object.values(this._records).map(rec => ({
            query: rec.query,
            category: rec.category,
            successRate: rec.total_runs > 0 ? rec.successes / rec.total_runs : 0,
            totalRuns: rec.total_runs,
            consecutive_zeros: rec.consecutive_zeros,
        }));
    }

    /**
     * Get queries that have been worthless (consecutive 0 results >= threshold)
     * @returns {Array<string>} query strings
     */
    getWorthlessQueries() {
        return Object.values(this._records)
            .filter(rec => rec.consecutive_zeros >= WORTHLESS_THRESHOLD)
            .map(rec => rec.query);
    }

    /**
     * Check if a specific query is worthless
     * @param {string} query
     * @returns {boolean}
     */
    isWorthless(query) {
        const key = this._normalizeQuery(query);
        const rec = this._records[key];
        return rec ? rec.consecutive_zeros >= WORTHLESS_THRESHOLD : false;
    }

    /**
     * Get top performing queries
     * @param {number} limit
     * @returns {Array}
     */
    getTopQueries(limit = 10) {
        return Object.values(this._records)
            .filter(r => r.total_runs >= 2)
            .sort((a, b) => {
                const rateA = a.successes / a.total_runs;
                const rateB = b.successes / b.total_runs;
                return rateB - rateA;
            })
            .slice(0, limit)
            .map(r => ({ query: r.query, category: r.category, successRate: r.successes / r.total_runs, totalRuns: r.total_runs }));
    }

    /**
     * Get stats
     */
    getStats() {
        const records = Object.values(this._records);
        return {
            totalQueries: records.length,
            totalRuns: records.reduce((sum, r) => sum + r.total_runs, 0),
            worthlessCount: this.getWorthlessQueries().length,
            avgSuccessRate: records.length > 0
                ? records.reduce((sum, r) => sum + (r.total_runs > 0 ? r.successes / r.total_runs : 0), 0) / records.length
                : 0,
        };
    }

    // --- Internal ---

    _normalizeQuery(query) {
        return String(query).trim().toLowerCase();
    }

    _capRecords() {
        const keys = Object.keys(this._records);
        if (keys.length > MAX_RECORDS) {
            // Remove oldest, least-used records
            const sorted = keys
                .map(k => ({ key: k, ...this._records[k] }))
                .sort((a, b) => (b.lastRun || 0) - (a.lastRun || 0));
            const keep = sorted.slice(0, MAX_RECORDS);
            const newRecords = {};
            for (const r of keep) {
                const { key, ...rest } = r;
                newRecords[key] = rest;
            }
            this._records = newRecords;
        }
    }

    _load() {
        try {
            if (fs.existsSync(this._filePath)) {
                const raw = fs.readFileSync(this._filePath, 'utf-8');
                const data = JSON.parse(raw);
                if (data && typeof data === 'object' && !Array.isArray(data)) {
                    this._records = data;
                }
            }
        } catch (e) {
            console.warn('[ScanQualityTracker] Load failed:', e.message);
            this._records = {};
        }
    }

    _save() {
        try {
            this._writer.markDirty(JSON.stringify(this._records, null, 2));
        } catch (e) {
            console.warn('[ScanQualityTracker] Save failed:', e.message);
        }
    }
}

module.exports = ScanQualityTracker;
