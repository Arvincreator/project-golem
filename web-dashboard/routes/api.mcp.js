const express = require('express');

module.exports = function registerMcpRoutes(server) {
    const router = express.Router();

    const getMCPManager = async () => {
        const MCPManager = require('../../src/mcp/MCPManager');
        const mgr = MCPManager.getInstance();

        if (!mgr._loaded) {
            if (!mgr._broadcastWired) {
                mgr._broadcastWired = true;
                mgr.on('mcpLog', (entry) => {
                    const preview = entry.success
                        ? JSON.stringify(entry.result || '').slice(0, 120)
                        : `ERROR: ${entry.error}`;

                    server.broadcastLog({
                        time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
                        msg: `[MCP] ${entry.server}/${entry.tool} (${entry.durationMs}ms) ${entry.success ? '✅' : '❌'} ${preview}`,
                        type: 'mcp',
                        raw: JSON.stringify(entry),
                        mcpEntry: entry
                    });
                });
            }
            await mgr.load();
        }

        return mgr;
    };

    router.get('/api/mcp/servers', async (req, res) => {
        try {
            const mgr = await getMCPManager();
            return res.json({ servers: mgr.getServers() });
        } catch (e) {
            console.error('[MCP] List servers error:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/mcp/servers', async (req, res) => {
        try {
            const { name, command, args, env, enabled, description } = req.body;
            if (!name || !command) return res.status(400).json({ error: 'Missing name or command' });

            const mgr = await getMCPManager();
            const entry = await mgr.addServer({ name, command, args, env, enabled, description });
            console.log(`[MCP] Added server: ${name}`);
            return res.json({ success: true, server: entry });
        } catch (e) {
            console.error('[MCP] Add server error:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.put('/api/mcp/servers/:name', async (req, res) => {
        try {
            const { name } = req.params;
            const mgr = await getMCPManager();
            const entry = await mgr.updateServer(name, req.body);
            console.log(`[MCP] Updated server: ${name}`);
            return res.json({ success: true, server: entry });
        } catch (e) {
            console.error('[MCP] Update server error:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.delete('/api/mcp/servers/:name', async (req, res) => {
        try {
            const { name } = req.params;
            const mgr = await getMCPManager();
            await mgr.removeServer(name);
            console.log(`[MCP] Removed server: ${name}`);
            return res.json({ success: true });
        } catch (e) {
            console.error('[MCP] Remove server error:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/mcp/servers/:name/toggle', async (req, res) => {
        try {
            const { name } = req.params;
            const { enabled } = req.body;
            const mgr = await getMCPManager();
            const entry = await mgr.toggleServer(name, Boolean(enabled));
            return res.json({ success: true, server: entry });
        } catch (e) {
            console.error('[MCP] Toggle server error:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/mcp/servers/:name/tools', async (req, res) => {
        try {
            const { name } = req.params;
            const mgr = await getMCPManager();
            const tools = await mgr.listTools(name);
            return res.json({ tools });
        } catch (e) {
            console.error('[MCP] List tools error:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/mcp/servers/:name/test', async (req, res) => {
        try {
            const { name } = req.params;
            const mgr = await getMCPManager();
            const result = await mgr.testServer(name);
            return res.json(result);
        } catch (e) {
            console.error('[MCP] Test server error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    });

    router.get('/api/mcp/logs', async (req, res) => {
        try {
            const limit = Math.min(Number(req.query.limit) || 100, 500);
            const mgr = await getMCPManager();
            return res.json({ logs: mgr.getLogs(limit) });
        } catch (e) {
            console.error('[MCP] Get logs error:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    return router;
};
