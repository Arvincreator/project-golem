// ============================================================
// WorkerAgent — Task execution (30s interval, 3000 token budget)
// ============================================================
const SubAgent = require('../SubAgent');

class WorkerAgent extends SubAgent {
    constructor(options = {}) {
        super({
            ...options,
            type: 'worker',
            name: options.name || 'worker-0',
            tokenBudget: options.tokenBudget || 3000,
            oodaIntervalMs: options.oodaIntervalMs || 30000,
            timeoutMs: options.timeoutMs || 30000,
        });

        this._pendingTasks = [];

        // Subscribe to task requests (non-analysis)
        this.subscribe('task.request', (msg) => {
            if (msg.payload?.type !== 'analysis') {
                this._pendingTasks.push(msg.payload);
                if (this._pendingTasks.length > 20) this._pendingTasks.shift();
            }
        });
    }

    async _observe() {
        return {
            pendingTasks: [...this._pendingTasks],
        };
    }

    _orient(observations) {
        return {
            hasTasks: observations.pendingTasks.length > 0,
            taskCount: observations.pendingTasks.length,
            tasks: observations.pendingTasks,
        };
    }

    _decide(analysis) {
        if (!analysis.hasTasks) {
            this._resetTokenBudget();
            return { action: 'noop', level: 'L0', reason: 'No pending tasks', payload: null };
        }

        // Take one task at a time
        const task = analysis.tasks[0];
        return {
            action: 'execute_task',
            level: 'L0',
            reason: `Executing task: ${task.type || 'generic'}`,
            payload: { task }
        };
    }

    async _act(decision) {
        const task = decision.payload?.task;
        if (!task) return;

        const estimatedTokens = 1500;
        if (this._brain && !this._consumeTokenBudget(estimatedTokens)) {
            this._logActivity({ event: 'budget_exceeded', tokenUsed: this._tokenUsed, budget: this._tokenBudgetMax });
            return;
        }

        try {
            let result;

            if (this._brain && task.prompt) {
                result = await this._brain.sendMessage(task.prompt);
            } else {
                result = `Task processed: ${JSON.stringify(task).substring(0, 200)}`;
            }

            // Publish result
            this.publish('task.result', {
                type: 'task_execution',
                source: this.id,
                taskType: task.type,
                result: String(result).substring(0, 1000),
            });

            // Remove processed task
            this._pendingTasks.shift();

            this._logActivity({ event: 'task_complete', taskType: task.type });
        } catch (err) {
            this._logActivity({ event: 'task_error', error: err.message });
            // Remove failed task to prevent retry loop
            this._pendingTasks.shift();
        } finally {
            this._resetTokenBudget();
        }
    }
}

module.exports = WorkerAgent;
