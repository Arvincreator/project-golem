const DashboardManager = require('../src/managers/DashboardManager');

describe('DashboardManager worker lifecycle state', () => {
    test('tracks worker lifecycle counters from InteractiveMultiAgent logs', () => {
        const manager = new DashboardManager();

        manager.dispatchLog(['[InteractiveMultiAgent][WorkerLifecycle] event=spawned agentKey=alex toolset=creative']);
        expect(manager.state.agentWorkersActive).toBe(1);
        expect(manager.state.agentWorkerTimeouts).toBe(0);
        expect(manager.state.lastAgentWorkerEvent).toContain('spawned');

        manager.dispatchLog(['[InteractiveMultiAgent][WorkerLifecycle] event=timeout agentKey=alex toolset=creative']);
        expect(manager.state.agentWorkersActive).toBe(0);
        expect(manager.state.agentWorkerTimeouts).toBe(1);
        expect(manager.state.lastAgentWorkerEvent).toContain('timeout');

        manager.dispatchLog(['[InteractiveMultiAgent][WorkerLifecycle] event=spawned agentKey=bob toolset=coding']);
        manager.dispatchLog(['[InteractiveMultiAgent][WorkerLifecycle] event=disposed agentKey=bob reason=conversation_end']);
        expect(manager.state.agentWorkersActive).toBe(0);
        expect(manager.state.lastAgentWorkerEvent).toContain('disposed');
    });
});
