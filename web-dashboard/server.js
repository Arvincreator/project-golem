const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');
const { getLocalIp } = require('../src/utils/HttpUtils');
const { MANDATORY_SKILLS, OPTIONAL_SKILLS: OPTIONAL_SKILL_LIST, resolveEnabledSkills } = require('../src/skills/skillsConfig');

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
        const cors = require('cors');

        // ─── Remote Access Config ────────────────────────────────────────────────────
        // When ALLOW_REMOTE_ACCESS=true, open CORS to all origins so remote clients
        // (e.g. LAN IP / reverse-proxy) can connect. Otherwise, restrict to localhost.
        this.allowRemote = (process.env.ALLOW_REMOTE_ACCESS || '').trim() === 'true';
        const corsOrigin = this.allowRemote
            ? true // allow all origins
            : ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001", "http://127.0.0.1:3001"];

        this.app.use(cors({
            origin: corsOrigin,
            methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
        }));
        this.app.use(express.json({ limit: '50mb' })); // Enable JSON body parsing with large limit
        this.app.use(express.urlencoded({ limit: '50mb', extended: true }));
        this.server = http.createServer(this.app);

        // 🎯 [v9.1.13] Set a generous timeout (120s) for long-running tasks like skill injection
        this.server.timeout = 300000;

        // Security & Cleanup Middleware
        this.app.use((req, res, next) => {
            // CSP: allow WebSocket connections from any host when remote access is on
            // 🎯 [v9.1.10] Relax CSP for images to support diverse sources and prevent broken icons
            const connectSrc = this.allowRemote
                ? "default-src 'self' *; connect-src * ws: wss:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: *;"
                : "default-src 'self'; connect-src 'self' ws: wss:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: *;";
            res.setHeader('Content-Security-Policy', connectSrc);
            next();
        });

        // Silencing Chrome's default searching for devtools config to avoid 404 noise
        this.app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
            res.json({});
        });

        // Health check for debugging
        this.app.get('/api/health', (req, res) => {
            res.json({ status: 'ok', time: new Date().toISOString() });
        });

        this.io = new Server(this.server, {
            cors: {
                origin: corsOrigin,
                methods: ["GET", "POST"]
            }
        });

        this.port = process.env.DASHBOARD_PORT || 3000;
        console.log(`📡 [WebServer] Initial port: ${this.port}, Dev Mode: ${process.env.DASHBOARD_DEV_MODE}`);

        // If in Dev Mode and port is still 3000 (default), shift backend to 3001 
        // to avoid conflict with Next.js Dev Server (which also defaults to 3000).
        const isDev = (process.env.DASHBOARD_DEV_MODE || "").trim() === 'true';
        if (isDev && this.port == 3000) {
            console.log('🚧 [WebServer] Dev Mode detected + Port 3000: Automatically shifting backend to 3001.');
            this.port = 3001;
        }
        console.log(`📡 [WebServer] Final bound port: ${this.port}`);

        this.contexts = new Map();
        this.golemFactory = null; // Injected from index.js for dynamic Golem creation

        this.init();
        this.isBooting = true;
        this.logBuffer = []; // Store last 200 logs
        this.chatHistory = new Map(); // Store chat history per golem
    }

    /**
     * 注入 Golem 工廠函式（由 index.js 在啟動後呼叫）
     * @param {Function} fn async (golemConfig) => golemInstance
     */
    setGolemFactory(fn) {
        this.golemFactory = fn;
        console.log('🔗 [WebServer] Golem factory injected — dynamic Golem creation enabled.');

        // 🎯 v9.1.5: Auto-start fully-configured Golem on backend boot.
        setTimeout(async () => {
            const ConfigManager = require('../src/config/index');
            const fs = require('fs');
            const path = require('path');

            const { MEMORY_BASE_DIR } = ConfigManager;
            const personaPath = path.resolve(MEMORY_BASE_DIR, 'persona.json');

            console.log('🔄 [WebServer] Scanning for persona.json to auto-start Golem...');

            if (fs.existsSync(personaPath)) {
                console.log(`🚀 [WebServer] Auto-starting Golem from saved state...`);
                try {
                    // 單機模式配置
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
                        console.log(`✅ [WebServer] Golem auto-started successfully.`);
                    }
                } catch (e) {
                    console.error(`❌ [WebServer] Failed to auto-start Golem:`, e);
                } finally {
                    this.isBooting = false;
                    console.log('🏁 [WebServer] Booting complete! Dashboard is now ready.');
                }
            } else {
                console.log(`⏸️ [WebServer] Golem skipped auto-start (Missing persona.json).`);
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
        // Serve uploaded files
        // 🚀 [v8.6] Static File Serving for Dashboard Uploads (Ensure absolute path)
        const projectRoot = path.resolve(__dirname, '..');
        const uploadDir = path.join(projectRoot, 'data', 'temp_uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        this.app.use('/api/files', express.static(uploadDir));

        // 🎯 [v9.1.10] Debug Endpoint to verify file visibility
        this.app.get('/api/files-debug', (req, res) => {
            if (fs.existsSync(uploadDir)) {
                const files = fs.readdirSync(uploadDir);
                return res.json({ uploadDir, files });
            }
            return res.status(404).json({ error: 'Upload directory not found', path: uploadDir });
        });

        // Serve static files with .html extension support - ONLY IN NON-DEV MODE
        const isDevMode = process.env.DASHBOARD_DEV_MODE === 'true';
        const publicPath = path.join(__dirname, 'out');

        if (!isDevMode) {
            this.app.use(express.static(publicPath, {
                extensions: ['html'],
                setHeaders: (res, path) => {
                    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                    res.setHeader('Pragma', 'no-cache');
                    res.setHeader('Expires', '0');
                }
            }));
        } else {
            console.log('🚧 [WebServer] Dashboard Dev Mode active — skipping static file serving.');

            // In Dev Mode, show a helpful message if user hits the backend port directly
            this.app.get('/', (req, res) => {
                res.status(200).send(`
                    <body style="background:#0a0a0a; color:#eee; font-family:sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0;">
                        <h1 style="color:#0096ff;">🚧 Golem Backend is Running (Dev Mode)</h1>
                        <p>This is the <b>Backend API</b> port (${this.port}).</p>
                        <div style="background:#1a1a1a; padding:20px; border-radius:12px; border:1px solid #333; text-align:center;">
                            <p>To access the Dashboard UI with Hot Reloading, please go to:</p>
                            <a href="http://localhost:3000" style="color:#00ff9d; font-size:24px; text-decoration:none; font-weight:bold;">http://localhost:3000</a>
                            <p style="font-size:12px; color:#666; margin-top:20px;">Make sure you have run: <code>cd web-dashboard && npm run dev</code></p>
                        </div>
                    </body>
                `);
            });
        }

        if (!isDevMode) {
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
                '/dashboard/mcp',
                '/dashboard/system-setup'
            ];

            // 🎯 v9.1.5 解耦：自動導引系統設定 (Auto-Setup)
            // 在進入 Dashboard 核心頁面之前，檢查系統配置狀態
            this.app.get(/\/dashboard.*/, (req, res, next) => {
                const normalizedPath = req.path.replace(/\/$/, "");
                // 排除設定頁面本身與 API 請求，避免無限重定向
                if (normalizedPath === '/dashboard/system-setup' || req.path.startsWith('/api/')) {
                    return next();
                }

                try {
                    const ConfigManager = require('../src/config/index');
                    // v9.1.5 修正：強制檢查初始化標記
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
        }


        // --- API Routes ---

        // Upload API (Direct Web Upload)
        this.app.post('/api/upload', async (req, res) => {
            try {
                const { fileName, base64Data } = req.body;
                if (!fileName || !base64Data) {
                    return res.status(400).json({ error: 'Missing fileName or base64Data' });
                }

                // Create temp upload dir
                const uploadDir = path.join(process.cwd(), 'data', 'temp_uploads');
                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                }

                // Sanitize filename
                const safeName = `${Date.now()}_${fileName.replace(/[^a-z0-9.]/gi, '_')}`;
                const filePath = path.join(uploadDir, safeName);

                // Save file
                const buffer = Buffer.from(base64Data, 'base64');
                fs.writeFileSync(filePath, buffer);

                console.log(`💾 [WebServer] File uploaded: ${safeName}`);
                return res.json({ success: true, path: filePath, url: `/api/files/${safeName}` });
            } catch (e) {
                console.error('Failed to upload file:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // Chat API (Direct Web Chat)
        this.app.post('/api/chat', async (req, res) => {
            try {
                const { golemId, message, attachment: attachmentData } = req.body;
                if (!golemId || (!message && !attachmentData)) {
                    return res.status(400).json({ error: 'Missing golemId, message or attachment' });
                }

                if (typeof global.handleDashboardMessage !== 'function') {
                    return res.status(503).json({ error: 'Dashboard message handler not ready' });
                }

                // 🚀 [v9.1.10] 更好的 MIME Type 推斷邏輯，避免非圖片檔案被誤判為 image/jpeg
                let finalMimeType = attachmentData ? attachmentData.mimeType : null;
                if (attachmentData && !finalMimeType && attachmentData.url) {
                    const ext = attachmentData.url.split('.').pop().toLowerCase();
                    const mimeMap = {
                        'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp',
                        'pdf': 'application/pdf', 'txt': 'text/plain', 'md': 'text/markdown', 'sh': 'text/x-sh', 'js': 'text/javascript'
                    };
                    finalMimeType = mimeMap[ext] || 'application/octet-stream';
                }

                const attachment = attachmentData ? {
                    isNative: true,
                    path: attachmentData.path,
                    url: attachmentData.url,
                    mimeType: finalMimeType || 'application/octet-stream'
                } : null;

                // 建立了 UniversalContext 替代品
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
                            time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
                            msg: `[${golemId}] ${text}`,
                            type: payloadType,
                            raw: text,
                            actionData,
                            golemId
                        });
                    },
                    sendTyping: async () => { },
                    getAttachment: async () => attachment,
                    instance: { username: golemId }
                };

                // 回顯使用者的訊息到 Dashboard Log
                this.broadcastLog({
                    time: new Date().toLocaleTimeString(),
                    msg: `[User] ${message || (attachment ? '[圖片]' : '')}`,
                    type: 'agent',
                    raw: `[User] ${message || '[圖片]'}`,
                    golemId,
                    attachment: attachment ? { url: attachment.url, mimeType: attachment.mimeType } : null
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
                    reply: async (text, options) => {
                        let payloadType = 'agent';
                        let actionData = null;

                        if (options && options.reply_markup && options.reply_markup.inline_keyboard) {
                            payloadType = 'approval';
                            actionData = options.reply_markup.inline_keyboard[0];
                        }

                        this.broadcastLog({
                            time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
                            msg: `[${golemId}] ${text}`,
                            type: payloadType,
                            raw: text,
                            actionData,
                            golemId
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

        // Config API (Settings Page)
        this.app.get('/api/config', (req, res) => {
            try {
                const EnvManager = require('../src/utils/EnvManager');
                const envData = EnvManager.readEnv();

                // We return all properties so the frontend can display them.
                return res.json({ env: envData, golems: [] });
            } catch (e) {
                console.error("Failed to read config:", e);
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.post('/api/config', (req, res) => {
            try {
                const { env: envPayload } = req.body;

                if (!envPayload || typeof envPayload !== 'object') {
                    return res.status(400).json({ error: "Invalid env payload" });
                }

                const EnvManager = require('../src/utils/EnvManager');

                // 1. 寫入 .env 檔案
                const envUpdated = EnvManager.updateEnv(envPayload);

                if (envUpdated) {
                    console.log(`📝 [System] Saved new config. env updated: ${envUpdated}`);

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
                const marketplaceDir = path.join(process.cwd(), 'data', 'marketplace', 'skills');
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

                // Calculate counts for all categories
                const categoryCounts = {};
                let totalMarketSkills = 0;
                if (fs.existsSync(marketplaceDir)) {
                    const files = fs.readdirSync(marketplaceDir).filter(f => f.endsWith('.json'));
                    for (const file of files) {
                        const data = JSON.parse(fs.readFileSync(path.join(marketplaceDir, file), 'utf8'));
                        const categoryId = file.replace('.json', '');
                        categoryCounts[categoryId] = data.length;
                        totalMarketSkills += data.length;
                    }
                }
                categoryCounts['all'] = totalMarketSkills;

                return res.json({ skills, total, categoryCounts });
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
                const { MEMORY_BASE_DIR } = require('../src/config');
                const idx = new SkillIndexManager(MEMORY_BASE_DIR);
                idx.addSkill(safeId).catch(e => console.error(`[SkillIndex] MarketplaceInstall-Add Error for ${safeId}:`, e.message));

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
                const { MEMORY_BASE_DIR } = require('../src/config');
                const idx = new SkillIndexManager(MEMORY_BASE_DIR);
                if (enabled) {
                    idx.addSkill(id).catch(e => console.error(`[SkillIndex] Toggle-Add Error for ${id}:`, e.message));
                } else {
                    idx.removeSkill(id).catch(e => console.error(`[SkillIndex] Toggle-Remove Error for ${id}:`, e.message));
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
                const enabledSkills = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', []);
                if (MANDATORY_SKILLS.includes(safeId) || enabledSkills.has(safeId)) {
                    const SkillIndexManager = require('../src/managers/SkillIndexManager');
                    const { MEMORY_BASE_DIR } = require('../src/config');
                    const idx = new SkillIndexManager(MEMORY_BASE_DIR);
                    idx.addSkill(safeId).catch(e => console.error(`[SkillIndex] Create-Add Error for ${safeId}:`, e.message));
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
                const enabledSkills = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', []);
                if (MANDATORY_SKILLS.includes(safeId) || enabledSkills.has(safeId)) {
                    const SkillIndexManager = require('../src/managers/SkillIndexManager');
                    const { MEMORY_BASE_DIR } = require('../src/config');

                    const idx = new SkillIndexManager(MEMORY_BASE_DIR);
                    idx.addSkill(safeId).catch(e => console.error(`[SkillIndex] Update-Add Error for ${safeId}:`, e.message));
                }

                return res.json({ success: true, id: safeId });
            } catch (e) {
                console.error('Failed to update skill:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // 🗑️ 刪除技能 API
        this.app.post('/api/skills/delete', async (req, res) => {
            try {
                const { id } = req.body;
                if (!id) return res.status(400).json({ error: 'Missing skill ID' });

                const safeId = id.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();

                // 1. 安全檢查：禁止刪除強制性技能
                if (MANDATORY_SKILLS.includes(safeId)) {
                    return res.status(403).json({ error: `Cannot delete mandatory skill '${safeId}'` });
                }

                const libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
                const filePath = path.join(libPath, `${safeId}.md`);

                if (!fs.existsSync(filePath)) {
                    return res.status(404).json({ error: `Skill '${safeId}' not found` });
                }

                // 2. 執行檔案刪除
                fs.unlinkSync(filePath);
                console.log(`🗑️ [WebServer] Custom skill deleted: ${safeId}.md`);

                // 3. 從 SQLite 索引移除
                const SkillIndexManager = require('../src/managers/SkillIndexManager');
                const { MEMORY_BASE_DIR } = require('../src/config');
                const idx = new SkillIndexManager(MEMORY_BASE_DIR);
                await idx.removeSkill(safeId).catch(e => console.error(`[SkillIndex] Delete-Remove Error for ${safeId}:`, e.message));

                // 4. 清除技能快取 (ProtocolFormatter)
                const ProtocolFormatter = require('../src/services/ProtocolFormatter');
                ProtocolFormatter._lastScanTime = 0;

                return res.json({ success: true, id: safeId });
            } catch (e) {
                console.error('Failed to delete skill:', e);
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
                            console.log(`🚀 [WebServer] 啟動 [${id}] 完整重啟程序...`);
                            await context.brain.reloadSkills();
                            results.push({ id, status: 'success' });

                            // 📣 TG 通知
                            const tgBot = context.brain.tgBot;
                            if (tgBot) {
                                const enabledSkills = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', []);
                                const enabledOptional = OPTIONAL_SKILL_LIST.filter(s => enabledSkills.has(s));
                                const disabledOptional = OPTIONAL_SKILL_LIST.filter(s => !enabledSkills.has(s));

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
            const personasDir = path.resolve(process.cwd(), 'personas');
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
                const personasDir = path.resolve(process.cwd(), 'data', 'marketplace', 'personas');

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

                // De-duplicate by ID
                const seenIds = new Set();
                allPersonas = allPersonas.filter(p => {
                    if (!p.id || seenIds.has(p.id)) return false;
                    seenIds.add(p.id);
                    return true;
                });

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

                let golemsData = [];
                const isSingleMode = envVars.GOLEM_MODE === 'SINGLE' || !envVars.GOLEM_MODE;
                const hasToken = envVars.TELEGRAM_TOKEN || envVars.DISCORD_TOKEN;

                if (hasToken || isSingleMode) {
                    const id = 'golem_A';
                    const context = this.contexts.get(id);
                    let status = 'not_started';

                    if (context && context.brain) {
                        status = context.brain.status || 'running';
                    } else {
                        status = 'not_started';
                    }
                    golemsData.push({ id, status });
                }

                // 補上其他在記憶體中的實體 (雖然單機模式通常只有 golem_A)
                this.contexts.forEach((ctx, id) => {
                    if (!golemsData.find(g => g.id === id)) {
                        golemsData.push({ id, status: ctx.brain.status || 'running' });
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
                const EnvManager = require('../src/utils/EnvManager');
                const envVars = EnvManager.readEnv();
                const configuredCount = (envVars.TELEGRAM_TOKEN || envVars.DISCORD_TOKEN) ? 1 : 0;

                const isSystemConfigured = envVars.SYSTEM_CONFIGURED === 'true';

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
                    isBooting: this.isBooting,
                    allowRemote: this.allowRemote,
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


        // ─── System Config ───────────────────────────────────────────────────────────────────
        this.app.get('/api/system/config', (req, res) => {
            try {
                const EnvManager = require('../src/utils/EnvManager');
                const envVars = EnvManager.readEnv();

                // Read version from package.json
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
                    allowRemoteAccess: this.allowRemote
                });
            } catch (e) {
                console.error('[WebServer] Failed to get system config:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.post('/api/system/config', (req, res) => {
            try {
                const { geminiApiKeys, userDataDir, golemMemoryMode, golemEmbeddingProvider, golemLocalEmbeddingModel, golemMode, allowRemoteAccess } = req.body;
                const EnvManager = require('../src/utils/EnvManager');
                const ConfigManager = require('../src/config/index');

                const updates = {};
                // Allow empty string to clear keys
                if (geminiApiKeys !== undefined) updates.GEMINI_API_KEYS = geminiApiKeys;
                if (userDataDir) updates.USER_DATA_DIR = userDataDir;
                if (golemMemoryMode) updates.GOLEM_MEMORY_MODE = golemMemoryMode;
                if (golemEmbeddingProvider) updates.GOLEM_EMBEDDING_PROVIDER = golemEmbeddingProvider;
                if (golemLocalEmbeddingModel) updates.GOLEM_LOCAL_EMBEDDING_MODEL = golemLocalEmbeddingModel;
                if (allowRemoteAccess !== undefined) updates.ALLOW_REMOTE_ACCESS = String(allowRemoteAccess);
                updates.GOLEM_MODE = 'SINGLE';

                if (Object.keys(updates).length > 0) {
                    // 標記系統已完成初始化
                    updates.SYSTEM_CONFIGURED = 'true';

                    EnvManager.updateEnv(updates);
                    console.log('📝 [System] System configuration updated via web dashboard. Flag: SYSTEM_CONFIGURED=true');

                    if (updates.ALLOW_REMOTE_ACCESS !== undefined) {
                        this.allowRemote = updates.ALLOW_REMOTE_ACCESS === 'true';
                    }

                    // 觸發熱重載
                    ConfigManager.reloadConfig();

                    // ✨ [v10.10] 通知 AutonomyManager 即時更新檢查排程
                    for (const ctx of this.contexts.values()) {
                        if (ctx.autonomy && typeof ctx.autonomy.scheduleNextArchive === 'function') {
                            ctx.autonomy.scheduleNextArchive();
                        }
                    }

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
                console.log("🔄 [System] Restart requested by user. Triggering hard restart...");
                res.json({ success: true, message: "Restarting system... Full re-initialization in progress." });

                if (typeof global.gracefulRestart === 'function') {
                    setTimeout(() => {
                        global.gracefulRestart().catch(err => {
                            console.error("❌ [System] Restart error:", err);
                            process.exit(1);
                        });
                    }, 1000);
                } else {
                    console.warn("⚠️ [System] global.gracefulRestart not found, falling back to process.exit()");
                    setTimeout(() => process.exit(0), 1000);
                }
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
                const EnvManager = require('../src/utils/EnvManager');
                const ConfigManager = require('../src/config/index');

                if (!id) {
                    return res.status(400).json({ error: 'Missing required fields: id' });
                }

                // Validate ID format
                if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
                    return res.status(400).json({ error: 'Invalid Golem ID: only alphanumeric, _ and - allowed' });
                }

                // --- Mode-aware Logic ---
                // --- Start Golem Logic (Simplified to Single Mode) ---
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

                ConfigManager.reloadConfig();

                if (typeof this.golemFactory === 'function') {
                    const { GOLEMS_CONFIG: freshGolemsConfig } = ConfigManager;
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
                    } catch (factoryErr) {
                        console.error(`❌ [WebServer] Single Mode golem_A factory failed:`, factoryErr.message);
                    }
                }

                return res.json({ success: true, mode: 'SINGLE', id: 'golem_A', message: 'Single Mode configuration updated successfully.' });
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

                // 🎯 v9.1.5 解耦：若實體尚未「孕育」，則先執行懶加載
                if (!instance) {
                    if (typeof this.golemFactory === 'function') {
                        console.log(`🧬 [WebServer] Golem '${id}' not in memory. Triggering lazy gestation (Single Mode)...`);
                        const ConfigManager = require('../src/config/index');
                        const targetConfig = ConfigManager.GOLEMS_CONFIG.find(g => g.id === id);

                        if (!targetConfig) return res.status(404).json({ error: `Config for '${id}' not found in internal config.` });

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
                this.isBooting = true;
                try {
                    await instance.brain.init();
                    instance.brain.status = 'running';
                } finally {
                    this.isBooting = false;
                }

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

        this.app.post('/api/golems/stop', async (req, res) => {
            try {
                const { id } = req.body;
                if (!id) return res.status(400).json({ error: 'Missing Golem ID' });

                console.log(`🛑 [WebServer] Stopping Golem: ${id}`);

                if (typeof global.stopGolem === 'function') {
                    await global.stopGolem(id);
                    // Explicitly remove from local contexts to ensure status update
                    this.removeContext(id);
                    return res.json({ success: true, message: `Golem ${id} stopped.` });
                } else {
                    // Fallback cleanup if Golem is in memory but global helper not found
                    const instance = this.contexts.get(id);
                    if (instance && instance.brain && instance.brain.browser) {
                        await instance.brain.browser.close();
                        instance.brain.status = 'not_started';
                        return res.json({ success: true, message: `Golem ${id} browser closed (fallback).` });
                    }
                    return res.status(404).json({ error: 'Stop helper not found and Golem not in memory.' });
                }
            } catch (e) {
                console.error(`❌ [WebServer] Stop failed:`, e);
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
                const oldPersona = personaManager.get(context.brain.userDataDir);
                personaManager.save(context.brain.userDataDir, {
                    aiName: aiName || "Golem",
                    userName: userName || "Traveler",
                    currentRole: currentRole || "一個擁有長期記憶與自主意識的 AI 助手",
                    tone: tone || "預設口氣",
                    skills: skills || [],
                    isNew: false,
                    workerProfiles: oldPersona.workerProfiles || personaManager._getDefaultWorkerProfiles()
                });

                // Update status and initialize
                context.brain.status = 'running';
                this.isBooting = true;

                // Initialize and start polling
                (async () => {
                    try {
                        await context.brain.init();

                        // 🎯 v9.1.5 解耦：設定完成後啟動 Telegram 輪詢
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
                    } finally {
                        this.isBooting = false;
                        console.log(`✅ [WebServer] Setup complete for ${golemId}. Dashboard is ready.`);
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
                } else {
                    userDataDir = ConfigManager.MEMORY_BASE_DIR;
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
                const { golemId: reqGolemId, aiName, userName, currentRole, tone, skills, workerProfiles } = req.body;
                const personaManager = require('../src/skills/core/persona');
                const ConfigManager = require('../src/config/index');

                const golemId = reqGolemId || (this.contexts.size > 0 ? Array.from(this.contexts.keys())[0] : null);
                const context = golemId ? this.contexts.get(golemId) : null;

                // ✅ 修正路徑判定確保能正確儲存 (同上)
                let userDataDir;
                if (context && context.brain && context.brain.userDataDir) {
                    userDataDir = context.brain.userDataDir;
                } else {
                    userDataDir = ConfigManager.MEMORY_BASE_DIR;
                }

                const oldPersona = personaManager.get(userDataDir);

                personaManager.save(userDataDir, {
                    aiName: aiName || 'Golem',
                    userName: userName || 'Traveler',
                    currentRole: currentRole || '一個擁有長期記憶與自主意識的 AI 助手',
                    tone: tone || '預設口氣',
                    skills: skills || [],
                    isNew: false,
                    workerProfiles: workerProfiles || oldPersona.workerProfiles || personaManager._getDefaultWorkerProfiles()
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

                const personasDir = path.resolve(process.cwd(), 'personas');
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

        // 🗑️ 刪除人格 API
        this.app.post('/api/persona/delete', async (req, res) => {
            try {
                const { id } = req.body;
                if (!id) return res.status(400).json({ success: false, error: 'Missing persona ID' });

                const safeId = id.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();

                // 1. 安全檢查：禁止刪除內建人格
                const BUILTIN_PERSONAS = ['standard', 'expert', 'analyst', 'coach', 'creative', 'storyteller', 'translator'];
                if (BUILTIN_PERSONAS.includes(safeId)) {
                    return res.status(403).json({ success: false, error: `無法刪除內建人格樣板 '${safeId}'` });
                }

                const personasDir = path.resolve(process.cwd(), 'personas');
                const filePath = path.join(personasDir, `${safeId}.md`);

                if (!fs.existsSync(filePath)) {
                    return res.status(404).json({ success: false, error: `樣板檔案 '${safeId}.md' 不存在` });
                }

                // 2. 執行檔案刪除
                fs.unlinkSync(filePath);
                console.log(`🗑️ [WebServer] Persona template deleted: ${safeId}.md`);

                return res.json({ success: true, id: safeId });
            } catch (e) {
                console.error('Failed to delete persona:', e);
                return res.status(500).json({ success: false, error: e.message });
            }
        });

        // ─── MCP API Routes ──────────────────────────────────────────────────────────────────────
        // Lazy-init MCPManager and wire its 'mcpLog' event to broadcastLog
        const getMCPManager = async () => {
            const MCPManager = require('../src/mcp/MCPManager');
            const mgr = MCPManager.getInstance();
            if (!mgr._loaded) {
                // Wire log event once
                if (!mgr._broadcastWired) {
                    mgr._broadcastWired = true;
                    mgr.on('mcpLog', (entry) => {
                        const preview = entry.success
                            ? (JSON.stringify(entry.result || '').slice(0, 120))
                            : `ERROR: ${entry.error}`;
                        this.broadcastLog({
                            time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
                            msg:  `[MCP] ${entry.server}/${entry.tool} (${entry.durationMs}ms) ${entry.success ? '✅' : '❌'} ${preview}`,
                            type: 'mcp',
                            raw:  JSON.stringify(entry),
                            mcpEntry: entry
                        });
                    });
                }
                await mgr.load();
            }
            return mgr;
        };

        // GET /api/mcp/servers — list all
        this.app.get('/api/mcp/servers', async (req, res) => {
            try {
                const mgr = await getMCPManager();
                return res.json({ servers: mgr.getServers() });
            } catch (e) {
                console.error('[MCP] List servers error:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // POST /api/mcp/servers — add
        this.app.post('/api/mcp/servers', async (req, res) => {
            try {
                const { name, command, args, env, enabled, description } = req.body;
                if (!name || !command) return res.status(400).json({ error: 'Missing name or command' });
                const mgr   = await getMCPManager();
                const entry = await mgr.addServer({ name, command, args, env, enabled, description });
                console.log(`[MCP] Added server: ${name}`);
                return res.json({ success: true, server: entry });
            } catch (e) {
                console.error('[MCP] Add server error:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // PUT /api/mcp/servers/:name — update
        this.app.put('/api/mcp/servers/:name', async (req, res) => {
            try {
                const { name } = req.params;
                const mgr   = await getMCPManager();
                const entry = await mgr.updateServer(name, req.body);
                console.log(`[MCP] Updated server: ${name}`);
                return res.json({ success: true, server: entry });
            } catch (e) {
                console.error('[MCP] Update server error:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // DELETE /api/mcp/servers/:name — remove
        this.app.delete('/api/mcp/servers/:name', async (req, res) => {
            try {
                const { name } = req.params;
                const mgr = await getMCPManager();
                await mgr.removeServer(name);
                console.log(`[MCP] Removed server: ${name}`);
                return res.json({ success: true });
            } catch (e) {
                console.error('[MCP] Remove server error:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // POST /api/mcp/servers/:name/toggle — enable/disable
        this.app.post('/api/mcp/servers/:name/toggle', async (req, res) => {
            try {
                const { name } = req.params;
                const { enabled } = req.body;
                const mgr   = await getMCPManager();
                const entry = await mgr.toggleServer(name, Boolean(enabled));
                return res.json({ success: true, server: entry });
            } catch (e) {
                console.error('[MCP] Toggle server error:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // GET /api/mcp/servers/:name/tools — list tools
        this.app.get('/api/mcp/servers/:name/tools', async (req, res) => {
            try {
                const { name } = req.params;
                const mgr   = await getMCPManager();
                const tools = await mgr.listTools(name);
                return res.json({ tools });
            } catch (e) {
                console.error('[MCP] List tools error:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        // POST /api/mcp/servers/:name/test — test connection
        this.app.post('/api/mcp/servers/:name/test', async (req, res) => {
            try {
                const { name } = req.params;
                const mgr    = await getMCPManager();
                const result = await mgr.testServer(name);
                return res.json(result);
            } catch (e) {
                console.error('[MCP] Test server error:', e);
                return res.status(500).json({ success: false, error: e.message });
            }
        });

        // GET /api/mcp/logs — recent call logs
        this.app.get('/api/mcp/logs', async (req, res) => {
            try {
                const limit = Math.min(Number(req.query.limit) || 100, 500);
                const mgr   = await getMCPManager();
                return res.json({ logs: mgr.getLogs(limit) });
            } catch (e) {
                console.error('[MCP] Get logs error:', e);
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.post('/api/system/reload', (req, res) => {
            console.log("🔄 [WebServer] Received reload request. Restarting system...");
            res.json({ success: true, message: "System is restarting with full re-initialization..." });

            if (typeof global.gracefulRestart === 'function') {
                setTimeout(() => {
                    global.gracefulRestart().catch(err => {
                        console.error("❌ [System] Reload error:", err);
                        process.exit(1);
                    });
                }, 1000);
            } else {
                console.warn("⚠️ [System] global.gracefulRestart not found, falling back to process.exit()");
                setTimeout(() => process.exit(0), 1000);
            }
        });

        this.app.post('/api/system/shutdown', (req, res) => {
            console.log("⛔ [WebServer] Received shutdown request. Stopping system...");
            res.json({ success: true, message: "System is shutting down... Please restart manually if needed." });

            // 呼叫全域關閉函式，執行完整的資源清理
            if (typeof global.fullShutdown === 'function') {
                setTimeout(() => {
                    global.fullShutdown().catch(err => {
                        console.error("❌ [System] Shutdown error:", err);
                        process.exit(1);
                    });
                }, 1000);
            } else {
                console.warn("⚠️ [System] global.fullShutdown not found, falling back to process.exit()");
                setTimeout(() => process.exit(0), 1000);
            }
        });


        // --- Health Check Endpoint ---
        this.app.get('/api/health', (req, res) => {
            const pkg = (() => { try { return require('../package.json'); } catch { return { version: 'unknown' }; } })();
            res.json({
                status: 'ok',
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                brain: { connected: !!(this.brain && this.brain.page) },
                skills: this.brain?.skillManager?.getLoadedSkills?.()?.length || 0,
                version: pkg.version,
                timestamp: new Date().toISOString()
            });
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
        });

        // Start Server
        this.server.listen(this.port, '0.0.0.0', () => {
            const displayPort = process.env.DASHBOARD_DEV_MODE === 'true' ? 3000 : this.port;
            const url = `http://localhost:${displayPort}/dashboard`;
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
