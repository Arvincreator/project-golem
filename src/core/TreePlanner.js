// ============================================================
// TreePlanner — Search-based planning with LATS-lite backtracking
// Extends TaskDecomposer with scored candidate plans + alternatives
// ============================================================
const TaskDecomposer = require('./TaskDecomposer');
const TreeSearch = require('./TreeSearch');
const { v4: uuidv4 } = require('uuid');

const MAX_BACKTRACK_DEPTH = 2;
const PRUNE_THRESHOLD = 0.2;
const MAX_CHILDREN = 3;
const MCTS_ITERATIONS = 10; // Debate consensus: 10 iterations for UCB1

class TreePlanner extends TaskDecomposer {
    constructor(brain, options = {}) {
        super(brain, options);
        this.oodaLoop = options.oodaLoop || null;
        this.threeLayerMemory = options.threeLayerMemory || null;
        // Phase 1C: TreeSearch MCTS escalation path
        this.treeSearch = new TreeSearch({
            brain,
            worldModel: options.worldModel || null,
            golemId: options.golemId || 'default',
        });
    }

    /**
     * Generate 2-3 candidate plans, score with OODA stats, return best tree
     * Falls back to linear plan for simple queries
     */
    async planTree(query, context = '') {
        // Check if query is simple enough for linear planning
        const isSimple = !this._isComplexQuery(query);
        if (isSimple) {
            const linear = await this.decompose(query);
            const root = this._linearToTree(linear.tasks);
            return { root, isSimple: true };
        }

        // Generate 2-3 candidate plans via brain
        const candidates = await this._generateCandidates(query, context);
        if (candidates.length === 0) {
            // Fallback to linear
            const linear = await this.decompose(query);
            return { root: this._linearToTree(linear.tasks), isSimple: true };
        }

        // Score each candidate
        for (const candidate of candidates) {
            const scored = this._scoreNode(candidate);
            candidate.score = scored.score;
            candidate.confidence = scored.confidence;
        }

        // Pick best root
        candidates.sort((a, b) => b.score - a.score);
        const root = candidates[0];

        // Attach alternatives as sibling references
        root._alternatives = candidates.slice(1);

        return { root, isSimple: false };
    }

    /**
     * Score a node using OODA action success rates
     */
    _scoreNode(node) {
        let score = 0.5; // default
        let confidence = 0.3;

        if (this.oodaLoop) {
            const metrics = this.oodaLoop.getMetrics();
            const recentDecisions = metrics.recentDecisions || [];
            if (recentDecisions.length > 0) {
                // Beta-distribution sampling: use success/total as alpha/beta
                const successes = recentDecisions.filter(d => d.action !== 'noop').length;
                const total = recentDecisions.length;
                const alpha = successes + 1;
                const beta = (total - successes) + 1;
                score = betaSample(alpha, beta);
                confidence = Math.min(total / 20, 1.0);
            }
        }

        // Boost score based on action keyword matching with past success
        if (node.action && this.threeLayerMemory) {
            const episodes = this.threeLayerMemory.queryEpisodesSync(node.action || node.description, 3);
            if (episodes.length > 0) {
                const avgReward = episodes.reduce((s, e) => s + (e.reward || 0), 0) / episodes.length;
                score = score * 0.6 + avgReward * 0.4;
                confidence = Math.min(confidence + 0.2, 1.0);
            }
        }

        return { score: Math.max(0, Math.min(1, score)), confidence };
    }

    /**
     * On failure: ask brain for 2 alternatives with reflection context
     */
    async _expandAlternatives(node, context, failureInfo) {
        const prompt = `【系統指令: 替代方案生成】
原始計劃步驟失敗:
步驟: ${node.description}
失敗原因: ${failureInfo}

請提供 2 個替代方案。
回覆 JSON:
{
    "alternatives": [
        { "description": "替代方案1描述", "action": "具體動作" },
        { "description": "替代方案2描述", "action": "具體動作" }
    ]
}`;

        try {
            const raw = await this.brain.sendMessage(prompt, true);
            const jsonMatch = raw.match(/\{[\s\S]*"alternatives"[\s\S]*\}/);
            if (!jsonMatch) return [];

            const parsed = JSON.parse(jsonMatch[0]);
            return (parsed.alternatives || []).slice(0, MAX_CHILDREN - 1).map(alt => ({
                id: uuidv4().substring(0, 8),
                description: alt.description,
                action: alt.action || alt.description,
                children: [],
                score: 0.5,
                status: 'pending',
                depth: (node.depth || 0),
                parentId: node.parentId,
            }));
        } catch (e) {
            console.warn('[TreePlanner] Failed to expand alternatives:', e.message);
            return [];
        }
    }

    /**
     * DFS execution with backtracking
     * success → advance, failure → expand alternatives → pick best → continue
     */
    async executeTree(ctx, tree, processStep) {
        const results = [];
        let backtracks = 0;
        let completed = 0;
        let failed = 0;

        const execute = async (node, depth = 0) => {
            if (!node || depth > MAX_BACKTRACK_DEPTH + 2) return false;

            node.status = 'running';
            console.log(`[TreePlanner] Executing: ${node.description} (depth=${depth}, score=${(node.score || 0).toFixed(2)})`);

            try {
                const result = await processStep(ctx, node);
                node.status = 'completed';
                completed++;
                results.push({ nodeId: node.id, status: 'completed', result });

                // Record success in episodic memory
                if (this.threeLayerMemory) {
                    this.threeLayerMemory.recordEpisode(
                        node.description, [node.action || 'execute'], 'success', 1.0
                    );
                }

                // Execute children sequentially
                for (const child of (node.children || [])) {
                    await execute(child, depth + 1);
                }
                return true;
            } catch (e) {
                node.status = 'failed';
                failed++;
                results.push({ nodeId: node.id, status: 'failed', error: e.message });

                console.warn(`[TreePlanner] Step failed: ${node.description} — ${e.message}`);

                // Record failure in episodic memory
                if (this.threeLayerMemory) {
                    this.threeLayerMemory.recordEpisode(
                        node.description, [node.action || 'execute'], `failed: ${e.message}`, 0.0
                    );
                }

                // Backtrack: generate alternatives if within depth limit
                if (backtracks < MAX_BACKTRACK_DEPTH) {
                    backtracks++;
                    const alternatives = await this._expandAlternatives(node, '', e.message);
                    if (alternatives.length > 0) {
                        // Score alternatives
                        for (const alt of alternatives) {
                            const scored = this._scoreNode(alt);
                            alt.score = scored.score;
                        }

                        // Prune low-scoring alternatives
                        const viable = alternatives.filter(a => a.score >= PRUNE_THRESHOLD);
                        viable.sort((a, b) => b.score - a.score);

                        // Try best alternative
                        if (viable.length > 0) {
                            node.children = node.children || [];
                            node.children.push(...viable);
                            console.log(`[TreePlanner] Backtracking (${backtracks}/${MAX_BACKTRACK_DEPTH}): trying ${viable[0].description}`);
                            return execute(viable[0], depth + 1);
                        }
                    }
                }
                return false;
            }
        };

        // Flatten and execute from root
        const steps = this._flattenBestPath(tree);
        for (const step of steps) {
            const success = await execute(step, 0);
            if (!success && backtracks >= MAX_BACKTRACK_DEPTH) {
                // Phase 1C: MCTS escalation when backtracking exhausted
                const enableMCTS = process.env.ENABLE_MCTS_ESCALATION === 'true';
                if (enableMCTS) {
                    const allLowScore = (tree._alternatives || []).every(a => (a.score || 0) < PRUNE_THRESHOLD);
                    if (allLowScore) {
                        console.log('[TreePlanner] Escalating to MCTS (backtracks exhausted, all alternatives low-scoring)');
                        try {
                            const mctsResult = await this._mctsEscalation(tree, ctx, processStep);
                            if (mctsResult) {
                                results.push(...mctsResult.results);
                                completed += mctsResult.completed;
                            }
                        } catch (e) {
                            console.warn('[TreePlanner] MCTS escalation failed:', e.message);
                        }
                    }
                }
                console.warn('[TreePlanner] Max backtrack depth reached, stopping.');
                break;
            }
        }

        return { results, completed, failed, backtracks };
    }

    /**
     * Prune branches scoring below threshold
     */
    _pruneBranch(node, threshold = PRUNE_THRESHOLD) {
        if (!node || !node.children) return;
        node.children = node.children.filter(child => {
            if ((child.score || 0) < threshold && child.status !== 'completed') {
                return false;
            }
            this._pruneBranch(child, threshold);
            return true;
        });
    }

    /**
     * Flatten best-scoring path from tree for display/execution
     */
    _flattenBestPath(root) {
        if (!root) return [];
        if (!root.children || root.children.length === 0) return [root];

        const steps = [root];
        let current = root;
        while (current.children && current.children.length > 0) {
            // Pick highest-scoring child
            const best = current.children.reduce((a, b) =>
                (b.score || 0) > (a.score || 0) ? b : a, current.children[0]);
            steps.push(best);
            current = best;
        }
        return steps;
    }

    /**
     * Check if query warrants tree planning (3+ indicators or specific keywords)
     */
    _isComplexQuery(query) {
        const indicators = [
            /\btry\b/i, /\bor\b/i, /\balternative/i, /\bcompare/i,
            /比較/, /嘗試/, /或者/, /方案/, /如果.*失敗/,
            /plan\b/i, /strategy/i, /step.*by.*step/i,
            /\bbackup\b/i, /\bfallback\b/i,
        ];
        const matches = indicators.filter(p => p.test(query)).length;
        return matches >= 2 || query.split(/[,，.。;；\n]/).length >= 4;
    }

    /**
     * Convert linear task list to tree structure
     */
    _linearToTree(tasks) {
        if (!tasks || tasks.length === 0) {
            return { id: 'root', description: 'empty', action: 'noop', children: [], score: 0, status: 'pending', depth: 0, parentId: null };
        }

        const root = {
            id: tasks[0].id || 'root',
            description: tasks[0].desc || tasks[0].description || '',
            action: tasks[0].desc || '',
            children: [],
            score: 0.5,
            status: 'pending',
            depth: 0,
            parentId: null,
        };

        let parent = root;
        for (let i = 1; i < tasks.length; i++) {
            const child = {
                id: tasks[i].id || `step_${i}`,
                description: tasks[i].desc || tasks[i].description || '',
                action: tasks[i].desc || '',
                children: [],
                score: 0.5,
                status: 'pending',
                depth: i,
                parentId: parent.id,
            };
            parent.children.push(child);
            parent = child;
        }

        return root;
    }

    /**
     * Phase 1C: MCTS escalation — full Monte Carlo Tree Search when backtracking is exhausted
     */
    async _mctsEscalation(tree, ctx, processStep) {
        const rootState = {
            goal: tree.description || 'complete task',
            context: '',
            history: [],
        };

        const getActions = async (state) => {
            const alts = await this._expandAlternatives(
                { description: state.lastAction || rootState.goal, depth: state.depth || 0 },
                '', 'backtrack exhausted'
            );
            // C4: Normalize action descriptions for consistent MCTS node comparison
            return alts.map(a => ({
                action: (a.action || '').trim().toLowerCase(),
                description: (a.description || a.action || '').trim(),
                level: 'L1',
            }));
        };

        const mctsResult = await this.treeSearch.search(rootState, getActions, MCTS_ITERATIONS);
        const results = [];
        let completed = 0;

        // Execute best path found by MCTS
        for (const pathStep of mctsResult.bestPath) {
            try {
                const node = {
                    id: uuidv4().substring(0, 8),
                    description: pathStep.action?.description || String(pathStep.action),
                    action: pathStep.action?.action || String(pathStep.action),
                    children: [],
                    score: pathStep.value,
                    status: 'pending',
                    depth: pathStep.depth,
                };
                await processStep(ctx, node);
                results.push({ nodeId: node.id, status: 'completed', source: 'mcts' });
                completed++;
            } catch (e) {
                results.push({ nodeId: 'mcts', status: 'failed', error: e.message });
                break;
            }
        }

        console.log(`[TreePlanner] MCTS escalation: ${completed} steps completed, ${mctsResult.iterations} iterations`);
        return { results, completed };
    }

    /**
     * Generate 2-3 candidate plans via brain
     */
    async _generateCandidates(query, context) {
        const prompt = `【系統指令: 多方案規劃】
目標: ${query}
${context ? `背景: ${context}` : ''}

請生成 2-3 個不同的執行計劃。每個計劃包含 2-5 個步驟。
回覆 JSON:
{
    "plans": [
        {
            "name": "方案A",
            "steps": [
                { "description": "步驟描述", "action": "具體動作" }
            ]
        }
    ]
}`;

        try {
            const raw = await this.brain.sendMessage(prompt, true);
            const jsonMatch = raw.match(/\{[\s\S]*"plans"[\s\S]*\}/);
            if (!jsonMatch) return [];

            const parsed = JSON.parse(jsonMatch[0]);
            return (parsed.plans || []).slice(0, 3).map((plan, planIdx) => {
                const rootNode = {
                    id: `plan_${planIdx}_root`,
                    description: plan.name || `Plan ${planIdx + 1}`,
                    action: plan.name || '',
                    children: [],
                    score: 0.5,
                    status: 'pending',
                    depth: 0,
                    parentId: null,
                };

                let parent = rootNode;
                for (let i = 0; i < (plan.steps || []).length; i++) {
                    const step = plan.steps[i];
                    const child = {
                        id: `plan_${planIdx}_step_${i}`,
                        description: step.description || '',
                        action: step.action || step.description || '',
                        children: [],
                        score: 0.5,
                        status: 'pending',
                        depth: i + 1,
                        parentId: parent.id,
                    };
                    parent.children.push(child);
                    parent = child;
                }

                return rootNode;
            });
        } catch (e) {
            console.warn('[TreePlanner] Failed to generate candidates:', e.message);
            return [];
        }
    }
}

/**
 * Beta distribution sampling (mean approximation)
 * Used for OODA-based scoring
 */
function betaSample(alpha, beta) {
    // Simple mean of beta distribution: alpha / (alpha + beta)
    // With small random perturbation for exploration
    const mean = alpha / (alpha + beta);
    const noise = (Math.random() - 0.5) * 0.1;
    return Math.max(0, Math.min(1, mean + noise));
}

// Export betaSample for OODALoop
TreePlanner.betaSample = betaSample;

module.exports = TreePlanner;
