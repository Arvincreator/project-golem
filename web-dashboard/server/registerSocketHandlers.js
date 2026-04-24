module.exports = function registerSocketHandlers(server) {
    server.io.on('connection', (socket) => {
        const dashboardState = server.dashboard && server.dashboard.manager && server.dashboard.manager.state
            ? server.dashboard.manager.state
            : {};

        const getGolemsData = () => {
            return Array.from(server.contexts.entries()).map(([id, context]) => {
                const status = (context.brain && context.brain.status) || 'running';
                return { id, status };
            });
        };

        const payload = {
            queueCount: dashboardState.queueCount || 0,
            lastSchedule: dashboardState.lastSchedule || 'N/A',
            agentWorkersActive: dashboardState.agentWorkersActive || 0,
            agentWorkerTimeouts: dashboardState.agentWorkerTimeouts || 0,
            agentWorkerSendTimeouts: dashboardState.agentWorkerSendTimeouts || 0,
            agentWorkerIdleTimeouts: dashboardState.agentWorkerIdleTimeouts || 0,
            agentWorkerDraftPendingChecks: dashboardState.agentWorkerDraftPendingChecks || 0,
            lastAgentWorkerEvent: dashboardState.lastAgentWorkerEvent || 'N/A',
            uptime: process.uptime(),
            logs: server.logBuffer,
            golems: getGolemsData()
        };

        socket.emit('init', payload);

        socket.on('request_logs', () => {
            socket.emit('init', { logs: server.logBuffer });
        });
    });
};
