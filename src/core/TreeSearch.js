// ============================================================
// TreeSearch — LATS MCTS (Monte Carlo Tree Search) for Planning
// ICML 2024: Language Agent Tree Search
// Selection → Expansion → Simulation → Backpropagation
// ============================================================

const MAX_ITERATIONS = 20;
const MAX_DEPTH = 5;
const EXPLORATION_CONSTANT = 1.41; // sqrt(2) for UCB1

class TreeSearch {
    constructor(options = {}) {
        this.brain = options.brain || null;
        this.worldModel = options.worldModel || null;
        this.golemId = options.golemId || 'default';
        this._iterations = 0;
    }

    /**
     * Run MCTS from a root state to find the best action sequence
     * @param {Object} rootState - Initial state { goal, context, ... }
     * @param {Function} getActions - (state) => [{action, description}]
     * @param {number} maxIterations - Number of MCTS iterations
     * @returns {{ bestPath, rootNode, iterations }}
     */
    async search(rootState, getActions, maxIterations = MAX_ITERATIONS) {
        const root = this._createNode(rootState, null, null, 0);
        this._iterations = 0;

        for (let i = 0; i < maxIterations; i++) {
            this._iterations++;

            // 1. Selection: traverse tree using UCB1
            const selected = this._select(root);

            // 2. Expansion: add child nodes
            const expanded = await this._expand(selected, getActions);
            if (!expanded) continue;

            // 3. Simulation: rollout from expanded node
            const reward = await this._simulate(expanded);

            // 4. Backpropagation: update values up the tree
            this._backpropagate(expanded, reward);
        }

        const bestPath = this._getBestPath(root);
        return {
            bestPath,
            rootNode: this._serializeNode(root),
            iterations: this._iterations,
            stats: this._getTreeStats(root),
        };
    }

    /**
     * Selection: UCB1-based tree traversal
     * Selects the most promising unexplored node
     */
    _select(node) {
        let current = node;
        while (current.children.length > 0 && current.isFullyExpanded) {
            current = this._bestUCB1Child(current);
        }
        return current;
    }

    /**
     * UCB1 formula: value/visits + C * sqrt(ln(parent.visits)/visits)
     */
    _bestUCB1Child(node) {
        let best = null;
        let bestScore = -Infinity;

        for (const child of node.children) {
            if (child.visits === 0) return child; // Prioritize unvisited

            const exploitation = child.totalReward / child.visits;
            const exploration = EXPLORATION_CONSTANT *
                Math.sqrt(Math.log(node.visits) / child.visits);
            const ucb1 = exploitation + exploration;

            if (ucb1 > bestScore) {
                bestScore = ucb1;
                best = child;
            }
        }
        return best || node.children[0];
    }

    /**
     * Expansion: generate child nodes from available actions
     */
    async _expand(node, getActions) {
        if (node.depth >= MAX_DEPTH) {
            node.isFullyExpanded = true;
            return null;
        }

        const actions = await getActions(node.state);
        if (!actions || actions.length === 0) {
            node.isFullyExpanded = true;
            return null;
        }

        // Add unexplored actions as children
        for (const action of actions) {
            const childState = {
                ...node.state,
                lastAction: action.description || action.action,
                depth: node.depth + 1,
                history: [...(node.state.history || []), action],
            };
            const child = this._createNode(childState, node, action, node.depth + 1);
            node.children.push(child);
        }

        node.isFullyExpanded = true;

        // Return first unexplored child for simulation
        return node.children.find(c => c.visits === 0) || node.children[0];
    }

    /**
     * Simulation: estimate value of a node
     * Uses WorldModel if available, otherwise heuristic
     */
    async _simulate(node) {
        // WorldModel simulation
        if (this.worldModel) {
            const value = this.worldModel.valueFunction(node.state, node.action);
            return value;
        }

        // LLM-based evaluation
        if (this.brain) {
            return this._llmEvaluate(node);
        }

        // Heuristic fallback
        return this._heuristicEvaluate(node);
    }

    /**
     * LLM evaluation: ask brain to score the state
     */
    async _llmEvaluate(node) {
        const goal = node.state.goal || 'unknown goal';
        const history = (node.state.history || [])
            .map(a => a.description || a.action || String(a))
            .join(' → ');

        const prompt = `Goal: ${goal}
Actions taken: ${history || 'none'}
Current action: ${node.action?.description || 'none'}

Rate progress toward goal (0.0 = no progress, 1.0 = goal achieved).
Reply with just a number.`;

        try {
            const raw = await this.brain.sendMessage(prompt, true);
            const match = raw.match(/(\d+\.?\d*)/);
            if (match) {
                const value = parseFloat(match[1]);
                return Math.max(0, Math.min(1, value > 1 ? value / 10 : value));
            }
        } catch (_) { /* expected: LLM evaluation may fail */ }
        return 0.5;
    }

    /**
     * Heuristic evaluation based on depth and action type
     */
    _heuristicEvaluate(node) {
        const depthPenalty = node.depth * 0.05;
        const baseValue = 0.5;
        const level = node.action?.level || 'L1';
        const levelBonus = { L0: 0.2, L1: 0.1, L2: 0, L3: -0.1 };
        return Math.max(0, Math.min(1, baseValue + (levelBonus[level] || 0) - depthPenalty));
    }

    /**
     * Backpropagation: update node values up to root
     */
    _backpropagate(node, reward) {
        let current = node;
        while (current) {
            current.visits++;
            current.totalReward += reward;
            current = current.parent;
        }
    }

    /**
     * Extract the best path from root to leaf
     */
    _getBestPath(root) {
        const path = [];
        let current = root;

        while (current.children.length > 0) {
            // Pick child with highest average reward
            const best = current.children.reduce((a, b) =>
                (b.visits > 0 ? b.totalReward / b.visits : 0) >
                (a.visits > 0 ? a.totalReward / a.visits : 0) ? b : a
            );
            if (best.action) {
                path.push({
                    action: best.action,
                    value: best.visits > 0 ? Math.round(best.totalReward / best.visits * 100) / 100 : 0,
                    visits: best.visits,
                    depth: best.depth,
                });
            }
            current = best;
        }

        return path;
    }

    /**
     * Create a new tree node
     */
    _createNode(state, parent, action, depth) {
        return {
            state,
            parent,
            action,
            depth,
            children: [],
            visits: 0,
            totalReward: 0,
            isFullyExpanded: false,
        };
    }

    /**
     * Serialize node for output (removes circular parent references)
     */
    _serializeNode(node, maxDepth = 3) {
        if (!node || maxDepth < 0) return null;
        return {
            action: node.action ? (node.action.description || node.action.action || String(node.action)) : 'root',
            visits: node.visits,
            avgReward: node.visits > 0 ? Math.round(node.totalReward / node.visits * 100) / 100 : 0,
            depth: node.depth,
            childCount: node.children.length,
            children: node.children
                .sort((a, b) => (b.totalReward / Math.max(b.visits, 1)) - (a.totalReward / Math.max(a.visits, 1)))
                .slice(0, 3)
                .map(c => this._serializeNode(c, maxDepth - 1)),
        };
    }

    /**
     * Get tree statistics
     */
    _getTreeStats(root) {
        let totalNodes = 0;
        let maxDepth = 0;
        let totalVisits = 0;

        const traverse = (node) => {
            totalNodes++;
            totalVisits += node.visits;
            if (node.depth > maxDepth) maxDepth = node.depth;
            for (const child of node.children) traverse(child);
        };
        traverse(root);

        return {
            totalNodes,
            maxDepth,
            totalVisits,
            iterations: this._iterations,
            explorationConstant: EXPLORATION_CONSTANT,
        };
    }
}

TreeSearch.MAX_ITERATIONS = MAX_ITERATIONS;
TreeSearch.MAX_DEPTH = MAX_DEPTH;
module.exports = TreeSearch;
