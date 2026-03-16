// ============================================================
// SubAgent — Base class for cooperative async agents
// ============================================================

class SubAgent {
    /**
     * @param {Object} options
     * @param {string} options.name - Agent instance name
     * @param {string} options.type - Agent type (sentinel, analyst, worker)
     * @param {string} options.golemId - Parent golem ID
     * @param {Object} options.brain - Brain instance for LLM calls
     * @param {import('./AgentBus')} options.bus - AgentBus instance
     * @param {number} options.tokenBudget - Max tokens per cycle (0 = unlimited/no LLM)
     * @param {number} options.timeoutMs - Tick timeout in ms (default 30000)
     * @param {number} options.oodaIntervalMs - Interval between ticks in ms
     */
    constructor(options = {}) {
        this._name = options.name || 'unnamed';
        this._type = options.type || 'generic';
        this._golemId = options.golemId || 'default';
        this._brain = options.brain || null;
        this._bus = options.bus || null;
        this._tokenBudget = options.tokenBudget || 0;
        this._tokenBudgetMax = options.tokenBudget || 0;
        this._tokenUsed = 0;
        this._timeoutMs = options.timeoutMs || 30000;
        this._oodaIntervalMs = options.oodaIntervalMs || 60000;

        this._status = 'idle'; // idle | running | paused | stopped | error
        this._tickTimer = null;
        this._tickCount = 0;
        this._totalTickMs = 0;
        this._consecutiveFailures = 0;
        this._activityLog = []; // ring buffer max 200
        this._startedAt = null;
    }

    // --- Identity ---

    get id() { return `${this._type}:${this._name}`; }
    get type() { return this._type; }
    get name() { return this._name; }
    get status() { return this._status; }
    get golemId() { return this._golemId; }

    // --- Lifecycle ---

    async start() {
        if (this._status === 'running') return;
        this._status = 'running';
        this._startedAt = Date.now();

        this._logActivity({ event: 'started' });

        if (this._bus) {
            this._bus.publish('agent.started', {
                id: this.id, type: this._type, name: this._name
            }, this.id);
        }

        // Start interval-based OODA tick
        this._tickTimer = setInterval(() => {
            if (this._status === 'running') {
                this._tick().catch(err => {
                    this._consecutiveFailures++;
                    this._logActivity({ event: 'tick_error', error: err.message });
                    if (this._consecutiveFailures >= 5) {
                        this._status = 'error';
                        clearInterval(this._tickTimer);
                        this._tickTimer = null;
                        console.error(`[SubAgent:${this.id}] Too many failures (${this._consecutiveFailures}), auto-stopped`);
                    }
                });
            }
        }, this._oodaIntervalMs);
    }

    async stop() {
        if (this._status === 'stopped') return;

        if (this._tickTimer) {
            clearInterval(this._tickTimer);
            this._tickTimer = null;
        }

        this._status = 'stopped';
        this._logActivity({ event: 'stopped' });

        if (this._bus) {
            this._bus.publish('agent.stopped', { id: this.id }, this.id);
            this._bus.unsubscribeAll(this.id);
        }
    }

    pause() {
        if (this._status !== 'running') return;
        this._status = 'paused';
        this._logActivity({ event: 'paused' });
    }

    resume() {
        if (this._status !== 'paused') return;
        this._status = 'running';
        this._consecutiveFailures = 0;
        this._logActivity({ event: 'resumed' });
    }

    // --- Micro OODA Loop ---

    async _tick() {
        const start = Date.now();
        this._tickCount++;

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Tick timeout')), this._timeoutMs)
        );

        try {
            await Promise.race([this._runOODA(), timeoutPromise]);
            this._consecutiveFailures = 0;
        } catch (err) {
            this._consecutiveFailures++;
            this._logActivity({ event: 'tick_error', error: err.message });
            throw err;
        } finally {
            this._totalTickMs += Date.now() - start;
        }
    }

    async _runOODA() {
        const observations = await this._observe();
        const analysis = this._orient(observations);
        const decision = this._decide(analysis);

        this._logActivity({ event: 'decision', action: decision.action, level: decision.level });

        if (decision.action !== 'noop') {
            await this._act(decision);
        }
    }

    // Subclasses override these
    async _observe() { return {}; }
    _orient(observations) { return observations; }
    _decide(analysis) { return { action: 'noop', level: 'L0', reason: 'base class', payload: null }; }
    async _act(decision) { }

    // --- Resource Control ---

    _consumeTokenBudget(cost) {
        if (this._tokenBudgetMax === 0) return true; // no budget = unlimited
        if (this._tokenUsed + cost > this._tokenBudgetMax) return false;
        this._tokenUsed += cost;
        return true;
    }

    _resetTokenBudget() {
        this._tokenUsed = 0;
    }

    // --- Communication ---

    publish(topic, payload) {
        if (this._bus) {
            this._bus.publish(topic, payload, this.id);
        }
    }

    subscribe(topic, handler) {
        if (this._bus) {
            this._bus.subscribe(topic, handler, this.id);
        }
    }

    // --- Audit ---

    _logActivity(entry) {
        this._activityLog.push({
            ...entry,
            agentId: this.id,
            timestamp: Date.now()
        });
        if (this._activityLog.length > 200) this._activityLog.shift();
    }

    getActivityLog(limit = 20) {
        return this._activityLog.slice(-limit);
    }

    getMetrics() {
        return {
            id: this.id,
            type: this._type,
            status: this._status,
            tickCount: this._tickCount,
            avgTickMs: this._tickCount > 0 ? Math.round(this._totalTickMs / this._tickCount) : 0,
            tokenUsed: this._tokenUsed,
            tokenBudget: this._tokenBudgetMax,
            consecutiveFailures: this._consecutiveFailures,
            uptime: this._startedAt ? Date.now() - this._startedAt : 0
        };
    }
}

module.exports = SubAgent;
