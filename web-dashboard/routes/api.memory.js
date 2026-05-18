const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const { resolveActiveContext } = require('./utils/context');
const { buildOperationGuard } = require('../server/security');

module.exports = function registerMemoryRoutes(server) {
    const router = express.Router();
    const requireMemoryAdmin = buildOperationGuard(server, 'memory_mutation');
    const toBool = (value) => {
        if (value === undefined) return undefined;
        if (typeof value === 'boolean') return value;
        const s = String(value).trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(s)) return true;
        if (['false', '0', 'no', 'off'].includes(s)) return false;
        return undefined;
    };
    const ensureMemoryId = (item, index = 0) => {
        const metadata = (item && typeof item.metadata === 'object' && item.metadata) ? item.metadata : {};
        const existing = typeof item?.id === 'string' && item.id.trim()
            ? item.id.trim()
            : (typeof metadata.id === 'string' && metadata.id.trim() ? metadata.id.trim() : '');
        const text = typeof item?.text === 'string' ? item.text : '';
        const createdAt = String(item?.createdAt || metadata.createdAt || item?.timestamp || '').trim();
        const type = String(metadata.type || '').trim();
        const source = String(metadata.source || '').trim();
        const fallbackSeed = `${createdAt}|${type}|${source}|${text}` || `${index}:${text}`;
        const fallbackId = crypto.createHash('sha1').update(fallbackSeed).digest('hex').slice(0, 24);
        const id = existing || fallbackId;
        return {
            ...item,
            id,
            visible: item?.visible !== false && metadata.visible !== false,
            metadata: {
                ...metadata,
                id
            }
        };
    };

    router.get('/api/memory', async (req, res) => {
        const { context } = resolveActiveContext(server, req.query.golemId);
        if (!context || !context.memory) return res.status(503).json({ error: 'Memory not engaged' });

        try {
            const q = typeof req.query.q === 'string' ? req.query.q : '';
            const type = typeof req.query.type === 'string' ? req.query.type : '';
            const source = typeof req.query.source === 'string' ? req.query.source : '';
            const includeHidden = toBool(req.query.includeHidden) === true;
            const visible = toBool(req.query.visible);
            const limit = Number(req.query.limit || 500);
            const offset = Number(req.query.offset || 0);

            if (typeof context.memory.listMemories === 'function') {
                const results = await context.memory.listMemories({
                    q,
                    type,
                    source,
                    includeHidden,
                    limit,
                    offset
                });
                const filtered = visible === undefined
                    ? results
                    : results.filter((item) => (item.visible !== false) === visible);
                return res.json(filtered.map((item, index) => ensureMemoryId(item, index)));
            }

            if (context.memory.data) {
                const base = Array.isArray(context.memory.data) ? context.memory.data : [];
                return res.json(base.map((item, index) => ensureMemoryId(item, index)));
            }
            const results = await context.memory.recall(q || '');
            return res.json((Array.isArray(results) ? results : []).map((item, index) => ensureMemoryId(item, index)));
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

    router.patch('/api/memory/:id', requireMemoryAdmin, async (req, res) => {
        const { context } = resolveActiveContext(server, req.query.golemId);
        if (!context || !context.memory) return res.status(503).json({ error: 'Memory not engaged' });
        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id is required' });

        try {
            if (typeof context.memory.updateMemory !== 'function') {
                return res.status(501).json({ error: 'Update memory not supported by this driver' });
            }
            const patch = {};
            if (typeof req.body.text === 'string') patch.text = req.body.text;
            if (req.body.metadata && typeof req.body.metadata === 'object') patch.metadata = req.body.metadata;
            if (req.body.visible !== undefined) patch.visible = req.body.visible !== false;
            const result = await context.memory.updateMemory(id, patch);
            if (result && result.success === false) return res.status(400).json(result);
            return res.json({ success: true, ...result });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.delete('/api/memory/:id', requireMemoryAdmin, async (req, res) => {
        const { context } = resolveActiveContext(server, req.query.golemId);
        if (!context || !context.memory) return res.status(503).json({ error: 'Memory not engaged' });
        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id is required' });

        try {
            if (typeof context.memory.deleteMemory !== 'function') {
                return res.status(501).json({ error: 'Delete memory not supported by this driver' });
            }
            const result = await context.memory.deleteMemory(id);
            if (result && result.success === false) return res.status(400).json(result);
            return res.json({ success: true, ...result });
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
                    try { return JSON.parse(line); } catch { return null; }
                })
                .filter((x) => x);

            return res.json(logs.slice(-1000));
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    return router;
};
