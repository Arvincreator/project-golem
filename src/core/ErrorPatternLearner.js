// ============================================================
// ErrorPatternLearner — 錯誤模式學習器
// v11.5: 記錄錯誤+解法, 查重複, 建議修復 — 不犯第二次
// ============================================================

const path = require('path');
const fs = require('fs');
const DebouncedWriter = require('../utils/DebouncedWriter');

const MAX_PATTERNS = 200;
const DATA_FILE = 'error_patterns.json';

class ErrorPatternLearner {
    constructor(options = {}) {
        this._dataDir = options.dataDir || path.resolve(process.cwd(), 'data');
        this._filePath = path.join(this._dataDir, DATA_FILE);
        this._patterns = [];
        this._writer = new DebouncedWriter(this._filePath, 3000);
        this._load();
    }

    /**
     * Record an error and its resolution
     * @param {string} context - Where the error occurred (module/function)
     * @param {Error|string} error - The error
     * @param {string} resolution - How it was fixed
     * @returns {Object} The recorded pattern
     */
    recordError(context, error, resolution) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorKey = this._makeKey(context, errorMsg);

        // Check if we already have this pattern
        const existing = this._patterns.find(p => p.key === errorKey);
        if (existing) {
            existing.occurrences++;
            existing.lastSeen = Date.now();
            if (resolution) existing.resolution = resolution;
            this._save();
            return existing;
        }

        const pattern = {
            key: errorKey,
            context: String(context),
            error: errorMsg,
            resolution: resolution || '',
            occurrences: 1,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
        };

        this._patterns.push(pattern);

        // Cap size
        if (this._patterns.length > MAX_PATTERNS) {
            // Remove oldest, least-occurred patterns
            this._patterns.sort((a, b) => b.occurrences - a.occurrences || b.lastSeen - a.lastSeen);
            this._patterns = this._patterns.slice(0, MAX_PATTERNS);
        }

        this._save();
        return pattern;
    }

    /**
     * Check if we've seen this error before
     * @param {string} context
     * @param {Error|string} error
     * @returns {boolean}
     */
    hasSeenBefore(context, error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const key = this._makeKey(context, errorMsg);
        return this._patterns.some(p => p.key === key);
    }

    /**
     * Get suggested fix for a known error
     * @param {string} context
     * @param {Error|string} error
     * @returns {string|null} resolution or null
     */
    getSuggestedFix(context, error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const key = this._makeKey(context, errorMsg);
        const pattern = this._patterns.find(p => p.key === key);
        return pattern?.resolution || null;
    }

    /**
     * Get all recorded patterns
     * @returns {Array}
     */
    getPatterns() {
        return [...this._patterns];
    }

    /**
     * Get stats
     */
    getStats() {
        return {
            totalPatterns: this._patterns.length,
            maxPatterns: MAX_PATTERNS,
            totalOccurrences: this._patterns.reduce((sum, p) => sum + p.occurrences, 0),
            topErrors: this._patterns
                .sort((a, b) => b.occurrences - a.occurrences)
                .slice(0, 5)
                .map(p => ({ context: p.context, error: p.error.substring(0, 80), occurrences: p.occurrences })),
        };
    }

    /**
     * Clear all patterns
     */
    clear() {
        this._patterns = [];
        this._save();
    }

    // --- Internal ---

    _makeKey(context, errorMsg) {
        // Normalize: strip numbers/timestamps for better matching
        const normalizedError = errorMsg
            .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z]+/g, '<timestamp>')
            .replace(/\d+/g, '<N>')
            .substring(0, 200);
        return `${context}::${normalizedError}`;
    }

    _load() {
        try {
            if (fs.existsSync(this._filePath)) {
                const raw = fs.readFileSync(this._filePath, 'utf-8');
                const data = JSON.parse(raw);
                if (Array.isArray(data)) {
                    this._patterns = data.slice(-MAX_PATTERNS);
                } else if (Array.isArray(data.patterns)) {
                    this._patterns = data.patterns.slice(-MAX_PATTERNS);
                }
            }
        } catch (e) {
            console.warn('[ErrorPatternLearner] Load failed:', e.message);
            this._patterns = [];
        }
    }

    _save() {
        try {
            this._writer.markDirty(JSON.stringify(this._patterns, null, 2));
        } catch (e) {
            console.warn('[ErrorPatternLearner] Save failed:', e.message);
        }
    }
}

module.exports = ErrorPatternLearner;
