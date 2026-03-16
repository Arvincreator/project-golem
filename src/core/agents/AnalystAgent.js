// ============================================================
// AnalystAgent — Deep analysis with brain calls (120s interval)
// ============================================================
const SubAgent = require('../SubAgent');

class AnalystAgent extends SubAgent {
    constructor(options = {}) {
        super({
            ...options,
            type: 'analyst',
            name: options.name || 'analyst-0',
            tokenBudget: options.tokenBudget || 5000,
            oodaIntervalMs: options.oodaIntervalMs || 120000,
            timeoutMs: options.timeoutMs || 60000,
        });

        this._pendingAlerts = [];

        // Subscribe to alerts from sentinel
        this.subscribe('alert', (msg) => {
            if (msg.senderId !== this.id) {
                this._pendingAlerts.push(msg.payload);
                if (this._pendingAlerts.length > 20) this._pendingAlerts.shift();
            }
        });

        // Subscribe to task requests
        this._pendingTasks = [];
        this.subscribe('task.request', (msg) => {
            if (msg.payload?.type === 'analysis') {
                this._pendingTasks.push(msg.payload);
                if (this._pendingTasks.length > 10) this._pendingTasks.shift();
            }
        });
    }

    async _observe() {
        return {
            pendingAlerts: [...this._pendingAlerts],
            pendingTasks: [...this._pendingTasks],
        };
    }

    _orient(observations) {
        const totalPending = observations.pendingAlerts.length + observations.pendingTasks.length;
        return {
            hasPending: totalPending > 0,
            alertCount: observations.pendingAlerts.length,
            taskCount: observations.pendingTasks.length,
            items: [...observations.pendingAlerts, ...observations.pendingTasks],
        };
    }

    _decide(analysis) {
        if (!analysis.hasPending) {
            this._resetTokenBudget();
            return { action: 'noop', level: 'L0', reason: 'No pending items', payload: null };
        }

        return {
            action: 'analyze',
            level: 'L0',
            reason: `${analysis.alertCount} alerts, ${analysis.taskCount} tasks pending`,
            payload: { items: analysis.items }
        };
    }

    async _act(decision) {
        if (!this._brain) {
            this._logActivity({ event: 'skip_no_brain', reason: 'No brain instance' });
            return;
        }

        const estimatedTokens = 2000;
        if (!this._consumeTokenBudget(estimatedTokens)) {
            this._logActivity({ event: 'budget_exceeded', tokenUsed: this._tokenUsed, budget: this._tokenBudgetMax });
            return;
        }

        try {
            const items = decision.payload?.items || [];
            const summary = items.map(item => {
                if (item.alerts) return item.alerts.map(a => a.detail).join(', ');
                if (item.payload) return item.payload;
                return JSON.stringify(item).substring(0, 200);
            }).join('\n');

            const prompt = `[System Analysis Request]\nAnalyze the following system alerts/tasks and provide a brief assessment:\n${summary}\n\nProvide: 1) Root cause hypothesis 2) Recommended action 3) Priority (low/medium/high)`;

            const response = await this._brain.sendMessage(prompt);

            // Publish analysis result
            this.publish('task.result', {
                type: 'analysis',
                source: this.id,
                input: summary.substring(0, 200),
                result: String(response).substring(0, 1000),
            });

            // Clear processed items
            this._pendingAlerts = [];
            this._pendingTasks = [];

            this._logActivity({ event: 'analysis_complete', itemCount: items.length });
        } catch (err) {
            this._logActivity({ event: 'analysis_error', error: err.message });
        } finally {
            this._resetTokenBudget();
        }
    }
}

module.exports = AnalystAgent;
