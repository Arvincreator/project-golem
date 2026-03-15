// McpBridge.js — Lightweight MCP client for OpenClaw Edge tools
// Calls CF Worker-based MCP servers via standard HTTP

class McpBridge {
    constructor() {
        this.servers = {
            'intel': 'https://openclaw-intel-mcp.yagami8095.workers.dev',
            'moltbook': 'https://moltbook-publisher-mcp.yagami8095.workers.dev',
            'json-toolkit': 'https://json-toolkit-mcp.yagami8095.workers.dev',
            'regex-engine': 'https://regex-engine-mcp.yagami8095.workers.dev',
            'prompt-enhancer': 'https://prompt-enhancer-mcp.yagami8095.workers.dev',
            'color-palette': 'https://color-palette-mcp.yagami8095.workers.dev',
            'timestamp': 'https://timestamp-converter-mcp.yagami8095.workers.dev',
            'agentforge': 'https://agentforge-compare-mcp.yagami8095.workers.dev',
            'fortune': 'https://openclaw-fortune-mcp.yagami8095.workers.dev',
        };
    }

    async callTool(serverName, toolName, args = {}) {
        const baseUrl = this.servers[serverName];
        if (!baseUrl) throw new Error(`Unknown MCP server: ${serverName}`);

        const res = await fetch(`${baseUrl}/mcp/tools/${toolName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
        });

        if (!res.ok) throw new Error(`MCP ${serverName}/${toolName}: ${res.status}`);
        return res.json();
    }

    async listTools(serverName) {
        const baseUrl = this.servers[serverName];
        if (!baseUrl) throw new Error(`Unknown MCP server: ${serverName}`);

        const res = await fetch(`${baseUrl}/mcp/tools`);
        if (!res.ok) throw new Error(`MCP ${serverName} list: ${res.status}`);
        return res.json();
    }

    getServerNames() {
        return Object.keys(this.servers);
    }
}

module.exports = McpBridge;
