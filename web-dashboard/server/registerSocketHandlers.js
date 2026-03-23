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
            golems: getGolemsData()
        };

        socket.emit('init', payload);

        socket.on('request_logs', () => {
            socket.emit('init', { logs: server.logBuffer });
        });
    });
};
