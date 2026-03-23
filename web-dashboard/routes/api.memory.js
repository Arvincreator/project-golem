const express = require('express');
const fs = require('fs');
const { resolveActiveContext } = require('./utils/context');
const { buildOperationGuard } = require('../server/security');

module.exports = function registerMemoryRoutes(server) {
    const router = express.Router();
    const requireMemoryAdmin = buildOperationGuard(server, 'memory_mutation');

    router.get('/api/memory', async (req, res) => {
        const { golemId, context } = resolveActiveContext(server, req.query.golemId);
        if (!context || !context.memory) return res.status(503).json({ error: 'Memory not engaged' });

        try {
            if (context.memory.data) return res.json(context.memory.data);
            const results = await context.memory.recall('');
            return res.json(results);
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.delete('/api/memory', requireMemoryAdmin, async (req, res) => {
        const { context } = resolveActiveContext(server, req.query.golemId);
        if (!context || !context.memory) return res.status(503).json({ error: 'Memory not engaged' });

        try {
            if (typeof context.memory.clearMemory === 'function') {
                await context.memory.clearMemory();
                return res.json({ success: true, message: 'Memory cleared' });
            }
            return res.status(501).json({ error: 'Clear memory not supported by this driver' });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/memory/export', async (req, res) => {
        const { golemId, context } = resolveActiveContext(server, req.query.golemId);
        if (!context || !context.memory) return res.status(503).json({ error: 'Memory not engaged' });

        try {
            if (typeof context.memory.exportMemory !== 'function') {
                return res.status(501).json({ error: 'Export memory not supported by this driver' });
            }

            const data = await context.memory.exportMemory();
            res.setHeader('Content-disposition', `attachment; filename=memory_${golemId || 'export'}_${Date.now()}.json`);
            res.setHeader('Content-type', 'application/json');
            return res.send(data);
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/memory/import', requireMemoryAdmin, async (req, res) => {
        const { context } = resolveActiveContext(server, req.query.golemId);
        if (!context || !context.memory) return res.status(503).json({ error: 'Memory not engaged' });

        try {
            if (typeof context.memory.importMemory !== 'function') {
                return res.status(501).json({ error: 'Import memory not supported by this driver' });
            }

            const result = await context.memory.importMemory(JSON.stringify(req.body));
            if (result.success) return res.json(result);
            return res.status(400).json(result);
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/memory', requireMemoryAdmin, async (req, res) => {
        const { golemId, context } = resolveActiveContext(server, req.query.golemId);
        if (!context || !context.memory) return res.status(503).json({ error: 'Memory not engaged' });

        try {
            const { text, metadata } = req.body;
            await context.memory.memorize(text, metadata || {});
            server.io.emit('memory_update', { action: 'add', text, metadata, golemId });
            return res.json({ success: true });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/agent/logs', (req, res) => {
        const { context } = resolveActiveContext(server, req.query.golemId);
        if (!context || !context.brain || !context.brain.chatLogFile) return res.json([]);

        try {
            if (!fs.existsSync(context.brain.chatLogFile)) return res.json([]);
            const content = fs.readFileSync(context.brain.chatLogFile, 'utf8');
            const logs = content
                .trim()
                .split('\n')
                .map((line) => {
                    try { return JSON.parse(line); } catch (e) { return null; }
                })
                .filter((x) => x);

            return res.json(logs.slice(-1000));
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    return router;
};
