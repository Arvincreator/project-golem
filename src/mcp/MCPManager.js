/**
 * MCPManager.js — 多 MCP Server 生命週期管理器
 *
 * 持久化配置到 data/mcp-servers.json
 * 提供 addServer / removeServer / callTool / listTools 等方法
 * 每次 callTool 呼叫都會 emit 'mcpLog' 事件
 */

const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const MCPClient = require('./MCPClient');

const CONFIG_PATH = path.resolve(process.cwd(), 'data', 'mcp-servers.json');
const BOOTSTRAP_STATE_PATH = path.resolve(process.cwd(), 'data', 'mempalace-bootstrap-state.json');
const BOOTSTRAP_REPO_ROOT_PLACEHOLDER = '$GOLEM_WORKSPACE_ROOT';
const MAX_LOG     = 500;
const CORE_MEMPALACE_SERVER = 'mempalace';
const CORE_MEMPALACE_PYTHON_PLACEHOLDER = '$GOLEM_MEMPALACE_PYTHON';
const CORE_MEMPALACE_PALACE_PATH_PLACEHOLDER = '$GOLEM_MEMPALACE_PALACE_PATH';
const CORE_RECONNECT_BASE_MS = 1000;
const CORE_RECONNECT_MAX_MS = 60000;

class MCPManager extends EventEmitter {
    constructor() {
        super();
        this._clients = new Map();  // name -> MCPClient
        this._configs = [];         // persisted server configs
        this._logs    = [];         // recent call logs
        this._loaded  = false;
        this._loadPromise = null;
        this._coreReconnectTimers = new Map();
        this._coreReconnectAttempts = new Map();
        this._coreStatuses = new Map();
        this._coreBootstrapScheduled = false;
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
        if (this._loadPromise) {
            await this._loadPromise;
            return;
        }

        this._loadPromise = (async () => {
            this._configs = this._readConfig();
            this.ensureCoreServers();

            // Auto-connect enabled servers
            const enabledServers = this._configs.filter(c => c.enabled !== false);
            for (const cfg of enabledServers) {
                try {
                    await this._startClient(cfg);
                } catch (e) {
                    console.warn(`[MCPManager] Auto-connect failed for "${cfg.name}": ${e.message}`);
                    this._handleStartFailure(cfg, e);
                }
            }

            this._scheduleCoreBootstrap();
            this._loaded  = true;
            console.log(`[MCPManager] Loaded ${this._configs.length} servers, ${this._clients.size} connected.`);
        })();

        try {
            await this._loadPromise;
        } finally {
            this._loadPromise = null;
        }
    }

    ensureCoreServers() {
        const coreServers = this._buildCoreServers();
        if (coreServers.length === 0) {
            const before = this._configs.length;
            this._configs = this._configs.filter(cfg => !(cfg && cfg.isCore === true));
            if (this._configs.length !== before) this._saveConfig();
            return;
        }

        let changed = false;

        for (const core of coreServers) {
            const idx = this._configs.findIndex(c => c.name === core.name);
            if (idx === -1) {
                this._configs.push(core);
                changed = true;
                continue;
            }

            const prev = this._configs[idx];
            const merged = {
                ...prev,
                ...core,
                enabled: true,
                isCore: true,
                cachedTools: prev.cachedTools || core.cachedTools || []
            };

            if (!this._isSameConfig(prev, merged)) {
                this._configs[idx] = merged;
                changed = true;
            }
        }

        if (changed) this._saveConfig();
    }

    // ─── Server CRUD ───────────────────────────────────────────────
    async addServer(cfg) {
        if (cfg && cfg.isCore) {
            throw new Error('Core MCP servers are managed by system');
        }
        if (this._configs.find(c => c.name === cfg.name)) {
            throw new Error(`MCP server "${cfg.name}" already exists`);
        }
        const entry = {
            name:    cfg.name,
            command: cfg.command,
            args:    cfg.args    || [],
            env:     cfg.env     || {},
            enabled: cfg.enabled !== false,
            description: cfg.description || '',
            isCore: false
        };
        this._configs.push(entry);
        this._saveConfig();

        if (entry.enabled) {
            await this._startClient(entry);
        }
        return entry;
    }

    async updateServer(name, updates) {
        const idx = this._configs.findIndex(c => c.name === name);
        if (idx === -1) throw new Error(`MCP server "${name}" not found`);
        if (this._configs[idx].isCore) {
            throw new Error(`MCP core server "${name}" is managed by system and cannot be modified`);
        }

        const entry = { ...this._configs[idx], ...updates, name, isCore: false };
        this._configs[idx] = entry;
        this._saveConfig();

        // Restart client if running
        await this._stopClient(name);
        if (entry.enabled) {
            await this._startClient(entry);
        }
        return entry;
    }

    async removeServer(name) {
        const cfg = this._configs.find(c => c.name === name);
        if (cfg && cfg.isCore) {
            throw new Error(`MCP core server "${name}" is managed by system and cannot be removed`);
        }
        await this._stopClient(name);
        this._configs = this._configs.filter(c => c.name !== name);
        this._saveConfig();
    }

    async toggleServer(name, enabled) {
        const cfg = this._configs.find(c => c.name === name);
        if (!cfg) throw new Error(`MCP server "${name}" not found`);
        if (cfg.isCore && enabled === false) {
            throw new Error(`MCP core server "${name}" must stay enabled`);
        }

        cfg.enabled = enabled;
        this._saveConfig();

        if (enabled) {
            await this._startClient(cfg);
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
            connected: this._clients.has(cfg.name) && this._clients.get(cfg.name).isConnected,
            ...this._buildCoreRuntimeInfo(cfg.name, cfg.isCore === true)
        }));
    }

    getServer(name) {
        const cfg = this._configs.find(c => c.name === name);
        if (!cfg) return null;
        return {
            ...cfg,
            connected: this._clients.has(name) && this._clients.get(name).isConnected,
            ...this._buildCoreRuntimeInfo(name, cfg.isCore === true)
        };
    }

    getLogs(limit = 100) {
        return this._logs.slice(-limit);
    }

    /** 測試連線（嘗試 listTools，成功後斷線） */
    async testServer(name) {
        const cfg = this._configs.find(c => c.name === name);
        if (!cfg) throw new Error(`MCP server "${name}" not found`);

        const runtimeCfg = this._materializeRuntimeConfig(cfg);
        const testClient = new MCPClient({ ...runtimeCfg, timeout: 10000 });
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
        if (cfg.isCore) this._clearCoreReconnect(cfg.name);

        const runtimeCfg = this._materializeRuntimeConfig(cfg);
        const client = new MCPClient(runtimeCfg);

        client.on('disconnected', () => {
            console.log(`[MCPManager] Server "${cfg.name}" disconnected.`);
            this._clients.delete(cfg.name);
            if (cfg.isCore) this._onCoreDisconnected(cfg.name, 'process exited');
        });

        client.on('error', (err) => {
            console.error(`[MCPManager] Server "${cfg.name}" error: ${err.message}`);
            this._clients.delete(cfg.name);
            if (cfg.isCore) this._onCoreDisconnected(cfg.name, err.message || 'runtime error');
        });

        await client.connect();
        this._clients.set(cfg.name, client);

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
        if (cfg.isCore) {
            this._coreReconnectAttempts.set(cfg.name, 0);
            this._setCoreStatus(cfg.name, {
                coreStatus: 'ok',
                coreLastError: null,
                coreReconnectAttempt: 0,
                coreNextRetryAt: null
            });
        }
        console.log(`[MCPManager] ✅ Connected: "${cfg.name}" (${client.tools.length} tools)`);
        return client;
    }

    async _stopClient(name) {
        const client = this._clients.get(name);
        if (client) {
            client.removeAllListeners('disconnected');
            client.removeAllListeners('error');
            await client.disconnect().catch(() => {});
            this._clients.delete(name);
        }
    }

    _appendLog(entry) {
        this._logs.push(entry);
        if (this._logs.length > MAX_LOG) this._logs.shift();
    }

    _buildCoreRuntimeInfo(name, isCore) {
        if (!isCore) return {};
        const status = this._coreStatuses.get(name) || {
            coreStatus: this._clients.has(name) ? 'ok' : 'error',
            coreLastError: null,
            coreReconnectAttempt: 0,
            coreNextRetryAt: null
        };
        return status;
    }

    _handleStartFailure(cfg, error) {
        if (!cfg || !cfg.isCore) return;
        const message = error && error.message ? error.message : String(error || 'unknown error');
        this._setCoreStatus(cfg.name, {
            coreStatus: 'error',
            coreLastError: message
        });
        this._scheduleCoreReconnect(cfg.name, message);
    }

    _onCoreDisconnected(name, reason) {
        const cfg = this._configs.find(c => c.name === name);
        if (!cfg || cfg.enabled === false) return;
        this._setCoreStatus(name, {
            coreStatus: 'error',
            coreLastError: reason || 'disconnected'
        });
        this._scheduleCoreReconnect(name, reason || 'disconnected');
    }

    _scheduleCoreReconnect(name, reason) {
        if (this._coreReconnectTimers.has(name)) return;
        const attempt = (this._coreReconnectAttempts.get(name) || 0) + 1;
        this._coreReconnectAttempts.set(name, attempt);

        const delay = Math.min(CORE_RECONNECT_MAX_MS, CORE_RECONNECT_BASE_MS * (2 ** (attempt - 1)));
        const nextRetryAt = new Date(Date.now() + delay).toISOString();

        this._setCoreStatus(name, {
            coreStatus: 'reconnecting',
            coreLastError: reason || 'reconnecting',
            coreReconnectAttempt: attempt,
            coreNextRetryAt: nextRetryAt
        });

        console.warn(`[MCPManager] Core server "${name}" reconnect scheduled in ${delay}ms (attempt ${attempt}).`);
        const timer = setTimeout(async () => {
            this._coreReconnectTimers.delete(name);
            const cfg = this._configs.find(c => c.name === name);
            if (!cfg || cfg.enabled === false) return;

            try {
                await this._startClient(cfg);
            } catch (e) {
                this._handleStartFailure(cfg, e);
            }
        }, delay);

        if (typeof timer.unref === 'function') timer.unref();
        this._coreReconnectTimers.set(name, timer);
    }

    _clearCoreReconnect(name) {
        const timer = this._coreReconnectTimers.get(name);
        if (timer) clearTimeout(timer);
        this._coreReconnectTimers.delete(name);
    }

    _setCoreStatus(name, patch) {
        const prev = this._coreStatuses.get(name) || {
            coreStatus: 'error',
            coreLastError: null,
            coreReconnectAttempt: 0,
            coreNextRetryAt: null
        };
        this._coreStatuses.set(name, { ...prev, ...patch });
    }

    _isMempalaceEnabled() {
        const raw = String(process.env.GOLEM_MEMPALACE_ENABLED || 'true').trim().toLowerCase();
        return !['false', '0', 'no', 'off'].includes(raw);
    }

    _isMempalaceBootstrapEnabled() {
        const raw = String(process.env.GOLEM_MEMPALACE_BOOTSTRAP_ENABLED || 'true').trim().toLowerCase();
        return !['false', '0', 'no', 'off'].includes(raw);
    }

    _resolveMempalacePythonCommand() {
        const explicit = String(process.env.GOLEM_MEMPALACE_PYTHON || '').trim();
        if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);

        const inRepo = process.platform === 'win32'
            ? path.resolve(process.cwd(), 'mempalace', '.venv', 'Scripts', 'python.exe')
            : path.resolve(process.cwd(), 'mempalace', '.venv', 'bin', 'python');
        if (fs.existsSync(inRepo)) return inRepo;

        const runtimeVenv = process.platform === 'win32'
            ? path.resolve(process.cwd(), '.mempalace-runtime', '.venv', 'Scripts', 'python.exe')
            : path.resolve(process.cwd(), '.mempalace-runtime', '.venv', 'bin', 'python');
        if (fs.existsSync(runtimeVenv)) return runtimeVenv;

        return process.platform === 'win32' ? 'python' : 'python3';
    }

    _getMempalacePalacePath() {
        const fromEnv = String(process.env.GOLEM_MEMPALACE_PALACE_PATH || process.env.MEMPALACE_PALACE_PATH || '').trim();
        if (fromEnv) return fromEnv;
        return path.join(os.homedir(), '.mempalace', 'palace');
    }

    _buildMempalacePythonPath() {
        const mempalacePkgDir = path.resolve(process.cwd(), 'mempalace');
        if (!fs.existsSync(mempalacePkgDir)) return undefined;
        return mempalacePkgDir;
    }

    _materializeRuntimeConfig(cfg) {
        if (!cfg || cfg.isCore !== true || cfg.name !== CORE_MEMPALACE_SERVER) {
            return cfg;
        }

        const env = {
            ...(cfg.env || {}),
            MEMPALACE_PALACE_PATH: this._getMempalacePalacePath()
        };
        const pythonPath = this._buildMempalacePythonPath();
        if (pythonPath) {
            env.PYTHONPATH = pythonPath;
        } else {
            delete env.PYTHONPATH;
        }

        return {
            ...cfg,
            command: this._resolveMempalacePythonCommand(),
            env
        };
    }

    _buildCoreServers() {
        if (!this._isMempalaceEnabled()) return [];

        const env = {
            MEMPALACE_PALACE_PATH: CORE_MEMPALACE_PALACE_PATH_PLACEHOLDER
        };

        return [{
            name: CORE_MEMPALACE_SERVER,
            command: CORE_MEMPALACE_PYTHON_PLACEHOLDER,
            args: ['-m', 'mempalace.mcp_server'],
            env,
            enabled: true,
            isCore: true,
            description: 'MemPalace Core MCP (always-on memory)'
        }];
    }

    _scheduleCoreBootstrap() {
        if (this._coreBootstrapScheduled || !this._isMempalaceEnabled() || !this._isMempalaceBootstrapEnabled()) {
            return;
        }
        this._coreBootstrapScheduled = true;

        const timer = setTimeout(() => {
            this._runMempalaceBootstrap().catch((e) => {
                console.warn(`[MCPManager] MemPalace bootstrap failed: ${e.message}`);
            });
        }, 1500);
        if (typeof timer.unref === 'function') timer.unref();
    }

    async _runMempalaceBootstrap() {
        const state = this._readBootstrapState();
        if (state && state.done) return;

        const repoRoot = process.cwd();
        const rawLimit = Number.parseInt(String(process.env.GOLEM_MEMPALACE_BOOTSTRAP_LIMIT || '200'), 10);
        const limit = Number.isFinite(rawLimit) ? Math.max(10, Math.min(rawLimit, 5000)) : 200;
        const command = this._resolveMempalacePythonCommand();
        const env = {
            ...process.env,
            MEMPALACE_PALACE_PATH: this._getMempalacePalacePath()
        };
        const pythonPath = this._buildMempalacePythonPath();
        if (pythonPath) env.PYTHONPATH = pythonPath;

        this._setCoreStatus(CORE_MEMPALACE_SERVER, {
            coreStatus: 'bootstrapping',
            coreLastError: null
        });

        try {
            this._ensureMempalaceConfig(repoRoot);
            await this._runCommand(command, ['-m', 'mempalace', 'mine', repoRoot, '--mode', 'projects', '--limit', String(limit)], { cwd: repoRoot, env });
            this._writeBootstrapState({
                done: true,
                doneAt: new Date().toISOString(),
                limit,
                repoRoot: BOOTSTRAP_REPO_ROOT_PLACEHOLDER
            });

            if (this._clients.has(CORE_MEMPALACE_SERVER)) {
                this._setCoreStatus(CORE_MEMPALACE_SERVER, {
                    coreStatus: 'ok',
                    coreLastError: null
                });
            }
        } catch (e) {
            const message = e && e.message ? e.message : String(e || 'bootstrap failed');
            this._writeBootstrapState({
                done: false,
                failedAt: new Date().toISOString(),
                limit,
                repoRoot: BOOTSTRAP_REPO_ROOT_PLACEHOLDER,
                error: message
            });
            this._setCoreStatus(CORE_MEMPALACE_SERVER, {
                coreStatus: 'error',
                coreLastError: `bootstrap: ${message}`
            });
        }
    }

    _ensureMempalaceConfig(repoRoot) {
        const yamlPath = path.resolve(repoRoot, 'mempalace.yaml');
        const legacyPath = path.resolve(repoRoot, 'mempal.yaml');
        if (fs.existsSync(yamlPath) || fs.existsSync(legacyPath)) return;

        const wing = path.basename(repoRoot)
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '_')
            .replace(/^_+|_+$/g, '') || 'project';

        const configText = [
            `wing: ${wing}`,
            'rooms:',
            '  - name: general',
            '    description: General project files',
            ''
        ].join('\n');

        fs.writeFileSync(yamlPath, configText, 'utf8');
    }

    _runCommand(command, args, options = {}) {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, {
                cwd: options.cwd || process.cwd(),
                env: options.env || process.env,
                stdio: ['ignore', 'ignore', 'pipe']
            });

            let stderr = '';
            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
            });

            child.on('error', (err) => {
                reject(err);
            });

            child.on('close', (code) => {
                if (code === 0) return resolve();
                const msg = stderr.trim() || `exit code ${code}`;
                reject(new Error(msg));
            });
        });
    }

    _readBootstrapState() {
        try {
            if (!fs.existsSync(BOOTSTRAP_STATE_PATH)) return null;
            const raw = JSON.parse(fs.readFileSync(BOOTSTRAP_STATE_PATH, 'utf8'));
            const { state, changed } = this._sanitizeBootstrapState(raw);
            if (changed) {
                fs.writeFileSync(BOOTSTRAP_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
            }
            return state;
        } catch {
            return null;
        }
    }

    _sanitizeBootstrapState(input) {
        if (!input || typeof input !== 'object') {
            return { state: input, changed: false };
        }

        const state = { ...input };
        let changed = false;
        const repoRoot = String(state.repoRoot || '');

        if (!repoRoot || path.isAbsolute(repoRoot)) {
            if (state.repoRoot !== BOOTSTRAP_REPO_ROOT_PLACEHOLDER) {
                state.repoRoot = BOOTSTRAP_REPO_ROOT_PLACEHOLDER;
                changed = true;
            }
        }

        return { state, changed };
    }

    _writeBootstrapState(state) {
        try {
            const dir = path.dirname(BOOTSTRAP_STATE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(BOOTSTRAP_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
        } catch (e) {
            console.warn(`[MCPManager] Failed to write bootstrap state: ${e.message}`);
        }
    }

    _isSameConfig(a, b) {
        return JSON.stringify(this._normalizeConfig(a)) === JSON.stringify(this._normalizeConfig(b));
    }

    _normalizeConfig(cfg) {
        if (!cfg || typeof cfg !== 'object') return {};
        return {
            name: cfg.name || '',
            command: cfg.command || '',
            args: Array.isArray(cfg.args) ? cfg.args : [],
            env: cfg.env && typeof cfg.env === 'object' ? cfg.env : {},
            enabled: cfg.enabled !== false,
            description: cfg.description || '',
            isCore: cfg.isCore === true,
            cachedTools: Array.isArray(cfg.cachedTools) ? cfg.cachedTools : []
        };
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
