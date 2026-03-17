// ============================================================
// TokenTracker — Per-module token usage tracking + budget management
// v12.0: Tracks token consumption across all modules
// ============================================================

const path = require('path');
const fs = require('fs');
const DebouncedWriter = require('../utils/DebouncedWriter');

const DEFAULT_DATA_FILE = 'data/token_usage.json';
const DEFAULT_BUDGET = 50000;

class TokenTracker {
    constructor(options = {}) {
        this._budget = options.budget || DEFAULT_BUDGET;
        this._dataDir = options.dataDir || path.resolve(process.cwd(), 'data');
        this._dataFile = options.dataFile || path.join(this._dataDir, 'token_usage.json');
        this._persistIntervalMs = options.persistIntervalMs || 5000;
        this._warnThresholdPct = options.warnThresholdPct || 80;

        this._usage = new Map(); // module -> { input: N, output: N, total: N }
        this._totalUsed = 0;
        this._sessionStart = Date.now();
        this._records = [];

        this._writer = new DebouncedWriter(this._dataFile, this._persistIntervalMs);
        this._load();
    }

    /**
     * Record token usage for a module
     * @param {string} module - Module name (e.g., 'ContextEngineer', 'WebResearcher')
     * @param {number} tokens - Number of tokens used
     * @param {string} type - 'input' or 'output'
     */
    record(module, tokens, type = 'input') {
        if (!module || !tokens || tokens <= 0) return;

        if (!this._usage.has(module)) {
            this._usage.set(module, { input: 0, output: 0, total: 0 });
        }

        const entry = this._usage.get(module);
        const validType = type === 'output' ? 'output' : 'input';
        entry[validType] += tokens;
        entry.total += tokens;
        this._totalUsed += tokens;

        this._records.push({
            timestamp: Date.now(),
            module,
            tokens,
            type: validType,
        });

        // Cap records
        if (this._records.length > 1000) {
            this._records = this._records.slice(-500);
        }

        // Warn if approaching budget
        const pct = (this._totalUsed / this._budget) * 100;
        if (pct >= this._warnThresholdPct && pct < this._warnThresholdPct + 5) {
            console.warn(`[TokenTracker] Warning: ${pct.toFixed(1)}% of daily budget used (${this._totalUsed}/${this._budget})`);
        }

        this._persist();
    }

    /**
     * Get usage report
     * @returns {{ totalUsed, byModule, budgetRemaining, budgetPct, sessionDurationMs }}
     */
    getReport() {
        const byModule = {};
        for (const [mod, usage] of this._usage) {
            byModule[mod] = { ...usage };
        }

        return {
            totalUsed: this._totalUsed,
            budget: this._budget,
            budgetRemaining: Math.max(0, this._budget - this._totalUsed),
            budgetPct: this._budget > 0 ? Math.round((this._totalUsed / this._budget) * 100 * 10) / 10 : 0,
            byModule,
            sessionStart: new Date(this._sessionStart).toISOString(),
            sessionDurationMs: Date.now() - this._sessionStart,
            recordCount: this._records.length,
        };
    }

    /**
     * Check if budget is exceeded
     */
    isOverBudget() {
        return this._totalUsed >= this._budget;
    }

    /**
     * Reset daily counters
     */
    resetDaily() {
        this._usage.clear();
        this._totalUsed = 0;
        this._records = [];
        this._sessionStart = Date.now();
        this._persist();
    }

    // --- Internal ---

    _load() {
        try {
            if (fs.existsSync(this._dataFile)) {
                const raw = JSON.parse(fs.readFileSync(this._dataFile, 'utf-8'));
                // Only restore if same day
                if (raw.date === new Date().toISOString().substring(0, 10)) {
                    this._totalUsed = raw.totalUsed || 0;
                    if (raw.byModule) {
                        for (const [mod, usage] of Object.entries(raw.byModule)) {
                            this._usage.set(mod, usage);
                        }
                    }
                }
            }
        } catch (e) {
            // Fresh start
        }
    }

    _persist() {
        const report = this.getReport();
        report.date = new Date().toISOString().substring(0, 10);
        try {
            this._writer.markDirty(JSON.stringify(report, null, 2));
        } catch (e) {
            // Non-blocking
        }
    }
}

module.exports = TokenTracker;
