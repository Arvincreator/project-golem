// ============================================================
// MetapromptAgent — OpenAI MetapromptAgent + VersionedPrompt
// Self-improving prompt engineering with A/B testing
// Versions system prompts, tracks performance, auto-selects best
// ============================================================
const fs = require('fs');
const path = require('path');

const PROMPT_VERSIONS_FILE = 'golem_prompt_versions.json';
const MAX_VERSIONS = 30;
const MIN_SAMPLES_FOR_COMPARISON = 5;

class MetapromptAgent {
    constructor(options = {}) {
        this.brain = options.brain || null;
        this.golemId = (options.golemId || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
        this._file = path.join(process.cwd(), PROMPT_VERSIONS_FILE);
        this._versions = [];
        this._activeVersion = null;
        this._load();
    }

    /**
     * Register a new prompt version
     * @param {string} promptText - The system prompt content
     * @param {Object} metadata - Version metadata
     * @returns {PromptVersion}
     */
    register(promptText, metadata = {}) {
        const version = {
            id: `prompt_v${this._versions.length + 1}_${Date.now()}`,
            text: promptText,
            metadata: {
                ...metadata,
                createdAt: new Date().toISOString(),
                author: metadata.author || 'system',
            },
            metrics: {
                uses: 0,
                avgGrade: null,
                grades: [],
                avgLatency: null,
                latencies: [],
            },
            active: false,
        };

        this._versions.push(version);
        if (this._versions.length > MAX_VERSIONS) {
            // Remove lowest-performing non-active version
            const removable = this._versions
                .filter(v => !v.active && v.metrics.uses >= MIN_SAMPLES_FOR_COMPARISON)
                .sort((a, b) => (a.metrics.avgGrade || 0) - (b.metrics.avgGrade || 0));
            if (removable.length > 0) {
                this._versions = this._versions.filter(v => v.id !== removable[0].id);
            }
        }

        this._save();
        return version;
    }

    /**
     * Set the active prompt version
     */
    activate(versionId) {
        for (const v of this._versions) {
            v.active = v.id === versionId;
        }
        this._activeVersion = this._versions.find(v => v.active) || null;
        this._save();
        return this._activeVersion;
    }

    /**
     * Get the active prompt text
     */
    getActivePrompt() {
        if (this._activeVersion) return this._activeVersion.text;
        // Fallback to latest
        return this._versions.length > 0
            ? this._versions[this._versions.length - 1].text
            : null;
    }

    /**
     * Record performance metrics for the current active version
     */
    recordPerformance(grade, latencyMs) {
        const version = this._activeVersion || this._versions[this._versions.length - 1];
        if (!version) return;

        version.metrics.uses++;

        if (typeof grade === 'number') {
            version.metrics.grades.push(grade);
            if (version.metrics.grades.length > 100) version.metrics.grades.shift();
            version.metrics.avgGrade = Math.round(
                version.metrics.grades.reduce((s, g) => s + g, 0) / version.metrics.grades.length * 100
            ) / 100;
        }

        if (typeof latencyMs === 'number') {
            version.metrics.latencies.push(latencyMs);
            if (version.metrics.latencies.length > 100) version.metrics.latencies.shift();
            version.metrics.avgLatency = Math.round(
                version.metrics.latencies.reduce((s, l) => s + l, 0) / version.metrics.latencies.length
            );
        }

        this._save();
    }

    /**
     * A/B test: compare active version with a challenger
     * Returns recommendation based on statistical comparison
     */
    compareVersions(versionIdA, versionIdB) {
        const a = this._versions.find(v => v.id === versionIdA);
        const b = this._versions.find(v => v.id === versionIdB);
        if (!a || !b) return null;

        const aGrades = a.metrics.grades;
        const bGrades = b.metrics.grades;

        if (aGrades.length < MIN_SAMPLES_FOR_COMPARISON || bGrades.length < MIN_SAMPLES_FOR_COMPARISON) {
            return {
                result: 'insufficient_data',
                aUses: a.metrics.uses,
                bUses: b.metrics.uses,
                minRequired: MIN_SAMPLES_FOR_COMPARISON,
            };
        }

        const aMean = aGrades.reduce((s, g) => s + g, 0) / aGrades.length;
        const bMean = bGrades.reduce((s, g) => s + g, 0) / bGrades.length;
        const diff = bMean - aMean;

        return {
            result: diff > 0.2 ? 'b_better' : (diff < -0.2 ? 'a_better' : 'no_significant_difference'),
            aAvgGrade: Math.round(aMean * 100) / 100,
            bAvgGrade: Math.round(bMean * 100) / 100,
            difference: Math.round(diff * 100) / 100,
            aSamples: aGrades.length,
            bSamples: bGrades.length,
        };
    }

    /**
     * Auto-select: activate the best-performing version
     */
    autoSelect() {
        const eligible = this._versions.filter(v =>
            v.metrics.uses >= MIN_SAMPLES_FOR_COMPARISON && v.metrics.avgGrade !== null
        );
        if (eligible.length === 0) return null;

        eligible.sort((a, b) => (b.metrics.avgGrade || 0) - (a.metrics.avgGrade || 0));
        const best = eligible[0];

        if (!best.active) {
            this.activate(best.id);
            console.log(`[MetapromptAgent] Auto-selected ${best.id} (avg grade: ${best.metrics.avgGrade})`);
        }

        return best;
    }

    /**
     * Generate an improved prompt version using LLM metaprompting
     */
    async generateImprovedVersion() {
        if (!this.brain) return null;

        const current = this.getActivePrompt();
        if (!current) return null;

        // Gather performance insights
        const recentGrades = this._activeVersion?.metrics.grades.slice(-10) || [];
        const avgGrade = recentGrades.length > 0
            ? recentGrades.reduce((s, g) => s + g, 0) / recentGrades.length
            : 'N/A';

        const prompt = `You are a prompt engineer. The current system prompt scores ${avgGrade}/4.0.

Current prompt (first 500 chars):
${current.substring(0, 500)}

Generate an improved version that:
1. Maintains the same role and capabilities
2. Improves clarity and specificity
3. Adds better output formatting guidelines

Reply with ONLY the improved prompt text (no explanations).`;

        try {
            const improved = await this.brain.sendMessage(prompt, true);
            if (improved && typeof improved === 'string' && improved.length > 50) {
                return this.register(improved, {
                    author: 'metaprompt_agent',
                    parentVersion: this._activeVersion?.id,
                    generationMethod: 'llm_improvement',
                });
            }
        } catch (e) {
            console.warn('[MetapromptAgent] Generation failed:', e.message);
        }
        return null;
    }

    /**
     * List all versions with metrics
     */
    listVersions() {
        return this._versions.map(v => ({
            id: v.id,
            active: v.active,
            uses: v.metrics.uses,
            avgGrade: v.metrics.avgGrade,
            avgLatency: v.metrics.avgLatency,
            createdAt: v.metadata.createdAt,
            author: v.metadata.author,
            textPreview: v.text.substring(0, 100),
        }));
    }

    /**
     * Get stats
     */
    getStats() {
        return {
            totalVersions: this._versions.length,
            activeVersion: this._activeVersion?.id || null,
            activeAvgGrade: this._activeVersion?.metrics.avgGrade || null,
            totalUses: this._versions.reduce((s, v) => s + v.metrics.uses, 0),
        };
    }

    // --- Persistence ---
    _load() {
        try {
            if (fs.existsSync(this._file)) {
                const data = JSON.parse(fs.readFileSync(this._file, 'utf-8'));
                this._versions = data.versions || [];
                this._activeVersion = this._versions.find(v => v.active) || null;
            }
        } catch (e) { /* fresh start */ }
    }

    _save() {
        try {
            fs.writeFileSync(this._file, JSON.stringify({ versions: this._versions }, null, 2));
        } catch (e) { console.warn('[MetapromptAgent] Save failed:', e.message); }
    }
}

module.exports = MetapromptAgent;
