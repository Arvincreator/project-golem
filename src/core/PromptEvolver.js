// ============================================================
// PromptEvolver — EvoPrompt + PromptBreeder Evolution Engine
// Population-based prompt optimization with 6 mutation operators
// Token budget: max (popSize × maxGen × 2) brain calls ≈ 30
// ============================================================

const MUTATION_OPS = ['rephrase', 'add-detail', 'remove-detail', 'restructure', 'pattern-inject', 'nl-to-structured'];

const PATTERN_TEMPLATES = {
    CoT: '讓我們一步一步思考。\nStep 1: ',
    ToT: '請列出 3 種可能的方案，分別分析優缺點，然後選擇最佳方案。\n方案 1: ',
    ReAct: '思考: 我需要什麼資訊？\n行動: 搜尋/查詢\n觀察: 結果是...\n結論: ',
    Reflexion: '第一次嘗試: ...\n反思: 哪裡可以改進？\n改進版: ',
    'Self-Consistency': '請從 3 個不同角度分析，然後取共識作為最終答案。\n角度 1: ',
};

class PromptEvolver {
    constructor(options = {}) {
        this.brain = options.brain || null;
        this.scorer = options.scorer || null;
        this.populationSize = options.populationSize || 5;
        this.maxGenerations = options.maxGenerations || 3;
    }

    /**
     * Full evolutionary optimization pipeline
     * @returns {{ best: {prompt, scores, overall}, population: [], trajectory: [{gen, bestScore}] }}
     */
    async optimize(seedPrompt, intent, options = {}) {
        const generations = options.generations || this.maxGenerations;
        const popSize = options.populationSize || this.populationSize;
        const pattern = options.pattern || null;

        let population = await this._initPopulation(seedPrompt, intent, popSize);
        const trajectory = [];

        for (let gen = 0; gen < generations; gen++) {
            // Score all candidates
            const scored = [];
            for (const candidate of population) {
                const result = this.scorer
                    ? this.scorer.quickScore(candidate, intent)
                    : { overall: this._fallbackScore(candidate, intent) };
                scored.push({ prompt: candidate, overall: result.overall, scores: result.scores || {} });
            }

            // Sort by score descending
            scored.sort((a, b) => b.overall - a.overall);
            trajectory.push({ gen: gen + 1, bestScore: scored[0].overall, bestPrompt: scored[0].prompt.substring(0, 100) });

            // Select top 2
            const parents = this._select(scored, 2);

            // Crossover
            const child = await this._crossover(parents[0].prompt, parents[1].prompt, intent);

            // Mutations
            const op1 = MUTATION_OPS[gen % MUTATION_OPS.length];
            const op2 = MUTATION_OPS[(gen + 2) % MUTATION_OPS.length];
            const mutant1 = await this._mutate(parents[0].prompt, intent, op1, pattern);
            const mutant2 = await this._mutate(child, intent, op2, pattern);

            // Next generation: top 2 parents + crossover child + 2 mutants
            population = [parents[0].prompt, parents[1].prompt, child, mutant1, mutant2].slice(0, popSize);
        }

        // Final scoring
        const finalScored = [];
        for (const candidate of population) {
            const result = this.scorer
                ? this.scorer.quickScore(candidate, intent)
                : { overall: this._fallbackScore(candidate, intent), scores: {} };
            finalScored.push({ prompt: candidate, overall: result.overall, scores: result.scores || {} });
        }
        finalScored.sort((a, b) => b.overall - a.overall);

        return {
            best: finalScored[0],
            population: finalScored,
            trajectory,
        };
    }

    /**
     * Initialize population: seed + (size-1) variants
     */
    async _initPopulation(seed, intent, size) {
        const population = [seed];

        for (let i = 1; i < size; i++) {
            const op = MUTATION_OPS[i % MUTATION_OPS.length];
            const variant = await this._mutate(seed, intent, op);
            population.push(variant);
        }

        return population;
    }

    /**
     * Tournament selection: pick top-K by score
     */
    _select(scored, count) {
        return scored.slice(0, Math.min(count, scored.length));
    }

    /**
     * Crossover: differential recombination (EvoPrompt DE style)
     */
    async _crossover(a, b, intent) {
        if (this.brain) {
            try {
                const prompt = `Combine the best elements of these two prompts into one improved prompt.
Intent: ${(intent || '').substring(0, 200)}

Prompt A:
${a.substring(0, 600)}

Prompt B:
${b.substring(0, 600)}

Output ONLY the combined prompt, nothing else.`;
                const result = await this.brain.sendMessage(prompt, true);
                if (result && result.length > 10) return result.trim();
            } catch (_) { /* fallback below */ }
        }

        // Heuristic fallback: interleave sentences
        return this._heuristicCrossover(a, b);
    }

    /**
     * Mutate with one of 6 operators
     */
    async _mutate(prompt, intent, operator, pattern) {
        if (this.brain) {
            try {
                const result = await this._llmMutate(prompt, intent, operator, pattern);
                if (result && result.length > 10) return result;
            } catch (_) { /* fallback below */ }
        }

        return this._heuristicMutate(prompt, intent, operator, pattern);
    }

    async _llmMutate(prompt, intent, operator, pattern) {
        const instructions = {
            'rephrase': 'Rephrase this prompt while preserving the exact same intent. Use different wording.',
            'add-detail': 'Add more specific details, examples, or constraints to improve this prompt.',
            'remove-detail': 'Simplify this prompt by removing redundant or unnecessary parts while keeping the core intent.',
            'restructure': 'Restructure this prompt into clear sections: Role → Context → Task → Format → Constraints.',
            'pattern-inject': `Inject a ${pattern || 'Chain-of-Thought'} reasoning pattern into this prompt.`,
            'nl-to-structured': 'Convert this free-text prompt into a structured format with Role, Context, Task, Format, and Constraints sections. Add CoT/ToT/ReAct reasoning as appropriate.',
        };

        const mutatePrompt = `${instructions[operator] || instructions['rephrase']}
Intent: ${(intent || '').substring(0, 200)}

Original prompt:
${prompt.substring(0, 800)}

Output ONLY the modified prompt, nothing else.`;

        const result = await this.brain.sendMessage(mutatePrompt, true);
        return result ? result.trim() : null;
    }

    _heuristicMutate(prompt, intent, operator, pattern) {
        switch (operator) {
            case 'rephrase': {
                // Swap some phrases
                return prompt
                    .replace(/請/g, '麻煩')
                    .replace(/分析/g, '深入分析')
                    .replace(/Please/gi, 'Kindly')
                    .replace(/analyze/gi, 'examine');
            }
            case 'add-detail': {
                const additions = [
                    '\n\n請提供具體的範例來說明。',
                    '\n\n請確保回答包含數據支持。',
                    '\n\nPlease include specific examples.',
                ];
                return prompt + additions[Math.floor(Math.random() * additions.length)];
            }
            case 'remove-detail': {
                // Remove last paragraph if multiple
                const parts = prompt.split(/\n\s*\n/);
                return parts.length > 1 ? parts.slice(0, -1).join('\n\n') : prompt;
            }
            case 'restructure': {
                return `## 角色\n你是一個專業的 AI 助手。\n\n## 背景\n${intent || '使用者需要協助'}\n\n## 任務\n${prompt}\n\n## 輸出格式\n請以結構化方式回答。`;
            }
            case 'pattern-inject': {
                const key = pattern || 'CoT';
                const template = PATTERN_TEMPLATES[key] || PATTERN_TEMPLATES.CoT;
                return prompt + '\n\n' + template;
            }
            case 'nl-to-structured': {
                // v12.0: Use PromptScorer.nlToStructured if available
                if (this.scorer && this.scorer.nlToStructured) {
                    const result = this.scorer.nlToStructured(prompt, intent);
                    return result.structured || prompt;
                }
                // Fallback: manual structuring
                return `## 角色\n你是專精於${intent || '解決問題'}的 AI 助手。\n\n## 背景\n${intent || '使用者需要專業協助。'}\n\n## 任務\n${prompt}\n\n## 輸出格式\n結構化 Markdown，含標題與重點。\n\n## 約束\n- 準確有據\n- 清晰易懂`;
            }
            default:
                return prompt;
        }
    }

    _heuristicCrossover(a, b) {
        const sentA = a.split(/[。\.\n]+/).filter(s => s.trim());
        const sentB = b.split(/[。\.\n]+/).filter(s => s.trim());
        const merged = [];
        const maxLen = Math.max(sentA.length, sentB.length);
        for (let i = 0; i < maxLen; i++) {
            if (i < sentA.length && i % 2 === 0) merged.push(sentA[i].trim());
            if (i < sentB.length && i % 2 === 1) merged.push(sentB[i].trim());
        }
        return merged.join('\n') || a;
    }

    /**
     * Fallback scoring when no scorer available
     */
    _fallbackScore(prompt, intent) {
        let score = 2.0;
        if (prompt.length > 50) score += 0.3;
        if (prompt.length > 200) score += 0.2;
        if (/\n/.test(prompt)) score += 0.3;
        if (intent) {
            const words = intent.toLowerCase().split(/\s+/).filter(w => w.length > 1);
            const covered = words.filter(w => prompt.toLowerCase().includes(w)).length;
            if (words.length > 0) score += (covered / words.length) * 1.0;
        }
        return Math.min(4, score);
    }
}

PromptEvolver.MUTATION_OPS = MUTATION_OPS;
PromptEvolver.PATTERN_TEMPLATES = PATTERN_TEMPLATES;
module.exports = PromptEvolver;
