/**
 * MCPManager.js — 多 MCP Server 生命週期管理器
 *
 * 持久化配置到 data/mcp-servers.json
 * 提供 addServer / removeServer / callTool / listTools 等方法
 * 每次 callTool 呼叫都會 emit 'mcpLog' 事件
 */

const fs    = require('fs');
const path  = require('path');
const { EventEmitter } = require('events');
const MCPClient = require('./MCPClient');
const { installMempalace } = require('./mempalaceInstaller');

const CONFIG_PATH = path.resolve(process.cwd(), 'data', 'mcp-servers.json');
const MAX_LOG     = 500;
const MEMPALACE_SERVER_NAME = 'mempalace';
const GBRAIN_SERVER_NAME    = 'gbrain';

function isMempalaceServer(name) {
    return String(name || '').trim().toLowerCase() === MEMPALACE_SERVER_NAME;
}

function isGBrainServer(name) {
    return String(name || '').trim().toLowerCase() === GBRAIN_SERVER_NAME;
}

function normalizeStringArray(values) {
    return Array.isArray(values) ? values.map((value) => String(value)) : [];
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
    return JSON.stringify(normalizeEnvObject(a)) === JSON.stringify(normalizeEnvObject(b));
}

class MCPManager extends EventEmitter {
    constructor() {
        super();
        this._clients = new Map();  // name -> MCPClient
        this._configs = [];         // persisted server configs
        this._logs    = [];         // recent call logs
        this._loaded  = false;
    }

    // ─── Singleton ─────────────────────────────────────────────────
    static getInstance() {
        if (!MCPManager._instance) {
            MCPManager._instance = new MCPManager();
        }
        return MCPManager._instance;
    }

    // ─── Init ──────────────────────────────────────────────────────
    /** 載入配置並啟動所有啟用的 server */
    async load() {
        if (this._loaded) return;
        this._configs = this._readConfig();
        this._loaded  = true;

        // Auto-connect enabled servers
        const enabledServers = this._configs.filter(c => c.enabled !== false);
        for (const cfg of enabledServers) {
            try {
                const prepared = await this._prepareServerForConnect(cfg, { disableOnFailure: true });
                await this._startClient(prepared);
            } catch (e) {
                console.warn(`[MCPManager] Auto-connect failed for "${cfg.name}": ${e.message}`);
            }
        }
        console.log(`[MCPManager] Loaded ${this._configs.length} servers, ${this._clients.size} connected.`);
    }

    // ─── Server CRUD ───────────────────────────────────────────────
    async addServer(cfg) {
        if (this._configs.find(c => c.name === cfg.name)) {
            throw new Error(`MCP server "${cfg.name}" already exists`);
        }
        const entry = {
            name:    cfg.name,
            command: cfg.command,
            args:    cfg.args    || [],
            env:     cfg.env     || {},
            enabled: cfg.enabled !== false,
            description: cfg.description || ''
        };
        this._configs.push(entry);
        this._saveConfig();

        if (entry.enabled) {
            const prepared = await this._prepareServerForConnect(entry);
            await this._startClient(prepared);
        }
        return entry;
    }

    async updateServer(name, updates) {
        const idx = this._configs.findIndex(c => c.name === name);
        if (idx === -1) throw new Error(`MCP server "${name}" not found`);

        const entry = { ...this._configs[idx], ...updates, name };
        this._configs[idx] = entry;
        this._saveConfig();

        // Restart client if running
        await this._stopClient(name);
        if (entry.enabled) {
            const prepared = await this._prepareServerForConnect(entry);
            await this._startClient(prepared);
        }
        return entry;
    }

    async removeServer(name) {
        await this._stopClient(name);
        this._configs = this._configs.filter(c => c.name !== name);
        this._saveConfig();
    }

    async toggleServer(name, enabled) {
        const cfg = this._configs.find(c => c.name === name);
        if (!cfg) throw new Error(`MCP server "${name}" not found`);

        cfg.enabled = enabled;
        this._saveConfig();

        if (enabled) {
            const prepared = await this._prepareServerForConnect(cfg);
            await this._startClient(prepared);
        } else {
            await this._stopClient(name);
        }
        return cfg;
    }

    // ─── Tool Operations ───────────────────────────────────────────
    async listTools(serverName) {
        const client = this._clients.get(serverName);
        if (!client) throw new Error(`MCP server "${serverName}" not connected`);
        return await client.listTools();
    }

    /**
     * 呼叫 MCP 工具，自動記錄 Log
     * @param {string} serverName
     * @param {string} toolName
     * @param {Object} params
     * @returns {Promise<Object>}
     */
    async callTool(serverName, toolName, params = {}) {
        const startTime = Date.now();
        const client = this._clients.get(serverName);
        if (!client) throw new Error(`MCP server "${serverName}" not connected`);

        let success = true;
        let result  = null;
        let error   = null;

        try {
            result = await client.callTool(toolName, params);
        } catch (e) {
            success = false;
            error   = e.message;
            throw e;
        } finally {
            const duration = Date.now() - startTime;
            const logEntry = {
                time:       new Date().toISOString(),
                server:     serverName,
                tool:       toolName,
                params:     params,
                success,
                result:     success ? result : null,
                error:      success ? null : error,
                durationMs: duration
            };
            this._appendLog(logEntry);
            this.emit('mcpLog', logEntry);
        }
        return result;
    }

    /** 列出所有 server 配置（含連線狀態） */
    getServers() {
        return this._configs.map(cfg => ({
            ...cfg,
            connected: this._clients.has(cfg.name) && this._clients.get(cfg.name).isConnected
        }));
    }

    getServer(name) {
        const cfg = this._configs.find(c => c.name === name);
        if (!cfg) return null;
        return {
            ...cfg,
            connected: this._clients.has(name) && this._clients.get(name).isConnected
        };
    }

    getLogs(limit = 100) {
        return this._logs.slice(-limit);
    }

    /** 測試連線（嘗試 listTools，成功後斷線） */
    async testServer(name) {
        const cfg = this._configs.find(c => c.name === name);
        if (!cfg) throw new Error(`MCP server "${name}" not found`);

        const testClient = new MCPClient({ ...cfg, timeout: 10000 });
        try {
            await testClient.connect();
            const tools = await testClient.listTools();
            return { success: true, toolCount: tools.length, tools };
        } finally {
            await testClient.disconnect();
        }
    }

    // ─── Private ───────────────────────────────────────────────────
    async _startClient(cfg) {
        // Stop existing client if any
        await this._stopClient(cfg.name);

        const client = new MCPClient(cfg);

        client.on('disconnected', () => {
            console.log(`[MCPManager] Server "${cfg.name}" disconnected.`);
            this._clients.delete(cfg.name);
        });

        client.on('error', (err) => {
            console.error(`[MCPManager] Server "${cfg.name}" error: ${err.message}`);
            this._clients.delete(cfg.name);
        });

        await client.connect();
        // Pre-fetch tools and persist to config for definition.js to read at startup
        try {
            await client.listTools();
            // Cache tools into the config entry so definition.js can read them from disk
            const cfgEntry = this._configs.find(c => c.name === cfg.name);
            if (cfgEntry && client.tools.length > 0) {
                cfgEntry.cachedTools = client.tools.map(t => ({
                    name:        t.name,
                    description: t.description || ''
                }));
                this._saveConfig();
            }
        } catch (_) { /* optional */ }
        this._clients.set(cfg.name, client);
        console.log(`[MCPManager] ✅ Connected: "${cfg.name}" (${client.tools.length} tools)`);
        return client;
    }

    async _prepareServerForConnect(cfg, options = {}) {
        if (!cfg || !cfg.name) return cfg;
        if (isMempalaceServer(cfg.name)) return await this._prepareMempalaceConfig(cfg, options);
        if (isGBrainServer(cfg.name))    return this._prepareGBrainConfig(cfg);
        return cfg;
    }

    _prepareGBrainConfig(cfg) {
        const os   = require('os');
        const bunBin    = path.join(os.homedir(), '.bun', 'bin', 'bun');
        const gbrainBin = path.join(os.homedir(), '.bun', 'bin', 'gbrain');

        const desiredCommand = bunBin;
        const desiredArgs    = [gbrainBin, 'serve'];

        const changed =
            cfg.command !== desiredCommand ||
            !areStringArraysEqual(normalizeStringArray(cfg.args), desiredArgs);

        if (changed) {
            cfg.command = desiredCommand;
            cfg.args    = desiredArgs;
            this._saveConfig();
            console.log(`[MCPManager] Prepared "gbrain" runtime -> ${bunBin}`);
        }
        return cfg;
    }

    async _prepareMempalaceConfig(cfg, options = {}) {
        const { disableOnFailure = false } = options;
        const preferredPython = /python/i.test(String(cfg.command || ''))
            ? String(cfg.command || '').trim()
            : '';

        try {
            const install = installMempalace({
                cwd: process.cwd(),
                preferredPython,
            });
            const desiredCommand = String(install.pythonBin || cfg.command || '').trim() || String(cfg.command || '').trim();
            const desiredArgs = normalizeStringArray(cfg.args).length > 0
                ? normalizeStringArray(cfg.args)
                : ['-m', 'mempalace.mcp_server'];
            const desiredEnv = {
                ...(cfg.env && typeof cfg.env === 'object' ? cfg.env : {}),
            };
            if (install.palaceDir) {
                desiredEnv.MEMPALACE_PALACE_DIR = String(install.palaceDir);
            }
            const desiredDescription = String(cfg.description || '');

            const changed =
                String(cfg.command || '') !== desiredCommand
                || !areStringArraysEqual(normalizeStringArray(cfg.args), desiredArgs)
                || !areEnvEqual(cfg.env || {}, desiredEnv)
                || String(cfg.description || '') !== desiredDescription;

            if (changed) {
                cfg.command = desiredCommand;
                cfg.args = desiredArgs;
                cfg.env = desiredEnv;
                cfg.description = desiredDescription;
                this._saveConfig();
                console.log(`[MCPManager] Prepared "mempalace" runtime (${install.installAction}) -> ${desiredCommand}`);
            }

            return cfg;
        } catch (e) {
            if (disableOnFailure && cfg.enabled !== false) {
                cfg.enabled = false;
                this._saveConfig();
                console.warn(`[MCPManager] Disabled "mempalace" after setup failure: ${e.message}`);
            }
            throw new Error(`mempalace setup failed: ${e.message}`);
        }
    }

    async _stopClient(name) {
        const client = this._clients.get(name);
        if (client) {
            await client.disconnect().catch(() => {});
            this._clients.delete(name);
        }
    }

    _appendLog(entry) {
        this._logs.push(entry);
        if (this._logs.length > MAX_LOG) this._logs.shift();
    }

    _readConfig() {
        try {
            if (!fs.existsSync(CONFIG_PATH)) return [];
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        } catch {
            return [];
        }
    }

    _saveConfig() {
        try {
            const dir = path.dirname(CONFIG_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(this._configs, null, 2), 'utf8');
        } catch (e) {
            console.error('[MCPManager] Failed to save config:', e.message);
        }
    }
}

MCPManager._instance = null;

module.exports = MCPManager;
