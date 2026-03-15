// ============================================================
// Self-Evolution Engine (Agent Zero inspired)
// Strategy tracking + Skill synthesis
// ============================================================
const fs = require('fs');
const path = require('path');

class SelfEvolution {
    constructor(options = {}) {
        this.golemId = options.golemId || 'default';
        this._strategyFile = path.join(process.cwd(), 'golem_strategies.json');
        this._strategies = this._load();
        this._actionSequences = []; // Track repeated patterns for skill synthesis
    }

    // --- Strategy Evolver ---
    recordAction(actionType, success) {
        if (!this._strategies[actionType]) {
            this._strategies[actionType] = { total: 0, success: 0, level: 'L1' };
        }
        const s = this._strategies[actionType];
        s.total++;
        if (success) s.success++;

        // Auto-adjust level based on success rate
        const rate = s.total >= 3 ? s.success / s.total : 0.5;
        if (rate < 0.5 && s.total >= 5) {
            if (s.level === 'L0') s.level = 'L1';
            else if (s.level === 'L1') s.level = 'L2';
            console.log(`[SelfEvolution] ${actionType} promoted to ${s.level} (success rate: ${(rate * 100).toFixed(0)}%)`);
        } else if (rate > 0.9 && s.total >= 10) {
            if (s.level === 'L2') s.level = 'L1';
            else if (s.level === 'L1') s.level = 'L0';
            console.log(`[SelfEvolution] ${actionType} demoted to ${s.level} (success rate: ${(rate * 100).toFixed(0)}%)`);
        }

        this._save();
    }

    getRecommendedLevel(actionType) {
        const s = this._strategies[actionType];
        return s ? s.level : 'L1'; // Default L1
    }

    getSuccessRate(actionType) {
        const s = this._strategies[actionType];
        if (!s || s.total === 0) return null;
        return s.success / s.total;
    }

    // --- Skill Synthesizer ---
    trackSequence(steps) {
        if (!Array.isArray(steps) || steps.length < 2) return;
        const key = steps.map(s => s.action || s).join('→');
        this._actionSequences.push({ key, steps, time: Date.now() });

        // Keep last 100
        if (this._actionSequences.length > 100) this._actionSequences.shift();

        // Check for recurring patterns (3+ occurrences of same sequence)
        const counts = {};
        for (const seq of this._actionSequences) {
            counts[seq.key] = (counts[seq.key] || 0) + 1;
        }

        for (const [key, count] of Object.entries(counts)) {
            if (count >= 3) {
                return {
                    suggestSkill: true,
                    pattern: key,
                    occurrences: count,
                    steps: this._actionSequences.find(s => s.key === key)?.steps
                };
            }
        }
        return null;
    }

    // --- Integration point ---
    afterAction(action, outcome, success) {
        const actionType = `${action?.action || 'unknown'}:${action?.task || ''}`;
        this.recordAction(actionType, success);

        // Track sequences
        if (action?.steps) {
            return this.trackSequence(action.steps);
        }
        return null;
    }

    // --- Persistence ---
    _load() {
        try {
            if (fs.existsSync(this._strategyFile)) {
                return JSON.parse(fs.readFileSync(this._strategyFile, 'utf-8'));
            }
        } catch (e) { console.warn('[SelfEvolution] Failed to load strategies:', e.message); }
        return {};
    }

    _save() {
        try {
            fs.writeFileSync(this._strategyFile, JSON.stringify(this._strategies, null, 2));
        } catch (e) { console.warn('[SelfEvolution] Failed to save strategies:', e.message); }
    }

    getStats() {
        const entries = Object.entries(this._strategies);
        return {
            totalStrategies: entries.length,
            avgSuccessRate: entries.length > 0
                ? (entries.reduce((sum, [, s]) => sum + (s.total > 0 ? s.success / s.total : 0), 0) / entries.length * 100).toFixed(1) + '%'
                : 'N/A',
            sequencesTracked: this._actionSequences.length
        };
    }
}

module.exports = SelfEvolution;
