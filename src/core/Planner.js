// ============================================================
// Planner — LangGraph Plan-and-Execute Pattern
// Plan → Execute → Observe → Re-plan loop with state management
// ============================================================
const { v4: uuidv4 } = require('uuid');
const TaskDecomposer = require('./TaskDecomposer');
const PlanCheckpoint = require('./PlanCheckpoint');

const PLAN_STATUS = { PENDING: 'pending', RUNNING: 'running', COMPLETED: 'completed', FAILED: 'failed', REPLANNING: 'replanning' };
const MAX_REPLAN_CYCLES = 3;
const STEP_TIMEOUT_MS = 120000;

class Planner {
    constructor(brain, options = {}) {
        this.brain = brain;
        this.golemId = options.golemId || 'default';
        this.decomposer = new TaskDecomposer(brain, options);
        this.worldModel = options.worldModel || null;
        this.metricsCollector = options.metricsCollector || null;
        this.checkpoint = options.checkpoint || new PlanCheckpoint({ golemId: this.golemId });
        this._activePlan = null;
        this._planHistory = [];
    }

    /**
     * Create a new execution plan from a goal
     * @param {string} goal - High-level objective
     * @param {Object} context - Additional context
     * @returns {PlanState}
     */
    async createPlan(goal, context = {}) {
        const planId = `plan_${uuidv4().substring(0, 8)}`;
        const decomposed = await this.decomposer.decompose(goal);
        const sorted = this.decomposer.topologicalSort(decomposed.tasks);

        // Simulate outcomes if world model available
        let predictions = null;
        if (this.worldModel) {
            predictions = await this.worldModel.simulate(goal, sorted);
        }

        const plan = {
            id: planId,
            goal,
            context,
            status: PLAN_STATUS.PENDING,
            steps: sorted.map((task, idx) => ({
                id: task.id,
                description: task.desc,
                deps: task.deps || [],
                level: task.level || 'L1',
                status: PLAN_STATUS.PENDING,
                result: null,
                error: null,
                attempts: 0,
                prediction: predictions ? predictions[idx] : null,
                startedAt: null,
                completedAt: null,
            })),
            replanCount: 0,
            observations: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        this._activePlan = plan;
        this._planHistory.push({ id: planId, goal, createdAt: plan.createdAt });
        if (this._planHistory.length > 50) this._planHistory.shift();

        // Phase 1B: Auto-checkpoint on plan creation
        this.checkpoint.save(planId, plan, { event: 'created' });

        console.log(`[Planner] Created plan ${planId}: ${sorted.length} steps for "${goal.substring(0, 50)}..."`);
        return plan;
    }

    /**
     * Execute the active plan step-by-step
     * @param {Object} ctx - Telegram/platform context
     * @param {Function} executeStep - (ctx, step) => Promise<result>
     * @returns {{ plan, results }}
     */
    async executePlan(ctx, executeStep) {
        if (!this._activePlan) throw new Error('No active plan');
        const plan = this._activePlan;
        plan.status = PLAN_STATUS.RUNNING;
        const results = [];

        for (const step of plan.steps) {
            if (step.status === PLAN_STATUS.COMPLETED) continue;

            // Check dependencies
            const depsReady = step.deps.every(depId => {
                const dep = plan.steps.find(s => s.id === depId);
                return dep && dep.status === PLAN_STATUS.COMPLETED;
            });
            if (!depsReady) {
                step.status = PLAN_STATUS.FAILED;
                step.error = 'Dependencies not met';
                results.push({ stepId: step.id, status: 'skipped', reason: 'deps_not_met' });
                continue;
            }

            step.status = PLAN_STATUS.RUNNING;
            step.startedAt = Date.now();
            step.attempts++;

            try {
                const result = await Promise.race([
                    executeStep(ctx, step),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Step timeout')), STEP_TIMEOUT_MS)
                    ),
                ]);

                step.status = PLAN_STATUS.COMPLETED;
                step.result = typeof result === 'string' ? result.substring(0, 1000) : result;
                step.completedAt = Date.now();
                results.push({ stepId: step.id, status: 'completed', result: step.result });

                // Record observation
                plan.observations.push({
                    stepId: step.id,
                    type: 'success',
                    timestamp: Date.now(),
                });

                // Phase 1B: Checkpoint after step completion
                this.checkpoint.save(plan.id, plan, { event: 'step_done', stepId: step.id });

                if (this.metricsCollector) {
                    this.metricsCollector.record('plan_step_success', {
                        planId: plan.id, stepId: step.id,
                        durationMs: step.completedAt - step.startedAt,
                    });
                }
            } catch (e) {
                step.status = PLAN_STATUS.FAILED;
                step.error = e.message;
                step.completedAt = Date.now();

                plan.observations.push({
                    stepId: step.id,
                    type: 'failure',
                    error: e.message,
                    timestamp: Date.now(),
                });

                results.push({ stepId: step.id, status: 'failed', error: e.message });

                if (this.metricsCollector) {
                    this.metricsCollector.record('plan_step_failure', {
                        planId: plan.id, stepId: step.id, error: e.message,
                    });
                }

                // Attempt re-planning
                if (plan.replanCount < MAX_REPLAN_CYCLES) {
                    console.log(`[Planner] Step ${step.id} failed, attempting re-plan (${plan.replanCount + 1}/${MAX_REPLAN_CYCLES})`);
                    const replanned = await this._replan(plan, step, e.message);
                    if (replanned) {
                        // Continue with new steps
                        continue;
                    }
                }

                console.warn(`[Planner] Step ${step.id} failed, no re-plan possible`);
            }
        }

        // Determine overall status
        const allCompleted = plan.steps.every(s => s.status === PLAN_STATUS.COMPLETED);
        const anyFailed = plan.steps.some(s => s.status === PLAN_STATUS.FAILED);
        plan.status = allCompleted ? PLAN_STATUS.COMPLETED : (anyFailed ? PLAN_STATUS.FAILED : PLAN_STATUS.COMPLETED);
        plan.updatedAt = Date.now();

        return { plan, results };
    }

    /**
     * Re-plan after failure: ask brain for revised steps
     */
    async _replan(plan, failedStep, errorMsg) {
        plan.replanCount++;
        plan.status = PLAN_STATUS.REPLANNING;

        // Phase 1B: Checkpoint before replan
        this.checkpoint.save(plan.id, plan, { event: 'pre_replan', failedStep: failedStep.id });

        const completedSteps = plan.steps
            .filter(s => s.status === PLAN_STATUS.COMPLETED)
            .map(s => `[Done] ${s.description}: ${String(s.result).substring(0, 100)}`);

        const prompt = `【系統指令: 計劃修正】
原始目標: ${plan.goal}
已完成步驟:
${completedSteps.join('\n') || '(無)'}

失敗步驟: ${failedStep.description}
錯誤原因: ${errorMsg}

請生成替代步驟來完成剩餘目標。
回覆 JSON:
{
    "tasks": [
        { "id": "r1", "desc": "替代步驟描述", "deps": [], "level": "L1" }
    ]
}`;

        try {
            const raw = await this.brain.sendMessage(prompt, true);
            const jsonMatch = raw.match(/\{[\s\S]*"tasks"[\s\S]*\}/);
            if (!jsonMatch) return false;

            const parsed = JSON.parse(jsonMatch[0]);
            const newSteps = (parsed.tasks || []).map(t => ({
                id: t.id || `replan_${uuidv4().substring(0, 4)}`,
                description: t.desc,
                deps: t.deps || [],
                level: t.level || 'L1',
                status: PLAN_STATUS.PENDING,
                result: null,
                error: null,
                attempts: 0,
                prediction: null,
                startedAt: null,
                completedAt: null,
            }));

            // Replace remaining pending steps
            const failedIdx = plan.steps.indexOf(failedStep);
            plan.steps = [
                ...plan.steps.slice(0, failedIdx),
                ...newSteps,
            ];

            plan.status = PLAN_STATUS.RUNNING;

            // Phase 1B: Checkpoint after replan
            this.checkpoint.save(plan.id, plan, { event: 'post_replan', newSteps: newSteps.length });

            console.log(`[Planner] Re-planned: ${newSteps.length} new steps`);
            return true;
        } catch (e) {
            console.warn('[Planner] Re-plan failed:', e.message);
            return false;
        }
    }

    /**
     * Execute independent steps in parallel (LangGraph parallel branches)
     */
    async executeParallel(ctx, executeStep) {
        if (!this._activePlan) throw new Error('No active plan');
        const plan = this._activePlan;
        plan.status = PLAN_STATUS.RUNNING;
        const results = [];

        // Group steps by dependency layers
        const layers = this._buildParallelLayers(plan.steps);

        for (const layer of layers) {
            // Execute all steps in this layer concurrently
            const promises = layer.map(async (step) => {
                step.status = PLAN_STATUS.RUNNING;
                step.startedAt = Date.now();
                step.attempts++;

                try {
                    const result = await Promise.race([
                        executeStep(ctx, step),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Step timeout')), STEP_TIMEOUT_MS)
                        ),
                    ]);
                    step.status = PLAN_STATUS.COMPLETED;
                    step.result = typeof result === 'string' ? result.substring(0, 1000) : result;
                    step.completedAt = Date.now();
                    return { stepId: step.id, status: 'completed', result: step.result };
                } catch (e) {
                    step.status = PLAN_STATUS.FAILED;
                    step.error = e.message;
                    step.completedAt = Date.now();
                    return { stepId: step.id, status: 'failed', error: e.message };
                }
            });

            const layerResults = await Promise.allSettled(promises);
            for (const r of layerResults) {
                results.push(r.status === 'fulfilled' ? r.value : { status: 'error', error: r.reason?.message });
            }
        }

        const allCompleted = plan.steps.every(s => s.status === PLAN_STATUS.COMPLETED);
        plan.status = allCompleted ? PLAN_STATUS.COMPLETED : PLAN_STATUS.FAILED;
        plan.updatedAt = Date.now();
        return { plan, results };
    }

    /**
     * Build parallel execution layers from dependency graph
     * Returns array of layers, each layer contains independent steps
     */
    _buildParallelLayers(steps) {
        const layers = [];
        const completed = new Set();
        const remaining = [...steps];

        while (remaining.length > 0) {
            const layer = [];
            const nextRemaining = [];

            for (const step of remaining) {
                const depsReady = (step.deps || []).every(d => completed.has(d));
                if (depsReady) {
                    layer.push(step);
                } else {
                    nextRemaining.push(step);
                }
            }

            if (layer.length === 0) {
                // Deadlock: add all remaining to avoid infinite loop
                layers.push(nextRemaining);
                break;
            }

            layers.push(layer);
            layer.forEach(s => completed.add(s.id));
            remaining.length = 0;
            remaining.push(...nextRemaining);
        }

        return layers;
    }

    /** Get the active plan */
    getActivePlan() { return this._activePlan; }

    /** Get plan history */
    getPlanHistory() { return this._planHistory; }

    /** Cancel active plan */
    cancelPlan() {
        if (this._activePlan) {
            this._activePlan.status = 'cancelled';
            this._activePlan.updatedAt = Date.now();
            console.log(`[Planner] Plan ${this._activePlan.id} cancelled`);
        }
        this._activePlan = null;
    }
}

Planner.PLAN_STATUS = PLAN_STATUS;
module.exports = Planner;
