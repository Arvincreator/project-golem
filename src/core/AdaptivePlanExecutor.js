// ============================================================
// AdaptivePlanExecutor — Plan-Execute-Observe-Replan Loop
// LangGraph Plan-and-Execute + Devin Adaptive Planning
// Orchestrates Planner, WorldModel, PlanCheckpoint, ExperienceReplay
// ============================================================

const MAX_BRAIN_CALLS_PER_PLAN = parseInt(process.env.MAX_BRAIN_CALLS_PER_PLAN || '5');

class AdaptivePlanExecutor {
    constructor(options = {}) {
        this.planner = options.planner;
        this.worldModel = options.worldModel;
        this.checkpoint = options.checkpoint;
        this.experienceReplay = options.experienceReplay;
        this.metrics = options.metrics || null;
        this._brainCallCount = 0;
    }

    /**
     * Execute an adaptive plan-execute-observe-replan loop
     * @param {string} goal - High-level objective
     * @param {Object} context - Additional context
     * @param {Object} ctx - Platform context (Telegram etc)
     * @param {Object} brain - GolemBrain instance
     * @returns {{ plan, results, replans }}
     */
    async run(goal, context, ctx, brain) {
        this._brainCallCount = 0;
        const results = [];
        let replans = 0;
        const DIVERGENCE_THRESHOLD = 0.4;

        // 1. Create plan
        const plan = await this.planner.createPlan(goal, context);

        // 2. Generate predictions via WorldModel
        let predictions = null;
        if (this.worldModel) {
            try {
                predictions = await this.worldModel.simulate(goal, plan.steps);
            } catch (e) {
                console.warn('[AdaptivePlanExecutor] WorldModel simulation failed:', e.message);
            }
        }

        // 3. Save initial checkpoint
        if (this.checkpoint) {
            this.checkpoint.save(plan.id, plan, { event: 'created' });
        }

        // 4. Execute each step with divergence detection
        for (let i = 0; i < plan.steps.length; i++) {
            const step = plan.steps[i];
            if (step.status === 'completed') continue;

            // Budget check
            if (this._brainCallCount >= MAX_BRAIN_CALLS_PER_PLAN) {
                console.warn(`[AdaptivePlanExecutor] Brain call budget exhausted (${MAX_BRAIN_CALLS_PER_PLAN}), stopping plan execution`);
                step.status = 'skipped';
                step.error = 'budget_exhausted';
                results.push({ stepId: step.id, status: 'skipped', reason: 'budget_exhausted' });
                continue;
            }

            step.status = 'running';
            step.startedAt = Date.now();

            try {
                // B3: Execute step via brain with cumulative context from previous results
                const result = await this._executeStep(brain, step, ctx, results);
                this._brainCallCount++;

                step.status = 'completed';
                step.result = typeof result === 'string' ? result.substring(0, 1000) : result;
                step.completedAt = Date.now();

                results.push({ stepId: step.id, status: 'completed', result: step.result });

                // Record trace
                if (this.experienceReplay) {
                    this.experienceReplay.recordTrace({
                        goal: goal.substring(0, 200),
                        action: step.description,
                        result: String(step.result).substring(0, 200),
                        success: true,
                        reward: 1.0,
                        duration: step.completedAt - step.startedAt,
                    });
                }

                // Checkpoint after step completion
                if (this.checkpoint) {
                    this.checkpoint.save(plan.id, plan, { event: 'step_done', stepId: step.id });
                }

                // Divergence detection: compare result with prediction
                if (predictions && predictions[i]) {
                    const divergence = this._computeDivergence(step.result, predictions[i]);
                    if (divergence > DIVERGENCE_THRESHOLD && this._brainCallCount < MAX_BRAIN_CALLS_PER_PLAN) {
                        console.log(`[AdaptivePlanExecutor] High divergence (${divergence.toFixed(2)}) at step ${step.id}, triggering replan`);

                        if (this.checkpoint) {
                            this.checkpoint.save(plan.id, plan, { event: 'pre_replan', divergence });
                        }

                        const replanned = await this.planner._replan(plan, step, `Divergence: ${divergence.toFixed(2)} — actual result differs from prediction`);
                        this._brainCallCount++;
                        replans++;

                        if (replanned) {
                            // Re-simulate new steps
                            if (this.worldModel) {
                                try {
                                    predictions = await this.worldModel.simulate(goal, plan.steps);
                                } catch (e) { /* continue without predictions */ }
                            }
                            if (this.checkpoint) {
                                this.checkpoint.save(plan.id, plan, { event: 'post_replan' });
                            }
                        }
                    }
                }

            } catch (e) {
                step.status = 'failed';
                step.error = e.message;
                step.completedAt = Date.now();

                results.push({ stepId: step.id, status: 'failed', error: e.message });

                if (this.experienceReplay) {
                    this.experienceReplay.recordTrace({
                        goal: goal.substring(0, 200),
                        action: step.description,
                        result: `error: ${e.message}`,
                        success: false,
                        reward: 0,
                        duration: step.completedAt - step.startedAt,
                    });
                }

                if (this.checkpoint) {
                    this.checkpoint.save(plan.id, plan, { event: 'step_failed', stepId: step.id, error: e.message });
                }

                // Attempt replan
                if (plan.replanCount < 3 && this._brainCallCount < MAX_BRAIN_CALLS_PER_PLAN) {
                    const replanned = await this.planner._replan(plan, step, e.message);
                    this._brainCallCount++;
                    replans++;

                    if (!replanned) {
                        console.warn(`[AdaptivePlanExecutor] Replan failed at step ${step.id}`);
                    }
                }
            }
        }

        // Final status
        const allCompleted = plan.steps.every(s => s.status === 'completed');
        plan.status = allCompleted ? 'completed' : 'failed';
        plan.updatedAt = Date.now();

        if (this.metrics) {
            this.metrics.record('adaptive_plan_complete', {
                planId: plan.id,
                stepsTotal: plan.steps.length,
                stepsCompleted: plan.steps.filter(s => s.status === 'completed').length,
                replans,
                brainCalls: this._brainCallCount,
            });
        }

        return { plan, results, replans, brainCalls: this._brainCallCount };
    }

    /**
     * Execute a single step via brain
     * B3: Includes cumulative context from previous results
     */
    async _executeStep(brain, step, ctx, previousResults = []) {
        let contextPart = '';
        if (previousResults.length > 0) {
            const completedSummary = previousResults
                .filter(r => r.status === 'completed')
                .map(r => `- ${r.stepId}: ${String(r.result).substring(0, 150)}`)
                .join('\n');
            if (completedSummary) {
                contextPart = `\n已完成步驟:\n${completedSummary}\n`;
            }
        }
        const prompt = `【任務執行】\n步驟: ${step.description}${contextPart}\n${step.prediction ? `預期結果: ${JSON.stringify(step.prediction).substring(0, 200)}` : ''}\n請執行此步驟並回報結果。`;
        return await brain.sendMessage(prompt, true);
    }

    /**
     * Compute divergence between actual result and prediction
     * Returns 0.0 (identical) to 1.0 (completely different)
     */
    _computeDivergence(actual, prediction) {
        if (!actual || !prediction) return 0;
        const actualStr = typeof actual === 'string' ? actual : JSON.stringify(actual);
        const predStr = typeof prediction === 'string' ? prediction : JSON.stringify(prediction);

        // Simple Jaccard-based divergence on word sets
        const wordsA = new Set(actualStr.toLowerCase().split(/\s+/).filter(w => w.length > 2));
        const wordsB = new Set(predStr.toLowerCase().split(/\s+/).filter(w => w.length > 2));

        if (wordsA.size === 0 && wordsB.size === 0) return 0;

        let intersection = 0;
        for (const w of wordsA) {
            if (wordsB.has(w)) intersection++;
        }
        const union = new Set([...wordsA, ...wordsB]).size;
        const jaccard = union > 0 ? intersection / union : 0;
        return 1 - jaccard; // divergence = 1 - similarity
    }
}

module.exports = AdaptivePlanExecutor;
