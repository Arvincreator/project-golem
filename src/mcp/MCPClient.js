/**
 * MCPClient.js — JSON-RPC 2.0 stdio transport MCP Client
 *
 * 透過 child_process.spawn 啟動本地 MCP Server，
 * 實作 initialize handshake、tools/list、tools/call。
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');

function shouldRetryViaWindowsCmd(command, error) {
    if (process.platform !== 'win32') return false;
    if (!error || error.code !== 'ENOENT') return false;
    const cmd = String(command || '').trim().toLowerCase();
    return cmd === 'npx' || cmd === 'npm';
}

function quoteForWindowsCmd(value) {
    const text = String(value ?? '');
    if (text.length === 0) return '""';
    if (!/[\s"&|<>^()]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
}

function buildWindowsCmdFallback(command, args = []) {
    const raw = [command, ...(Array.isArray(args) ? args : [])]
        .map((part) => quoteForWindowsCmd(part))
        .join(' ');
    return {
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', raw]
    };
}

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
        this.timeout = Number(config.timeout || 30000);

        this._process     = null;
        this._pending     = new Map();   // id -> { resolve, reject, timer }
        this._nextId      = 1;
        this._buf         = Buffer.alloc(0);
        this._connected   = false;
        this._capabilities = {};
        this._tools        = [];
        this._stderrLog    = [];
    }

    // ─── Public API ────────────────────────────────────────────────
    async connect() {
        if (this._connected) return;

        return new Promise((resolve, reject) => {
            let settled = false;
            let retriedViaCmd = false;
            const safeResolve = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            const safeReject = (error) => {
                if (settled) return;
                settled = true;
                reject(error);
            };
            const env = { ...process.env, ...this.env };
            const bindProcessHandlers = () => {
                if (!this._process) return;
                this._process.stdout.on('data', (chunk) => this._onData(chunk));
                this._process.stderr.on('data', (chunk) => {
                    const text = chunk.toString();
                    const lines = text
                        .split(/\r?\n/)
                        .map((line) => line.trim())
                        .filter(Boolean);
                    for (const line of lines) {
                        this._pushStderr(line);
                        console.warn(`[MCPClient:${this.name}] stderr: ${line}`);
                    }
                });

                this._process.on('error', (err) => {
                    if (!retriedViaCmd && shouldRetryViaWindowsCmd(this.command, err)) {
                        retriedViaCmd = true;
                        const fallback = buildWindowsCmdFallback(this.command, this.args);
                        console.warn(
                            `[MCPClient:${this.name}] spawn ${this.command} ENOENT on Windows, retrying via cmd.exe`
                        );
                        this._process = spawn(fallback.command, fallback.args, {
                            stdio: ['pipe', 'pipe', 'pipe'],
                            env
                        });
                        bindProcessHandlers();
                        return;
                    }

                    console.error(`[MCPClient:${this.name}] Process error:`, err.message);
                    this._connected = false;
                    this.emit('error', err);
                    safeReject(err);
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

                    if (!this._connected) {
                        const stderrHint = this.getStderrTail();
                        const detail = stderrHint ? ` | stderr: ${stderrHint}` : '';
                        const err = new Error(`MCP server "${this.name}" exited before ready (code=${code}, signal=${signal})${detail}`);
                        err.code = 'MCP_PROCESS_EXIT';
                        err.exitCode = code;
                        err.signal = signal;
                        safeReject(err);
                    }
                });
            };

            this._process = spawn(this.command, this.args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                env
            });
            bindProcessHandlers();

            // Wait for initialize to complete
            this._initialize().then((caps) => {
                this._capabilities = caps;
                this._connected    = true;
                this.emit('connected', { capabilities: caps });
                safeResolve(caps);
            }).catch(safeReject);
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

        const toolTimeout = Number(params && params.timeout);
        const rpcTimeout = Number.isFinite(toolTimeout) && toolTimeout > 0
            ? Math.max(this.timeout, toolTimeout + 5000)
            : this.timeout;

        const result = await this._rpc('tools/call', {
            name:      toolName,
            arguments: params
        }, rpcTimeout);
        return result;
    }

    get isConnected() { return this._connected; }
    get tools()       { return this._tools; }
    get capabilities(){ return this._capabilities; }
    getStderrTail(limit = 6) {
        return this._stderrLog.slice(-Math.max(1, Number(limit) || 6)).join(' | ');
    }

    // ─── Private ───────────────────────────────────────────────────
    async _initialize() {
        const result = await this._rpc('initialize', {
            protocolVersion: '2025-06-18',
            capabilities:    { tools: {} },
            clientInfo:      { name: 'project-golem', version: '1.0' }
        });
        // send initialized notification (no response expected)
        this._notify('notifications/initialized', {});
        return result.capabilities || {};
    }

    /** Send a JSON-RPC request, return promise that resolves with result */
    _rpc(method, params, timeout = this.timeout) {
        return new Promise((resolve, reject) => {
            const id  = this._nextId++;
            const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new Error(`MCP RPC timeout (${timeout}ms) for method "${method}"`));
            }, timeout);

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
        this._buf = Buffer.concat([this._buf, Buffer.from(chunk)]);

        while (this._buf.length > 0) {
            if (this._buf.toString('utf8', 0, Math.min(this._buf.length, 32)).startsWith('Content-Length:')) {
                const headerEnd = this._findHeaderEnd(this._buf);
                if (headerEnd === -1) return;

                const headerText = this._buf.toString('utf8', 0, headerEnd.index);
                const match = headerText.match(/Content-Length:\s*(\d+)/i);
                if (!match) {
                    this._buf = this._buf.slice(headerEnd.next);
                    continue;
                }

                const contentLength = Number(match[1]);
                const bodyStart = headerEnd.next;
                const bodyEnd = bodyStart + contentLength;
                if (this._buf.length < bodyEnd) return;

                const body = this._buf.toString('utf8', bodyStart, bodyEnd);
                this._buf = this._buf.slice(bodyEnd);
                this._parseMessage(body);
                continue;
            }

            const newline = this._buf.indexOf(0x0a);
            if (newline === -1) return;
            const line = this._buf.toString('utf8', 0, newline).trim();
            this._buf = this._buf.slice(newline + 1);
            if (!line || /^Content-Length:/i.test(line)) continue;
            this._parseMessage(line);
        }
    }

    _findHeaderEnd(buffer) {
        const crlf = buffer.indexOf('\r\n\r\n');
        if (crlf !== -1) return { index: crlf, next: crlf + 4 };
        const lf = buffer.indexOf('\n\n');
        if (lf !== -1) return { index: lf, next: lf + 2 };
        return -1;
    }

    _parseMessage(raw) {
        try {
            const msg = JSON.parse(raw.trim());
            this._handleMessage(msg);
        } catch (e) {
            // Some servers output non-JSON lines (debug info) — ignore
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

    _pushStderr(line) {
        if (!line) return;
        this._stderrLog.push(String(line));
        if (this._stderrLog.length > 80) {
            this._stderrLog.shift();
        }
    }
}

module.exports = MCPClient;
