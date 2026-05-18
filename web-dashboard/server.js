const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const registerStaticRoutes = require('./server/registerStaticRoutes');
const registerSocketHandlers = require('./server/registerSocketHandlers');
const {
    installSecurityContext,
    buildApiSecurityMiddleware,
} = require('./server/security');

const registerUploadRoutes = require('./routes/api.upload');
const registerChatRoutes = require('./routes/api.chat');
const registerConfigRoutes = require('./routes/api.config');
const registerSkillsRoutes = require('./routes/api.skills');
const registerSystemRoutes = require('./routes/api.system');
const registerPersonaRoutes = require('./routes/api.persona');
const registerGolemRoutes = require('./routes/api.golems');
const registerMemoryRoutes = require('./routes/api.memory');
const registerMemoryFirewallRoutes = require('./routes/api.memory-firewall');
const registerMcpRoutes = require('./routes/api.mcp');
const registerDiaryRoutes = require('./routes/api.diary');
const registerPromptPoolRoutes = require('./routes/api.prompt-pool');
const registerRpgRoutes = require('./routes/api.rpg');
const registerStockRoutes = require('./routes/api.stocks');
const registerReferenceFileRoutes = require('./routes/api.reference-files');
const registerCalendarRoutes = require('./routes/api.calendar');

class WebServer {
    constructor(dashboard) {
        this.dashboard = dashboard;
        this.app = express();

        this.allowRemote = (process.env.ALLOW_REMOTE_ACCESS || '').trim() === 'true';
        const corsOrigin = this.allowRemote
            ? true
            : [
                'http://localhost:3000',
                'http://127.0.0.1:3000',
                'http://localhost:3001',
                'http://127.0.0.1:3001'
            ];

        this.app.use(cors({
            origin: corsOrigin,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
        }));

        const uploadMaxBytesRaw = Number(process.env.UPLOAD_MAX_BYTES || 8 * 1024 * 1024);
        this.maxUploadBytes = Number.isFinite(uploadMaxBytesRaw) && uploadMaxBytesRaw > 0
            ? Math.floor(uploadMaxBytesRaw)
            : 8 * 1024 * 1024;

        const bodyLimitMbRaw = Number(process.env.DASHBOARD_API_BODY_LIMIT_MB || 5);
        const baseBodyLimitMb = Number.isFinite(bodyLimitMbRaw) && bodyLimitMbRaw > 0
            ? Math.min(bodyLimitMbRaw, 25)
            : 5;
        const uploadOverheadMb = Math.ceil((this.maxUploadBytes * 1.4) / (1024 * 1024));
        const bodyLimitMb = Math.min(50, Math.max(baseBodyLimitMb, uploadOverheadMb));
        const bodyLimit = `${bodyLimitMb}mb`;
        const backupBodyLimitMbRaw = Number(process.env.DASHBOARD_BACKUP_BODY_LIMIT_MB || 120);
        const backupBodyLimitMb = Number.isFinite(backupBodyLimitMbRaw) && backupBodyLimitMbRaw > 0
            ? Math.min(backupBodyLimitMbRaw, 256)
            : 120;
        const backupBodyLimit = `${backupBodyLimitMb}mb`;

        // Backup restore payload can be much larger than normal API requests.
        // Apply a wider limit only for backup endpoints to reduce global attack surface.
        this.app.use('/api/system/backup', express.json({ limit: backupBodyLimit }));
        this.app.use('/api/system/backup', express.urlencoded({ limit: backupBodyLimit, extended: true }));

        this.app.use(express.json({ limit: bodyLimit }));
        this.app.use(express.urlencoded({ limit: bodyLimit, extended: true }));

        this.server = http.createServer(this.app);
        this.server.timeout = 300000;

        this.app.use((req, res, next) => {
            const rpgSources = [
                'https://cdn.tailwindcss.com',
                'https://unpkg.com',
                'https://cdnjs.cloudflare.com',
                'https://www.gstatic.com',
                'https://fonts.googleapis.com',
                'https://fonts.gstatic.com',
            ].join(' ');
            const rpgConnectSources = [
                'https://www.googleapis.com',
                'https://firebaseinstallations.googleapis.com',
                'https://identitytoolkit.googleapis.com',
                'https://firestore.googleapis.com',
                'https://securetoken.googleapis.com',
                'https://*.googleapis.com',
            ].join(' ');
            const connectSrc = this.allowRemote ? '* ws: wss:' : `'self' ws: wss: ${rpgConnectSources}`;
            res.setHeader(
                'Content-Security-Policy',
                [
                    "default-src 'self'",
                    `connect-src ${connectSrc}`,
                    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${rpgSources}`,
                    `style-src 'self' 'unsafe-inline' ${rpgSources}`,
                    `font-src 'self' data: ${rpgSources}`,
                    "img-src 'self' data: blob: *",
                    "frame-src 'self'",
                ].join('; ') + ';'
            );
            next();
        });

        this.app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
            res.json({});
        });

        this.io = new Server(this.server, {
            cors: {
                origin: corsOrigin,
                methods: ['GET', 'POST']
            }
        });

        this.port = Number(process.env.DASHBOARD_PORT || 3000);
        console.log(`📡 [WebServer] Initial port: ${this.port}, Dev Mode: ${process.env.DASHBOARD_DEV_MODE}`);

        const isDev = (process.env.DASHBOARD_DEV_MODE || '').trim() === 'true';
        if (isDev && this.port == 3000) {
            console.log('🚧 [WebServer] Dev Mode detected + Port 3000: Automatically shifting backend to 3001.');
            this.port = 3001;
        }
        console.log(`📡 [WebServer] Final preferred port: ${this.port}`);

        this.contexts = new Map();
        this.golemFactory = null;
        this.isBooting = true;
        this.logBuffer = [];
        this.chatHistory = new Map();
        installSecurityContext(this);
        this.app.use(buildApiSecurityMiddleware(this));

        this.init();
    }

    setGolemFactory(fn) {
        this.golemFactory = fn;
        console.log('🔗 [WebServer] Golem factory injected — dynamic Golem creation enabled.');

        setTimeout(async () => {
            const ConfigManager = require('../src/config/index');
            const fs = require('fs');
            const path = require('path');

            const { MEMORY_BASE_DIR } = ConfigManager;
            const personaPath = path.resolve(MEMORY_BASE_DIR, 'persona.json');

            console.log('🔄 [WebServer] Scanning for persona.json to auto-start Golem...');

            if (fs.existsSync(personaPath)) {
                console.log('🚀 [WebServer] Auto-starting Golem from saved state...');
                try {
                    const EnvManager = require('../src/utils/EnvManager');
                    const envVars = EnvManager.readEnv();
                    const config = {
                        id: 'golem_A',
                        tgToken: envVars.TELEGRAM_TOKEN,
                        dcToken: envVars.DISCORD_TOKEN,
                        tgAuthMode: envVars.TG_AUTH_MODE,
                        adminId: envVars.ADMIN_ID,
                        chatId: envVars.TG_CHAT_ID
                    };
                    const instance = await this.golemFactory(config);
                    if (instance.brain.init) {
                        await instance.brain.init(false);
                        console.log('✅ [WebServer] Golem auto-started successfully.');
                    }
                } catch (e) {
                    console.error('❌ [WebServer] Failed to auto-start Golem:', e);
                } finally {
                    this.isBooting = false;
                    console.log('🏁 [WebServer] Booting complete! Dashboard is now ready.');
                }
            } else {
                console.log('⏸️ [WebServer] Golem skipped auto-start (Missing persona.json).');
                this.isBooting = false;
                console.log('🏁 [WebServer] Booting complete (No Golem to start). Dashboard is ready.');
            }
        }, 500);
    }

    setContext(golemId, brain, memory, autonomy) {
        this.contexts.set(golemId, { brain, memory, autonomy });
        console.log(`🔗 [WebServer] Context linked: Brain, Memory & Autonomy for Golem [${golemId}]`);
    }

    removeContext(golemId) {
        this.contexts.delete(golemId);
        console.log(`🔌 [WebServer] Context unlinked: Golem [${golemId}] removed from memory.`);
    }

    init() {
        registerStaticRoutes(this);

        const routeFactories = [
            registerUploadRoutes,
            registerChatRoutes,
            registerConfigRoutes,
            registerSkillsRoutes,
            registerSystemRoutes,
            registerPersonaRoutes,
            registerGolemRoutes,
            registerMemoryRoutes,
            registerMemoryFirewallRoutes,
            registerMcpRoutes,
            registerDiaryRoutes,
            registerPromptPoolRoutes,
            registerRpgRoutes,
            registerStockRoutes,
            registerReferenceFileRoutes,
            registerCalendarRoutes,
        ];

        routeFactories.forEach((factory) => {
            this.app.use(factory(this));
        });

        this.app.use((err, req, res, next) => {
            if (!err) return next();
            if (err.type === 'entity.too.large') {
                return res.status(413).json({
                    success: false,
                    error: 'Payload too large',
                    message: 'Backup file is too large for current server limit.',
                    limit: err.limit || null
                });
            }
            return next(err);
        });

        registerSocketHandlers(this);
        this.startServer();
    }

    startServer() {
        const preferredPort = Number(this.port) || 3000;
        const maxAttempts = 10;

        const tryListen = (port, attempt = 1) => {
            const onError = (err) => {
                this.server.removeListener('listening', onListening);

                if (err && err.code === 'EADDRINUSE' && attempt < maxAttempts) {
                    const nextPort = port + 1;
                    console.warn(`⚠️ [WebServer] Port ${port} is in use. Trying ${nextPort}...`);
                    setTimeout(() => tryListen(nextPort, attempt + 1), 100);
                    return;
                }

                console.error(`❌ [WebServer] Failed to bind dashboard on port ${port}:`, err.message);
                throw err;
            };

            const onListening = () => {
                this.server.removeListener('error', onError);
                this.port = port;
                process.env.DASHBOARD_PORT = String(port);
                console.log(`📡 [WebServer] Final bound port: ${this.port}`);

                const url = `http://localhost:${this.port}/dashboard`;
                console.log(`🚀 [WebServer] Dashboard running at ${url}`);

                if (!process.env.SKIP_BROWSER) {
                    setTimeout(() => {
                        const connectedClients = this.io.engine.clientsCount;
                        if (connectedClients === 0) {
                            const startCmd = process.platform == 'darwin'
                                ? 'open'
                                : process.platform == 'win32'
                                    ? 'start'
                                    : 'xdg-open';

                            const { exec } = require('child_process');
                            exec(`${startCmd} ${url}`);
                        } else {
                            console.log(`🌐 [WebServer] Existing dashboard tab detected (${connectedClients} connection/s). Skipping auto-open.`);
                        }
                    }, 1500);
                }
            };

            this.server.once('error', onError);
            this.server.once('listening', onListening);
            this.server.listen(port, '0.0.0.0');
        };

        tryListen(preferredPort);
    }

    broadcastLog(data) {
        this.logBuffer.push(data);
        if (this.logBuffer.length > 200) {
            this.logBuffer.shift();
        }

        if (data && data.msg) {
            const restartMatch = data.msg.match(/Browser Session Started \(Golem: (.*?)\)/);
            if (restartMatch) {
                const gId = restartMatch[1];
                if (!this.chatHistory) this.chatHistory = new Map();
                this.chatHistory.set(gId, []);
                console.log(`🧹 [WebServer] Cleared chat history for Golem [${gId}] due to browser session start.`);
            }

            if (
                data.type !== 'thinking' &&
                (
                    data.type === 'agent' ||
                    data.type === 'approval' ||
                    data.msg.includes('[MultiAgent]') ||
                    data.msg.includes('[User]') ||
                    data.msg.includes('[WebUser]')
                )
            ) {
                let gId = data.golemId;
                if (!gId) {
                    const srcMatch = data.msg.match(/^\[(.*?)\]/);
                    if (srcMatch && !['User', 'System', 'WebUser', 'User Action', 'MultiAgent'].includes(srcMatch[1])) {
                        gId = srcMatch[1];
                    }
                }

                if (gId && gId !== 'System' && gId !== 'global') {
                    if (!this.chatHistory) this.chatHistory = new Map();
                    if (!this.chatHistory.has(gId)) this.chatHistory.set(gId, []);
                    this.chatHistory.get(gId).push(data);

                    if (this.chatHistory.get(gId).length > 500) {
                        this.chatHistory.get(gId).shift();
                    }
                }
            }
        }

        if (this.io) {
            this.io.emit('log', data);
        }
    }

    broadcastState(data) {
        if (this.io) {
            this.io.emit('state_update', data);
        }
    }

    broadcastHeartbeat(data) {
        if (this.io) {
            this.io.emit('heartbeat', data);
        }
    }

    stop() {
        if (this.server) {
            this.server.close();
        }
    }
}

module.exports = WebServer;
