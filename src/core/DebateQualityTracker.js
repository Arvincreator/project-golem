// ============================================================
// DebateQualityTracker — 辯論品質 A/B 測試
// v11.5: 評分辯論品質, A/B 比較 heuristic vs RAG-augmented
// ============================================================

const path = require('path');
const fs = require('fs');
const DebouncedWriter = require('../utils/DebouncedWriter');

const MAX_HISTORY = 100;
const DATA_FILE = 'debate_quality_history.json';

class DebateQualityTracker {
    constructor(options = {}) {
        this._dataDir = options.dataDir || path.resolve(process.cwd(), 'data');
        this._filePath = path.join(this._dataDir, DATA_FILE);
        this._history = [];
        this._writer = new DebouncedWriter(this._filePath, 3000);
        this._load();
    }

    /**
     * Score a debate result
     * @param {Object} debateResult - From CouncilDebate.debate()
     * @returns {Object} { keywordDiversity, perspectiveDifferentiation, synthesisCoverage, overall }
     */
    scoreDebate(debateResult) {
        if (!debateResult || !debateResult.perspectives) {
            return { keywordDiversity: 0, perspectiveDifferentiation: 0, synthesisCoverage: 0, overall: 0 };
        }

        const perspectives = debateResult.perspectives;

        // 1. Keyword diversity: unique keywords across all perspectives
        const allKeywords = new Set();
        const perspectiveKeywordSets = [];
        for (const p of perspectives) {
            const kws = this._extractKeywords(p.analysis || '');
            perspectiveKeywordSets.push(new Set(kws));
            kws.forEach(kw => allKeywords.add(kw));
        }
        // Normalize by expected range (good debates have 30-100 unique keywords)
        const keywordDiversity = Math.min(1, allKeywords.size / 80);

        // 2. Perspective differentiation: avg pairwise Jaccard distance
        let totalJaccard = 0;
        let pairCount = 0;
        for (let i = 0; i < perspectiveKeywordSets.length; i++) {
            for (let j = i + 1; j < perspectiveKeywordSets.length; j++) {
                const sim = this._jaccardSimilarity(perspectiveKeywordSets[i], perspectiveKeywordSets[j]);
                totalJaccard += (1 - sim); // distance = 1 - similarity
                pairCount++;
            }
        }
        const perspectiveDifferentiation = pairCount > 0 ? totalJaccard / pairCount : 0;

        // 3. Synthesis coverage: what fraction of perspective keywords appear in synthesis
        const synthesisText = debateResult.synthesis?.consensus || '';
        const synthesisKws = new Set(this._extractKeywords(synthesisText));
        let covered = 0;
        for (const kw of allKeywords) {
            if (synthesisKws.has(kw)) covered++;
        }
        const synthesisCoverage = allKeywords.size > 0 ? covered / allKeywords.size : 0;

        // Overall score: weighted average
        const overall = keywordDiversity * 0.3 + perspectiveDifferentiation * 0.4 + synthesisCoverage * 0.3;

        const score = {
            keywordDiversity: Math.round(keywordDiversity * 100) / 100,
            perspectiveDifferentiation: Math.round(perspectiveDifferentiation * 100) / 100,
            synthesisCoverage: Math.round(synthesisCoverage * 100) / 100,
            overall: Math.round(overall * 100) / 100,
            mode: debateResult.mode || 'unknown',
            perspectiveCount: perspectives.length,
            totalKeywords: allKeywords.size,
            timestamp: new Date().toISOString(),
        };

        // Record in history
        this._history.push(score);
        if (this._history.length > MAX_HISTORY) {
            this._history = this._history.slice(-MAX_HISTORY);
        }
        this._save();

        return score;
    }

    /**
     * Compare two debate results (A/B testing)
     * @param {Object} debateA - First debate result
     * @param {Object} debateB - Second debate result
     * @returns {Object} { scoreA, scoreB, winner, delta }
     */
    compare(debateA, debateB) {
        const scoreA = this.scoreDebate(debateA);
        const scoreB = this.scoreDebate(debateB);

        return {
            scoreA,
            scoreB,
            winner: scoreA.overall > scoreB.overall ? 'A' : scoreB.overall > scoreA.overall ? 'B' : 'tie',
            delta: {
                keywordDiversity: Math.round((scoreB.keywordDiversity - scoreA.keywordDiversity) * 100) / 100,
                perspectiveDifferentiation: Math.round((scoreB.perspectiveDifferentiation - scoreA.perspectiveDifferentiation) * 100) / 100,
                synthesisCoverage: Math.round((scoreB.synthesisCoverage - scoreA.synthesisCoverage) * 100) / 100,
                overall: Math.round((scoreB.overall - scoreA.overall) * 100) / 100,
            },
        };
    }

    /**
     * Get history of scored debates
     */
    getHistory() {
        return [...this._history];
    }

    /**
     * Get aggregate stats
     */
    getStats() {
        if (this._history.length === 0) {
            return { totalDebates: 0, avgOverall: 0, byMode: {} };
        }

        const byMode = {};
        for (const s of this._history) {
            const mode = s.mode || 'unknown';
            if (!byMode[mode]) byMode[mode] = { count: 0, totalOverall: 0 };
            byMode[mode].count++;
            byMode[mode].totalOverall += s.overall;
        }

        for (const mode of Object.keys(byMode)) {
            byMode[mode].avgOverall = Math.round((byMode[mode].totalOverall / byMode[mode].count) * 100) / 100;
        }

        return {
            totalDebates: this._history.length,
            avgOverall: Math.round((this._history.reduce((sum, s) => sum + s.overall, 0) / this._history.length) * 100) / 100,
            byMode,
        };
    }

    // --- Internal ---

    _extractKeywords(text) {
        if (!text) return [];
        return text.toLowerCase()
            .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3);
    }

    _jaccardSimilarity(setA, setB) {
        if (setA.size === 0 && setB.size === 0) return 1;
        const intersection = [...setA].filter(x => setB.has(x)).length;
        const union = new Set([...setA, ...setB]).size;
        return union === 0 ? 0 : intersection / union;
    }

    _load() {
        try {
            if (fs.existsSync(this._filePath)) {
                const raw = fs.readFileSync(this._filePath, 'utf-8');
                const data = JSON.parse(raw);
                if (Array.isArray(data)) {
                    this._history = data.slice(-MAX_HISTORY);
                }
            }
        } catch (e) {
            console.warn('[DebateQualityTracker] Load failed:', e.message);
            this._history = [];
        }
    }

    _save() {
        try {
            this._writer.markDirty(JSON.stringify(this._history, null, 2));
        } catch (e) {
            console.warn('[DebateQualityTracker] Save failed:', e.message);
        }
    }
}

module.exports = DebateQualityTracker;
