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
const registerMcpRoutes = require('./routes/api.mcp');
const registerDiaryRoutes = require('./routes/api.diary');
const registerPromptPoolRoutes = require('./routes/api.prompt-pool');
const registerTaskRoutes = require('./routes/api.tasks');
const registerAgentRoutes = require('./routes/api.agents');

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

        this.app.use(express.json({ limit: bodyLimit }));
        this.app.use(express.urlencoded({ limit: bodyLimit, extended: true }));

        this.server = http.createServer(this.app);
        this.server.timeout = 300000;

        this.app.use((req, res, next) => {
            const connectSrc = this.allowRemote
                ? "default-src 'self'; connect-src * ws: wss:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: *;"
                : "default-src 'self'; connect-src 'self' ws: wss:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: *;";
            res.setHeader('Content-Security-Policy', connectSrc);
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

        this.port = process.env.DASHBOARD_PORT || 3000;
        console.log(`📡 [WebServer] Initial port: ${this.port}, Dev Mode: ${process.env.DASHBOARD_DEV_MODE}`);

        const isDev = (process.env.DASHBOARD_DEV_MODE || '').trim() === 'true';
        if (isDev && this.port == 3000) {
            console.log('🚧 [WebServer] Dev Mode detected + Port 3000: Automatically shifting backend to 3001.');
            this.port = 3001;
        }
        console.log(`📡 [WebServer] Final bound port: ${this.port}`);

        this.contexts = new Map();
        this.golemFactory = null;
        this.runtimeController = null;
        this.isBooting = true;
        this.logBuffer = [];
        this.taskEventBuffer = [];
        this.taskViolationBuffer = [];
        this.taskResumeBuffer = [];
        this.taskRecoveryState = {};
        this.taskRecoveryMeta = {};
        this.agentEventBuffer = [];
        this.agentViolationBuffer = [];
        this.agentResumeBuffer = [];
        this.agentRecoveryState = {};
        this.agentRecoveryMeta = {};
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
                    const shouldInitInWebLayer = !this.runtimeController
                        && instance
                        && instance.brain
                        && typeof instance.brain.init === 'function';

                    if (shouldInitInWebLayer) {
                        await instance.brain.init(false);
                    }

                    console.log('✅ [WebServer] Golem auto-started successfully.');
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
            registerMcpRoutes,
            registerDiaryRoutes,
            registerPromptPoolRoutes,
            registerTaskRoutes,
            registerAgentRoutes,
        ];

        routeFactories.forEach((factory) => {
            this.app.use(factory(this));
        });

        registerSocketHandlers(this);
        this.startServer();
    }

    startServer() {
        this.server.listen(this.port, '0.0.0.0', () => {
            const displayPort = process.env.DASHBOARD_DEV_MODE === 'true' ? 3000 : this.port;
            const url = `http://localhost:${displayPort}/dashboard`;
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
        });
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
            const payload = { ...data };
            if (this.runtimeController && !payload.runtime) {
                payload.runtime = this.runtimeController.getRuntimeSnapshot();
            }
            this.io.emit('state_update', payload);
        }
    }

    broadcastHeartbeat(data) {
        if (this.io) {
            const payload = { ...data };
            if (this.runtimeController && !payload.runtime) {
                payload.runtime = this.runtimeController.getRuntimeSnapshot();
            }
            this.io.emit('heartbeat', payload);
        }
    }

    broadcastTaskEvent(payload = {}) {
        this.taskEventBuffer.push(payload);
        if (this.taskEventBuffer.length > 500) {
            this.taskEventBuffer.shift();
        }
        if (this.io) {
            this.io.emit('task_event', payload);
            if (payload && payload.type === 'task.violation') {
                this.taskViolationBuffer.push(payload);
                if (this.taskViolationBuffer.length > 500) this.taskViolationBuffer.shift();
                this.io.emit('task_violation', payload);
            }
            if (payload && payload.type === 'task.resume') {
                this.taskResumeBuffer.push(payload);
                if (this.taskResumeBuffer.length > 500) this.taskResumeBuffer.shift();
                this.io.emit('task_resume', payload);
            }
        }
    }

    broadcastTaskRecovery(payload = {}) {
        const golemId = payload && payload.golemId ? String(payload.golemId) : 'golem_A';
        const dedupWindowMs = Number(process.env.GOLEM_TASK_RECOVERY_DEDUP_MS || 1500);
        const safeWindowMs = Number.isFinite(dedupWindowMs) && dedupWindowMs >= 0 ? dedupWindowMs : 1500;
        const seq = Number(payload && payload.seq);
        const now = Date.now();
        const previous = this.taskRecoveryMeta[golemId] || { seq: 0, ts: 0 };
        if (Number.isFinite(seq) && seq > 0 && Number.isFinite(previous.seq) && seq <= previous.seq) {
            return;
        }
        if (now - Number(previous.ts || 0) < safeWindowMs) {
            const prevRecovery = this.taskRecoveryState[golemId] || {};
            const prevType = String(prevRecovery.recoveryType || '');
            const nextType = String(payload && payload.recoveryType || '');
            const prevNextTask = prevRecovery.recovery && prevRecovery.recovery.nextTaskId;
            const nextNextTask = payload && payload.recovery && payload.recovery.nextTaskId;
            if (prevType === nextType && prevNextTask === nextNextTask) {
                return;
            }
        }
        this.taskRecoveryMeta[golemId] = {
            seq: Number.isFinite(seq) ? seq : (Number(previous.seq || 0) + 1),
            ts: now,
        };
        this.taskRecoveryState[golemId] = payload;
        if (this.io) {
            this.io.emit('task_recovery', payload);
        }
    }

    broadcastAgentEvent(payload = {}) {
        this.agentEventBuffer.push(payload);
        if (this.agentEventBuffer.length > 500) {
            this.agentEventBuffer.shift();
        }

        if (!this.io) return;
        this.io.emit('agent_event', payload);

        const type = String(payload && payload.type || '').trim();
        if (type === 'agent.violation') {
            this.agentViolationBuffer.push(payload);
            if (this.agentViolationBuffer.length > 500) this.agentViolationBuffer.shift();
            this.io.emit('agent_violation', payload);
        }
        if (type === 'agent.resume') {
            this.agentResumeBuffer.push(payload);
            if (this.agentResumeBuffer.length > 500) this.agentResumeBuffer.shift();
            this.io.emit('agent_resume', payload);
        }
        if (type === 'agent.session.created') {
            this.io.emit('agent_session_created', payload);
        }
        if (type === 'agent.session.updated') {
            this.io.emit('agent_session_updated', payload);
        }
        if (type === 'agent.worker.created' || type === 'agent.worker.updated') {
            this.io.emit('agent_worker_updated', payload);
        }
        if (type === 'agent.notification') {
            this.io.emit('agent_notification', payload);
        }
    }

    broadcastAgentRecovery(payload = {}) {
        const golemId = payload && payload.golemId ? String(payload.golemId) : 'golem_A';
        const dedupWindowMs = Number(process.env.GOLEM_AGENT_RECOVERY_DEDUP_MS || 1500);
        const safeWindowMs = Number.isFinite(dedupWindowMs) && dedupWindowMs >= 0 ? dedupWindowMs : 1500;
        const seq = Number(payload && payload.seq);
        const now = Date.now();
        const previous = this.agentRecoveryMeta[golemId] || { seq: 0, ts: 0 };

        if (Number.isFinite(seq) && seq > 0 && Number.isFinite(previous.seq) && seq <= previous.seq) {
            return;
        }
        if (now - Number(previous.ts || 0) < safeWindowMs) {
            const prevRecovery = this.agentRecoveryState[golemId] || {};
            const prevType = String(prevRecovery.recoveryType || '');
            const nextType = String(payload && payload.recoveryType || '');
            const prevNextSession = prevRecovery.recovery && prevRecovery.recovery.nextSessionId;
            const nextNextSession = payload && payload.recovery && payload.recovery.nextSessionId;
            if (prevType === nextType && prevNextSession === nextNextSession) {
                return;
            }
        }

        this.agentRecoveryMeta[golemId] = {
            seq: Number.isFinite(seq) ? seq : (Number(previous.seq || 0) + 1),
            ts: now,
        };
        this.agentRecoveryState[golemId] = payload;
        if (this.io) {
            this.io.emit('agent_recovery', payload);
        }
    }

    stop() {
        if (this.server) {
            this.server.close();
        }
    }
}

module.exports = WebServer;
