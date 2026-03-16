const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');
const { MANDATORY_SKILLS, OPTIONAL_SKILLS: OPTIONAL_SKILL_LIST, resolveEnabledSkills } = require('../src/skills/skillsConfig');

// v10.8: Safe exit — run GracefulShutdown handlers before process.exit
function safeExit(code = 0) {
    try {
        const shutdown = require('../src/bridges/GracefulShutdown');
        shutdown._runAll().then(() => process.exit(code)).catch(() => process.exit(code));
    } catch (e) {
        process.exit(code);
    }
}

// ─── .env helper ────────────────────────────────────────────────────────────────────
function readEnvFile(envPath) {
    if (!fs.existsSync(envPath)) return {};
    const content = fs.readFileSync(envPath, 'utf8');
    const result = {};
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        result[key] = val;
    }
    return result;
}

function updateEnvFile(envPath, updates) {
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    for (const [key, value] of Object.entries(updates)) {
        const regex = new RegExp(`^(${key}\\s*=.*)$`, 'm');
        if (regex.test(content)) {
            content = content.replace(regex, `${key}=${value}`);
        } else {
            content = content + `\n${key}=${value}`;
        }
    }
    fs.writeFileSync(envPath, content, 'utf8');
}

function maskValue(val) {
    if (!val || val.length < 8) return val ? '****' : '';
    return val.slice(0, 4) + '****' + val.slice(-4);
}

class WebServer {
    constructor(dashboard) {
        this.dashboard = dashboard; // Reference to main dashboard if needed for initial state
        this.app = express();
        this.app.use(express.json()); // Enable JSON body parsing
        this.server = http.createServer(this.app);

        // Security & Cleanup Middleware
        this.app.use((req, res, next) => {
            // Set a sensible CSP to avoid Chrome defaults blocking things during redirects
            res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' ws: wss:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;");
            next();
        });

        // Silencing Chrome's default searching for devtools config to avoid 404 noise
        this.app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
            res.json({});
        });

        // [Health Endpoint] Lightweight health check for external monitoring
        this.app.get('/health', (req, res) => {
            try {
                const mem = process.memoryUsage();
                const health = {
                    status: 'ok',
                    timestamp: new Date().toISOString(),
                    uptime: Math.floor(process.uptime()),
                    memory: {
                        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
                        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
                        rss: Math.round(mem.rss / 1024 / 1024),
                    },
                    golems: this.contexts ? this.contexts.size : 0,
                };

                // Add Telegram health if watchdog is available
                try {
                    const tgHealth = require('../src/bridges/TelegramHealthWatchdog');
                    health.telegram = tgHealth.getHealth();
                    if (health.telegram.status === 'critical') health.status = 'degraded';
                } catch (e) { /* watchdog not loaded */ }

                // Add circuit breaker status
                try {
                    const cb = require('../src/core/circuit_breaker');
                    health.circuitBreakers = cb.getStatus();
                    for (const [name, s] of Object.entries(health.circuitBreakers)) {
                        if (s.state === 'OPEN') {
                            health.status = 'degraded';
                            break;
                        }
                    }
                } catch (e) { /* CB not loaded */ }

                // Enhanced health info
                try {
                    const snapshot = global._metricsCollector ? global._metricsCollector.getSnapshot() : {};
                    health.skills = { loaded: snapshot.skills_loaded || 0 };
                    health.brainEngine = process.env.GOLEM_BRAIN_ENGINE || 'puppeteer';
                    health.memoryLayers = {
                        working: snapshot.memory_working || 0,
                        episodic: snapshot.memory_episodic || 0,
                    };
                    health.ragConfidence = snapshot.rag_confidence_avg || 0;
                    health.errors1h = snapshot.errors_1h || 0;
                    health.cpu = snapshot.cpu_pct || 0;
                } catch (e) { /* optional metrics */ }

                const httpCode = health.status === 'ok' ? 200 : 503;
                res.status(httpCode).json(health);
            } catch (e) {
                res.status(500).json({ status: 'error', error: e.message });
            }
        });

        this.io = new Server(this.server, {
            cors: {
                origin: "*", // Allow Next.js dev server
                methods: ["GET", "POST"]
            }
        });
        this.port = process.env.DASHBOARD_PORT || 3000;

        this.contexts = new Map();
        this.golemFactory = null; // Injected from index.js for dynamic Golem creation

        this.init();
        this.logBuffer = []; // Store last 200 logs
        this.chatHistory = new Map(); // Store chat history per golem

        // ✅ [Phase 1.5 Bug #5] Persistent chat history
        this._chatHistoryFile = path.join(path.resolve(__dirname, '..'), 'golem_memory', 'chat_history.json');
        this._loadChatHistory();
        this._chatHistorySaveTimer = null;
    }

    _loadChatHistory() {
        try {
            if (fs.existsSync(this._chatHistoryFile)) {
                const data = JSON.parse(fs.readFileSync(this._chatHistoryFile, 'utf-8'));
                for (const [golemId, history] of Object.entries(data)) {
                    this.chatHistory.set(golemId, history);
                }
                console.log(`[WebServer] Loaded chat history (${Object.keys(data).length} golems)`);
            }
        } catch (e) {
            console.warn('[WebServer] Failed to load chat history:', e.message);
        }
    }

    _saveChatHistory() {
        if (this._chatHistorySaveTimer) return; // debounce
        this._chatHistorySaveTimer = setTimeout(() => {
            try {
                const dir = path.dirname(this._chatHistoryFile);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                const data = {};
                for (const [golemId, history] of this.chatHistory.entries()) {
                    data[golemId] = history.slice(-200); // Keep last 200 messages
                }
                fs.writeFileSync(this._chatHistoryFile, JSON.stringify(data, null, 2));
            } catch (e) {
                console.warn('[WebServer] Failed to save chat history:', e.message);
            }
            this._chatHistorySaveTimer = null;
        }, 5000);
    }

    /**
     * 注入 Golem 工廠函式（由 index.js 在啟動後呼叫）
     * @param {Function} fn async (golemConfig) => golemInstance
     */
    setGolemFactory(fn) {
        this.golemFactory = fn;
        console.log('🔗 [WebServer] Golem factory injected — dynamic Golem creation enabled.');

        // 🎯 V9.0.7: Auto-start fully-configured Golems on backend boot.
        // We defer this by 2 seconds to let the server fully stabilize.
        setTimeout(async () => {
            const EnvManager = require('../src/utils/EnvManager');
            const envVars = EnvManager.readEnv();
            const ConfigManager = require('../src/config/index');
            const fs = require('fs');
            const path = require('path');

            const isSingleNode = ConfigManager.GOLEM_MODE === 'SINGLE';
            const { MEMORY_BASE_DIR } = ConfigManager;

            console.log('🔄 [WebServer] Scanning for fully-configured Golems to auto-start...');

            let allConfigs = [];

            // 1. Gather configs
            if (isSingleNode) {
                const hasToken = envVars.TELEGRAM_TOKEN || envVars.DISCORD_TOKEN;
                if (hasToken) {
                    allConfigs.push({
                        id: 'golem_A',
                        tgToken: envVars.TELEGRAM_TOKEN,
                        dcToken: envVars.DISCORD_TOKEN,
                        tgAuthMode: envVars.TG_AUTH_MODE,
                        adminId: envVars.ADMIN_ID,
                        chatId: envVars.TG_CHAT_ID
                    });
                }
            } else {
                const golemsPath = path.resolve(process.cwd(), 'golems.json');
                if (fs.existsSync(golemsPath)) {
                    allConfigs = JSON.parse(fs.readFileSync(golemsPath, 'utf8'));
                }
            }

            // 2. Iterate and check persona
            for (const config of allConfigs) {
                // Determine persona.json path
                let personaPath;
                if (isSingleNode) {
                    personaPath = path.resolve(MEMORY_BASE_DIR, 'persona.json');
                } else {
                    personaPath = path.resolve(MEMORY_BASE_DIR, config.id, 'persona.json');
                }

                if (fs.existsSync(personaPath)) {
                    // Ready to start!
                    console.log(`🚀 [WebServer] Auto-starting Golem [${config.id}] from saved state...`);
                    try {
                        const instance = await this.golemFactory(config);
                        if (instance.brain.init) {
                            await instance.brain.init(false);
                            console.log(`✅ [WebServer] Golem [${config.id}] auto-started successfully.`);
                        }
                    } catch (e) {
                        console.error(`❌ [WebServer] Failed to auto-start Golem [${config.id}]:`, e);
                    }
                } else {
                    console.log(`⏸️ [WebServer] Golem [${config.id}] skipped auto-start (Missing persona.json).`);
                }
            }
        }, 2000);
    }

    setContext(golemId, brain, memory) {
        this.contexts.set(golemId, { brain, memory });
        // v10.5: Update Claude Gateway context
        if (this._claudeGateway) {
            const brains = {};
            for (const [id, ctx] of this.contexts) brains[id] = ctx.brain;
            this._claudeGateway.setContext(brain, brains, brain._ragProvider || null);
        }
        console.log(`🔗 [WebServer] Context linked: Brain & Memory for Golem [${golemId}]`);
    }

    init() {
        // v10.5: Claude Gateway
        try {
            const ClaudeGateway = require('../src/bridges/ClaudeGateway');
            this._claudeGateway = new ClaudeGateway(null);
            this._claudeGateway.mountRoutes(this.app);
        } catch (e) { console.warn('[WebServer] Claude Gateway not available:', e.message); }

        // Serve static files with .html extension support
        const publicPath = path.join(__dirname, 'out');
        this.app.use(express.static(publicPath, {
            extensions: ['html'],
            setHeaders: (res, path) => {
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            }
        }));

        // Fix Next.js static export routing
        this.app.get('/', (req, res) => {
            res.redirect('/dashboard');
        });

        // Ensure /dashboard and sub-routes are handled for SPA
        const dashboardRoutes = [
            '/dashboard',
            '/dashboard/terminal',
            '/dashboard/agents',
            '/dashboard/office',
            '/dashboard/system-setup'
        ];

        // 🎯 V9.0.7 解耦：自動導引系統設定 (Auto-Setup)
        // 在進入 Dashboard 核心頁面之前，檢查系統配置狀態
        this.app.get(/\/dashboard.*/, (req, res, next) => {
            const normalizedPath = req.path.replace(/\/$/, "");
            // 排除設定頁面本身與 API 請求，避免無限重定向
            if (normalizedPath === '/dashboard/system-setup' || req.path.startsWith('/api/')) {
                return next();
            }

            try {
                const ConfigManager = require('../src/config/index');
                // V9.0.9 修正：強制檢查初始化標記
                // 只有在 SYSTEM_CONFIGURED 為 'true' 時才允許通行
                const isConfigured = process.env.SYSTEM_CONFIGURED === 'true';

                if (!isConfigured) {
                    console.log(`🚩 [WebServer] System NOT initialized. Redirecting ${req.path} to /dashboard/system-setup`);
                    return res.redirect('/dashboard/system-setup');
                }
            } catch (e) {
                console.error('Failed to check config during redirect:', e.message);
            }
            next();
        });

        dashboardRoutes.forEach(route => {
            this.app.get(route, (req, res) => {
                const fileName = route === '/dashboard' ? 'dashboard.html' : `${route.replace(/^\//, '')}.html`;
                const fullPath = path.join(publicPath, fileName);
                if (fs.existsSync(fullPath)) {
                    res.sendFile(fullPath);
                } else {
                    res.sendFile(path.join(publicPath, 'dashboard.html'));
                }
            });
        });

        // Catch-all fallback for any other /dashboard/* routes
        this.app.get(/\/dashboard\/.*/, (req, res) => {
            const normalizedPath = req.path.replace(/\/$/, "");
            const htmlFileName = `${normalizedPath.replace(/^\//, '')}.html`;
            const fullPath = path.join(publicPath, htmlFileName);

            if (fs.existsSync(fullPath)) {
                res.sendFile(fullPath);
            } else {
                // If the exact html file isn't found, try to resolve as a generic SPA fallback
                res.sendFile(path.join(publicPath, 'dashboard.html'));
            }
        });


        // --- API Routes ---

        // Chat API (Direct Web Chat)
        this.app.post('/api/chat', async (req, res) => {
            try {
                const { golemId, message } = req.body;
                if (!golemId || !message) {
                    return res.status(400).json({ error: 'Missing golemId or message' });
                }

                if (typeof global.handleDashboardMessage !== 'function') {
                    return res.status(503).json({ error: 'Dashboard message handler not ready' });
                }

                // 建立 UniversalContext 替代品
                const mockContext = {
                    platform: 'web',
                    isAdmin: true,
                    text: message,
                    messageTime: Date.now(),
                    senderName: 'User',
                    replyToName: '',
                    chatId: 'web-dashboard',
                    reply: async (text, options) => {
                        let payloadType = 'agent';
                        let actionData = null;

                        if (options && options.reply_markup && options.reply_markup.inline_keyboard) {
                            payloadType = 'approval';
                            actionData = options.reply_markup.inline_keyboard[0];
                        }

                        this.broadcastLog({
                            time: new Date().toLocaleTimeString(),
                            msg: `[${golemId}] ${text}`,
                            type: payloadType,
                            raw: text,
                            actionData,
                            golemId
                        });
                    },
                    sendTyping: async () => { },
                    getAttachment: async () => null,
                    instance: { username: golemId }
                };

                // 回顯使用者的訊息到 Dashboard Log
                this.broadcastLog({
                    time: new Date().toLocaleTimeString(),
                    msg: `[User] ${message}`,
                    type: 'agent',
                    raw: `[User] ${message}`,
                    golemId
                });

                // ── [v9.1.10] 立即發送「思考中」信號 ──
                this.broadcastLog({
                    time: new Date().toLocaleTimeString(),
                    msg: `[${golemId}] ...`,
                    type: 'thinking',
                    raw: '...',
                    golemId
                });

                // 將訊息推進 Golem
                global.handleDashboardMessage(mockContext, golemId).catch(exp => {
                    console.error('[WebServer] Direct chat error:', exp);
                });

                return res.json({ success: true });
            } catch (e) {
                console.error('Failed to send chat message:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // Chat Action Callback API (Inline Button Click)
        this.app.post('/api/chat/callback', async (req, res) => {
            try {
                const { golemId, callback_data } = req.body;
                if (!golemId || !callback_data) {
                    return res.status(400).json({ error: 'Missing golemId or callback_data' });
                }

                const index = require('../index.js');

                if (typeof global.handleDashboardMessage !== 'function') {
                    return res.status(503).json({ error: 'Dashboard message handler not ready' });
                }

                const mockContext = {
                    platform: 'web',
                    isAdmin: true,
                    data: callback_data,
                    messageTime: Date.now(),
                    senderName: 'User',
                    replyToName: '',
                    chatId: 'web-dashboard',
                    reply: async (text) => {
                        this.broadcastLog({
                            time: new Date().toLocaleTimeString(),
                            msg: `[${golemId}] ${text}`,
                            type: 'agent',
                            raw: text
                        });
                    },
                    answerCallbackQuery: async () => { },
                    sendTyping: async () => { },
                    instance: { username: golemId }
                };

                // ── [v9.1.8] 翻譯指令代碼為人類語言 ──
                let translatedMsg = callback_data;
                let displayType = 'agent';

                if (callback_data.includes('_')) {
                    const [action, taskId] = callback_data.split('_');
                    const isApprove = action === 'APPROVE';
                    const isDeny = action === 'DENY';

                    if (isApprove || isDeny) {
                        translatedMsg = isApprove ? '✅ 批准執行' : '❌ 拒絕執行';
                        displayType = 'agent'; // 雖然是 User 發起，但目前前端統一走 agent 頻道

                        // 嘗試抓取具體指令內容增加上下文
                        try {
                            const instance = index.getOrCreateGolem ? index.getOrCreateGolem(golemId) : null;
                            if (instance && instance.controller && instance.controller.pendingTasks) {
                                const task = instance.controller.pendingTasks.get(taskId);
                                if (task && task.steps && task.steps[task.nextIndex]) {
                                    const step = task.steps[task.nextIndex];
                                    const cmd = step.cmd || step.parameter || step.command || "";
                                    if (cmd) {
                                        translatedMsg += `: \`${cmd.length > 50 ? cmd.substring(0, 47) + '...' : cmd}\``;
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn('[WebServer] 無法取得任務上下文:', err.message);
                        }
                    }
                }

                // ── [v9.1.11] 調整順序：優先顯示使用者動作，再執行後端邏輯 ──

                // 1. 回顯操作給前端 (改用 [WebUser] 前綴，讓前端正確歸類為使用者消息)
                this.broadcastLog({
                    time: new Date().toLocaleTimeString(),
                    msg: `[WebUser] ${translatedMsg}`,
                    type: displayType,
                    raw: `[User] ${translatedMsg}`,
                    golemId
                });

                // 2. 立即發送「思考中」信號
                this.broadcastLog({
                    time: new Date().toLocaleTimeString(),
                    msg: `[${golemId}] ...`,
                    type: 'thinking',
                    raw: '...',
                    golemId
                });

                // 3. 微小延遲確保前端 Socket 順序，接著才觸發後端執行 (避免 Golem 回覆超車)
                setTimeout(() => {
                    if (typeof index.handleUnifiedCallback === 'function') {
                        index.handleUnifiedCallback(mockContext, callback_data, golemId).catch(console.error);
                    } else if (global.handleUnifiedCallback) {
                        global.handleUnifiedCallback(mockContext, callback_data, golemId).catch(console.error);
                    } else {
                        console.error('[WebServer] handleUnifiedCallback not found in index.js exports or global');
                    }
                }, 100);

                return res.json({ success: true });
            } catch (e) {
                console.error('Failed to send callback query:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // Chat History API
        this.app.get('/api/chat/history', (req, res) => {
            try {
                const { golemId } = req.query;
                if (!golemId) return res.status(400).json({ error: 'golemId required' });

                const history = this.chatHistory ? (this.chatHistory.get(golemId) || []) : [];
                return res.json({ success: true, history });
            } catch (e) {
                console.error('Failed to fetch chat history:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // --- Metrics API ---
        this.app.get('/api/stats', (req, res) => {
            try {
                if (global._metricsCollector) {
                    res.json(global._metricsCollector.getSnapshot());
                } else {
                    const mem = process.memoryUsage();
                    res.json({
                        rss_mb: Math.round(mem.rss / 1024 / 1024),
                        heap_mb: Math.round(mem.heapUsed / 1024 / 1024),
                        uptime_sec: Math.floor(process.uptime()),
                        queue_depth: 0,
                        tasks_completed: 0,
                        tasks_failed: 0,
                        errors_1h: 0,
                        skills_loaded: 0,
                        memory_working: 0,
                        memory_episodic: 0,
                        circuit_breakers_open: 0,
                        rag_confidence_avg: 0,
                        cpu_pct: 0,
                    });
                }
            } catch (e) { res.status(500).json({ error: e.message }); }
        });

        this.app.get('/api/stats/history', (req, res) => {
            try {
                const minutes = parseInt(req.query.minutes) || 60;
                if (global._metricsCollector) {
                    res.json(global._metricsCollector.getHistory(minutes));
                } else {
                    res.json([]);
                }
            } catch (e) { res.status(500).json({ error: e.message }); }
        });

        this.app.get('/api/agents', (req, res) => {
            try {
                const index = require('../index.js');
                const agents = [];
                if (index.activeGolems) {
                    for (const [id, instance] of index.activeGolems.entries()) {
                        const agent = {
                            id,
                            status: instance.brain?.status || 'unknown',
                            brainEngine: instance.brain?.engineType || process.env.GOLEM_BRAIN_ENGINE || 'unknown',
                            lastActivity: instance.brain?._lastActivity || null,
                            tasks: {
                                pending: instance.controller?.pendingTasks?.size || 0,
                            },
                        };
                        if (instance.threeLayerMemory) {
                            try {
                                agent.memory = instance.threeLayerMemory.getStats();
                            } catch (e) { agent.memory = null; }
                        }
                        agents.push(agent);
                    }
                }
                res.json(agents);
            } catch (e) { res.json([]); }
        });

        this.app.get('/api/models', (req, res) => {
            try {
                res.json({
                    current: process.env.GOLEM_BRAIN_ENGINE || 'puppeteer',
                    available: ['puppeteer', 'sdk', 'monica-web', 'openai-compat', 'ollama'],
                });
            } catch (e) { res.status(500).json({ error: e.message }); }
        });

        this.app.get('/api/memory/layers', (req, res) => {
            try {
                const index = require('../index.js');
                const result = {};
                if (index.activeGolems) {
                    for (const [id, instance] of index.activeGolems.entries()) {
                        if (instance.threeLayerMemory) {
                            result[id] = instance.threeLayerMemory.getStats();
                        }
                    }
                }
                res.json(result);
            } catch (e) { res.status(500).json({ error: e.message }); }
        });

        this.app.get('/api/rag/stats', (req, res) => {
            try {
                const magma = require('../src/memory/graph/ma_gma');
                const stats = magma.stats();
                res.json({
                    local: stats,
                    confidence: global._metricsCollector?.getSnapshot()?.rag_confidence_avg || 0,
                });
            } catch (e) { res.status(500).json({ error: e.message }); }
        });

        this.app.get('/api/logs', (req, res) => {
            try {
                const limit = parseInt(req.query.limit) || 50;
                res.json(this.logBuffer.slice(-limit));
            } catch (e) { res.status(500).json({ error: e.message }); }
        });

        // Config API (Settings Page)
        this.app.get('/api/config', (req, res) => {
            try {
                const EnvManager = require('../src/utils/EnvManager');
                const envData = EnvManager.readEnv();
                const golemsData = EnvManager.readGolemsJson();

                // We return all properties so the frontend can display them.
                return res.json({ env: envData, golems: golemsData });
            } catch (e) {
                console.error("Failed to read config:", e);
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.post('/api/config', (req, res) => {
            try {
                const { env: envPayload, golems: golemsPayload } = req.body;

                if (!envPayload || typeof envPayload !== 'object') {
                    return res.status(400).json({ error: "Invalid env payload" });
                }

                const EnvManager = require('../src/utils/EnvManager');
                const ConfigManager = require('../src/config/index');

                // 1. 寫入 .env 檔案 與 golems.json
                const envUpdated = EnvManager.updateEnv(envPayload);
                let golemsUpdated = false;

                if (golemsPayload && Array.isArray(golemsPayload)) {
                    golemsUpdated = EnvManager.updateGolemsJson(golemsPayload);
                }

                if (envUpdated || golemsUpdated) {
                    console.log(`📝 [System] Saved new config. env updated: ${envUpdated}, golems updated: ${golemsUpdated}`);

                    return res.json({ success: true, message: "Settings saved successfully. A system restart is required for changes to take effect." });
                }

                return res.json({ success: false, message: "No changes detected" });
            } catch (e) {
                console.error("Failed to update config:", e);
                return res.status(500).json({ error: e.message });
            }
        });


        this.app.get('/api/skills/marketplace', (req, res) => {
            try {
                const marketplaceDir = path.join(process.cwd(), 'data', 'marketplace');
                let allSkills = [];

                const { search, category, page = 1, limit = 20 } = req.query;

                if (category && category !== 'all') {
                    const catFile = path.join(marketplaceDir, `${category}.json`);
                    if (fs.existsSync(catFile)) {
                        allSkills = JSON.parse(fs.readFileSync(catFile, 'utf8'));
                    }
                } else {
                    if (fs.existsSync(marketplaceDir)) {
                        const files = fs.readdirSync(marketplaceDir).filter(f => f.endsWith('.json'));
                        for (const file of files) {
                            const data = JSON.parse(fs.readFileSync(path.join(marketplaceDir, file), 'utf8'));
                            allSkills = allSkills.concat(data);
                        }
                    }
                }

                if (category && category !== 'all') {
                    allSkills = allSkills.filter(s => s.category === category);
                }
                if (search) {
                    const term = search.toLowerCase();
                    allSkills = allSkills.filter(s => s.title.toLowerCase().includes(term) || s.description.toLowerCase().includes(term));
                }

                const total = allSkills.length;
                const startIndex = (Number(page) - 1) * Number(limit);
                const endIndex = startIndex + Number(limit);
                const skills = allSkills.slice(startIndex, endIndex);

                return res.json({ skills, total });
            } catch (e) {
                console.error("Failed to read marketplace skills:", e);
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.post('/api/skills/marketplace/install', async (req, res) => {
            try {
                const { id, repoUrl } = req.body;
                if (!id || !repoUrl) return res.status(400).json({ error: 'Missing id or repoUrl' });

                let rawUrl = repoUrl
                    .replace('github.com', 'raw.githubusercontent.com')
                    .replace('/tree/', '/');

                if (!rawUrl.toLowerCase().endsWith('.md')) {
                    if (rawUrl.endsWith('/')) rawUrl += 'SKILL.md';
                    else rawUrl += '/SKILL.md';
                }

                const https = require('https');

                async function fetchWithFallback(url, id) {
                    const tryUrls = [
                        url, // Original
                        url.replace(/\/SKILL\.md$/i, `/${id}/SKILL.md`), // Subdir + SKILL.md
                        url.replace(/\/SKILL\.md$/i, `/${id}/skill.md`), // Subdir + skill.md
                        url.endsWith('SKILL.md') ? url.replace('SKILL.md', 'skill.md') : url + '/skill.md' // Root skill.md
                    ];

                    // Remove duplicates
                    const uniqueUrls = [...new Set(tryUrls)];

                    for (const targetUrl of uniqueUrls) {
                        try {
                            const data = await new Promise((resolve, reject) => {
                                const options = {
                                    headers: { 'User-Agent': 'Golem-Dashboard-Installer' }
                                };
                                https.get(targetUrl, options, (response) => {
                                    if (response.statusCode === 200) {
                                        let body = '';
                                        response.on('data', chunk => body += chunk);
                                        response.on('end', () => resolve(body));
                                    } else {
                                        resolve(null);
                                    }
                                }).on('error', (e) => resolve(null));
                            });
                            if (data) return data;
                        } catch (e) {
                            continue;
                        }
                    }
                    return null;
                }

                const content = await fetchWithFallback(rawUrl, id);
                if (!content) {
                    return res.status(404).json({ error: 'Skill markdown not found even after trying subdirectories' });
                }

                const safeId = id.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
                const libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
                const filePath = path.join(libPath, `${safeId}.md`);

                let title = safeId;
                // Remove BOM if present, then trim
                let parsedContent = content.toString().replace(/^\uFEFF/, '').trim();

                // Parse YAML frontmatter if present (allowing for any stray spaces before ---)
                const fmMatch = parsedContent.match(/^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
                if (fmMatch) {
                    const yaml = fmMatch[1];
                    const nameMatch = yaml.match(/^name:\s*(.+)$/m);
                    if (nameMatch) {
                        title = nameMatch[1].replace(/^["']|["']$/g, '').trim();
                    }
                    parsedContent = fmMatch[2].trim();
                } else {
                    // Fallback to first heading
                    const hMatch = parsedContent.match(/^#+\s+(.+)$/m);
                    if (hMatch) title = hMatch[1].trim();
                }

                // Wrap with Golem standard tag
                const finalContent = `【已載入技能：${title}】\n\n${parsedContent}`;

                fs.writeFileSync(filePath, finalContent, 'utf8');
                console.log(`✨ [WebServer] Marketplace skill installed: ${safeId}.md`);

                const SkillIndexManager = require('../src/managers/SkillIndexManager');
                const { GOLEMS_CONFIG, MEMORY_BASE_DIR, GOLEM_MODE } = require('../src/config');
                const targetDirs = GOLEM_MODE === 'SINGLE'
                    ? [MEMORY_BASE_DIR]
                    : GOLEMS_CONFIG.map(g => path.join(MEMORY_BASE_DIR, g.id));

                for (const dir of targetDirs) {
                    const idx = new SkillIndexManager(dir);
                    idx.addSkill(safeId).catch(e => console.error(`[SkillIndex][${path.basename(dir)}] MarketplaceInstall-Add Error for ${safeId}:`, e.message));
                }

                return res.json({ success: true, id: safeId });
            } catch (e) {
                console.error('Failed to install marketplace skill:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.get('/api/skills', async (req, res) => {
            try {
                const libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
                if (!fs.existsSync(libPath)) return res.json([]);

                const files = fs.readdirSync(libPath).filter(f => f.endsWith('.md'));

                // Use shared skillsConfig: mandatory always on, optional via env
                const enabledSkills = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', []);

                const skillsData = files.map(file => {
                    const content = fs.readFileSync(path.join(libPath, file), 'utf8');
                    const baseName = file.replace('.md', '').toLowerCase();
                    const isOptional = !MANDATORY_SKILLS.includes(baseName);
                    const isEnabled = enabledSkills.has(baseName);

                    // Extract first line or generic title
                    const firstLineMatch = content.match(/^#+ (.*)|^【(.*)】/m) || content.match(/^([^\n]+)/);
                    let title = baseName;
                    if (firstLineMatch) {
                        title = firstLineMatch[1] || firstLineMatch[2] || firstLineMatch[0];
                        title = title.replace(/^#+\s*|【|】/g, '').trim();
                    }

                    return {
                        id: baseName,
                        title: title || baseName,
                        isOptional,
                        isEnabled,
                        content: content
                    };
                });

                // Sort: Enabled first, then by name
                skillsData.sort((a, b) => {
                    if (a.isEnabled && !b.isEnabled) return -1;
                    if (!a.isEnabled && b.isEnabled) return 1;
                    return a.id.localeCompare(b.id);
                });

                return res.json(skillsData);
            } catch (e) {
                console.error("Failed to read skills:", e);
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.post('/api/skills/toggle', (req, res) => {
            try {
                const { id, enabled } = req.body;
                if (!id) return res.status(400).json({ error: "Missing skill ID" });

                // Verify skill is optional and exists in lib/
                const libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
                if (!fs.existsSync(path.join(libPath, `${id}.md`))) {
                    return res.status(400).json({ error: `Skill "${id}" not found in lib/` });
                }
                if (MANDATORY_SKILLS.includes(id)) {
                    return res.status(400).json({ error: `"${id}" is a mandatory skill and cannot be toggled` });
                }

                // 1. Update in-memory
                let currentStr = process.env.OPTIONAL_SKILLS || '';
                let currentSkills = currentStr.split(',').map(s => s.trim().toLowerCase()).filter(s => s !== '');

                if (enabled && !currentSkills.includes(id)) {
                    currentSkills.push(id);
                } else if (!enabled && currentSkills.includes(id)) {
                    currentSkills = currentSkills.filter(s => s !== id);
                }

                const newSkillsStr = currentSkills.join(',');
                process.env.OPTIONAL_SKILLS = newSkillsStr;

                // 2. Persist to .env
                const envPath = path.resolve(process.cwd(), '.env'); // Fixed: directly in root if started from root
                if (fs.existsSync(envPath)) {
                    let envContent = fs.readFileSync(envPath, 'utf8');

                    // Regex to find OPTIONAL_SKILLS=... and replace it
                    const regex = /^OPTIONAL_SKILLS=.*$/m;
                    if (regex.test(envContent)) {
                        envContent = envContent.replace(regex, `OPTIONAL_SKILLS=${newSkillsStr}`);
                    } else {
                        envContent += `\nOPTIONAL_SKILLS=${newSkillsStr}\n`;
                    }
                    fs.writeFileSync(envPath, envContent, 'utf8');
                    console.log(`📝 [System] Saved new skill config to .env: ${newSkillsStr}`);
                }

                // 3. Clear Cache (Hot Reload)
                const ProtocolFormatter = require('../src/services/ProtocolFormatter');
                ProtocolFormatter._lastScanTime = 0;

                // 4. Update SQLite Index
                const SkillIndexManager = require('../src/managers/SkillIndexManager');
                const { GOLEMS_CONFIG, MEMORY_BASE_DIR, GOLEM_MODE } = require('../src/config');
                const targetDirs = GOLEM_MODE === 'SINGLE'
                    ? [MEMORY_BASE_DIR]
                    : GOLEMS_CONFIG.map(g => path.join(MEMORY_BASE_DIR, g.id));

                for (const dir of targetDirs) {
                    const idx = new SkillIndexManager(dir);
                    if (enabled) {
                        idx.addSkill(id).catch(e => console.error(`[SkillIndex][${path.basename(dir)}] Toggle-Add Error for ${id}:`, e.message));
                    } else {
                        idx.removeSkill(id).catch(e => console.error(`[SkillIndex][${path.basename(dir)}] Toggle-Remove Error for ${id}:`, e.message));
                    }
                }

                return res.json({ success: true, enabled, skillsStr: newSkillsStr });
            } catch (e) {
                console.error("Failed to toggle skill:", e);
                return res.status(500).json({ error: e.message });
            }
        });

        // ➕ 新增技能 API
        this.app.post('/api/skills/create', (req, res) => {
            try {
                const { id, content } = req.body;
                if (!id || !content) return res.status(400).json({ error: 'Missing id or content' });

                const safeId = id.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
                if (MANDATORY_SKILLS.includes(safeId)) {
                    return res.status(400).json({ error: `Cannot overwrite mandatory skill '${safeId}'` });
                }

                const libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
                const filePath = path.join(libPath, `${safeId}.md`);

                if (fs.existsSync(filePath)) {
                    return res.status(409).json({ error: `Skill '${safeId}' already exists` });
                }

                fs.writeFileSync(filePath, content, 'utf8');
                console.log(`✨ [WebServer] Custom skill created: ${safeId}.md`);

                // 2. Index to SQLite if it would be enabled (mandatory or in OPTIONAL_SKILLS)
                const { MANDATORY_SKILLS, resolveEnabledSkills } = require('../src/skills/skillsConfig');
                const enabledSkills = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', []);
                if (MANDATORY_SKILLS.includes(safeId) || enabledSkills.has(safeId)) {
                    const SkillIndexManager = require('../src/managers/SkillIndexManager');
                    const { GOLEMS_CONFIG, MEMORY_BASE_DIR, GOLEM_MODE } = require('../src/config');
                    const targetDirs = GOLEM_MODE === 'SINGLE'
                        ? [MEMORY_BASE_DIR]
                        : GOLEMS_CONFIG.map(g => path.join(MEMORY_BASE_DIR, g.id));

                    for (const dir of targetDirs) {
                        const idx = new SkillIndexManager(dir);
                        idx.addSkill(safeId).catch(e => console.error(`[SkillIndex][${path.basename(dir)}] Create-Add Error for ${safeId}:`, e.message));
                    }
                }

                return res.json({ success: true, id: safeId });
            } catch (e) {
                console.error('Failed to create skill:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // ✏️ 更新技能 API
        this.app.post('/api/skills/update', (req, res) => {
            try {
                const { id, content } = req.body;
                if (!id || !content) return res.status(400).json({ error: 'Missing id or content' });

                const safeId = id.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
                if (MANDATORY_SKILLS.includes(safeId)) {
                    return res.status(403).json({ error: `Cannot edit mandatory skill '${safeId}'` });
                }

                const libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
                const filePath = path.join(libPath, `${safeId}.md`);

                if (!fs.existsSync(filePath)) {
                    return res.status(404).json({ error: `Skill '${safeId}' not found` });
                }

                fs.writeFileSync(filePath, content, 'utf8');
                console.log(`📝 [WebServer] Custom skill updated: ${safeId}.md`);

                // 2. Update SQLite Index if active
                const { MANDATORY_SKILLS, resolveEnabledSkills } = require('../src/skills/skillsConfig');
                const enabledSkills = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', []);
                if (MANDATORY_SKILLS.includes(safeId) || enabledSkills.has(safeId)) {
                    const SkillIndexManager = require('../src/managers/SkillIndexManager');
                    const { GOLEMS_CONFIG, MEMORY_BASE_DIR, GOLEM_MODE } = require('../src/config');
                    const targetDirs = GOLEM_MODE === 'SINGLE'
                        ? [MEMORY_BASE_DIR]
                        : GOLEMS_CONFIG.map(g => path.join(MEMORY_BASE_DIR, g.id));

                    for (const dir of targetDirs) {
                        const idx = new SkillIndexManager(dir);
                        idx.addSkill(safeId).catch(e => console.error(`[SkillIndex][${path.basename(dir)}] Update-Add Error for ${safeId}:`, e.message));
                    }
                }

                return res.json({ success: true, id: safeId });
            } catch (e) {
                console.error('Failed to update skill:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // ✨ [v9.0.8] 刪除技能 API
        this.app.post('/api/skills/delete', (req, res) => {
            try {
                const { id } = req.body;
                if (!id) return res.status(400).json({ error: 'Missing skill ID' });

                const safeId = id.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
                if (MANDATORY_SKILLS.includes(safeId)) {
                    return res.status(403).json({ error: `Cannot delete mandatory skill '${safeId}'` });
                }

                const libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
                const filePath = path.join(libPath, `${safeId}.md`);

                if (!fs.existsSync(filePath)) {
                    return res.status(404).json({ error: `Skill '${safeId}' not found` });
                }

                fs.unlinkSync(filePath);
                console.log(`🗑️ [WebServer] Skill deleted: ${safeId}.md`);

                // Remove from OPTIONAL_SKILLS env
                let currentStr = process.env.OPTIONAL_SKILLS || '';
                let currentSkills = currentStr.split(',').map(s => s.trim().toLowerCase()).filter(s => s !== '' && s !== safeId);
                process.env.OPTIONAL_SKILLS = currentSkills.join(',');

                // Remove from SQLite index
                const SkillIndexManager = require('../src/managers/SkillIndexManager');
                const { GOLEMS_CONFIG, MEMORY_BASE_DIR, GOLEM_MODE } = require('../src/config');
                const targetDirs = GOLEM_MODE === 'SINGLE'
                    ? [MEMORY_BASE_DIR]
                    : GOLEMS_CONFIG.map(g => path.join(MEMORY_BASE_DIR, g.id));
                for (const dir of targetDirs) {
                    const idx = new SkillIndexManager(dir);
                    idx.removeSkill(safeId).catch(e => console.error(`[SkillIndex] Delete Error for ${safeId}:`, e.message));
                }

                // Clear cache
                const ProtocolFormatter = require('../src/services/ProtocolFormatter');
                ProtocolFormatter._lastScanTime = 0;

                return res.json({ success: true, id: safeId });
            } catch (e) {
                console.error('Failed to delete skill:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // ✨ [v9.0.8] 刪除 Persona API
        this.app.post('/api/persona/delete', (req, res) => {
            try {
                const { golemId } = req.body;
                if (!golemId) return res.status(400).json({ error: 'Missing golemId' });

                const ConfigManager = require('../src/config/index');
                const isSingleMode = ConfigManager.GOLEM_MODE === 'SINGLE';
                const personaPath = isSingleMode
                    ? path.resolve(ConfigManager.MEMORY_BASE_DIR, 'persona.json')
                    : path.resolve(ConfigManager.MEMORY_BASE_DIR, golemId, 'persona.json');

                if (!fs.existsSync(personaPath)) {
                    return res.status(404).json({ error: `Persona for '${golemId}' not found` });
                }

                // Backup before delete
                const backupPath = `${personaPath}.bak-${Date.now()}`;
                fs.copyFileSync(personaPath, backupPath);
                fs.unlinkSync(personaPath);
                console.log(`🗑️ [WebServer] Persona deleted: ${golemId} (backup: ${path.basename(backupPath)})`);

                return res.json({ success: true, golemId, backup: path.basename(backupPath) });
            } catch (e) {
                console.error('Failed to delete persona:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // ✨ [v9.0.8] 系統狀態 API (含 isBooting)
        this.app.get('/api/status', (req, res) => {
            try {
                const index = require('../index.js');
                const golems = {};
                if (index.activeGolems) {
                    for (const [id, instance] of index.activeGolems.entries()) {
                        golems[id] = {
                            status: instance.brain?.status || 'unknown',
                            isBooting: instance.brain?.isBooting ?? true,
                            uptime: Math.floor(process.uptime()),
                        };
                    }
                }
                return res.json({
                    isBooting: Object.values(golems).some(g => g.isBooting),
                    golems,
                    timestamp: new Date().toISOString()
                });
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.post('/api/skills/reload', (req, res) => {
            try {
                console.log("🔄 [WebServer] Hot-reloading skills... Clearing ProtocolFormatter cache.");
                const ProtocolFormatter = require('../src/services/ProtocolFormatter');
                ProtocolFormatter._lastScanTime = 0; // Trigger a fresh scan on next turn
                return res.json({ success: true, message: "Skills cache cleared" });
            } catch (e) {
                console.error("Failed to reload skills cache:", e);
                return res.status(500).json({ error: e.message });
            }
        });

        // 🚀 技能注入：重新組裝技能書並送進 Gemini
        this.app.post('/api/skills/inject', async (req, res) => {
            try {
                // 1. 先清除 ProtocolFormatter 快取，確保讀到最新的技能清單
                const ProtocolFormatter = require('../src/services/ProtocolFormatter');
                ProtocolFormatter._lastScanTime = 0;

                // 2. 對每個運行中的 Golem Brain 呼叫 reloadSkills()
                const results = [];
                for (const [id, context] of this.contexts.entries()) {
                    if (context.brain && typeof context.brain.reloadSkills === 'function') {
                        try {
                            console.log(`⚡ [WebServer] Injecting skills into Golem [${id}]...`);
                            await context.brain.reloadSkills();
                            results.push({ id, status: 'success' });

                            // 📣 TG 通知
                            const tgBot = context.brain.tgBot;
                            if (tgBot) {
                                const { MANDATORY_SKILLS, OPTIONAL_SKILLS: OPT_LIST, resolveEnabledSkills } = require('../src/skills/skillsConfig');
                                const enabledSkills = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', []);
                                const enabledOptional = OPT_LIST.filter(s => enabledSkills.has(s));
                                const disabledOptional = OPT_LIST.filter(s => !enabledSkills.has(s));

                                const mandatoryList = MANDATORY_SKILLS.map(s => `• ${s}`).join('\n');
                                const optionalList = enabledOptional.length > 0 ? enabledOptional.map(s => `• ${s}`).join('\n') : '（無）';
                                const disabledList = disabledOptional.length > 0 ? disabledOptional.map(s => `• ${s}`).join('\n') : '（無）';

                                const msg = `⚡ *[${id}] 技能書已重新注入*\n\n🔒 *必要技能（永久啟用）:*\n${mandatoryList}\n\n✅ *已啟用選用技能:*\n${optionalList}\n\n⛔ *未啟用選用技能:*\n${disabledList}`;

                                const gCfg = tgBot.golemConfig || {};
                                const targetId = gCfg.adminId || gCfg.chatId;
                                if (targetId) {
                                    tgBot.sendMessage(targetId, msg, { parse_mode: 'Markdown' })
                                        .catch(e => console.warn(`⚠️ [WebServer] TG skill notify failed [${id}]:`, e.message));
                                    // 確認通知
                                    tgBot.sendMessage(targetId, `🔄 *[${id}] 技能書注入完成*\n已為您重新開啟全新的 Gemini 對話視窗並注入技能，人格設定與歷史記憶已完整保留，不需重新設定。`, { parse_mode: 'Markdown' })
                                        .catch(e => console.warn(`⚠️ [WebServer] TG inject notify failed [${id}]:`, e.message));
                                }
                            }
                        } catch (e) {
                            console.error(`❌ [WebServer] Failed to inject skills into Golem [${id}]:`, e.message);
                            results.push({ id, status: 'error', error: e.message });
                        }
                    } else {
                        results.push({ id, status: 'skipped', error: 'Brain not ready or reloadSkills not available' });
                    }
                }

                if (results.length === 0) {
                    return res.status(503).json({ success: false, message: "No active Golem instances found" });
                }

                const allSuccess = results.every(r => r.status === 'success');
                return res.json({
                    success: allSuccess,
                    message: allSuccess
                        ? `技能書已成功注入 ${results.length} 個 Golem 實體`
                        : `部分注入失敗`,
                    results
                });
            } catch (e) {
                console.error("Failed to inject skills:", e);
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.get('/api/golems/templates', (req, res) => {
            const personasDir = path.resolve(__dirname, '..', 'personas');
            if (!fs.existsSync(personasDir)) {
                return res.json({ templates: [] });
            }

            try {
                const files = fs.readdirSync(personasDir).filter(f => f.endsWith('.md'));
                const templates = files.map(file => {
                    const content = fs.readFileSync(path.join(personasDir, file), 'utf8');
                    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

                    if (frontmatterMatch) {
                        const yamlStr = frontmatterMatch[1];
                        const body = frontmatterMatch[2].trim();

                        // Simple YAML parser (since we don't have a yaml library here)
                        const metadata = {};
                        yamlStr.split('\n').forEach(line => {
                            const [key, ...valParts] = line.split(':');
                            if (key && valParts.length > 0) {
                                let val = valParts.join(':').trim();
                                if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
                                if (val.startsWith('[') && val.endsWith(']')) {
                                    val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(s => s !== '');
                                }
                                metadata[key.trim()] = val;
                            }
                        });

                        return {
                            id: file.replace('.md', ''),
                            name: metadata.name || file,
                            description: metadata.description || '',
                            icon: metadata.icon || 'BrainCircuit',
                            aiName: metadata.aiName || 'Golem',
                            userName: metadata.userName || 'Traveler',
                            role: body || metadata.role || '',
                            tone: metadata.tone || '',
                            tags: metadata.tags || [],
                            skills: metadata.skills || []
                        };
                    }
                    return null;
                }).filter(t => t !== null);

                return res.json({ templates });
            } catch (e) {
                console.error("Failed to load persona templates:", e);
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.get('/api/persona/market', (req, res) => {
            try {
                const { search, category, page = 1, limit = 20 } = req.query;
                const personasDir = path.resolve(__dirname, '..', 'data', 'marketplace', 'personas');
                
                if (!fs.existsSync(personasDir)) {
                    return res.json({ personas: [], total: 0 });
                }

                let allPersonas = [];
                const files = fs.readdirSync(personasDir).filter(f => f.endsWith('.json'));

                // Optimize: if category is specified, only read that file
                if (category && category !== 'all') {
                    const catFile = path.join(personasDir, `${category}.json`);
                    if (fs.existsSync(catFile)) {
                        allPersonas = JSON.parse(fs.readFileSync(catFile, 'utf8'));
                    }
                } else {
                    // Load all
                    for (const file of files) {
                        const data = fs.readFileSync(path.join(personasDir, file), 'utf8');
                        allPersonas = allPersonas.concat(JSON.parse(data));
                    }
                }

                if (search) {
                    const term = search.toLowerCase();
                    allPersonas = allPersonas.filter(p => 
                        (p.name && p.name.toLowerCase().includes(term)) || 
                        (p.name_zh && p.name_zh.toLowerCase().includes(term)) ||
                        (p.description && p.description.toLowerCase().includes(term)) ||
                        (p.description_zh && p.description_zh.toLowerCase().includes(term)) ||
                        (p.role && p.role.toLowerCase().includes(term)) ||
                        (p.role_zh && p.role_zh.toLowerCase().includes(term))
                    );
                }

                const total = allPersonas.length;
                const startIndex = (Number(page) - 1) * Number(limit);
                const endIndex = startIndex + Number(limit);
                const personas = allPersonas.slice(startIndex, endIndex);

                return res.json({ personas, total });
            } catch (e) {
                console.error("Failed to load market personas:", e);
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.get('/api/golems', (req, res) => {
            try {
                const EnvManager = require('../src/utils/EnvManager');
                const envVars = EnvManager.readEnv();
                const ConfigManager = require('../src/config/index');
                const isSingleNode = ConfigManager.GOLEM_MODE === 'SINGLE';

                // 1. 獲取現有的 golems.json 配置 (僅在非單機模式下)
                const golemsPath = path.resolve(process.cwd(), 'golems.json');
                let allConfigs = [];
                if (!isSingleNode && fs.existsSync(golemsPath)) {
                    allConfigs = JSON.parse(fs.readFileSync(golemsPath, 'utf8'));
                }

                // ✅ [Phase 1.5 Bug #7] Check global.activeGolems first (from index.js), fallback to this.contexts
                let activeGolemsMap = this.contexts;
                try {
                    const index = require('../index.js');
                    if (index.activeGolems && index.activeGolems.size > 0) {
                        activeGolemsMap = index.activeGolems;
                    }
                } catch (e) { /* index.js not ready yet, use this.contexts */ }

                // 2. 獲取當前記憶體中的 contexts
                const activeIds = Array.from(activeGolemsMap.keys());

                // 3. 合併狀態
                let golemsData = allConfigs.map(config => {
                    const id = config.id;
                    const context = activeGolemsMap.get(id) || this.contexts.get(id);
                    let status = 'not_started';

                    if (context && context.brain) {
                        status = context.brain.status || 'running';
                    }

                    return { id, status };
                });

                // 3.5 單機模式特化處理：如果沒在清單中但環境變數有 Token，強制加入 golem_A
                if (isSingleNode) {
                    const hasToken = envVars.TELEGRAM_TOKEN || envVars.DISCORD_TOKEN;
                    if (hasToken && !golemsData.find(g => g.id === 'golem_A')) {
                        const id = 'golem_A';
                        const context = activeGolemsMap.get(id) || this.contexts.get(id);
                        let status = 'not_started';

                        if (context && context.brain) {
                            status = context.brain.status || 'running';
                        } else {
                            // ✅ [Bug #4 修復] server.js 的 CWD 是 web-dashboard/，
                            // 必須使用 __dirname 往上一層找到真正的 golem_memory 目錄
                            const projectRoot = path.resolve(__dirname, '..');
                            const envVarsForPath = EnvManager.readEnv();
                            const userDataDirFromEnv = envVarsForPath.USER_DATA_DIR;
                            const personaPath = userDataDirFromEnv
                                ? path.resolve(userDataDirFromEnv, 'persona.json')
                                : path.resolve(projectRoot, 'golem_memory', 'persona.json');
                            if (!fs.existsSync(personaPath)) {
                                status = 'pending_setup';
                            } else {
                                status = 'running'; // ✅ [Bug #4 修復] 加上 if exists = running
                            }
                        }
                        golemsData.push({ id, status });
                    }
                }

                // 4. 對於不在 golems.json 但在 contexts 中的 (可能是動態建立未存檔的)，也補上去
                // ✅ [Phase 1.5 Bug #7] Merge from both activeGolemsMap and this.contexts
                const mergedContexts = new Map([...this.contexts]);
                activeGolemsMap.forEach((ctx, id) => {
                    if (!mergedContexts.has(id)) mergedContexts.set(id, ctx);
                });
                mergedContexts.forEach((ctx, id) => {
                    if (!golemsData.find(g => g.id === id)) {
                        golemsData.push({ id, status: (ctx.brain && ctx.brain.status) || 'running' });
                    }
                });

                return res.json({ golems: golemsData });
            } catch (e) {
                console.error('[WebServer] Failed to fetch golems list:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // ─── System Status ────────────────────────────────────────────────────────────────────
        this.app.get('/api/system/status', (req, res) => {
            try {
                const liveCount = this.contexts.size;
                let configuredCount = 0;
                const golemsPath = path.resolve(process.cwd(), 'golems.json');
                if (fs.existsSync(golemsPath)) {
                    const content = fs.readFileSync(golemsPath, 'utf8');
                    if (content.trim()) {
                        const stored = JSON.parse(content);
                        if (Array.isArray(stored)) configuredCount = stored.length;
                    }
                }

                const EnvManager = require('../src/utils/EnvManager');
                const envVars = EnvManager.readEnv();

                const isSystemConfigured = envVars.SYSTEM_CONFIGURED === 'true';
                const ConfigManager = require('../src/config/index');
                const isSingleNode = ConfigManager.GOLEM_MODE === 'SINGLE';

                // --- 額外獲取環境資訊 ---
                const os = require('os');
                const { execSync } = require('child_process');

                // Node.js 與平台資訊
                const runtime = {
                    node: process.version,
                    npm: 'N/A',
                    platform: process.platform,
                    arch: process.arch,
                    uptime: Math.floor(process.uptime()),
                    osName: 'Unknown'
                };
                try { runtime.npm = 'v' + execSync('npm -v').toString().trim(); } catch (e) { }

                // 獲取詳細 OS 名稱
                try {
                    if (process.platform === 'darwin') {
                        const name = execSync('sw_vers -productName').toString().trim();
                        const ver = execSync('sw_vers -productVersion').toString().trim();
                        runtime.osName = `${name} ${ver}`;
                    } else if (process.platform === 'linux') {
                        // 嘗試讀取 os-release
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

                // 健康檢查
                const DOT_ENV_PATH = path.join(process.cwd(), '.env');
                const health = {
                    node: process.version.startsWith('v20') || process.version.startsWith('v22') || process.version.startsWith('v21') || process.version.startsWith('v23') || process.version.startsWith('v25'),
                    env: fs.existsSync(DOT_ENV_PATH),
                    keys: !!(envVars.GEMINI_API_KEYS && envVars.GEMINI_API_KEYS !== '你的Key1,你的Key2,你的Key3'),
                    deps: fs.existsSync(path.join(process.cwd(), 'node_modules')),
                    core: ['index.js', 'package.json', 'dashboard.js'].every(f => fs.existsSync(path.join(process.cwd(), f))),
                    dashboard: fs.existsSync(path.join(process.cwd(), 'web-dashboard/node_modules')) || fs.existsSync(path.join(process.cwd(), 'web-dashboard/.next'))
                };

                // 系統資源
                let diskUsage = 'N/A';
                try {
                    if (process.platform === 'darwin' || process.platform === 'linux') {
                        const df = execSync(`df -h . | awk 'NR==2{print $4}'`).toString().trim();
                        diskUsage = df;
                    }
                } catch (e) { }

                const system = {
                    totalMem: Math.floor(os.totalmem() / 1024 / 1024) + ' MB',
                    freeMem: Math.floor(os.freemem() / 1024 / 1024) + ' MB',
                    diskAvail: diskUsage
                };

                return res.json({
                    hasGolems: liveCount > 0 || configuredCount > 0,
                    liveCount,
                    configuredCount,
                    isSystemConfigured,
                    isSingleNode,
                    runtime,
                    health,
                    system
                });
            } catch (e) {
                console.error('[WebServer] Failed to get system status:', e);
                return res.status(500).json({ error: e.message });
            }
        });


        // ─── System Config ───────────────────────────────────────────────────────────────────
        this.app.get('/api/system/config', (req, res) => {
            try {
                const EnvManager = require('../src/utils/EnvManager');
                const envVars = EnvManager.readEnv();
                return res.json({
                    userDataDir: envVars.USER_DATA_DIR || './golem_memory',
                    golemMemoryMode: envVars.GOLEM_MEMORY_MODE || 'browser',
                    golemMode: envVars.GOLEM_MODE || 'MULTI'
                });
            } catch (e) {
                console.error('[WebServer] Failed to get system config:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.post('/api/system/config', (req, res) => {
            try {
                const { geminiApiKeys, userDataDir, golemMemoryMode, golemMode } = req.body;
                const EnvManager = require('../src/utils/EnvManager');
                const ConfigManager = require('../src/config/index');

                const updates = {};
                // Allow empty string to clear keys
                if (geminiApiKeys !== undefined) updates.GEMINI_API_KEYS = geminiApiKeys;
                if (userDataDir) updates.USER_DATA_DIR = userDataDir;
                if (golemMemoryMode) updates.GOLEM_MEMORY_MODE = golemMemoryMode;
                if (golemMode) updates.GOLEM_MODE = golemMode;

                if (Object.keys(updates).length > 0) {
                    // 標記系統已完成初始化
                    updates.SYSTEM_CONFIGURED = 'true';

                    EnvManager.updateEnv(updates);
                    console.log('📝 [System] System configuration updated via web dashboard. Flag: SYSTEM_CONFIGURED=true');

                    // 觸發熱重載
                    ConfigManager.reloadConfig();

                    return res.json({ success: true, message: 'Configuration saved and reloaded.' });
                }
                return res.json({ success: false, message: 'No updates provided.' });
            } catch (e) {
                console.error('[WebServer] Failed to update system config:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // ─── Create New Golem ────────────────────────────────────────────
        // ─── System Update ───────────────────────────────────────────────
        this.app.get('/api/system/log-info', (req, res) => {
            try {
                const logPath = path.resolve(process.cwd(), 'logs', 'system.log');
                if (fs.existsSync(logPath)) {
                    const stats = fs.statSync(logPath);
                    const bytes = stats.size;
                    let displaySize = bytes + ' B';
                    if (bytes > 1024 * 1024) {
                        displaySize = (bytes / (1024 * 1024)).toFixed(2) + ' MB';
                    } else if (bytes > 1024) {
                        displaySize = (bytes / 1024).toFixed(2) + ' KB';
                    }
                    return res.json({ success: true, size: displaySize, bytes });
                }
                return res.json({ success: true, size: '0 B', bytes: 0 });
            } catch (e) {
                console.error('[WebServer] Failed to get log info:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.get('/api/system/update/check', async (req, res) => {
            try {
                const SystemUpdater = require('../src/utils/SystemUpdater');
                const info = await SystemUpdater.checkEnvironment();
                return res.json(info);
            } catch (e) {
                console.error('[WebServer] Update check failed:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.post('/api/system/update/execute', async (req, res) => {
            try {
                const { keepOldData = true, keepMemory = true } = req.body;
                const SystemUpdater = require('../src/utils/SystemUpdater');

                // Do not await, let it run in the background. SystemUpdater will broadcast via socket.io
                SystemUpdater.update({ keepOldData, keepMemory }, this.io).catch(err => {
                    console.error('[WebServer] Background update failed:', err);
                });

                return res.json({ success: true, message: "Update process started" });
            } catch (e) {
                console.error('[WebServer] Update execution failed:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.post('/api/system/restart', (req, res) => {
            try {
                console.log("🔄 [System] Restart requested by user. Terminating process...");
                res.json({ success: true, message: "Restarting system..." });
                setTimeout(() => {
                    safeExit(0);
                }, 1000);
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }
        });

        // ─── Create New Golem ────────────────────────────────────────────
        this.app.post('/api/golems/create', async (req, res) => {
            try {
                const {
                    id, role,
                    tgToken, tgAuthMode, tgAdminId, tgChatId,
                    dcToken, dcAuthMode, dcAdminId, dcChatId
                } = req.body;

                if (!id) {
                    return res.status(400).json({ error: 'Missing required fields: id' });
                }

                // Validate ID format
                if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
                    return res.status(400).json({ error: 'Invalid Golem ID: only alphanumeric, _ and - allowed' });
                }

                // --- Mode-aware Logic ---
                const EnvManager = require('../src/utils/EnvManager');
                const ConfigManager = require('../src/config/index');
                const isSingleNode = ConfigManager.GOLEM_MODE === 'SINGLE';

                if (isSingleNode) {
                    console.log('📝 [API] System in SINGLE mode. Writing Golem config to .env');
                    const updates = {};
                    if (tgToken) {
                        updates.TELEGRAM_TOKEN = tgToken;
                        updates.TG_AUTH_MODE = tgAuthMode || 'ADMIN';
                        if (tgAuthMode === 'CHAT' && tgChatId) updates.TG_CHAT_ID = tgChatId;
                        if ((!tgAuthMode || tgAuthMode === 'ADMIN') && tgAdminId) updates.ADMIN_ID = tgAdminId;
                    }
                    if (dcToken) {
                        updates.DISCORD_TOKEN = dcToken;
                        updates.DISCORD_ADMIN_ID = dcAdminId;
                    }

                    EnvManager.updateEnv(updates);
                    console.log(`✅ [WebServer] Single Mode config updated in .env. Triggering reload...`);

                    // 關鍵修正：寫入 .env 後必須熱重載，否則後續 Setup API 會找不到設定
                    const ConfigManager = require('../src/config/index');
                    ConfigManager.reloadConfig();

                    // ✅ [Bug #2 修復] Single Mode 也需呼叫 golemFactory 以建立帶有 tgBot 的實體
                    // 讓後續 Setup API 能找到 context 並正確啟動 polling
                    if (typeof this.golemFactory === 'function') {
                        const { CONFIG: freshConfig, GOLEMS_CONFIG: freshGolemsConfig } = require('../src/config/index');
                        const singleGolemConfig = freshGolemsConfig.find(g => g.id === 'golem_A') || {
                            id: 'golem_A',
                            tgToken: tgToken,
                            tgAuthMode: tgAuthMode || 'ADMIN',
                            adminId: tgAdminId,
                            chatId: tgChatId,
                            dcToken: dcToken,
                            dcAdminId: dcAdminId,
                        };
                        try {
                            await this.golemFactory(singleGolemConfig);
                            console.log(`✅ [WebServer] Single Mode golem_A instance created via factory.`);
                        } catch (factoryErr) {
                            console.error(`❌ [WebServer] Single Mode golem_A factory failed:`, factoryErr.message);
                        }
                    }

                    return res.json({ success: true, mode: 'SINGLE', id: 'golem_A', message: 'Single Mode configuration updated successfully.' });
                }

                // --- Multi Mode (Default) ---
                const golemsPath = path.resolve(process.cwd(), 'golems.json');
                let existingGolems = [];
                if (fs.existsSync(golemsPath)) {
                    existingGolems = JSON.parse(fs.readFileSync(golemsPath, 'utf8'));
                    if (!Array.isArray(existingGolems)) existingGolems = [];
                }

                if (existingGolems.find(g => g.id === id)) {
                    return res.status(409).json({ error: `Golem ID '${id}' already exists` });
                }

                // Build new golem config entry
                const newGolemConfig = { id, role: role || '' };

                // Telegram
                if (tgToken) {
                    newGolemConfig.tgToken = tgToken;
                    if (tgAuthMode) newGolemConfig.tgAuthMode = tgAuthMode;
                    if (tgAuthMode === 'CHAT' && tgChatId) newGolemConfig.chatId = tgChatId;
                    if ((!tgAuthMode || tgAuthMode === 'ADMIN') && tgAdminId) newGolemConfig.adminId = tgAdminId;
                }

                // Discord
                if (dcToken) {
                    newGolemConfig.dcToken = dcToken;
                    if (dcAuthMode) newGolemConfig.dcAuthMode = dcAuthMode;
                    if (dcAuthMode === 'CHAT' && dcChatId) newGolemConfig.dcChatId = dcChatId;
                    if ((!dcAuthMode || dcAuthMode === 'ADMIN') && dcAdminId) newGolemConfig.dcAdminId = dcAdminId;
                }

                // Persist to golems.json
                existingGolems.push(newGolemConfig);
                fs.writeFileSync(golemsPath, JSON.stringify(existingGolems, null, 4), 'utf8');
                console.log(`📝 [WebServer] New Golem config saved: ${id}`);

                // Dynamically start the Golem instance (deferred init)
                if (typeof this.golemFactory === 'function') {
                    try {
                        const instance = await this.golemFactory(newGolemConfig);
                        console.log(`🚀 [WebServer] Golem [${id}] instance created (Ready for setup).`);
                    } catch (factoryErr) {
                        console.error(`❌ [WebServer] Golem factory failed for [${id}]:`, factoryErr.message);
                    }
                }

                return res.json({ success: true, id, message: `Golem '${id}' created. Please complete persona setup to start.` });
            } catch (e) {
                console.error('[WebServer] Failed to create Golem:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // ─── Start Golem Legally ──────────────────────────────────────────
        this.app.post('/api/golems/start', async (req, res) => {
            try {
                const { id } = req.body;
                if (!id) return res.status(400).json({ error: 'Missing Golem ID' });

                let instance = this.contexts.get(id);

                // 🎯 V9.0.7 解耦：若實體尚未「孕育」，則先執行懶加載
                if (!instance) {
                    if (typeof this.golemFactory === 'function') {
                        console.log(`🧬 [WebServer] Golem '${id}' not in memory. Triggering lazy gestation...`);
                        const golemsPath = path.resolve(process.cwd(), 'golems.json');
                        const configs = JSON.parse(fs.readFileSync(golemsPath, 'utf8'));
                        const targetConfig = configs.find(g => g.id === id);

                        if (!targetConfig) return res.status(404).json({ error: `Config for '${id}' not found in golems.json` });

                        await this.golemFactory(targetConfig);
                        instance = this.contexts.get(id);
                    }

                    if (!instance) return res.status(404).json({ error: `Golem '${id}' failed to gestate.` });
                }

                if (instance.brain.status === 'running') {
                    return res.json({ success: true, message: 'Golem is already running.' });
                }

                console.log(`🎬 [WebServer] Explicitly starting Golem: ${id}`);

                // 1. 執行大腦初始化 (啟動瀏覽器等)
                await instance.brain.init();
                instance.brain.status = 'running';

                // 2. 啟動 Telegram 輪詢
                if (instance.brain.tgBot && typeof instance.brain.tgBot.startPolling === 'function') {
                    try {
                        await instance.brain.tgBot.startPolling();
                        console.log(`🤖 [Bot] ${id} Telegram polling started.`);
                    } catch (botErr) {
                        console.warn(`⚠️ [Bot] ${id} Polling failed:`, botErr.message);
                    }
                }

                // 3. 啟動自主引擎
                if (instance.autonomy && typeof instance.autonomy.start === 'function') {
                    instance.autonomy.start();
                }

                return res.json({ success: true, message: `Golem '${id}' started successfully.` });
            } catch (e) {
                console.error('[WebServer] Failed to start Golem:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.post('/api/golems/setup', async (req, res) => {
            const { golemId, aiName, userName, currentRole, tone, skills } = req.body;
            if (!golemId) return res.status(400).json({ error: "Missing golemId" });

            let context = this.contexts.get(golemId);

            // 如果 context 不存在，試著手動初始化一個臨時 context
            if (!context || !context.brain) {
                console.log(`🏗️ [WebServer] Golem context [${golemId}] not found for setup. Attempting on-demand initialization...`);
                const ConfigManager = require('../src/config/index');
                const golemConfig = ConfigManager.GOLEMS_CONFIG.find(g => g.id === golemId);

                if (golemConfig) {
                    // ✅ [Bug #7 Fix]: 使用真正的 golemFactory 代替殘缺的腦部初始化，確保 Bot、Queue 全數綁定
                    const factory = this.golemFactory;
                    if (factory) {
                        try {
                            const newInstance = await factory(golemConfig);
                            // factory 會塞進 activeGolems，為確保 dashboard 這邊取得，手動同步參考
                            this.contexts.set(golemId, newInstance);
                            context = this.contexts.get(golemId);
                            console.log(`✅ [WebServer] Full context created for [${golemId}] via factory.`);
                        } catch (e) {
                            console.error(`❌ [WebServer] Failed to create context for [${golemId}]:`, e);
                            return res.status(500).json({ error: "Failed to initialize golem context" });
                        }
                    } else {
                        return res.status(500).json({ error: "golemFactory not available" });
                    }
                } else {
                    return res.status(404).json({ error: "Golem configuration not found" });
                }
            }

            try {
                const personaManager = require('../src/skills/core/persona');
                personaManager.save(context.brain.userDataDir, {
                    aiName: aiName || "Golem",
                    userName: userName || "Traveler",
                    currentRole: currentRole || "一個擁有長期記憶與自主意識的 AI 助手",
                    tone: tone || "預設口氣",
                    skills: skills || [],
                    isNew: false
                });

                // Update status and initialize
                context.brain.status = 'running';

                // Initialize and start polling
                (async () => {
                    try {
                        await context.brain.init();

                        // 🎯 V9.0.7 解耦：設定完成後啟動 Telegram 輪詢
                        if (context.brain.tgBot && typeof context.brain.tgBot.startPolling === 'function') {
                            await context.brain.tgBot.startPolling();
                            console.log(`🤖 [Bot] ${golemId} started polling after setup.`);
                        }

                        // 啟動自主引擎
                        if (context.autonomy && typeof context.autonomy.start === 'function') {
                            context.autonomy.start();
                        }
                    } catch (err) {
                        console.error(`Failed to initialize Golem [${golemId}] after setup:`, err);
                        context.brain.status = 'error';
                    }
                })();

                return res.json({ success: true, message: "Golem setup initiated and starting..." });
            } catch (e) {
                console.error("Setup error:", e);
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.get('/api/memory', async (req, res) => {
            const golemId = req.query.golemId || (this.contexts.size > 0 ? Array.from(this.contexts.keys())[0] : null);
            const context = golemId ? this.contexts.get(golemId) : null;
            if (!context || !context.memory) return res.status(503).json({ error: "Memory not engaged" });

            try {
                // If using Qmd/Native, we might need a way to list all. 
                // For now, let's assume valid search or exposed method.
                // If ExperienceMemory (JSON based):
                if (context.memory.data) return res.json(context.memory.data);

                // If SystemNativeDriver or Qmd, we need a implementation to "list all" or search empty
                const results = await context.memory.recall("");
                return res.json(results);
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.delete('/api/memory', async (req, res) => {
            const golemId = req.query.golemId || (this.contexts.size > 0 ? Array.from(this.contexts.keys())[0] : null);
            const context = golemId ? this.contexts.get(golemId) : null;
            if (!context || !context.memory) return res.status(503).json({ error: "Memory not engaged" });
            try {
                if (typeof context.memory.clearMemory === 'function') {
                    await context.memory.clearMemory();
                    return res.json({ success: true, message: "Memory cleared" });
                } else {
                    return res.status(501).json({ error: "Clear memory not supported by this driver" });
                }
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.get('/api/memory/export', async (req, res) => {
            const golemId = req.query.golemId || (this.contexts.size > 0 ? Array.from(this.contexts.keys())[0] : null);
            const context = golemId ? this.contexts.get(golemId) : null;
            if (!context || !context.memory) return res.status(503).json({ error: "Memory not engaged" });
            try {
                if (typeof context.memory.exportMemory === 'function') {
                    const data = await context.memory.exportMemory();
                    res.setHeader('Content-disposition', `attachment; filename=memory_${golemId || 'export'}_${Date.now()}.json`);
                    res.setHeader('Content-type', 'application/json');
                    return res.send(data);
                } else {
                    return res.status(501).json({ error: "Export memory not supported by this driver" });
                }
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.post('/api/memory/import', async (req, res) => {
            const golemId = req.query.golemId || (this.contexts.size > 0 ? Array.from(this.contexts.keys())[0] : null);
            const context = golemId ? this.contexts.get(golemId) : null;
            if (!context || !context.memory) return res.status(503).json({ error: "Memory not engaged" });

            try {
                if (typeof context.memory.importMemory === 'function') {
                    const jsonData = req.body;
                    // body is parsed as object if we use express.json(), need it as string for evaluate
                    const result = await context.memory.importMemory(JSON.stringify(jsonData));
                    if (result.success) {
                        return res.json(result);
                    } else {
                        return res.status(400).json(result);
                    }
                } else {
                    return res.status(501).json({ error: "Import memory not supported by this driver" });
                }
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.post('/api/memory', async (req, res) => {
            const golemId = req.query.golemId || (this.contexts.size > 0 ? Array.from(this.contexts.keys())[0] : null);
            const context = golemId ? this.contexts.get(golemId) : null;
            if (!context || !context.memory) return res.status(503).json({ error: "Memory not engaged" });
            try {
                const { text, metadata } = req.body;
                await context.memory.memorize(text, metadata || {});
                this.io.emit('memory_update', { action: 'add', text, metadata, golemId });
                return res.json({ success: true });
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.get('/api/agent/logs', (req, res) => {
            const golemId = req.query.golemId || (this.contexts.size > 0 ? Array.from(this.contexts.keys())[0] : null);
            const context = golemId ? this.contexts.get(golemId) : null;
            if (!context || !context.brain || !context.brain.chatLogFile) return res.json([]);
            try {
                if (!fs.existsSync(context.brain.chatLogFile)) return res.json([]);
                const content = fs.readFileSync(context.brain.chatLogFile, 'utf8');
                const logs = content.trim().split('\n').map(line => {
                    try { return JSON.parse(line); } catch (e) { return null; }
                }).filter(x => x);

                // Return last 1000 logs (approx 1 day of heavy usage)
                return res.json(logs.slice(-1000));
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }
        });

        // 🎭 人格讀取 API
        this.app.get('/api/persona', (req, res) => {
            try {
                const personaManager = require('../src/skills/core/persona');
                const ConfigManager = require('../src/config/index');

                const golemId = req.query.golemId || (this.contexts.size > 0 ? Array.from(this.contexts.keys())[0] : null);
                const context = golemId ? this.contexts.get(golemId) : null;

                // ✅ 修正路徑判定：預設使用模式切換後的 MEMORY_BASE_DIR 而非寫死的預設值
                let userDataDir;
                if (context && context.brain && context.brain.userDataDir) {
                    userDataDir = context.brain.userDataDir;
                } else if (ConfigManager.GOLEM_MODE === 'SINGLE') {
                    userDataDir = ConfigManager.MEMORY_BASE_DIR;
                } else {
                    userDataDir = golemId ? require('path').join(ConfigManager.MEMORY_BASE_DIR, golemId) : ConfigManager.MEMORY_BASE_DIR;
                }

                const persona = personaManager.get(userDataDir);
                return res.json(persona);
            } catch (e) {
                console.error('Failed to read persona:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // 🎭 人格注入 API
        this.app.post('/api/persona/inject', async (req, res) => {
            try {
                const { golemId: reqGolemId, aiName, userName, currentRole, tone, skills } = req.body;
                const personaManager = require('../src/skills/core/persona');
                const ConfigManager = require('../src/config/index');

                const golemId = reqGolemId || (this.contexts.size > 0 ? Array.from(this.contexts.keys())[0] : null);
                const context = golemId ? this.contexts.get(golemId) : null;

                // ✅ 修正路徑判定確保能正確儲存 (同上)
                let userDataDir;
                if (context && context.brain && context.brain.userDataDir) {
                    userDataDir = context.brain.userDataDir;
                } else if (ConfigManager.GOLEM_MODE === 'SINGLE') {
                    userDataDir = ConfigManager.MEMORY_BASE_DIR;
                } else {
                    userDataDir = golemId ? require('path').join(ConfigManager.MEMORY_BASE_DIR, golemId) : ConfigManager.MEMORY_BASE_DIR;
                }

                personaManager.save(userDataDir, {
                    aiName: aiName || 'Golem',
                    userName: userName || 'Traveler',
                    currentRole: currentRole || '一個擁有長期記憶與自主意識的 AI 助手',
                    tone: tone || '預設口氣',
                    skills: skills || [],
                    isNew: false
                });

                // ✅ 改為熱重載：不再要求重啟，直接呼叫 reloadSkills 開啟新視窗
                if (context && context.brain) {
                    try {
                        console.log(`🤖 [WebServer] Triggering hot-reload for persona via new Gemini window... (Golem: ${golemId})`);
                        await context.brain.reloadSkills();

                        // TG 通知 (同技能注入)
                        const targetId = context.brain.config?.chatId || ConfigManager.CONFIG.TG_CHAT_ID;
                        if (context.brain.tgBot && targetId) {
                            const bot = context.brain.tgBot;
                            bot.sendMessage(targetId, `🔄 *[${golemId}] 人格設定已更新*\n已重新開啟全新的對話視窗並載入最新人格「${aiName || 'Golem'}」，歷史記憶完整保留。`, { parse_mode: 'Markdown' })
                                .catch(e => console.warn(`⚠️ [WebServer] TG persona notify failed [${golemId}]:`, e.message));
                        }
                    } catch (e) {
                        console.error('⚠️ [WebServer] Failed to hot-reload persona:', e);
                    }
                } else {
                    // 若 Golem 尚未啟動，至少要清快取，下次啟動自動套用
                    try {
                        const ProtocolFormatter = require('../src/services/ProtocolFormatter');
                        ProtocolFormatter._lastScanTime = 0;
                    } catch (_) { /* ignore */ }
                }

                console.log(`🎭 [WebServer] Persona saved & injection requested for Golem [${golemId}]`);
                return res.json({ success: true, message: '人格已更新並重新開啟對話視窗' });
            } catch (e) {
                console.error('Failed to inject persona:', e);
                return res.status(500).json({ success: false, error: e.message });
            }
        });

        // 🎭 新增人格樣板 API
        this.app.post('/api/persona/create', (req, res) => {
            try {
                const { id, name, description, icon, aiName, userName, role, tone, tags } = req.body;
                if (!id || !name) return res.status(400).json({ success: false, error: 'Missing id or name' });

                const personasDir = path.resolve(__dirname, '..', 'personas');
                if (!fs.existsSync(personasDir)) fs.mkdirSync(personasDir, { recursive: true });

                const safeId = id.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
                const filePath = path.join(personasDir, `${safeId}.md`);
                if (fs.existsSync(filePath)) {
                    return res.status(409).json({ success: false, error: `檔案 ${safeId}.md 已存在` });
                }

                const tagsArray = Array.isArray(tags) ? tags : (tags || '').split(',').map(s => s.trim()).filter(Boolean);
                const tagsYaml = tagsArray.length > 0 ? `[${tagsArray.map(t => `"${t}"`).join(', ')}]` : '[]';

                const content = `---\nname: "${name}"\ndescription: "${description || ''}"\nicon: "${icon || 'BrainCircuit'}"\naiName: "${aiName || 'Golem'}"\nuserName: "${userName || 'Traveler'}"\ntone: "${tone || '預設口氣'}"\ntags: ${tagsYaml}\nskills: []\n---\n${role || ''}\n`;

                fs.writeFileSync(filePath, content, 'utf8');
                console.log(`🎭 [WebServer] New persona created: ${safeId}.md`);
                return res.json({ success: true, id: safeId });
            } catch (e) {
                console.error('Failed to create persona:', e);
                return res.status(500).json({ success: false, error: e.message });
            }
        });

        this.app.post('/api/system/reload', (req, res) => {
            console.log("🔄 [WebServer] Received reload request. Restarting system...");
            res.json({ success: true, message: "System is restarting..." });

            // ✅ [Phase 1.5 Bug #1] Actually restart the system via gracefulRestart
            setTimeout(() => {
                if (typeof global.gracefulRestart === 'function') {
                    console.log("🔄 [WebServer] Calling global.gracefulRestart()...");
                    global.gracefulRestart();
                } else {
                    console.warn("⚠️ [WebServer] global.gracefulRestart not available. Falling back to safeExit for restart.");
                    safeExit(0);
                }
            }, 500);
        });

        this.app.post('/api/system/shutdown', (req, res) => {
            console.log("⛔ [WebServer] Received shutdown request. Stopping system...");
            res.json({ success: true, message: "System is shutting down... Please restart manually if needed." });

            // 直接終止進程，不 spawn 新子進程
            // 與 reload 的差異：reload 會生出新進程再死去（熱重啟），shutdown 則完全停止
            // Single mode / Multi mode 皆適用（都是同一個 Node.js 進程）
            setTimeout(() => {
                safeExit(0);
            }, 1000);
        });

        // Socket.io connection handler
        this.io.on('connection', (socket) => {
            const getGolemsData = () => {
                return Array.from(this.contexts.entries()).map(([id, context]) => {
                    const status = (context.brain && context.brain.status) || 'running';
                    return { id, status };
                });
            };

            // Send initial state upon connection
            if (this.dashboard) {
                socket.emit('init', {
                    queueCount: this.dashboard.queueCount,
                    lastSchedule: this.dashboard.lastSchedule,
                    uptime: process.uptime(),
                    logs: this.logBuffer, // Send buffered logs
                    golems: getGolemsData() // Send active golems
                });
            } else {
                socket.emit('init', {
                    queueCount: 0,
                    lastSchedule: 'N/A',
                    uptime: process.uptime(),
                    logs: this.logBuffer,
                    golems: getGolemsData()
                });
            }

            // Allow client to manually request logs (for page navigation)
            socket.on('request_logs', () => {
                socket.emit('init', { logs: this.logBuffer });
            });

            // ✅ [Phase 1.5 Bug #6] Socket.io heartbeat (enhanced with MetricsCollector)
            const heartbeatInterval = setInterval(() => {
                const snapshot = global._metricsCollector ? global._metricsCollector.getSnapshot() : {};
                socket.emit('heartbeat', {
                    uptime: snapshot.uptime_sec || Math.floor(process.uptime()),
                    memUsage: snapshot.rss_mb || Math.round(process.memoryUsage().rss / 1024 / 1024),
                    heapUsage: snapshot.heap_mb || 0,
                    cpuPct: snapshot.cpu_pct || 0,
                    queueDepth: snapshot.queue_depth || 0,
                    tasksCompleted: snapshot.tasks_completed || 0,
                    tasksFailed: snapshot.tasks_failed || 0,
                    errors1h: snapshot.errors_1h || 0,
                    skillsLoaded: snapshot.skills_loaded || 0,
                    memoryWorking: snapshot.memory_working || 0,
                    memoryEpisodic: snapshot.memory_episodic || 0,
                    cbOpen: snapshot.circuit_breakers_open || 0,
                    ragConfidence: snapshot.rag_confidence_avg || 0,
                    timestamp: Date.now()
                });
            }, 30000);

            socket.on('disconnect', () => {
                clearInterval(heartbeatInterval);
            });
        });

        // Start Server
        this.server.listen(this.port, () => {
            const url = `http://localhost:${this.port}/dashboard`;
            console.log(`🚀 [WebServer] Dashboard running at ${url}`);

            if (!process.env.SKIP_BROWSER) {
                // Wait briefly to see if an existing dashboard tab reconnects
                // before opening a new one. (Socket.io clients auto-reconnect)
                setTimeout(() => {
                    const connectedClients = this.io.engine.clientsCount;
                    if (connectedClients === 0) {
                        // Auto-open browser (MacOS 'open', Windows 'start', Linux 'xdg-open')
                        const startCmd = process.platform == 'darwin' ? 'open' : process.platform == 'win32' ? 'start' : 'xdg-open';
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
        // Add to buffer
        this.logBuffer.push(data);
        if (this.logBuffer.length > 200) {
            this.logBuffer.shift();
        }

        // ── [v9.1.9] Chat History Tracking ──
        if (data && data.msg) {
            // Detect Browser Session Restart to clear history
            const restartMatch = data.msg.match(/Browser Session Started \(Golem: (.*?)\)/);
            if (restartMatch) {
                const gId = restartMatch[1];
                if (!this.chatHistory) this.chatHistory = new Map();
                this.chatHistory.set(gId, []);
                console.log(`🧹 [WebServer] Cleared chat history for Golem [${gId}] due to browser session start.`);
            }

            // Filter for chat-like UI messages (Exclude 'thinking' type from history)
            if (data.type !== 'thinking' && (data.type === 'agent' || data.type === 'approval' || data.msg.includes('[MultiAgent]') || data.msg.includes('[User]') || data.msg.includes('[WebUser]'))) {
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

                    // Limit history to last 500 messages per Golem
                    if (this.chatHistory.get(gId).length > 500) {
                        this.chatHistory.get(gId).shift();
                    }

                    // ✅ [Phase 1.5 Bug #5] Persist chat history to disk (debounced)
                    this._saveChatHistory();
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
