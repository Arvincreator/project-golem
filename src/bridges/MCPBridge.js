// ============================================================
// MCP Bridge — Maps 9 YEDAN workers as callable tools
// ============================================================
const { getToken } = require('../utils/yedan-auth');
const { MCP_SERVERS } = require('../config/endpoints');

// Per-server circuit breaker state
const _circuits = {};

function _getCircuit(server) {
    if (!_circuits[server]) _circuits[server] = { open: false, resetAt: 0, failures: 0 };
    const c = _circuits[server];
    if (c.open && Date.now() > c.resetAt) { c.open = false; c.failures = 0; }
    return c;
}

class MCPBridge {
    constructor() {
        this.servers = MCP_SERVERS;
    }

    getToolManifest() {
        return Object.entries(this.servers).map(([id, cfg]) => ({
            name: `mcp_${id.replace(/-/g, '_')}`,
            description: cfg.desc,
            server: id,
            parameters: { method: 'string', params: 'object' }
        }));
    }

    async callTool(server, method, params = {}) {
        const cfg = this.servers[server];
        if (!cfg) throw new Error(`Unknown MCP server: ${server}`);
        if (!cfg.url) return { error: 'Server URL not configured' };

        const circuit = _getCircuit(server);
        if (circuit.open) {
            return { error: `Circuit breaker open for ${server}`, retryAfter: circuit.resetAt - Date.now() };
        }

        const token = getToken();
        if (!token) return { error: 'No auth token available' };

        try {
            const url = method.startsWith('/') ? `${cfg.url}${method}` : `${cfg.url}/${method}`;
            const isGet = !params || Object.keys(params).length === 0;

            const fetchOpts = {
                method: isGet ? 'GET' : 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                signal: AbortSignal.timeout(15000)
            };
            if (!isGet) fetchOpts.body = JSON.stringify(params);

            const res = await fetch(url, fetchOpts);
            circuit.failures = 0;

            if (!res.ok) return { error: `HTTP ${res.status}`, body: await res.text().catch(() => '') };
            return await res.json().catch(async () => ({ text: await res.text() }));
        } catch (e) {
            circuit.failures++;
            if (circuit.failures >= 3) {
                circuit.open = true;
                circuit.resetAt = Date.now() + 60000;
                console.warn(`[MCPBridge] Circuit breaker tripped for ${server}: ${e.message}`);
            }
            return { error: e.message };
        }
    }

    getStatus() {
        const status = {};
        for (const server of Object.keys(this.servers)) {
            const c = _getCircuit(server);
            status[server] = c.open ? 'OPEN' : 'CLOSED';
        }
        return status;
    }
}

module.exports = MCPBridge;
