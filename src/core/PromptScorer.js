// ============================================================
// PromptScorer — PEEM 9-Axis Prompt Evaluation Engine
// Scores prompts on 9 dimensions: clarity, accuracy, coherence,
// relevance, completeness, conciseness, safety, creativity, actionability
// Auto-calibrates weights from scoring history
// ============================================================

const DIMENSIONS = ['clarity', 'accuracy', 'coherence', 'relevance', 'completeness', 'conciseness', 'safety', 'creativity', 'actionability'];
const DEFAULT_WEIGHTS = {
    clarity: 0.15, accuracy: 0.15, relevance: 0.15,
    coherence: 0.10, completeness: 0.10, conciseness: 0.10,
    safety: 0.10, actionability: 0.10, creativity: 0.05
};

class PromptScorer {
    constructor(options = {}) {
        this.brain = options.brain || null;
        this._weights = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };
        this._history = [];
    }

    /**
     * Full score: heuristic + LLM hybrid (1 brain call)
     */
    async score(prompt, intent) {
        if (!prompt) return this._emptyScore();

        const heuristic = this._heuristicScore(prompt, intent || '');
        let llm = null;

        if (this.brain && prompt.length > 20) {
            llm = await this._llmScore(prompt, intent || '');
        }

        const scores = {};
        for (const dim of DIMENSIONS) {
            scores[dim] = (llm && llm[dim] !== undefined) ? llm[dim] : heuristic[dim];
        }

        const overall = this._computeOverall(scores);
        const result = {
            scores,
            overall,
            explanation: this._generateExplanation(scores),
            timestamp: Date.now(),
        };

        this._history.push(result);
        if (this._history.length > 500) this._history.shift();

        return result;
    }

    /**
     * Quick score: heuristic only, 0 LLM calls
     */
    quickScore(prompt, intent) {
        if (!prompt) return this._emptyScore();
        const scores = this._heuristicScore(prompt, intent || '');
        const overall = this._computeOverall(scores);
        return { scores, overall };
    }

    /**
     * Compare two prompts
     */
    async compare(a, b, intent) {
        const scoreA = this.brain ? await this.score(a, intent) : this.quickScore(a, intent);
        const scoreB = this.brain ? await this.score(b, intent) : this.quickScore(b, intent);
        return {
            winner: scoreA.overall >= scoreB.overall ? 'a' : 'b',
            scores_a: scoreA,
            scores_b: scoreB,
        };
    }

    /**
     * Auto-calibrate weights based on variance (≥20 history)
     */
    calibrate() {
        if (this._history.length < 20) return false;

        const recent = this._history.slice(-100);
        const variances = {};

        for (const dim of DIMENSIONS) {
            const values = recent.map(r => r.scores[dim]).filter(v => v !== undefined);
            if (values.length < 10) continue;
            const mean = values.reduce((s, v) => s + v, 0) / values.length;
            const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
            variances[dim] = variance;
        }

        const totalVariance = Object.values(variances).reduce((s, v) => s + v, 0);
        if (totalVariance === 0) return false;

        for (const dim of DIMENSIONS) {
            if (variances[dim] !== undefined) {
                this._weights[dim] = Math.max(0.05, Math.min(0.30,
                    (variances[dim] / totalVariance) * 0.7 + DEFAULT_WEIGHTS[dim] * 0.3
                ));
            }
        }

        // Normalize
        const sum = Object.values(this._weights).reduce((s, w) => s + w, 0);
        for (const dim of DIMENSIONS) {
            this._weights[dim] = Math.round(this._weights[dim] / sum * 100) / 100;
        }

        return true;
    }

    // ─── Heuristic scoring (9 axes) ───

    _heuristicScore(prompt, intent) {
        const scores = {};
        const lower = prompt.toLowerCase();
        const intentLower = (intent || '').toLowerCase();
        const intentWords = intentLower.split(/\s+/).filter(w => w.length > 1);

        // clarity: no ambiguous pronouns, has structure markers, reasonable length
        const hasAmbiguous = /\b(它|這個|那個|this|that|it)\b/i.test(prompt) && prompt.length < 100;
        const hasStructure = /[#\-\*•\d\.]\s/.test(prompt) || /\n/.test(prompt);
        const goodLength = prompt.length >= 30 && prompt.length <= 3000;
        scores.clarity = 2.0 + (hasStructure ? 0.8 : 0) + (goodLength ? 0.5 : 0) - (hasAmbiguous ? 0.8 : 0);

        // accuracy: intent keyword coverage
        const covered = intentWords.filter(w => lower.includes(w)).length;
        const coverage = intentWords.length > 0 ? covered / intentWords.length : 0.5;
        scores.accuracy = Math.min(4, 1.5 + coverage * 2.5);

        // coherence: paragraphs flow, consistent tone
        const paragraphs = prompt.split(/\n\s*\n/).length;
        const hasMixedLang = /[\u4e00-\u9fff]/.test(prompt) && /[a-zA-Z]{10,}/.test(prompt);
        scores.coherence = 2.5 + (paragraphs > 1 ? 0.5 : 0) + (hasStructure ? 0.5 : 0) - (hasMixedLang ? 0.3 : 0);

        // relevance: intent keyword overlap
        scores.relevance = Math.min(4, 1.5 + coverage * 2.5);

        // completeness: has role+context+task+format sections
        const hasRole = /角色|role|你是|you are|act as|作為/i.test(prompt);
        const hasContext = /背景|context|情境|scenario/i.test(prompt);
        const hasTask = /任務|task|請|please|幫|help|分析|analyze/i.test(prompt);
        const hasFormat = /格式|format|輸出|output|JSON|列表|markdown/i.test(prompt);
        const sectionCount = [hasRole, hasContext, hasTask, hasFormat].filter(Boolean).length;
        scores.completeness = 1.5 + sectionCount * 0.6;

        // conciseness: no repetition, <2000 chars
        const isLong = prompt.length > 2000;
        const words = lower.split(/\s+/);
        const uniqueRatio = words.length > 0 ? new Set(words).size / words.length : 1;
        scores.conciseness = 2.0 + (isLong ? -0.5 : 0.5) + (uniqueRatio > 0.7 ? 0.5 : 0) + (prompt.length < 500 ? 0.3 : 0);

        // safety: OutputGrader-style regex
        const dangerPatterns = /rm\s+-rf|DROP\s+TABLE|exec\(|eval\(|password|secret|api.?key|inject|exploit|hack/i;
        scores.safety = dangerPatterns.test(prompt) ? 1.0 : 3.8;

        // creativity: has metaphor, examples, novel framework
        const hasExample = /例如|example|比如|e\.g\.|範例|for instance/i.test(prompt);
        const hasMetaphor = /像|如同|好比|like|as if|metaphor/i.test(prompt);
        const hasNovel = /框架|framework|模型|model|方法論|methodology/i.test(prompt);
        scores.creativity = 1.5 + (hasExample ? 0.8 : 0) + (hasMetaphor ? 0.5 : 0) + (hasNovel ? 0.5 : 0);

        // actionability: clear output format, constraints
        const hasConstraint = /限制|constraint|不要|do not|必須|must|規則|rule/i.test(prompt);
        scores.actionability = 1.5 + (hasFormat ? 1.0 : 0) + (hasConstraint ? 0.8 : 0) + (hasTask ? 0.5 : 0);

        // Clamp all to [0, 4]
        for (const dim of DIMENSIONS) {
            scores[dim] = Math.min(4, Math.max(0, Math.round(scores[dim] * 100) / 100));
        }

        return scores;
    }

    /**
     * LLM-assisted scoring (1 brain call)
     */
    async _llmScore(prompt, intent) {
        const scorePrompt = `Score this prompt on 9 dimensions (0-4 scale, decimals ok).
Intent: ${(intent || '').substring(0, 200)}
Prompt: ${prompt.substring(0, 800)}

Reply JSON only:
{"clarity":N,"accuracy":N,"coherence":N,"relevance":N,"completeness":N,"conciseness":N,"safety":N,"creativity":N,"actionability":N}`;

        try {
            const raw = await this.brain.sendMessage(scorePrompt, true);
            const match = raw.match(/\{[^}]*"clarity"[^}]*\}/);
            if (!match) return null;
            const parsed = JSON.parse(match[0]);

            const scores = {};
            for (const dim of DIMENSIONS) {
                const val = parseFloat(parsed[dim]);
                if (!isNaN(val) && val >= 0 && val <= 4) {
                    scores[dim] = val;
                }
            }
            return Object.keys(scores).length === 9 ? scores : null;
        } catch (_) {
            return null;
        }
    }

    _computeOverall(scores) {
        let total = 0;
        let weightSum = 0;
        for (const dim of DIMENSIONS) {
            if (scores[dim] !== undefined) {
                total += scores[dim] * (this._weights[dim] || 0.11);
                weightSum += this._weights[dim] || 0.11;
            }
        }
        return weightSum > 0 ? Math.round(total / weightSum * 100) / 100 : 0;
    }

    _generateExplanation(scores) {
        const weak = DIMENSIONS.filter(d => scores[d] < 2);
        if (weak.length === 0) return 'Good quality prompt';
        return `Weak dimensions: ${weak.join(', ')}`;
    }

    _emptyScore() {
        const scores = {};
        for (const dim of DIMENSIONS) scores[dim] = 0;
        return { scores, overall: 0 };
    }

    /**
     * v12.0: NL→Structured prompt conversion
     * Heuristic detection of missing structure/ambiguity/constraints,
     * then applies CoT/ToT/ReAct templates as appropriate
     * @param {string} prompt - Free-text natural language prompt
     * @param {string} intent - Optional intent description
     * @returns {{ structured, improvements, scoreGain }}
     */
    nlToStructured(prompt, intent) {
        if (!prompt) return { structured: '', improvements: [], scoreGain: 0 };

        const improvements = [];
        const parts = [];

        // Detect missing structure
        const hasRole = /角色|role|你是|you are|act as|作為/i.test(prompt);
        const hasContext = /背景|context|情境|scenario/i.test(prompt);
        const hasTask = /任務|task|請|please|幫|help|分析|analyze/i.test(prompt);
        const hasFormat = /格式|format|輸出|output|JSON|列表|markdown/i.test(prompt);
        const hasConstraint = /限制|constraint|不要|do not|必須|must|規則|rule/i.test(prompt);

        // Role section
        if (!hasRole) {
            const roleGuess = intent ? `專精於${intent}的 AI 助手` : 'AI 專業助手';
            parts.push(`## 角色\n你是${roleGuess}。`);
            improvements.push('added-role');
        }

        // Context section
        if (!hasContext) {
            parts.push(`## 背景\n${intent || '使用者需要專業分析和建議。'}`);
            improvements.push('added-context');
        }

        // Task section — wrap original prompt
        parts.push(`## 任務\n${prompt}`);

        // Detect ambiguity
        const ambiguous = /\b(它|這個|那個|this|that|some|something|某)\b/i;
        if (ambiguous.test(prompt)) {
            improvements.push('detected-ambiguity');
        }

        // Format section
        if (!hasFormat) {
            parts.push('## 輸出格式\n請使用結構化 Markdown 格式，包含標題和重點摘要。');
            improvements.push('added-format');
        }

        // Constraints
        if (!hasConstraint) {
            parts.push('## 約束條件\n- 回答須準確且有依據\n- 使用清晰易懂的語言\n- 控制在合理篇幅內');
            improvements.push('added-constraints');
        }

        // Inject reasoning pattern based on intent
        const lower = (intent || prompt).toLowerCase();
        if (/分析|推理|計算|步驟|step|reason|calcu/i.test(lower)) {
            parts.push('## 推理模式 (CoT)\n讓我們一步一步思考。');
            improvements.push('injected-CoT');
        } else if (/探索|方案|列舉|brainstorm|explore/i.test(lower)) {
            parts.push('## 推理模式 (ToT)\n請列出 3 種可能的方案，分別分析優缺點。');
            improvements.push('injected-ToT');
        } else if (/搜尋|查詢|API|工具|search|tool/i.test(lower)) {
            parts.push('## 推理模式 (ReAct)\n思考 → 行動 → 觀察 → 結論');
            improvements.push('injected-ReAct');
        }

        const structured = parts.join('\n\n');

        // Score gain estimate
        const beforeScore = this.quickScore(prompt, intent || '').overall;
        const afterScore = this.quickScore(structured, intent || '').overall;
        const scoreGain = Math.round((afterScore - beforeScore) * 100) / 100;

        return { structured, improvements, scoreGain, beforeScore, afterScore };
    }
}

PromptScorer.DIMENSIONS = DIMENSIONS;
PromptScorer.DEFAULT_WEIGHTS = DEFAULT_WEIGHTS;
module.exports = PromptScorer;
