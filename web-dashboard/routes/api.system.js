const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { getLocalIp } = require('../../src/utils/HttpUtils');
const { resolveEnabledSkills } = require('../../src/skills/skillsConfig');

module.exports = function registerSystemRoutes(server) {
    const router = express.Router();

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

            try { runtime.npm = `v${execSync('npm -v').toString().trim()}`; } catch (e) { }

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
            } catch (e) {
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
            } catch (e) { }

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
                golemMemoryMode: envVars.GOLEM_MEMORY_MODE || 'lancedb',
                golemEmbeddingProvider: envVars.GOLEM_EMBEDDING_PROVIDER || 'gemini',
                golemLocalEmbeddingModel: envVars.GOLEM_LOCAL_EMBEDDING_MODEL || 'Xenova/bge-small-zh-v1.5',
                golemMode: 'SINGLE',
                allowRemoteAccess: server.allowRemote,
                hasRemotePassword: !!(envVars.REMOTE_ACCESS_PASSWORD && envVars.REMOTE_ACCESS_PASSWORD.trim() !== '')
            });
        } catch (e) {
            console.error('[WebServer] Failed to get system config:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/system/config', (req, res) => {
        try {
            const {
                geminiApiKeys,
                userDataDir,
                golemMemoryMode,
                golemEmbeddingProvider,
                golemLocalEmbeddingModel,
                allowRemoteAccess,
                remoteAccessPassword
            } = req.body;

            const EnvManager = require('../../src/utils/EnvManager');
            const ConfigManager = require('../../src/config/index');
            const updates = {};

            if (geminiApiKeys !== undefined) updates.GEMINI_API_KEYS = geminiApiKeys;
            if (userDataDir) updates.USER_DATA_DIR = userDataDir;
            if (golemMemoryMode) updates.GOLEM_MEMORY_MODE = golemMemoryMode;
            if (golemEmbeddingProvider) updates.GOLEM_EMBEDDING_PROVIDER = golemEmbeddingProvider;
            if (golemLocalEmbeddingModel) updates.GOLEM_LOCAL_EMBEDDING_MODEL = golemLocalEmbeddingModel;
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

    router.post('/api/system/login', (req, res) => {
        try {
            const { password } = req.body;
            const expectedPassword = process.env.REMOTE_ACCESS_PASSWORD || '';

            if (!expectedPassword || expectedPassword.trim() === '') {
                return res.json({ success: true, message: 'Authentication not required.' });
            }

            if (password === expectedPassword) {
                res.cookie('golem_auth_token', 'verified', {
                    maxAge: 7 * 24 * 60 * 60 * 1000,
                    httpOnly: false,
                    sameSite: 'lax',
                });
                return res.json({ success: true, message: 'Login successful.' });
            }

            return res.status(401).json({ success: false, message: '密碼錯誤 (Invalid password)' });
        } catch (e) {
            console.error('[WebServer] Login failed:', e);
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

    router.post('/api/system/update/execute', async (req, res) => {
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

    router.post('/api/system/restart', (req, res) => {
        try {
            console.log('🔄 [System] Restart requested by user. Triggering hard restart...');
            res.json({ success: true, message: 'Restarting system... Full re-initialization in progress.' });

            if (typeof global.gracefulRestart === 'function') {
                setTimeout(() => {
                    global.gracefulRestart().catch((err) => {
                        console.error('❌ [System] Restart error:', err);
                        process.exit(1);
                    });
                }, 1000);
            } else {
                console.warn('⚠️ [System] global.gracefulRestart not found, falling back to process.exit()');
                setTimeout(() => process.exit(0), 1000);
            }
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/system/reload', (req, res) => {
        console.log('🔄 [WebServer] Received reload request. Restarting system...');
        res.json({ success: true, message: 'System is restarting with full re-initialization...' });

        if (typeof global.gracefulRestart === 'function') {
            setTimeout(() => {
                global.gracefulRestart().catch((err) => {
                    console.error('❌ [System] Reload error:', err);
                    process.exit(1);
                });
            }, 1000);
        } else {
            console.warn('⚠️ [System] global.gracefulRestart not found, falling back to process.exit()');
            setTimeout(() => process.exit(0), 1000);
        }
    });

    router.post('/api/system/shutdown', (req, res) => {
        console.log('⛔ [WebServer] Received shutdown request. Stopping system...');
        res.json({ success: true, message: 'System is shutting down... Please restart manually if needed.' });

        if (typeof global.fullShutdown === 'function') {
            setTimeout(() => {
                global.fullShutdown().catch((err) => {
                    console.error('❌ [System] Shutdown error:', err);
                    process.exit(1);
                });
            }, 1000);
        } else {
            console.warn('⚠️ [System] global.fullShutdown not found, falling back to process.exit()');
            setTimeout(() => process.exit(0), 1000);
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
        } catch (e) { }

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
