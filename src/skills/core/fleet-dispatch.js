// fleet-dispatch.js — Push tasks to OpenClaw OODA Fleet
// Dispatches sub-tasks to Cloudflare Workers via Graph RAG ingest
const AragClient = require('../../services/AragClient');

module.exports = {
    name: 'fleet-dispatch',
    description: 'Dispatch tasks to the OpenClaw OODA Fleet for distributed execution',
    usage: '/skill fleet-dispatch <task description>',

    async run(ctx) {
        const task = (ctx.args && ctx.args.task) || ctx.message || '';
        if (!task) return { error: 'No task provided' };

        try {
            const client = new AragClient();
            const result = await client.ingest({
                type: 'fleet_task',
                source: 'rendan',
                content: task,
                metadata: {
                    priority: (ctx.args && ctx.args.priority) || 'normal',
                    dispatchedBy: 'rendan',
                    timestamp: Date.now(),
                }
            });
            return { dispatched: true, task, result };
        } catch (e) {
            return { error: e.message };
        }
    }
};
