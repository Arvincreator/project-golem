// ============================================================
// WorldModel — LATS Value Function + LLM-as-Simulator
// Predicts outcomes before executing, scores plans, enables lookahead
// ============================================================

const VALUE_CACHE_SIZE = 100;

class WorldModel {
    constructor(brain, options = {}) {
        this.brain = brain;
        this.golemId = options.golemId || 'default';
        this.threeLayerMemory = options.threeLayerMemory || null;
        this._valueCache = new Map();
        this._simulationHistory = [];
    }

    /**
     * Simulate outcomes for a sequence of steps
     * @param {string} goal - The high-level objective
     * @param {Array} steps - Array of { id, desc, level } step objects
     * @returns {Array} Predictions per step: { expectedOutcome, riskLevel, confidence, valueScore }
     */
    async simulate(goal, steps) {
        if (!steps || steps.length === 0) return [];

        // Check cache first
        const cacheKey = `${goal}_${steps.map(s => s.id).join(',')}`;
        if (this._valueCache.has(cacheKey)) {
            return this._valueCache.get(cacheKey);
        }

        const prompt = `【系統指令: 世界模型模擬】
目標: ${goal}
計劃步驟:
${steps.map((s, i) => `${i + 1}. [${s.level || 'L1'}] ${s.desc}`).join('\n')}

對每個步驟，預測:
1. 預期結果 (一句話)
2. 風險等級 (LOW/MEDIUM/HIGH)
3. 成功信心 (0.0-1.0)

回覆 JSON:
{
    "predictions": [
        { "stepId": "step_id", "expectedOutcome": "結果", "riskLevel": "LOW", "confidence": 0.8 }
    ]
}`;

        try {
            const raw = await this.brain.sendMessage(prompt, true);
            const jsonMatch = raw.match(/\{[\s\S]*"predictions"[\s\S]*\}/);
            if (!jsonMatch) return this._heuristicSimulate(steps);

            const parsed = JSON.parse(jsonMatch[0]);
            const predictions = (parsed.predictions || []).map((pred, i) => ({
                stepId: steps[i]?.id || pred.stepId,
                expectedOutcome: pred.expectedOutcome || 'unknown',
                riskLevel: pred.riskLevel || 'MEDIUM',
                confidence: typeof pred.confidence === 'number' ? pred.confidence : 0.5,
                valueScore: this._computeValueScore(pred, steps[i]),
            }));

            // Cache
            this._valueCache.set(cacheKey, predictions);
            if (this._valueCache.size > VALUE_CACHE_SIZE) {
                const firstKey = this._valueCache.keys().next().value;
                this._valueCache.delete(firstKey);
            }

            this._simulationHistory.push({
                goal, stepCount: steps.length,
                avgConfidence: predictions.reduce((s, p) => s + p.confidence, 0) / predictions.length,
                timestamp: Date.now(),
            });
            if (this._simulationHistory.length > 100) this._simulationHistory.shift();

            return predictions;
        } catch (e) {
            console.warn('[WorldModel] Simulation failed, using heuristics:', e.message);
            return this._heuristicSimulate(steps);
        }
    }

    /**
     * D2: Set EMA values from ExperienceReplay
     */
    setEmaValues(emaValues) {
        this._emaValues = emaValues;
    }

    /**
     * Score a single action/state for LATS value function
     * D2: Uses EMA values from ExperienceReplay when available, falls back to hardcoded
     */
    valueFunction(state, action) {
        let baseScore = 0.5;

        // D2: Use EMA values if available
        const levelScoresFallback = { L0: 0.9, L1: 0.7, L2: 0.5, L3: 0.3 };
        const ema = this._emaValues || null;
        if (action?.level) {
            if (ema && ema[action.level] !== undefined) {
                baseScore = ema[action.level];
            } else {
                baseScore = levelScoresFallback[action.level] || 0.5;
            }
        }

        // Episodic memory boost
        if (this.threeLayerMemory) {
            const similar = this.threeLayerMemory.queryEpisodesSync(
                action?.desc || action?.description || String(state), 3
            );
            if (similar.length > 0) {
                const avgReward = similar.reduce((s, e) => s + (e.reward || 0), 0) / similar.length;
                baseScore = baseScore * 0.5 + avgReward * 0.5;
            }
        }

        return Math.max(0, Math.min(1, baseScore));
    }

    /**
     * Predict the next state given current state and action
     * (LLM-as-Simulator: asks brain to predict consequences)
     */
    async predictNextState(currentState, action) {
        const prompt = `Current state: ${JSON.stringify(currentState).substring(0, 500)}
Action: ${typeof action === 'string' ? action : JSON.stringify(action).substring(0, 200)}

Predict the next state after this action in one sentence. Focus on observable changes.`;

        try {
            const raw = await this.brain.sendMessage(prompt, true);
            return {
                description: typeof raw === 'string' ? raw.substring(0, 500) : 'unknown',
                confidence: 0.6,
                timestamp: Date.now(),
            };
        } catch (e) {
            return { description: 'prediction_failed', confidence: 0.1, timestamp: Date.now() };
        }
    }

    /**
     * Lookahead: simulate N steps ahead and return cumulative value
     */
    async lookahead(state, actions, depth = 3) {
        let currentState = state;
        let totalValue = 0;
        const trajectory = [];

        const stepsToSimulate = actions.slice(0, depth);
        for (const action of stepsToSimulate) {
            const value = this.valueFunction(currentState, action);
            totalValue += value;
            trajectory.push({ action: action.desc || action, value });

            // Predict next state (use heuristic for speed)
            currentState = {
                ...currentState,
                lastAction: action.desc || action,
                stepsDone: (currentState.stepsDone || 0) + 1,
            };
        }

        return {
            totalValue,
            avgValue: stepsToSimulate.length > 0 ? totalValue / stepsToSimulate.length : 0,
            trajectory,
            depth: stepsToSimulate.length,
        };
    }

    /**
     * Heuristic simulation fallback (no LLM call)
     */
    _heuristicSimulate(steps) {
        return steps.map(step => {
            const riskByLevel = { L0: 'LOW', L1: 'LOW', L2: 'MEDIUM', L3: 'HIGH' };
            const confByLevel = { L0: 0.9, L1: 0.75, L2: 0.5, L3: 0.3 };
            return {
                stepId: step.id,
                expectedOutcome: `Execute: ${step.desc}`,
                riskLevel: riskByLevel[step.level] || 'MEDIUM',
                confidence: confByLevel[step.level] || 0.5,
                valueScore: this.valueFunction({}, step),
            };
        });
    }

    /**
     * Compute value score from prediction
     */
    _computeValueScore(prediction, step) {
        const confidence = prediction.confidence || 0.5;
        const riskPenalty = { LOW: 0, MEDIUM: 0.15, HIGH: 0.35 };
        const penalty = riskPenalty[prediction.riskLevel] || 0.15;
        return Math.max(0, Math.min(1, confidence - penalty));
    }

    /**
     * Get simulation statistics
     */
    getStats() {
        return {
            cacheSize: this._valueCache.size,
            simulationCount: this._simulationHistory.length,
            avgConfidence: this._simulationHistory.length > 0
                ? Math.round(this._simulationHistory.reduce((s, h) => s + h.avgConfidence, 0) / this._simulationHistory.length * 100) / 100
                : null,
        };
    }
}

module.exports = WorldModel;
