/**
 * MCPClient.js — JSON-RPC 2.0 stdio transport MCP Client
 *
 * 透過 child_process.spawn 啟動本地 MCP Server，
 * 實作 initialize handshake、tools/list、tools/call。
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class MCPClient extends EventEmitter {
    /**
     * @param {Object} config
     * @param {string} config.name        - Server 名稱
     * @param {string} config.command     - 執行指令 (e.g. "codex", "npx")
     * @param {string[]} config.args      - 指令參數
     * @param {Object}  config.env        - 額外環境變數
     * @param {number}  config.timeout    - 請求超時 ms (預設 30000)
     */
    constructor(config) {
        super();
        this.name    = config.name;
        this.command = config.command;
        this.args    = config.args || [];
        this.env     = config.env  || {};
        this.timeout = config.timeout || 30000;

        this._process     = null;
        this._pending     = new Map();   // id -> { resolve, reject, timer }
        this._nextId      = 1;
        this._buf         = '';
        this._connected   = false;
        this._capabilities = {};
        this._tools        = [];
    }

    // ─── Public API ────────────────────────────────────────────────
    async connect() {
        if (this._connected) return;

        return new Promise((resolve, reject) => {
            const env = { ...process.env, ...this.env };

            this._process = spawn(this.command, this.args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                env
            });

            this._process.stdout.on('data', (chunk) => this._onData(chunk));
            this._process.stderr.on('data', (chunk) => {
                const msg = chunk.toString().trim();
                if (msg) console.warn(`[MCPClient:${this.name}] stderr: ${msg}`);
            });

            this._process.on('error', (err) => {
                console.error(`[MCPClient:${this.name}] Process error:`, err.message);
                this._connected = false;
                this.emit('error', err);
                reject(err);
            });

            this._process.on('exit', (code, signal) => {
                console.log(`[MCPClient:${this.name}] Process exited (code=${code}, signal=${signal})`);
                this._connected = false;
                this.emit('disconnected', { code, signal });
                // Reject all pending requests
                for (const [id, { reject: rej, timer }] of this._pending.entries()) {
                    clearTimeout(timer);
                    rej(new Error(`MCP Server "${this.name}" disconnected`));
                    this._pending.delete(id);
                }
            });

            // Wait for initialize to complete
            this._initialize().then((caps) => {
                this._capabilities = caps;
                this._connected    = true;
                this.emit('connected', { capabilities: caps });
                resolve(caps);
            }).catch(reject);
        });
    }

    async disconnect() {
        if (this._process) {
            this._process.kill('SIGTERM');
            this._process = null;
        }
        this._connected = false;
    }

    async listTools(forceRefresh = false) {
        if (!this._connected) throw new Error(`MCP Server "${this.name}" not connected`);
        if (this._tools.length > 0 && !forceRefresh) return this._tools;

        const result = await this._rpc('tools/list', {});
        this._tools  = result.tools || [];
        return this._tools;
    }

    /**
     * @param {string} toolName
     * @param {Object} params
     * @returns {Promise<Object>} tool result
     */
    async callTool(toolName, params = {}) {
        if (!this._connected) throw new Error(`MCP Server "${this.name}" not connected`);

        const result = await this._rpc('tools/call', {
            name:      toolName,
            arguments: params
        });
        return result;
    }

    get isConnected() { return this._connected; }
    get tools()       { return this._tools; }
    get capabilities(){ return this._capabilities; }

    // ─── Private ───────────────────────────────────────────────────
    async _initialize() {
        const result = await this._rpc('initialize', {
            protocolVersion: '2024-11-05',
            capabilities:    { tools: {} },
            clientInfo:      { name: 'project-golem', version: '1.0' }
        });
        // send initialized notification (no response expected)
        this._notify('notifications/initialized', {});
        return result.capabilities || {};
    }

    /** Send a JSON-RPC request, return promise that resolves with result */
    _rpc(method, params) {
        return new Promise((resolve, reject) => {
            const id  = this._nextId++;
            const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new Error(`MCP RPC timeout (${this.timeout}ms) for method "${method}"`));
            }, this.timeout);

            this._pending.set(id, { resolve, reject, timer });
            this._process.stdin.write(msg);
        });
    }

    /** Send a JSON-RPC notification (fire-and-forget) */
    _notify(method, params) {
        if (!this._process || !this._process.stdin.writable) return;
        const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
        this._process.stdin.write(msg);
    }

    _onData(chunk) {
        this._buf += chunk.toString();
        const lines = this._buf.split('\n');
        this._buf   = lines.pop(); // keep incomplete last line

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const msg = JSON.parse(trimmed);
                this._handleMessage(msg);
            } catch (e) {
                // Some servers output non-JSON lines (debug info) — ignore
            }
        }
    }

    _handleMessage(msg) {
        if (msg.id !== undefined && this._pending.has(msg.id)) {
            const { resolve, reject, timer } = this._pending.get(msg.id);
            clearTimeout(timer);
            this._pending.delete(msg.id);

            if (msg.error) {
                reject(new Error(`MCP error [${msg.error.code}]: ${msg.error.message}`));
            } else {
                resolve(msg.result);
            }
        }
        // Notifications from server (no id) — emit as event
        else if (msg.method && msg.id === undefined) {
            this.emit('notification', { method: msg.method, params: msg.params });
        }
    }
}

module.exports = MCPClient;
