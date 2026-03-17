// ============================================================
// TipMemory — Persistent tip storage + Jaccard keyword retrieval
// Trajectory-Informed Memory (arXiv 2603.10600) + Mem0 pattern
// ============================================================
const fs = require('fs');
const path = require('path');

const TIP_FILE = 'golem_tip_memory.json';
const MAX_TIPS = 200;

class TipMemory {
    constructor(options = {}) {
        this.golemId = (options.golemId || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
        this._file = path.join(process.cwd(), TIP_FILE);
        this._tips = [];
        this._writer = null;
        this._load();
    }

    /**
     * Store a tip in memory
     * @param {Object} tip - { id, type, content, confidence, source, context }
     * @returns {Object} stored tip with outcomes tracking
     */
    store(tip) {
        if (!tip || !tip.content) return null;

        const entry = {
            id: tip.id || `tip_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            type: tip.type || 'strategy',
            content: tip.content,
            confidence: tip.confidence || 0.5,
            source: tip.source || 'unknown',
            context: tip.context || {},
            outcomes: { success: 0, failure: 0 },
            createdAt: tip.createdAt || Date.now(),
            lastUsed: null,
            useCount: 0,
        };

        // Check for duplicates (Jaccard > 0.6)
        const isDuplicate = this._tips.some(existing => {
            const sim = this._jaccardSimilarity(
                this._extractKeywords(existing.content),
                this._extractKeywords(entry.content)
            );
            return sim > 0.6;
        });

        if (isDuplicate) return null;

        this._tips.push(entry);
        if (this._tips.length > MAX_TIPS) {
            // Evict lowest-scored tip
            this._tips.sort((a, b) => this._tipScore(b) - this._tipScore(a));
            this._tips = this._tips.slice(0, MAX_TIPS);
        }

        this._save();
        return entry;
    }

    /**
     * Retrieve tips relevant to a situation using Jaccard keyword matching
     * @param {string} situation - Current situation description
     * @param {number} limit - Max tips to return
     * @returns {Array} Ranked tips
     */
    retrieve(situation, limit = 3) {
        if (!situation || this._tips.length === 0) return [];

        const sitKeywords = this._extractKeywords(situation);
        if (sitKeywords.length === 0) return this._tips.slice(0, limit);

        const scored = this._tips.map(tip => {
            const tipKeywords = this._extractKeywords(tip.content);
            const contextKeywords = this._extractKeywords(
                JSON.stringify(tip.context || {})
            );
            const allTipKeywords = [...new Set([...tipKeywords, ...contextKeywords])];

            const similarity = this._jaccardSimilarity(sitKeywords, allTipKeywords);
            const effectivenessScore = this._tipScore(tip);
            const combined = similarity * 0.6 + effectivenessScore * 0.4;

            return { ...tip, _score: combined, _similarity: similarity };
        });

        scored.sort((a, b) => b._score - a._score);

        return scored
            .filter(t => t._similarity > 0.05) // minimum relevance
            .slice(0, limit)
            .map(({ _score, _similarity, ...tip }) => tip);
    }

    /**
     * Record outcome of a tip application
     * @param {string} tipId - Tip ID
     * @param {boolean} success - Whether the tip helped
     */
    recordOutcome(tipId, success) {
        const tip = this._tips.find(t => t.id === tipId);
        if (!tip) return false;

        if (success) {
            tip.outcomes.success++;
        } else {
            tip.outcomes.failure++;
        }
        tip.lastUsed = Date.now();
        tip.useCount++;

        // Update confidence based on outcomes
        const total = tip.outcomes.success + tip.outcomes.failure;
        if (total >= 3) {
            const rate = tip.outcomes.success / total;
            tip.confidence = tip.confidence * 0.7 + rate * 0.3;
        }

        this._save();
        return true;
    }

    /**
     * Get top-performing tips across all types
     * @param {number} limit
     * @returns {Array}
     */
    getTopTips(limit = 10) {
        return [...this._tips]
            .sort((a, b) => this._tipScore(b) - this._tipScore(a))
            .slice(0, limit);
    }

    /**
     * Get stats
     */
    getStats() {
        const byType = {};
        for (const tip of this._tips) {
            byType[tip.type] = (byType[tip.type] || 0) + 1;
        }
        return {
            totalTips: this._tips.length,
            byType,
            maxTips: MAX_TIPS,
        };
    }

    /**
     * v11.5: Get effectiveness statistics across all tips
     */
    getEffectivenessStats() {
        let totalSuccess = 0;
        let totalFailure = 0;
        let totalConfidence = 0;
        let usedTips = 0;

        for (const tip of this._tips) {
            totalSuccess += tip.outcomes?.success || 0;
            totalFailure += tip.outcomes?.failure || 0;
            totalConfidence += tip.confidence || 0;
            if (tip.useCount > 0) usedTips++;
        }

        const totalOutcomes = totalSuccess + totalFailure;
        return {
            totalTips: this._tips.length,
            usedTips,
            successRate: totalOutcomes > 0 ? totalSuccess / totalOutcomes : 0,
            avgConfidence: this._tips.length > 0 ? totalConfidence / this._tips.length : 0,
            totalOutcomes,
        };
    }

    // --- Internal ---

    _tipScore(tip) {
        let score = tip.confidence || 0.5;
        const total = (tip.outcomes?.success || 0) + (tip.outcomes?.failure || 0);
        if (total > 0) {
            const rate = tip.outcomes.success / total;
            score = score * 0.6 + rate * 0.4;
        }
        // Recency bonus (decay over 24h)
        const age = Date.now() - (tip.createdAt || 0);
        const recencyBonus = Math.max(0, 1 - age / (24 * 60 * 60 * 1000)) * 0.1;
        return Math.min(1, score + recencyBonus);
    }

    _extractKeywords(text) {
        if (!text) return [];
        return text.toLowerCase()
            .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2);
    }

    _jaccardSimilarity(setA, setB) {
        if (setA.length === 0 && setB.length === 0) return 1;
        const a = new Set(setA);
        const b = new Set(setB);
        const intersection = [...a].filter(x => b.has(x)).length;
        const union = new Set([...a, ...b]).size;
        return union === 0 ? 0 : intersection / union;
    }

    // --- Persistence ---

    _load() {
        try {
            if (fs.existsSync(this._file)) {
                const raw = fs.readFileSync(this._file, 'utf-8');
                const data = JSON.parse(raw);
                this._tips = Array.isArray(data.tips) ? data.tips : (Array.isArray(data) ? data : []);
            }
        } catch (e) {
            // v11.3: Auto-repair corrupted JSON
            const repaired = this._tryRepairJSON();
            if (repaired !== null) this._tips = repaired;
        }
    }

    /**
     * v11.3: Attempt to repair corrupted tip JSON file
     */
    _tryRepairJSON() {
        try {
            const raw = fs.readFileSync(this._file, 'utf-8').trim();

            // Try extracting "tips" array from partial JSON
            const match = raw.match(/"tips"\s*:\s*(\[[\s\S]*?\])/);
            if (match) {
                try {
                    const tips = JSON.parse(match[1]);
                    if (Array.isArray(tips)) {
                        this._tips = tips;
                        this._save(); // write back clean
                        console.log(`[TipMemory] Auto-repaired: recovered ${tips.length} tips`);
                        return tips;
                    }
                } catch { /* try next strategy */ }
            }

            // Try parsing as bare array
            let depth = 0, end = 0;
            const start = raw.indexOf('[');
            if (start >= 0) {
                for (let i = start; i < raw.length; i++) {
                    if (raw[i] === '[') depth++;
                    else if (raw[i] === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
                }
                if (end > start) {
                    const arr = JSON.parse(raw.substring(start, end));
                    if (Array.isArray(arr)) {
                        fs.writeFileSync(this._file, JSON.stringify({ tips: arr }, null, 2));
                        console.log(`[TipMemory] Auto-repaired (array strategy): recovered ${arr.length} tips`);
                        return arr;
                    }
                }
            }
        } catch (e2) {
            console.warn('[TipMemory] Auto-repair failed:', e2.message);
        }
        // Last resort: backup + fresh
        try {
            const backup = this._file + '.corrupted.' + Date.now();
            fs.copyFileSync(this._file, backup);
            fs.writeFileSync(this._file, JSON.stringify({ tips: [] }));
            console.warn(`[TipMemory] Unrecoverable — backed up to ${backup}, starting fresh`);
        } catch { /* nothing */ }
        return [];
    }

    _save() {
        try {
            const data = JSON.stringify({ tips: this._tips }, null, 2);
            if (this._writer) {
                this._writer.markDirty(data);
            } else {
                try {
                    const DebouncedWriter = require('../utils/DebouncedWriter');
                    this._writer = new DebouncedWriter(this._file, 2000);
                    this._writer.markDirty(data);
                } catch (e) {
                    fs.writeFileSync(this._file, data);
                }
            }
        } catch (e) {
            console.warn('[TipMemory] Save failed:', e.message);
        }
    }
}

module.exports = TipMemory;
