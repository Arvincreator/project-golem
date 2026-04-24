const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { getLocalIp } = require('../../src/utils/HttpUtils');
const { resolveEnabledSkills } = require('../../src/skills/skillsConfig');
const OllamaClient = require('../../src/services/OllamaClient');
const LMStudioClient = require('../../src/services/LMStudioClient');
const { buildOperationGuard, auditSecurityEvent } = require('../server/security');

function normalizeMemoryMode(modeRaw) {
    const mode = String(modeRaw || '').trim().toLowerCase();
    if (!mode) return 'lancedb-pro';

    if (mode === 'lancedb' || mode === 'lancedb-pro' || mode === 'lancedb_legacy' || mode === 'lancedb-legacy') {
        return 'lancedb-pro';
    }

    if (mode === 'native' || mode === 'system') {
        return 'native';
    }

    return 'lancedb-pro';
}

function normalizeBackend(backendRaw) {
    const backend = String(backendRaw || '').trim().toLowerCase();
    if (backend === 'gemini' || backend === 'ollama' || backend === 'lmstudio' || backend === 'perplexity') {
        return backend;
    }
    return 'gemini';
}

function normalizeEmbeddingProvider(providerRaw) {
    const provider = String(providerRaw || '').trim().toLowerCase();
    if (provider === 'local' || provider === 'ollama') {
        return provider;
    }
    return 'local';
}

function parsePositiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = function registerSystemRoutes(server) {
    const router = express.Router();
    const requireUpdateExecute = buildOperationGuard(server, 'system_update_execute');
    const requireSystemConfigUpdate = buildOperationGuard(server, 'system_config_update');
    const requireRestart = buildOperationGuard(server, 'system_restart');
    const requireReload = buildOperationGuard(server, 'system_reload');
    const requireShutdown = buildOperationGuard(server, 'system_shutdown');

    router.get('/api/system/status', (req, res) => {
        try {
            const liveCount = server.contexts.size;
            const EnvManager = require('../../src/utils/EnvManager');
            const envVars = EnvManager.readEnv();
            const configuredCount = (envVars.TELEGRAM_TOKEN || envVars.DISCORD_TOKEN) ? 1 : 0;
            const isSystemConfigured = envVars.SYSTEM_CONFIGURED === 'true';

            const runtime = {
                node: process.version,
                npm: 'N/A',
                platform: process.platform,
                arch: process.arch,
                uptime: Math.floor(process.uptime()),
                osName: 'Unknown'
            };

            try { runtime.npm = `v${execSync('npm -v').toString().trim()}`; } catch { }

            try {
                if (process.platform === 'darwin') {
                    const name = execSync('sw_vers -productName').toString().trim();
                    const ver = execSync('sw_vers -productVersion').toString().trim();
                    runtime.osName = `${name} ${ver}`;
                } else if (process.platform === 'linux') {
                    if (fs.existsSync('/etc/os-release')) {
                        const content = fs.readFileSync('/etc/os-release', 'utf8');
                        const match = content.match(/PRETTY_NAME="([^"]+)"/);
                        if (match) runtime.osName = match[1];
                    }
                } else {
                    runtime.osName = `${os.type()} ${os.release()}`;
                }
            } catch {
                runtime.osName = `${os.type()} ${os.release()}`;
            }

            const dotEnvPath = path.join(process.cwd(), '.env');
            const health = {
                node: process.version.startsWith('v20') || process.version.startsWith('v21') || process.version.startsWith('v22') || process.version.startsWith('v23') || process.version.startsWith('v25'),
                env: fs.existsSync(dotEnvPath),
                deps: fs.existsSync(path.join(process.cwd(), 'node_modules')),
                core: ['index.js', 'package.json', 'dashboard.js'].every((f) => fs.existsSync(path.join(process.cwd(), f))),
                dashboard: fs.existsSync(path.join(process.cwd(), 'web-dashboard/node_modules')) || fs.existsSync(path.join(process.cwd(), 'web-dashboard/.next'))
            };

            let diskUsage = 'N/A';
            try {
                if (process.platform === 'darwin' || process.platform === 'linux') {
                    diskUsage = execSync("df -h . | awk 'NR==2{print $4}'").toString().trim();
                }
            } catch { }

            const system = {
                totalMem: `${Math.floor(os.totalmem() / 1024 / 1024)} MB`,
                freeMem: `${Math.floor(os.freemem() / 1024 / 1024)} MB`,
                diskAvail: diskUsage
            };

            return res.json({
                hasGolems: liveCount > 0 || configuredCount > 0,
                liveCount,
                configuredCount,
                isSystemConfigured,
                isBooting: server.isBooting,
                allowRemote: server.allowRemote,
                localIp: getLocalIp(),
                dashboardPort: process.env.DASHBOARD_PORT || 3000,
                runtime,
                health,
                system
            });
        } catch (e) {
            console.error('[WebServer] Failed to get system status:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/system/config', (req, res) => {
        try {
            const EnvManager = require('../../src/utils/EnvManager');
            const envVars = EnvManager.readEnv();
            const rawMemoryMode = String(envVars.GOLEM_MEMORY_MODE || '').trim();

            let version = 'v9.1';
            try {
                const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
                version = pkg.version;
            } catch (e) {
                console.warn('[WebServer] Failed to read version from package.json:', e.message);
            }

            return res.json({
                version,
                userDataDir: envVars.USER_DATA_DIR || './golem_memory',
                golemBackend: normalizeBackend(envVars.GOLEM_BACKEND),
                golemMemoryMode: normalizeMemoryMode(rawMemoryMode),
                hasCustomMemoryMode: rawMemoryMode.length > 0,
                golemEmbeddingProvider: normalizeEmbeddingProvider(envVars.GOLEM_EMBEDDING_PROVIDER),
                golemLocalEmbeddingModel: envVars.GOLEM_LOCAL_EMBEDDING_MODEL || 'Xenova/bge-small-zh-v1.5',
                golemOllamaBaseUrl: envVars.GOLEM_OLLAMA_BASE_URL || envVars.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
                golemOllamaBrainModel: envVars.GOLEM_OLLAMA_BRAIN_MODEL || envVars.OLLAMA_BRAIN_MODEL || 'llama3.1:8b',
                golemOllamaEmbeddingModel: envVars.GOLEM_OLLAMA_EMBEDDING_MODEL || envVars.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
                golemOllamaRerankModel: envVars.GOLEM_OLLAMA_RERANK_MODEL || envVars.OLLAMA_RERANK_MODEL || '',
                golemOllamaTimeoutMs: envVars.GOLEM_OLLAMA_TIMEOUT_MS || envVars.OLLAMA_TIMEOUT_MS || '60000',
                golemLmstudioBaseUrl: envVars.GOLEM_LMSTUDIO_BASE_URL || envVars.LMSTUDIO_BASE_URL || 'http://127.0.0.1:1234/v1',
                golemLmstudioBrainModel: envVars.GOLEM_LMSTUDIO_BRAIN_MODEL || envVars.LMSTUDIO_BRAIN_MODEL || '',
                golemLmstudioTimeoutMs: envVars.GOLEM_LMSTUDIO_TIMEOUT_MS || envVars.LMSTUDIO_TIMEOUT_MS || '60000',
                golemLmstudioApiKey: envVars.GOLEM_LMSTUDIO_API_KEY || envVars.LMSTUDIO_API_KEY || '',
                golemMode: 'SINGLE',
                allowRemoteAccess: server.allowRemote,
                hasRemotePassword: !!(envVars.REMOTE_ACCESS_PASSWORD && envVars.REMOTE_ACCESS_PASSWORD.trim() !== '')
            });
        } catch (e) {
            console.error('[WebServer] Failed to get system config:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/system/config', requireSystemConfigUpdate, (req, res) => {
        try {
            const {
                geminiApiKeys,
                userDataDir,
                golemBackend,
                golemMemoryMode,
                golemEmbeddingProvider,
                golemLocalEmbeddingModel,
                golemOllamaBaseUrl,
                golemOllamaBrainModel,
                golemOllamaEmbeddingModel,
                golemOllamaRerankModel,
                golemOllamaTimeoutMs,
                golemLmstudioBaseUrl,
                golemLmstudioBrainModel,
                golemLmstudioTimeoutMs,
                golemLmstudioApiKey,
                allowRemoteAccess,
                remoteAccessPassword
            } = req.body;

            const EnvManager = require('../../src/utils/EnvManager');
            const ConfigManager = require('../../src/config/index');
            const updates = {};

            if (geminiApiKeys !== undefined) updates.GEMINI_API_KEYS = geminiApiKeys;
            if (userDataDir) updates.USER_DATA_DIR = userDataDir;
            if (golemBackend !== undefined) updates.GOLEM_BACKEND = normalizeBackend(golemBackend);
            if (golemMemoryMode !== undefined) updates.GOLEM_MEMORY_MODE = normalizeMemoryMode(golemMemoryMode);
            if (golemEmbeddingProvider !== undefined) updates.GOLEM_EMBEDDING_PROVIDER = normalizeEmbeddingProvider(golemEmbeddingProvider);
            if (golemLocalEmbeddingModel) updates.GOLEM_LOCAL_EMBEDDING_MODEL = golemLocalEmbeddingModel;
            if (golemOllamaBaseUrl !== undefined) updates.GOLEM_OLLAMA_BASE_URL = String(golemOllamaBaseUrl).trim();
            if (golemOllamaBrainModel !== undefined) updates.GOLEM_OLLAMA_BRAIN_MODEL = String(golemOllamaBrainModel).trim();
            if (golemOllamaEmbeddingModel !== undefined) updates.GOLEM_OLLAMA_EMBEDDING_MODEL = String(golemOllamaEmbeddingModel).trim();
            if (golemOllamaRerankModel !== undefined) updates.GOLEM_OLLAMA_RERANK_MODEL = String(golemOllamaRerankModel).trim();
            if (golemOllamaTimeoutMs !== undefined) updates.GOLEM_OLLAMA_TIMEOUT_MS = String(golemOllamaTimeoutMs).trim();
            if (golemLmstudioBaseUrl !== undefined) updates.GOLEM_LMSTUDIO_BASE_URL = String(golemLmstudioBaseUrl).trim();
            if (golemLmstudioBrainModel !== undefined) updates.GOLEM_LMSTUDIO_BRAIN_MODEL = String(golemLmstudioBrainModel).trim();
            if (golemLmstudioTimeoutMs !== undefined) updates.GOLEM_LMSTUDIO_TIMEOUT_MS = String(golemLmstudioTimeoutMs).trim();
            if (golemLmstudioApiKey !== undefined) updates.GOLEM_LMSTUDIO_API_KEY = String(golemLmstudioApiKey).trim();
            if (allowRemoteAccess !== undefined) updates.ALLOW_REMOTE_ACCESS = String(allowRemoteAccess);
            if (remoteAccessPassword !== undefined) updates.REMOTE_ACCESS_PASSWORD = String(remoteAccessPassword).trim();
            updates.GOLEM_MODE = 'SINGLE';

            if (Object.keys(updates).length === 0) {
                return res.json({ success: false, message: 'No updates provided.' });
            }

            updates.SYSTEM_CONFIGURED = 'true';
            EnvManager.updateEnv(updates);
            console.log('📝 [System] System configuration updated via web dashboard. Flag: SYSTEM_CONFIGURED=true');

            if (updates.ALLOW_REMOTE_ACCESS !== undefined) {
                server.allowRemote = updates.ALLOW_REMOTE_ACCESS === 'true';
            }

            ConfigManager.reloadConfig();

            for (const ctx of server.contexts.values()) {
                if (ctx.autonomy && typeof ctx.autonomy.scheduleNextArchive === 'function') {
                    ctx.autonomy.scheduleNextArchive();
                }
            }

            return res.json({ success: true, message: 'Configuration saved and reloaded.' });
        } catch (e) {
            console.error('[WebServer] Failed to update system config:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/system/backend/test', requireSystemConfigUpdate, async (req, res) => {
        try {
            const EnvManager = require('../../src/utils/EnvManager');
            const envVars = EnvManager.readEnv();
            const backend = normalizeBackend(req.body?.backend || envVars.GOLEM_BACKEND);
            const purpose = String(req.body?.purpose || 'brain').trim().toLowerCase() === 'embedding'
                ? 'embedding'
                : 'brain';
            const startedAt = Date.now();

            if (backend === 'ollama') {
                const baseUrl = String(
                    req.body?.baseUrl
                    || envVars.GOLEM_OLLAMA_BASE_URL
                    || envVars.OLLAMA_BASE_URL
                    || 'http://127.0.0.1:11434'
                ).trim();
                const timeoutMs = parsePositiveInt(
                    req.body?.timeoutMs || envVars.GOLEM_OLLAMA_TIMEOUT_MS || envVars.OLLAMA_TIMEOUT_MS,
                    60000
                );
                const client = new OllamaClient({ baseUrl, timeoutMs });

                if (purpose === 'embedding') {
                    const embeddingModel = String(
                        req.body?.embeddingModel
                        || req.body?.model
                        || envVars.GOLEM_OLLAMA_EMBEDDING_MODEL
                        || envVars.OLLAMA_EMBEDDING_MODEL
                        || ''
                    ).trim();

                    if (!embeddingModel) {
                        return res.status(400).json({ success: false, error: 'Ollama embedding model is required for embedding test.' });
                    }

                    const vector = await client.embed('ping', { model: embeddingModel });
                    const dimension = Array.isArray(vector) ? vector.length : 0;
                    return res.json({
                        success: true,
                        backend: 'ollama',
                        purpose: 'embedding',
                        baseUrl,
                        embeddingModel,
                        latencyMs: Math.max(0, Date.now() - startedAt),
                        message: 'Ollama embedding connection test passed.',
                        dimension
                    });
                }

                const model = String(
                    req.body?.model
                    || envVars.GOLEM_OLLAMA_BRAIN_MODEL
                    || envVars.OLLAMA_BRAIN_MODEL
                    || ''
                ).trim();

                if (!model) {
                    return res.status(400).json({ success: false, error: 'Ollama model is required for connection test.' });
                }

                const reply = await client.chat('Reply with exactly: OK', { model });
                return res.json({
                    success: true,
                    backend: 'ollama',
                    purpose: 'brain',
                    baseUrl,
                    model,
                    latencyMs: Math.max(0, Date.now() - startedAt),
                    message: 'Ollama connection test passed.',
                    preview: String(reply || '').slice(0, 120)
                });
            }

            if (backend === 'lmstudio') {
                if (purpose === 'embedding') {
                    return res.status(400).json({
                        success: false,
                        error: 'LM Studio embedding test is not supported in this route. Please use Ollama embedding provider for embedding tests.'
                    });
                }

                const baseUrl = String(
                    req.body?.baseUrl
                    || envVars.GOLEM_LMSTUDIO_BASE_URL
                    || envVars.LMSTUDIO_BASE_URL
                    || 'http://127.0.0.1:1234/v1'
                ).trim();
                const model = String(
                    req.body?.model
                    || envVars.GOLEM_LMSTUDIO_BRAIN_MODEL
                    || envVars.LMSTUDIO_BRAIN_MODEL
                    || ''
                ).trim();
                const timeoutMs = parsePositiveInt(
                    req.body?.timeoutMs || envVars.GOLEM_LMSTUDIO_TIMEOUT_MS || envVars.LMSTUDIO_TIMEOUT_MS,
                    60000
                );
                const apiKey = String(
                    req.body?.apiKey
                    || envVars.GOLEM_LMSTUDIO_API_KEY
                    || envVars.LMSTUDIO_API_KEY
                    || ''
                ).trim();

                if (!model) {
                    return res.status(400).json({ success: false, error: 'LM Studio model is required for connection test.' });
                }

                const client = new LMStudioClient({ baseUrl, timeoutMs, apiKey });
                const reply = await client.chat('Reply with exactly: OK', { model });
                return res.json({
                    success: true,
                    backend: 'lmstudio',
                    purpose: 'brain',
                    baseUrl,
                    model,
                    latencyMs: Math.max(0, Date.now() - startedAt),
                    message: 'LM Studio connection test passed.',
                    preview: String(reply || '').slice(0, 120)
                });
            }

            return res.status(400).json({
                success: false,
                error: 'Connection test currently supports only ollama and lmstudio backends.'
            });
        } catch (e) {
            console.error('[WebServer] Backend connection test failed:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    });

    router.post('/api/system/login', (req, res) => {
        try {
            const { password } = req.body;
            const expectedPassword = process.env.REMOTE_ACCESS_PASSWORD || '';

            if (!expectedPassword || expectedPassword.trim() === '') {
                auditSecurityEvent(server, 'login_skipped', req, { reason: 'no_remote_password_configured' });
                return res.json({ success: true, message: 'Authentication not required.' });
            }

            if (password === expectedPassword) {
                const token = server.createAuthSession(req);
                const isSecure = req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
                res.cookie('golem_auth_token', token, {
                    maxAge: server.authSessionTtlMs,
                    httpOnly: true,
                    sameSite: 'lax',
                    secure: !!isSecure,
                    path: '/',
                });
                auditSecurityEvent(server, 'login_success', req, { remote: server.requiresRemoteAuth(req) });
                return res.json({ success: true, message: 'Login successful.' });
            }

            auditSecurityEvent(server, 'login_failed', req, { reason: 'invalid_password' });
            return res.status(401).json({ success: false, message: '密碼錯誤 (Invalid password)' });
        } catch (e) {
            console.error('[WebServer] Login failed:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/system/logout', (req, res) => {
        try {
            const token = server.resolveAuthToken(req);
            server.invalidateAuthSession(token);
            res.clearCookie('golem_auth_token', { path: '/' });
            auditSecurityEvent(server, 'logout', req, {});
            return res.json({ success: true, message: 'Logged out' });
        } catch (e) {
            console.error('[WebServer] Logout failed:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/system/log-info', (req, res) => {
        try {
            const logPath = path.resolve(process.cwd(), 'logs', 'system.log');
            if (!fs.existsSync(logPath)) {
                return res.json({ success: true, size: '0 B', bytes: 0 });
            }

            const stats = fs.statSync(logPath);
            const bytes = stats.size;
            let displaySize = `${bytes} B`;
            if (bytes > 1024 * 1024) {
                displaySize = `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
            } else if (bytes > 1024) {
                displaySize = `${(bytes / 1024).toFixed(2)} KB`;
            }
            return res.json({ success: true, size: displaySize, bytes });
        } catch (e) {
            console.error('[WebServer] Failed to get log info:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/system/update/check', async (req, res) => {
        try {
            const SystemUpdater = require('../../src/utils/SystemUpdater');
            const info = await SystemUpdater.checkEnvironment();
            return res.json(info);
        } catch (e) {
            console.error('[WebServer] Update check failed:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/system/update/execute', requireUpdateExecute, async (req, res) => {
        try {
            const { keepOldData = true, keepMemory = true } = req.body;
            const SystemUpdater = require('../../src/utils/SystemUpdater');
            SystemUpdater.update({ keepOldData, keepMemory }, server.io).catch((err) => {
                console.error('[WebServer] Background update failed:', err);
            });
            return res.json({ success: true, message: 'Update process started' });
        } catch (e) {
            console.error('[WebServer] Update execution failed:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/system/restart', requireRestart, (req, res) => {
        try {
            console.log('🔄 [System] Restart requested by user. Triggering hard restart...');
            res.json({ success: true, message: 'Restarting system... Full re-initialization in progress.' });

            if (typeof global.gracefulRestart === 'function') {
                setTimeout(() => {
                    global.gracefulRestart().catch((err) => {
                        console.error('❌ [System] Restart error:', err);
                    });
                }, 1000);
            } else {
                console.warn('⚠️ [System] global.gracefulRestart not found, skipping forced process exit');
            }
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/system/reload', requireReload, (req, res) => {
        console.log('🔄 [WebServer] Received reload request. Restarting system...');
        res.json({ success: true, message: 'System is restarting with full re-initialization...' });

        if (typeof global.gracefulRestart === 'function') {
            setTimeout(() => {
                global.gracefulRestart().catch((err) => {
                    console.error('❌ [System] Reload error:', err);
                });
            }, 1000);
        } else {
            console.warn('⚠️ [System] global.gracefulRestart not found, skipping forced process exit');
        }
    });

    router.post('/api/system/shutdown', requireShutdown, (req, res) => {
        console.log('⛔ [WebServer] Received shutdown request. Stopping system...');
        res.json({ success: true, message: 'System is shutting down... Please restart manually if needed.' });

        if (typeof global.fullShutdown === 'function') {
            setTimeout(() => {
                global.fullShutdown().catch((err) => {
                    console.error('❌ [System] Shutdown error:', err);
                });
            }, 1000);
        } else {
            console.warn('⚠️ [System] global.fullShutdown not found, skipping forced process exit');
        }
    });

    router.get('/api/system/security/events', (req, res) => {
        try {
            const limitRaw = Number(req.query.limit || 100);
            const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;
            const events = (server.securityEvents || []).slice(-limit);
            return res.json({ success: true, events });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/health', (req, res) => {
        const pkg = (() => {
            try {
                return require('../../package.json');
            } catch {
                return { version: 'unknown' };
            }
        })();

        const contextEntries = Array.from(server.contexts.entries());
        const hasActivePage = contextEntries.some(([, ctx]) => !!(ctx && ctx.brain && ctx.brain.page));
        const runningCount = contextEntries.filter(([, ctx]) => (ctx && ctx.brain && ctx.brain.status === 'running')).length;

        let skillCount = 0;
        try {
            skillCount = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', []).size;
        } catch { }

        res.json({
            status: 'ok',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            brain: {
                connected: hasActivePage,
                runningCount,
                contextCount: contextEntries.length
            },
            skills: skillCount,
            version: pkg.version,
            timestamp: new Date().toISOString()
        });
    });

    return router;
};
