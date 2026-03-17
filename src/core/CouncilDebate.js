// ============================================================
// CouncilDebate — 多角色議會辯論系統
// 4 角色 + 1 綜合 = 最多 5 次 brain call
// brain 為 null 時退化為啟發式分析
// ============================================================

const COUNCIL_ROLES = [
    {
        id: 'researcher',
        name: 'Researcher',
        focus: '學術嚴謹、方法論、證據品質',
        prompt: 'You are a rigorous academic researcher. Analyze the following AGI scan findings from the perspective of scientific methodology, evidence quality, and reproducibility. Be critical of weak claims.',
    },
    {
        id: 'engineer',
        name: 'Engineer',
        focus: '實作可行性、擴展性、系統整合',
        prompt: 'You are a senior systems engineer. Analyze the following AGI scan findings from the perspective of practical implementation, scalability, system integration, and engineering trade-offs.',
    },
    {
        id: 'skeptic',
        name: 'Skeptic',
        focus: '批判分析、風險評估、假設質疑',
        prompt: 'You are a critical skeptic. Challenge the following AGI scan findings. Question assumptions, identify risks, highlight potential biases, and consider what might go wrong.',
    },
    {
        id: 'strategist',
        name: 'Strategist',
        focus: '長期願景、競爭格局、路線圖',
        prompt: 'You are a strategic advisor. Analyze the following AGI scan findings from the perspective of long-term vision, competitive landscape, market positioning, and roadmap implications.',
    },
];

const MAX_BRAIN_CALLS = 5;
const MAX_CONTENT_PER_ROLE = 2000;

class CouncilDebate {
    constructor(options = {}) {
        this._brain = options.brain || null;
        this._agentBus = options.agentBus || null;
        this._ragProvider = options.ragProvider || null;
        this._maxBrainCalls = options.maxBrainCalls || MAX_BRAIN_CALLS;
        this._brainCallCount = 0;
    }

    /**
     * Run full council debate on scan results
     * @param {Object} scanReport - From AGIScanner.fullScan()
     * @param {Object} options - { topic }
     * @returns {Object} DebateResult
     */
    async debate(scanReport, options = {}) {
        this._brainCallCount = 0;
        const topic = options.topic || 'AGI landscape analysis';
        const content = this._extractContent(scanReport);

        const result = {
            timestamp: new Date().toISOString(),
            topic,
            perspectives: [],
            synthesis: null,
            brainCallsUsed: 0,
            mode: this._brain ? 'brain' : 'heuristic',
        };

        // Get perspectives from each role (4 brain calls)
        for (const role of COUNCIL_ROLES) {
            const perspective = await this.getPerspective(role, content, this._brain);
            result.perspectives.push(perspective);
        }

        // Synthesize all perspectives (1 brain call)
        result.synthesis = await this.synthesize(result.perspectives, this._brain);
        result.brainCallsUsed = this._brainCallCount;

        return result;
    }

    /**
     * Get a single role's perspective
     * @param {Object} role - Role definition
     * @param {string} content - Scan content (truncated)
     * @param {Object} brain - Brain instance or null
     * @returns {Object} Perspective
     */
    async getPerspective(role, content, brain) {
        const truncated = String(content).substring(0, MAX_CONTENT_PER_ROLE);

        if (brain && this._brainCallCount < this._maxBrainCalls) {
            try {
                const prompt = `${role.prompt}\n\n--- Scan Data ---\n${truncated}\n\nProvide your analysis in 3-5 key points.`;
                const response = await brain.sendMessage(prompt);
                this._brainCallCount++;
                return {
                    role: role.id,
                    name: role.name,
                    focus: role.focus,
                    analysis: typeof response === 'string' ? response : (response?.text || response?.reply || String(response)),
                    mode: 'brain',
                };
            } catch (e) {
                console.warn(`[CouncilDebate] Brain call failed for ${role.name}:`, e.message);
            }
        }

        // Heuristic fallback: keyword extraction
        return {
            role: role.id,
            name: role.name,
            focus: role.focus,
            analysis: this._heuristicAnalysis(role, truncated),
            mode: 'heuristic',
        };
    }

    /**
     * Synthesize all perspectives into consensus + divergences
     * @param {Array} perspectives - Array of Perspective objects
     * @param {Object} brain - Brain instance or null
     * @returns {Object} Synthesis
     */
    async synthesize(perspectives, brain) {
        const perspectiveText = perspectives
            .map(p => `[${p.name}] ${p.analysis}`)
            .join('\n\n');

        if (brain && this._brainCallCount < this._maxBrainCalls) {
            try {
                const prompt = `You are synthesizing a council debate. Four experts have analyzed AGI scan data:\n\n${perspectiveText.substring(0, 3000)}\n\nProvide:\n1. **Consensus**: Points all roles agree on\n2. **Divergences**: Key disagreements\n3. **Recommendations**: Top 3 actionable insights`;
                const response = await brain.sendMessage(prompt);
                this._brainCallCount++;
                return {
                    consensus: typeof response === 'string' ? response : (response?.text || response?.reply || String(response)),
                    mode: 'brain',
                };
            } catch (e) {
                console.warn('[CouncilDebate] Synthesis brain call failed:', e.message);
            }
        }

        // Heuristic synthesis
        return {
            consensus: this._heuristicSynthesis(perspectives),
            mode: 'heuristic',
        };
    }

    /**
     * Publish debate results to RAG and AgentBus
     */
    async publishResults(debateResult) {
        // Ingest to RAG
        if (this._ragProvider && debateResult) {
            try {
                const content = `[Council Debate: ${debateResult.topic}]\n` +
                    debateResult.perspectives.map(p => `${p.name}: ${(p.analysis || '').substring(0, 500)}`).join('\n') +
                    `\nSynthesis: ${debateResult.synthesis?.consensus || ''}`;
                await this._ragProvider.ingest(content, {
                    type: 'council_insight',
                    topic: debateResult.topic,
                    timestamp: debateResult.timestamp,
                });
            } catch (e) { /* non-blocking */ }
        }

        // Publish to AgentBus
        if (this._agentBus && debateResult) {
            try {
                this._agentBus.publish('council.debate_completed', {
                    topic: debateResult.topic,
                    perspectiveCount: debateResult.perspectives.length,
                    mode: debateResult.mode,
                    brainCallsUsed: debateResult.brainCallsUsed,
                    timestamp: debateResult.timestamp,
                }, 'council_debate');
            } catch (e) { /* non-blocking */ }
        }
    }

    /**
     * v11.5: Debate with RAG-augmented context
     * First queries RAG for historical context, then debates with enriched data
     * @param {Object} scanReport - From AGIScanner.fullScan()
     * @param {Object} ragProvider - RAGProvider instance
     * @param {Object} options - { topic }
     * @returns {Object} DebateResult with ragEnriched flag
     */
    async debateWithRAGContext(scanReport, ragProvider, options = {}) {
        let enrichedContent = this._extractContent(scanReport);

        // Query RAG for historical context
        if (ragProvider) {
            try {
                const topic = options.topic || 'AGI landscape analysis';
                const ragResult = await ragProvider.augmentedRecall(topic, { limit: 5 });
                if (ragResult && ragResult.contextString) {
                    enrichedContent = `[Historical RAG Context]\n${ragResult.contextString.substring(0, 1000)}\n\n[Current Scan Data]\n${enrichedContent}`;
                }
            } catch (e) {
                console.warn('[CouncilDebate] RAG context enrichment failed:', e.message);
            }
        }

        // Run debate with enriched content
        this._brainCallCount = 0;
        const topic = options.topic || 'AGI landscape analysis (RAG-augmented)';

        const result = {
            timestamp: new Date().toISOString(),
            topic,
            perspectives: [],
            synthesis: null,
            brainCallsUsed: 0,
            mode: this._brain ? 'brain' : 'heuristic',
            ragEnriched: true,
        };

        for (const role of COUNCIL_ROLES) {
            const perspective = await this.getPerspective(role, enrichedContent, this._brain);
            result.perspectives.push(perspective);
        }

        result.synthesis = await this.synthesize(result.perspectives, this._brain);
        result.brainCallsUsed = this._brainCallCount;

        return result;
    }

    // --- Internal ---

    _extractContent(scanReport) {
        if (!scanReport || !scanReport.categories) return '';
        const parts = [];
        for (const [catName, catResult] of Object.entries(scanReport.categories)) {
            for (const r of catResult.results || []) {
                if (r.synthesis) {
                    parts.push(`[${catName}] ${r.query}: ${r.synthesis}`);
                }
            }
        }
        return parts.join('\n');
    }

    _heuristicAnalysis(role, content) {
        const keywords = this._extractKeywords(content);

        // Role-specific keyword filters for differentiated analysis
        const roleFilters = {
            researcher: ['research', 'paper', 'model', 'benchmark', 'accuracy', 'reasoning', 'architecture', 'training', 'data', 'distillation'],
            engineer: ['framework', 'deploy', 'production', 'scale', 'integration', 'platform', 'open', 'source', 'agent', 'tool', 'sandbox'],
            skeptic: ['risk', 'safety', 'alignment', 'mirage', 'fake', 'bottleneck', 'limitation', 'concern', 'resign', 'control', 'fail'],
            strategist: ['revenue', 'valuation', 'market', 'competition', 'timeline', 'roadmap', 'funding', 'enterprise', 'growth', 'billion'],
        };

        const filters = roleFilters[role.id] || [];
        const relevant = keywords.filter(kw => filters.some(f => kw.includes(f) || f.includes(kw)));
        const top = (relevant.length > 0 ? relevant : keywords).slice(0, 8).join(', ');

        const lines = [`[${role.name} Analysis]`];
        lines.push(`Focus: ${role.focus}`);
        lines.push(`Key signals: ${top || 'insufficient data'}`);
        lines.push(`Coverage: ${keywords.length} keywords from ${content.length} chars`);

        // Role-specific heuristic commentary
        if (role.id === 'researcher') {
            const hasData = keywords.some(kw => ['benchmark', 'accuracy', 'paper', 'arxiv'].some(f => kw.includes(f)));
            lines.push(hasData ? 'Evidence quality: Peer-reviewed sources detected' : 'Evidence quality: Mostly industry claims, needs verification');
        } else if (role.id === 'engineer') {
            const hasProd = keywords.some(kw => ['production', 'deploy', 'framework', 'platform'].some(f => kw.includes(f)));
            lines.push(hasProd ? 'Implementation readiness: Production-grade solutions available' : 'Implementation readiness: Mostly experimental/research stage');
        } else if (role.id === 'skeptic') {
            const hasRisk = keywords.some(kw => ['risk', 'safety', 'alignment', 'concern', 'fail'].some(f => kw.includes(f)));
            lines.push(hasRisk ? 'Risk assessment: Significant safety concerns identified' : 'Risk assessment: Insufficient safety analysis in source data');
        } else if (role.id === 'strategist') {
            const hasBiz = keywords.some(kw => ['revenue', 'billion', 'market', 'growth', 'valuation'].some(f => kw.includes(f)));
            lines.push(hasBiz ? 'Market signal: Strong commercial momentum detected' : 'Market signal: Limited business intelligence in source data');
        }

        return lines.join('. ');
    }

    _heuristicSynthesis(perspectives) {
        // Collect unique keywords per role
        const roleKeywords = {};
        for (const p of perspectives) {
            roleKeywords[p.name] = new Set(this._extractKeywords(p.analysis));
        }

        // Find common keywords (appear in 3+ roles)
        const allKw = {};
        for (const kws of Object.values(roleKeywords)) {
            for (const kw of kws) {
                allKw[kw] = (allKw[kw] || 0) + 1;
            }
        }
        const consensus = Object.entries(allKw).filter(([, c]) => c >= 3).map(([kw]) => kw).slice(0, 10);
        const divergent = Object.entries(allKw).filter(([, c]) => c === 1).map(([kw]) => kw).slice(0, 5);

        const lines = [
            `Synthesis from ${perspectives.length} council roles.`,
            `Consensus themes (3+ roles agree): ${consensus.join(', ') || 'none identified'}.`,
            `Divergent signals (single role): ${divergent.join(', ') || 'none'}.`,
            `Recommendation: Cross-validate divergent signals; prioritize consensus themes for action.`,
        ];
        return lines.join(' ');
    }

    _extractKeywords(text) {
        if (!text) return [];
        return text.toLowerCase()
            .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3);
    }
}

module.exports = CouncilDebate;
