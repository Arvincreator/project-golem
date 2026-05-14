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
const MCPToolCatalog = require('./MCPToolCatalog');

const CONFIG_PATH = path.resolve(process.cwd(), 'data', 'mcp-servers.json');
const MAX_LOG     = 500;
const DEFAULT_TIMEOUT_MS = 30000;
const CHROME_PROFILE_LOCK_RE = /(browser is already running|user.?data.?dir(?:ectory)?.*in use|processsingleton|singletonlock|profile.*in use|opening in existing browser session)/i;
const CHROME_REMOTE_DEFAULT_URLS = ['http://127.0.0.1:9222', 'http://127.0.0.1:9223'];
const CHROME_PROFILE_LOCK_FILES = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'RunningChromeVersion'];
const CHROME_MCP_PKG_RE = /^chrome-devtools-mcp(?:@[\w.\-+]+)?$/i;

function normalizeTimeout(value, fallback = DEFAULT_TIMEOUT_MS) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(Math.max(Math.round(parsed), 1000), 600000);
}

function extractUserDataDirArg(args = []) {
    const list = Array.isArray(args) ? args : [];
    for (let i = 0; i < list.length; i += 1) {
        const cur = String(list[i] || '');
        const lower = cur.toLowerCase();
        if (lower.startsWith('--userdatadir=')) return cur.slice(cur.indexOf('=') + 1);
        if (lower.startsWith('--user-data-dir=')) return cur.slice(cur.indexOf('=') + 1);
        if (lower === '--userdatadir' || lower === '--user-data-dir') {
            return String(list[i + 1] || '').trim();
        }
    }
    return '';
}

function stripUserDataDirArg(args = []) {
    const list = Array.isArray(args) ? [...args] : [];
    const output = [];
    for (let i = 0; i < list.length; i += 1) {
        const cur = String(list[i] || '');
        const lower = cur.toLowerCase();
        if (lower.startsWith('--userdatadir=')) continue;
        if (lower.startsWith('--user-data-dir=')) continue;
        if (lower === '--userdatadir' || lower === '--user-data-dir') {
            i += 1;
            continue;
        }
        output.push(cur);
    }
    return output;
}

function extractBrowserUrlArg(args = []) {
    const list = Array.isArray(args) ? args : [];
    for (let i = 0; i < list.length; i += 1) {
        const cur = String(list[i] || '');
        const lower = cur.toLowerCase();
        if (lower.startsWith('--browserurl=')) return cur.slice(cur.indexOf('=') + 1);
        if (lower === '--browserurl') return String(list[i + 1] || '').trim();
    }
    return '';
}

function replaceBrowserUrlArg(args = [], browserUrl = '') {
    const list = Array.isArray(args) ? [...args] : [];
    const output = [];
    let replaced = false;
    for (let i = 0; i < list.length; i += 1) {
        const cur = String(list[i] || '');
        const lower = cur.toLowerCase();
        if (lower.startsWith('--browserurl=')) {
            output.push(`--browserUrl=${browserUrl}`);
            replaced = true;
            continue;
        }
        if (lower === '--browserurl') {
            output.push(cur);
            output.push(browserUrl);
            replaced = true;
            i += 1;
            continue;
        }
        output.push(cur);
    }
    if (!replaced) output.push(`--browserUrl=${browserUrl}`);
    return output;
}

function replaceUserDataDirArg(args = [], nextDir = '') {
    const list = Array.isArray(args) ? [...args] : [];
    const output = [];
    let replaced = false;

    for (let i = 0; i < list.length; i += 1) {
        const cur = String(list[i] || '');
        const lower = cur.toLowerCase();
        if (lower.startsWith('--userdatadir=')) {
            output.push(`--userDataDir=${nextDir}`);
            replaced = true;
            continue;
        }
        if (lower.startsWith('--user-data-dir=')) {
            output.push(`--user-data-dir=${nextDir}`);
            replaced = true;
            continue;
        }
        if (lower === '--userdatadir' || lower === '--user-data-dir') {
            output.push(cur);
            output.push(nextDir);
            replaced = true;
            i += 1;
            continue;
        }
        output.push(cur);
    }

    if (!replaced) {
        output.push(`--userDataDir=${nextDir}`);
    }
    return output;
}

function isChromeDevtoolsServer(cfg) {
    if (!cfg || !cfg.name) return false;
    return String(cfg.name).trim().toLowerCase() === 'chrome-devtools';
}

function stripChromeDevtoolsPkgArgs(args = []) {
    const list = Array.isArray(args) ? [...args] : [];
    const output = [];
    for (let i = 0; i < list.length; i += 1) {
        const cur = String(list[i] || '').trim();
        if (!cur) continue;
        if (cur === '-y' || cur === '--yes') continue;
        if (CHROME_MCP_PKG_RE.test(cur)) continue;
        output.push(cur);
    }
    return output;
}

function resolveLocalChromeMcpCli() {
    try {
        const pkgJsonPath = require.resolve('chrome-devtools-mcp/package.json', {
            paths: [process.cwd()]
        });
        const pkgDir = path.dirname(pkgJsonPath);
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        let rel = '';
        if (typeof pkg.bin === 'string') rel = pkg.bin;
        else if (pkg.bin && typeof pkg.bin === 'object') rel = pkg.bin['chrome-devtools-mcp'] || '';
        if (!rel) return '';
        const cliPath = path.resolve(pkgDir, rel);
        return fs.existsSync(cliPath) ? cliPath : '';
    } catch (_) {
        return '';
    }
}

function buildLaunchCandidates(cfg) {
    const base = [{ ...cfg, args: Array.isArray(cfg.args) ? [...cfg.args] : [] }];
    if (!isChromeDevtoolsServer(cfg)) return base;

    const sharedArgs = stripChromeDevtoolsPkgArgs(cfg.args || []);
    const localCli = resolveLocalChromeMcpCli();
    const candidates = [];

    if (localCli) {
        candidates.push({
            ...cfg,
            command: process.execPath || 'node',
            args: [localCli, ...sharedArgs],
            _launchMode: 'local_node_modules'
        });
    }

    candidates.push({
        ...cfg,
        _launchMode: 'configured'
    });

    const seen = new Set();
    return candidates.filter((item) => {
        const key = `${item.command}::${JSON.stringify(item.args || [])}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function resolveNodeEntryArg(args = []) {
    const list = Array.isArray(args) ? args : [];
    for (const item of list) {
        const cur = String(item || '').trim();
        if (!cur) continue;
        if (cur.startsWith('-')) continue;
        return cur;
    }
    return '';
}

function ensureLaunchConfigHealthy(cfg) {
    const command = String(cfg && cfg.command ? cfg.command : '').trim();
    const args = Array.isArray(cfg && cfg.args) ? cfg.args : [];
    const nodeLike = command === 'node' || command.endsWith('/node') || command.endsWith('\\node.exe');
    if (!nodeLike) return;

    const entry = resolveNodeEntryArg(args);
    if (!entry) return;

    const resolvedEntry = path.isAbsolute(entry) ? entry : path.resolve(process.cwd(), entry);
    if (!fs.existsSync(resolvedEntry)) {
        const err = new Error(
            `MCP startup blocked: entry script not found (${resolvedEntry}). ` +
            `Please update data/mcp-servers.json for server "${cfg.name}".`
        );
        err.code = 'MCP_ENTRY_NOT_FOUND';
        err.server = cfg && cfg.name ? cfg.name : null;
        err.entry = resolvedEntry;
        throw err;
    }
}

function shouldRetryWithFallbackProfile(cfg, error) {
    if (!isChromeDevtoolsServer(cfg)) return false;
    const hasUserDataDir = Boolean(extractUserDataDirArg(cfg && cfg.args));
    if (!hasUserDataDir) return false;
    const text = String((error && error.message) || '');
    return CHROME_PROFILE_LOCK_RE.test(text);
}

function shouldRetryWithBrowserBridge(cfg, error) {
    if (!isChromeDevtoolsServer(cfg)) return false;
    const text = String((error && error.message) || '');
    return CHROME_PROFILE_LOCK_RE.test(text);
}

function buildFallbackProfileDir(baseDir) {
    const stamp = Date.now().toString(36);
    return `${baseDir}-fallback-${stamp}`;
}

function isPidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        if (err && err.code === 'ESRCH') return false;
        return true; // EPERM or others => treat as alive/unknown
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSingletonLockPid(lockPath) {
    try {
        const linkValue = fs.readlinkSync(lockPath);
        const match = String(linkValue || '').match(/-(\d+)\s*$/);
        if (!match) return null;
        const pid = Number(match[1]);
        return Number.isInteger(pid) ? pid : null;
    } catch (_) {
        return null;
    }
}

function cleanupChromeProfileLocks(userDataDir) {
    const profileDir = String(userDataDir || '').trim();
    if (!profileDir || !fs.existsSync(profileDir)) return;

    const lockPath = path.join(profileDir, 'SingletonLock');
    const lockPid = parseSingletonLockPid(lockPath);
    if (lockPid && isPidAlive(lockPid)) {
        return; // active owner still alive, do not remove lock files
    }

    for (const file of CHROME_PROFILE_LOCK_FILES) {
        const target = path.join(profileDir, file);
        try {
            if (fs.existsSync(target)) fs.rmSync(target, { force: true });
        } catch (err) {
            if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
                console.warn(
                    `[MCPManager] Cannot remove lock file (${target}) due to permission. ` +
                    `Run: sudo chown -R "$USER":staff "${profileDir}"`
                );
            }
        }
    }
}

async function normalizeChromeProfileBeforeLaunch(userDataDir) {
    const profileDir = String(userDataDir || '').trim();
    if (!profileDir || !fs.existsSync(profileDir)) return;

    const lockPath = path.join(profileDir, 'SingletonLock');
    const lockPid = parseSingletonLockPid(lockPath);
    if (!lockPid) {
        cleanupChromeProfileLocks(profileDir);
        return;
    }

    const autoKill = String(process.env.GOLEM_MCP_CHROME_AUTOKILL_LOCK_OWNER || 'true').toLowerCase() !== 'false';
    if (isPidAlive(lockPid) && autoKill) {
        try {
            console.warn(`[MCPManager] Detected active lock owner PID=${lockPid}, sending SIGTERM...`);
            process.kill(lockPid, 'SIGTERM');
        } catch (_) { }

        const deadline = Date.now() + 2200;
        while (isPidAlive(lockPid) && Date.now() < deadline) {
            await sleep(200);
        }

        if (isPidAlive(lockPid)) {
            try {
                console.warn(`[MCPManager] PID=${lockPid} still alive, sending SIGKILL...`);
                process.kill(lockPid, 'SIGKILL');
            } catch (_) { }
            const killDeadline = Date.now() + 1200;
            while (isPidAlive(lockPid) && Date.now() < killDeadline) {
                await sleep(150);
            }
        }
    }

    cleanupChromeProfileLocks(profileDir);
}

function parseBridgeUrlList(raw = '') {
    const text = String(raw || '').trim();
    if (!text) return [];
    return text
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function resolveBridgeUrls(cfg = {}) {
    const fromConfigEnv = parseBridgeUrlList(cfg && cfg.env && cfg.env.GOLEM_CHROME_BRIDGE_URLS);
    const fromProcessEnv = parseBridgeUrlList(process.env.GOLEM_CHROME_BRIDGE_URLS);
    const current = extractBrowserUrlArg(cfg && cfg.args);
    const ordered = [];
    if (current) ordered.push(current);
    ordered.push(...fromConfigEnv, ...fromProcessEnv, ...CHROME_REMOTE_DEFAULT_URLS);
    return [...new Set(ordered)];
}

class MCPManager extends EventEmitter {
    constructor() {
        super();
        this._clients = new Map();  // name -> MCPClient
        this._configs = [];         // persisted server configs
        this._logs    = [];         // recent call logs
        this._loaded  = false;
        this._loadingPromise = null;
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
        if (this._loadingPromise) {
            await this._loadingPromise;
            return;
        }

        this._loadingPromise = (async () => {
            this._configs = this._readConfig();

            // Auto-connect enabled servers
            const enabledServers = this._configs.filter(c => c.enabled !== false);
            for (const cfg of enabledServers) {
                try {
                    await this._startClient(cfg);
                } catch (e) {
                    console.warn(`[MCPManager] Auto-connect failed for "${cfg.name}": ${e.message}`);
                }
            }
            this._loaded  = true;
            console.log(`[MCPManager] Loaded ${this._configs.length} servers, ${this._clients.size} connected.`);
        })();

        try {
            await this._loadingPromise;
        } finally {
            this._loadingPromise = null;
        }
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
            timeout: normalizeTimeout(cfg.timeout),
            enabled: cfg.enabled !== false,
            description: cfg.description || ''
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

        const entry = { ...this._configs[idx], ...updates, name };
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
        const tools = await client.listTools();
        this._cacheTools(serverName, tools);
        return this.getCachedTools(serverName);
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
        const normalized = MCPToolCatalog.normalizeToolCall({
            server: serverName,
            tool: toolName,
            parameters: params
        }, this._configs);
        const effectiveServer = normalized.server || serverName;
        const effectiveTool = normalized.tool || toolName;
        const effectiveParams = normalized.parameters || params;

        const client = this._clients.get(effectiveServer);
        if (!client) throw new Error(`MCP server "${serverName}" not connected`);

        let success = true;
        let result  = null;
        let error   = null;

        try {
            result = await client.callTool(effectiveTool, effectiveParams);
        } catch (e) {
            success = false;
            error   = e.message;
            throw e;
        } finally {
            const duration = Date.now() - startTime;
            const logEntry = {
                time:       new Date().toISOString(),
                server:     effectiveServer,
                tool:       effectiveTool,
                params:     effectiveParams,
                success,
                result:     success ? result : null,
                error:      success ? null : error,
                durationMs: duration,
                aliasedFrom: normalized.aliasedFrom || null,
                paramFixes: normalized.paramFixes || []
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

    getCachedTools(serverName = null) {
        const servers = serverName
            ? this._configs.filter(cfg => cfg.name === serverName)
            : this._configs;
        const tools = [];
        for (const server of servers.filter(cfg => cfg.enabled !== false)) {
            for (const tool of server.cachedTools || []) {
                tools.push(MCPToolCatalog.findTool(server.name, tool.name, this._configs));
            }
        }
        return tools.filter(Boolean);
    }

    getToolCatalog() {
        return MCPToolCatalog.buildCatalog(this._configs);
    }

    /** 測試連線（嘗試 listTools，成功後斷線） */
    async testServer(name) {
        const cfg = this._configs.find(c => c.name === name);
        if (!cfg) throw new Error(`MCP server "${name}" not found`);

        const testClient = new MCPClient({ ...cfg, timeout: normalizeTimeout(cfg.timeout, 10000) });
        try {
            await testClient.connect();
            const tools = await testClient.listTools();
            const normalizedTools = tools
                .map(tool => MCPToolCatalog.findTool(name, tool.name, [{ ...cfg, enabled: true, cachedTools: tools }]))
                .filter(Boolean);
            return { success: true, toolCount: normalizedTools.length, tools: normalizedTools };
        } finally {
            await testClient.disconnect();
        }
    }

    _cacheTools(serverName, tools) {
        const cfgEntry = this._configs.find(c => c.name === serverName);
        if (!cfgEntry) return;
        cfgEntry.cachedTools = (tools || []).map(t => ({
            name:        t.name,
            description: t.description || '',
            inputSchema: t.inputSchema || t.schema || null,
            example:     MCPToolCatalog.buildActionExample(serverName, t.name, t.inputSchema || t.schema || {}),
        }));
        this._saveConfig();
        MCPToolCatalog.writeCatalog(this._configs);
    }

    // ─── Private ───────────────────────────────────────────────────
    async _startClient(cfg) {
        // Stop existing client if any
        await this._stopClient(cfg.name);
        const launchCandidates = buildLaunchCandidates(cfg);
        let lastErr = null;
        for (const launchCfg of launchCandidates) {
            try {
                ensureLaunchConfigHealthy(launchCfg);
                if (isChromeDevtoolsServer(launchCfg)) {
                    const userDataDir = extractUserDataDirArg(launchCfg.args || []);
                    await normalizeChromeProfileBeforeLaunch(userDataDir);
                }
                return await this._startClientWithFallbacks(launchCfg, {
                    mode: launchCfg._launchMode || 'primary'
                });
            } catch (err) {
                lastErr = err;
                console.warn(
                    `[MCPManager] Launch candidate failed for "${cfg.name}" (${launchCfg.command} ${JSON.stringify(launchCfg.args || [])}): ${err.message}`
                );
            }
        }
        throw lastErr || new Error(`MCP server "${cfg.name}" failed to launch`);
    }

    async _startClientWithFallbacks(cfg, meta = {}) {
        try {
            return await this._startClientWithConfig(cfg, meta);
        } catch (err) {
            if (shouldRetryWithBrowserBridge(cfg, err)) {
                const bridgeUrls = resolveBridgeUrls(cfg);
                for (const bridgeUrl of bridgeUrls) {
                    const bridgeCfg = {
                        ...cfg,
                        args: replaceBrowserUrlArg(stripUserDataDirArg(cfg.args || []), bridgeUrl)
                    };
                    try {
                        console.warn(
                            `[MCPManager] "${cfg.name}" profile lock detected. ` +
                            `Retrying via browser bridge: ${bridgeUrl}`
                        );
                        return await this._startClientWithConfig(bridgeCfg, {
                            ...meta,
                            mode: 'bridge_browser_url',
                            bridgeUrl
                        });
                    } catch (bridgeErr) {
                        console.warn(`[MCPManager] Bridge retry failed (${bridgeUrl}): ${bridgeErr.message}`);
                    }
                }
            }

            if (!shouldRetryWithFallbackProfile(cfg, err)) throw err;

            const originalDir = extractUserDataDirArg(cfg.args);
            const fallbackDir = buildFallbackProfileDir(originalDir);
            fs.mkdirSync(fallbackDir, { recursive: true });
            const fallbackCfg = {
                ...cfg,
                args: replaceUserDataDirArg(cfg.args || [], fallbackDir)
            };

            console.warn(
                `[MCPManager] "${cfg.name}" profile in use (${originalDir}). ` +
                `Retrying with fallback profile: ${fallbackDir}`
            );

            return this._startClientWithConfig(fallbackCfg, {
                ...meta,
                mode: 'fallback_profile',
                originalDir,
                fallbackDir
            });
        }
    }

    async _startClientWithConfig(launchCfg, meta = {}) {
        const client = new MCPClient(launchCfg);

        client.on('disconnected', () => {
            console.log(`[MCPManager] Server "${launchCfg.name}" disconnected.`);
            this._clients.delete(launchCfg.name);
        });

        client.on('error', (err) => {
            console.error(`[MCPManager] Server "${launchCfg.name}" error: ${err.message}`);
            this._clients.delete(launchCfg.name);
        });

        await client.connect();
        client.effectiveLaunch = {
            command: launchCfg.command,
            args: launchCfg.args,
            mode: meta.mode || 'primary',
            originalDir: meta.originalDir || null,
            fallbackDir: meta.fallbackDir || null,
            bridgeUrl: meta.bridgeUrl || null
        };

        try {
            const tools = await client.listTools();
            this._cacheTools(launchCfg.name, tools);
        } catch (_) { /* optional */ }

        this._clients.set(launchCfg.name, client);
        if (meta.mode === 'fallback_profile') {
            console.log(`[MCPManager] ✅ Connected (fallback profile): "${launchCfg.name}" (${client.tools.length} tools)`);
        } else if (meta.mode === 'bridge_browser_url') {
            console.log(`[MCPManager] ✅ Connected (browser bridge ${meta.bridgeUrl}): "${launchCfg.name}" (${client.tools.length} tools)`);
        } else {
            console.log(`[MCPManager] ✅ Connected: "${launchCfg.name}" (${client.tools.length} tools)`);
        }
        return client;
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
