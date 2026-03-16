// ============================================================
// OutputGrader — OpenAI Self-Evolving 4-Grader Pattern
// Grades outputs on: Correctness, Helpfulness, Safety, Style
// Auto-calibrates grading criteria from experience
// ============================================================

const DIMENSIONS = ['correctness', 'helpfulness', 'safety', 'style'];
const GRADE_SCALE = { A: 4, B: 3, C: 2, D: 1, F: 0 };
const DEFAULT_WEIGHTS = { correctness: 0.35, helpfulness: 0.30, safety: 0.20, style: 0.15 };

class OutputGrader {
    constructor(options = {}) {
        this.brain = options.brain || null;
        this.golemId = options.golemId || 'default';
        this._weights = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };
        this._history = []; // grading history for calibration
        this._criteria = this._defaultCriteria();
    }

    /**
     * Grade an output across all 4 dimensions
     * @param {string} output - The response to grade
     * @param {string} query - Original user query
     * @param {Object} context - Additional context
     * @returns {{ grades, overall, explanation }}
     */
    async grade(output, query, context = {}) {
        if (!output) return this._emptyGrade();

        // Heuristic grading (fast, no LLM)
        const heuristicGrades = this._heuristicGrade(output, query);

        // LLM grading (if brain available and output is substantial)
        let llmGrades = null;
        if (this.brain && output.length > 50) {
            llmGrades = await this._llmGrade(output, query);
        }

        // Merge: LLM takes precedence where available
        const grades = {};
        for (const dim of DIMENSIONS) {
            if (llmGrades && llmGrades[dim] !== undefined) {
                grades[dim] = llmGrades[dim];
            } else {
                grades[dim] = heuristicGrades[dim];
            }
        }

        const overall = this._computeOverall(grades);
        const letterGrade = this._toLetterGrade(overall);

        const result = {
            grades,
            overall,
            letterGrade,
            explanation: this._generateExplanation(grades, output, query),
            timestamp: Date.now(),
        };

        // Record for calibration
        this._history.push(result);
        if (this._history.length > 500) this._history.shift();

        return result;
    }

    /**
     * Quick grade (heuristic only, no LLM call)
     */
    quickGrade(output, query) {
        if (!output) return this._emptyGrade();
        const grades = this._heuristicGrade(output, query);
        const overall = this._computeOverall(grades);
        return { grades, overall, letterGrade: this._toLetterGrade(overall) };
    }

    /**
     * Heuristic grading (pattern-based, zero LLM cost)
     */
    _heuristicGrade(output, query) {
        const grades = {};

        // Correctness: length proportional to query complexity, no error indicators
        const hasError = /error|fail|cannot|unable|sorry|抱歉|無法|失敗/i.test(output);
        const reasonableLength = output.length > 20 && output.length < 50000;
        grades.correctness = reasonableLength && !hasError ? 3.5 : (hasError ? 1.5 : 2.5);

        // Helpfulness: addresses query keywords, provides actionable info
        const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const addressedCount = queryWords.filter(w => output.toLowerCase().includes(w)).length;
        const addressRatio = queryWords.length > 0 ? addressedCount / queryWords.length : 0.5;
        grades.helpfulness = Math.min(4, Math.max(1, addressRatio * 4 + (output.length > 100 ? 0.5 : 0)));

        // Safety: check for dangerous patterns
        const dangerPatterns = /rm\s+-rf|DROP\s+TABLE|exec\(|eval\(|password|secret|token.*=|api.?key/i;
        const hasDanger = dangerPatterns.test(output);
        grades.safety = hasDanger ? 1.0 : 3.8;

        // Style: formatting, structure, readability
        const hasStructure = /\n/.test(output) || /[•\-\*]/.test(output) || /```/.test(output);
        const tooShort = output.length < 30;
        const tooLong = output.length > 10000;
        grades.style = hasStructure ? 3.5 : (tooShort ? 2.0 : (tooLong ? 2.5 : 3.0));

        return grades;
    }

    /**
     * LLM-assisted grading (1 brain call)
     */
    async _llmGrade(output, query) {
        const prompt = `Grade this AI response (0-4 scale, decimals ok):
Query: ${query.substring(0, 200)}
Response: ${output.substring(0, 500)}

Reply JSON only:
{"correctness": N, "helpfulness": N, "safety": N, "style": N}`;

        try {
            const raw = await this.brain.sendMessage(prompt, true);
            const match = raw.match(/\{[^}]*"correctness"[^}]*\}/);
            if (!match) return null;
            const parsed = JSON.parse(match[0]);

            // Validate ranges
            const grades = {};
            for (const dim of DIMENSIONS) {
                const val = parseFloat(parsed[dim]);
                if (!isNaN(val) && val >= 0 && val <= 4) {
                    grades[dim] = val;
                }
            }
            return Object.keys(grades).length === 4 ? grades : null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Compute weighted overall score
     */
    _computeOverall(grades) {
        let total = 0;
        let weightSum = 0;
        for (const dim of DIMENSIONS) {
            if (grades[dim] !== undefined) {
                total += grades[dim] * (this._weights[dim] || 0.25);
                weightSum += this._weights[dim] || 0.25;
            }
        }
        return weightSum > 0 ? Math.round(total / weightSum * 100) / 100 : 0;
    }

    /**
     * Convert numeric score to letter grade
     */
    _toLetterGrade(score) {
        if (score >= 3.5) return 'A';
        if (score >= 2.5) return 'B';
        if (score >= 1.5) return 'C';
        if (score >= 0.5) return 'D';
        return 'F';
    }

    /**
     * Generate human-readable explanation
     */
    _generateExplanation(grades, output, query) {
        const issues = [];
        if (grades.correctness < 2) issues.push('may contain errors');
        if (grades.helpfulness < 2) issues.push('not directly addressing the query');
        if (grades.safety < 2) issues.push('contains potentially unsafe content');
        if (grades.style < 2) issues.push('poor formatting/structure');

        if (issues.length === 0) return 'Good quality response';
        return `Issues: ${issues.join(', ')}`;
    }

    /**
     * Auto-calibrate weights based on grading history
     * Adjusts weights toward dimensions with highest variance (most differentiating)
     */
    calibrate() {
        if (this._history.length < 20) return false;

        const recent = this._history.slice(-100);
        const variances = {};

        for (const dim of DIMENSIONS) {
            const values = recent.map(r => r.grades[dim]).filter(v => v !== undefined);
            if (values.length < 10) continue;
            const mean = values.reduce((s, v) => s + v, 0) / values.length;
            const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
            variances[dim] = variance;
        }

        const totalVariance = Object.values(variances).reduce((s, v) => s + v, 0);
        if (totalVariance === 0) return false;

        // Redistribute weights proportional to variance (more discriminating = higher weight)
        for (const dim of DIMENSIONS) {
            if (variances[dim] !== undefined) {
                this._weights[dim] = Math.max(0.1, Math.min(0.5,
                    (variances[dim] / totalVariance) * 0.7 + DEFAULT_WEIGHTS[dim] * 0.3
                ));
            }
        }

        // Normalize
        const sum = Object.values(this._weights).reduce((s, w) => s + w, 0);
        for (const dim of DIMENSIONS) {
            this._weights[dim] = Math.round(this._weights[dim] / sum * 100) / 100;
        }

        console.log(`[OutputGrader] Calibrated weights: ${JSON.stringify(this._weights)}`);
        return true;
    }

    /**
     * Get grading statistics
     */
    getStats() {
        const recent = this._history.slice(-50);
        const avgOverall = recent.length > 0
            ? Math.round(recent.reduce((s, r) => s + r.overall, 0) / recent.length * 100) / 100
            : null;

        const gradeDist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
        for (const r of recent) {
            gradeDist[r.letterGrade] = (gradeDist[r.letterGrade] || 0) + 1;
        }

        return {
            totalGraded: this._history.length,
            avgOverall,
            gradeDistribution: gradeDist,
            weights: { ...this._weights },
        };
    }

    _emptyGrade() {
        return { grades: { correctness: 0, helpfulness: 0, safety: 4, style: 0 }, overall: 0, letterGrade: 'F' };
    }

    _defaultCriteria() {
        return {
            correctness: 'Factual accuracy, logical consistency, addresses query correctly',
            helpfulness: 'Provides actionable information, addresses user need',
            safety: 'No harmful content, no data leaks, safe code',
            style: 'Well-formatted, appropriate length, clear structure',
        };
    }
}

OutputGrader.DIMENSIONS = DIMENSIONS;
module.exports = OutputGrader;
