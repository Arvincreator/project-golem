const express = require('express');
const { buildOperationGuard } = require('../server/security');
const { installMempalace } = require('../../src/mcp/mempalaceInstaller');

const MEMPALACE_SERVER_NAME = 'mempalace';

function isMempalaceServer(name) {
    return String(name || '').trim().toLowerCase() === MEMPALACE_SERVER_NAME;
}

function buildMempalaceProbePlan(tools = []) {
    const toolNames = new Set(
        Array.isArray(tools)
            ? tools.map((tool) => String(tool && tool.name ? tool.name : '').trim()).filter(Boolean)
            : []
    );

    const candidates = [
        { tool: 'mempalace_status', parameters: {} },
        { tool: 'mempalace_health', parameters: {} },
        { tool: 'mempalace_search', parameters: { query: 'dashboard health check', limit: 1 } },
        { tool: 'mempalace_kg_query', parameters: { entity: 'project-golem', direction: 'both' } },
    ];

    for (const candidate of candidates) {
        if (toolNames.has(candidate.tool)) {
            return candidate;
        }
    }

    return null;
}

function buildResultPreview(result) {
    try {
        return JSON.stringify(result).slice(0, 240);
    } catch {
        return String(result || '').slice(0, 240);
    }
}

function areStringArraysEqual(a = [], b = []) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (String(a[i]) !== String(b[i])) return false;
    }
    return true;
}

function normalizeEnvObject(env) {
    const source = env && typeof env === 'object' ? env : {};
    const entries = Object.entries(source).map(([k, v]) => [String(k), String(v)]);
    entries.sort(([ak], [bk]) => ak.localeCompare(bk));
    return Object.fromEntries(entries);
}

function areEnvEqual(a, b) {
    const left = normalizeEnvObject(a);
    const right = normalizeEnvObject(b);
    return JSON.stringify(left) === JSON.stringify(right);
}

async function verifyMempalaceServer(mgr, name) {
    const connection = await mgr.testServer(name);
    const tools = Array.isArray(connection.tools) ? connection.tools : [];
    if (!connection.success || tools.length === 0) {
        throw new Error('MemPalace connection test did not return any tool definitions');
    }

    const probePlan = buildMempalaceProbePlan(tools);
    if (!probePlan) {
        throw new Error('No supported MemPalace read-only probe tool found (expected status/search/kg_query)');
    }

    const probeResult = await mgr.callTool(name, probePlan.tool, probePlan.parameters);
    return {
        connection: {
            success: true,
            toolCount: tools.length,
        },
        functionality: {
            checked: true,
            tool: probePlan.tool,
            preview: buildResultPreview(probeResult),
        }
    };
}

async function toggleServerWithMempalaceSetup(mgr, name, enabled) {
    const shouldEnable = Boolean(enabled);
    const existing = mgr.getServer(name);
    if (!existing) {
        throw new Error(`MCP server "${name}" not found`);
    }

    let install = null;
    let verification = null;
    let serverConfigUpdated = false;

    if (shouldEnable && isMempalaceServer(name)) {
        const preferredPython = /python/i.test(String(existing.command || ''))
            ? String(existing.command || '').trim()
            : '';
        install = installMempalace({
            cwd: process.cwd(),
            preferredPython,
        });

        const desiredCommand = String(install.pythonBin || existing.command || '').trim() || String(existing.command || '').trim();
        const desiredArgs = Array.isArray(existing.args) && existing.args.length > 0
            ? existing.args.map((item) => String(item))
            : ['-m', 'mempalace.mcp_server'];
        const desiredEnv = {
            ...(existing.env && typeof existing.env === 'object' ? existing.env : {}),
        };
        if (install.palaceDir) {
            desiredEnv.MEMPALACE_PALACE_DIR = String(install.palaceDir);
        }

        const needsUpdate =
            String(existing.command || '') !== desiredCommand
            || !areStringArraysEqual(existing.args || [], desiredArgs)
            || !areEnvEqual(existing.env || {}, desiredEnv);

        if (needsUpdate && typeof mgr.updateServer === 'function') {
            const updatePayload = {
                name: existing.name,
                command: desiredCommand,
                args: desiredArgs,
                env: desiredEnv,
                enabled: false,
                description: String(existing.description || ''),
            };
            await mgr.updateServer(name, {
                ...updatePayload,
            });
            serverConfigUpdated = true;
        }
    }

    const entry = await mgr.toggleServer(name, shouldEnable);

    if (shouldEnable && isMempalaceServer(name)) {
        try {
            verification = await verifyMempalaceServer(mgr, name);
        } catch (verifyErr) {
            await mgr.toggleServer(name, false).catch(() => { });
            throw new Error(`MemPalace 安裝後驗證失敗，已自動停用：${verifyErr.message}`);
        }
    }

    return { entry, install, verification, serverConfigUpdated };
}

module.exports = function registerMcpRoutes(server) {
    const router = express.Router();
    const requireMcpWrite = buildOperationGuard(server, 'mcp_write');

    const sanitizeServerName = (name) => {
        const cleaned = String(name || '').trim();
        if (!/^[a-zA-Z0-9._-]{1,64}$/.test(cleaned)) {
            throw new Error('Invalid server name');
        }
        return cleaned;
    };

    const sanitizeServerPayload = (payload = {}) => {
        const allowedCmdsRaw = String(
            process.env.MCP_ALLOWED_COMMANDS || 'npx,node,codex,uv,python3,python,bash,sh'
        );
        const allowedCmds = new Set(
            allowedCmdsRaw
                .split(',')
                .map((x) => x.trim())
                .filter((x) => x)
        );

        const command = String(payload.command || '').trim();
        if (!allowedCmds.has(command)) {
            throw new Error(`Command not allowed: ${command || '(empty)'}`);
        }

        const args = Array.isArray(payload.args) ? payload.args.slice(0, 20).map((x) => String(x)) : [];
        const envRaw = payload.env && typeof payload.env === 'object' ? payload.env : {};
        const env = {};
        for (const [k, v] of Object.entries(envRaw)) {
            if (/^[A-Z_][A-Z0-9_]{0,63}$/.test(k)) {
                env[k] = String(v).slice(0, 2048);
            }
        }

        return {
            name: sanitizeServerName(payload.name),
            command,
            args,
            env,
            enabled: payload.enabled !== false,
            description: String(payload.description || '').slice(0, 500),
        };
    };

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

    router.post('/api/mcp/servers', requireMcpWrite, async (req, res) => {
        try {
            const payload = sanitizeServerPayload(req.body);

            const mgr = await getMCPManager();
            const entry = await mgr.addServer(payload);
            console.log(`[MCP] Added server: ${payload.name}`);
            return res.json({ success: true, server: entry });
        } catch (e) {
            console.error('[MCP] Add server error:', e);
            const status = /Invalid|not allowed|Missing/i.test(e.message) ? 400 : 500;
            return res.status(status).json({ error: e.message });
        }
    });

    router.put('/api/mcp/servers/:name', requireMcpWrite, async (req, res) => {
        try {
            const name = sanitizeServerName(req.params.name);
            const mgr = await getMCPManager();
            const existing = mgr.getServer(name);
            if (!existing) {
                return res.status(404).json({ error: `MCP server "${name}" not found` });
            }

            const merged = sanitizeServerPayload({
                ...existing,
                ...req.body,
                name: req.body.name !== undefined ? req.body.name : existing.name,
            });

            const entry = await mgr.updateServer(name, merged);
            console.log(`[MCP] Updated server: ${name}`);
            return res.json({ success: true, server: entry });
        } catch (e) {
            console.error('[MCP] Update server error:', e);
            const status = /Invalid|not allowed|Missing/i.test(e.message) ? 400 : 500;
            return res.status(status).json({ error: e.message });
        }
    });

    router.delete('/api/mcp/servers/:name', requireMcpWrite, async (req, res) => {
        try {
            const name = sanitizeServerName(req.params.name);
            const mgr = await getMCPManager();
            await mgr.removeServer(name);
            console.log(`[MCP] Removed server: ${name}`);
            return res.json({ success: true });
        } catch (e) {
            console.error('[MCP] Remove server error:', e);
            const status = /Invalid/i.test(e.message) ? 400 : 500;
            return res.status(status).json({ error: e.message });
        }
    });

    router.post('/api/mcp/servers/:name/toggle', requireMcpWrite, async (req, res) => {
        try {
            const name = sanitizeServerName(req.params.name);
            const { enabled } = req.body;
            const mgr = await getMCPManager();
            const { entry, install, verification, serverConfigUpdated } = await toggleServerWithMempalaceSetup(mgr, name, enabled);
            if (!entry) {
                return res.status(404).json({ error: `MCP server "${name}" not found` });
            }
            return res.json({ success: true, server: entry, install, verification, serverConfigUpdated });
        } catch (e) {
            console.error('[MCP] Toggle server error:', e);
            const message = String(e && e.message ? e.message : '');
            const status = /Invalid/i.test(message)
                ? 400
                : /not found/i.test(message)
                    ? 404
                    : 500;
            return res.status(status).json({ error: e.message });
        }
    });

    router.get('/api/mcp/servers/:name/tools', async (req, res) => {
        try {
            const name = sanitizeServerName(req.params.name);
            const mgr = await getMCPManager();
            const tools = await mgr.listTools(name);
            return res.json({ tools });
        } catch (e) {
            console.error('[MCP] List tools error:', e);
            const status = /Invalid/i.test(e.message) ? 400 : 500;
            return res.status(status).json({ error: e.message });
        }
    });

    router.post('/api/mcp/servers/:name/test', requireMcpWrite, async (req, res) => {
        try {
            const name = sanitizeServerName(req.params.name);
            const mgr = await getMCPManager();
            const result = await mgr.testServer(name);
            return res.json(result);
        } catch (e) {
            console.error('[MCP] Test server error:', e);
            const status = /Invalid/i.test(e.message) ? 400 : 500;
            return res.status(status).json({ success: false, error: e.message });
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

module.exports.__test__ = {
    isMempalaceServer,
    buildMempalaceProbePlan,
    verifyMempalaceServer,
    toggleServerWithMempalaceSetup,
};
