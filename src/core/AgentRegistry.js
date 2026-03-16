// ============================================================
// AgentRegistry — Lifecycle management for SubAgents
// ============================================================
const AgentBus = require('./AgentBus');
const { AgentSpawnError } = require('./errors');

class AgentRegistry {
    /**
     * @param {Object} options
     * @param {string} options.golemId
     * @param {number} options.maxAgents - Maximum concurrent agents (default 10)
     */
    constructor(options = {}) {
        this._agents = new Map(); // id → SubAgent
        this._bus = new AgentBus();
        this._maxAgents = options.maxAgents || 10;
        this._golemId = options.golemId || 'default';
    }

    /**
     * Spawn a new agent
     * @param {typeof import('./SubAgent')} AgentClass - SubAgent subclass
     * @param {Object} options - Options passed to agent constructor
     * @returns {import('./SubAgent')} The spawned agent
     */
    spawn(AgentClass, options = {}) {
        if (this._agents.size >= this._maxAgents) {
            throw new AgentSpawnError(`Max agents (${this._maxAgents}) reached`);
        }

        const agent = new AgentClass({
            ...options,
            bus: this._bus,
            golemId: options.golemId || this._golemId,
        });

        if (this._agents.has(agent.id)) {
            throw new AgentSpawnError(`Agent ${agent.id} already exists`);
        }

        this._agents.set(agent.id, agent);
        agent.start();

        return agent;
    }

    /**
     * Gracefully stop an agent with timeout
     * @param {string} agentId
     * @param {number} timeoutMs - Stop timeout (default 5000)
     */
    async stop(agentId, timeoutMs = 5000) {
        const agent = this._agents.get(agentId);
        if (!agent) return;

        let timer;
        const timeout = new Promise(resolve => {
            timer = setTimeout(() => resolve('timeout'), timeoutMs);
        });

        try {
            await Promise.race([agent.stop(), timeout]);
        } catch (err) {
            console.warn(`[AgentRegistry] Error stopping ${agentId}: ${err.message}`);
        } finally {
            clearTimeout(timer);
        }

        this._agents.delete(agentId);
    }

    /**
     * Stop all agents
     */
    async stopAll() {
        const ids = [...this._agents.keys()];
        await Promise.allSettled(ids.map(id => this.stop(id)));
    }

    /**
     * Get agent by ID
     * @param {string} agentId
     * @returns {import('./SubAgent')|undefined}
     */
    get(agentId) {
        return this._agents.get(agentId);
    }

    /**
     * Get all agents of a specific type
     * @param {string} type
     * @returns {import('./SubAgent')[]}
     */
    getByType(type) {
        return [...this._agents.values()].filter(a => a.type === type);
    }

    /**
     * List all agents with summary info
     * @returns {Array<{ id: string, type: string, status: string, metrics: Object }>}
     */
    list() {
        return [...this._agents.values()].map(a => ({
            id: a.id,
            type: a.type,
            status: a.status,
            metrics: a.getMetrics()
        }));
    }

    /**
     * Get health summary
     * @returns {{ total: number, byType: Object, byStatus: Object }}
     */
    getHealth() {
        const byType = {};
        const byStatus = {};

        for (const agent of this._agents.values()) {
            byType[agent.type] = (byType[agent.type] || 0) + 1;
            byStatus[agent.status] = (byStatus[agent.status] || 0) + 1;
        }

        return { total: this._agents.size, byType, byStatus };
    }

    /**
     * Expose bus for external subscriptions
     * @returns {AgentBus}
     */
    getBus() {
        return this._bus;
    }
}

module.exports = AgentRegistry;
