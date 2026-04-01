module.exports = function registerSocketHandlers(server) {
    server.io.on('connection', (socket) => {
        const getGolemsData = () => {
            return Array.from(server.contexts.entries()).map(([id, context]) => {
                const status = (context.brain && context.brain.status) || 'running';
                return { id, status };
            });
        };

        const payload = {
            queueCount: server.dashboard ? server.dashboard.queueCount : 0,
            lastSchedule: server.dashboard ? server.dashboard.lastSchedule : 'N/A',
            uptime: process.uptime(),
            logs: server.logBuffer,
            taskEvents: server.taskEventBuffer || [],
            taskViolations: server.taskViolationBuffer || [],
            taskResumes: server.taskResumeBuffer || [],
            taskRecovery: server.taskRecoveryState || {},
            agentEvents: server.agentEventBuffer || [],
            agentViolations: server.agentViolationBuffer || [],
            agentResumes: server.agentResumeBuffer || [],
            agentRecovery: server.agentRecoveryState || {},
            golems: getGolemsData(),
            runtime: server.runtimeController ? server.runtimeController.getRuntimeSnapshot() : null,
        };

        socket.emit('init', payload);

        socket.on('request_logs', () => {
            socket.emit('init', {
                logs: server.logBuffer,
                taskEvents: server.taskEventBuffer || [],
                taskViolations: server.taskViolationBuffer || [],
                taskResumes: server.taskResumeBuffer || [],
                taskRecovery: server.taskRecoveryState || {},
                agentEvents: server.agentEventBuffer || [],
                agentViolations: server.agentViolationBuffer || [],
                agentResumes: server.agentResumeBuffer || [],
                agentRecovery: server.agentRecoveryState || {},
                runtime: server.runtimeController ? server.runtimeController.getRuntimeSnapshot() : null,
            });
        });
    });
};
