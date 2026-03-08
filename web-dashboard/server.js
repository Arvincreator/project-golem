const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');

class WebServer {
    constructor(dashboard) {
        this.dashboard = dashboard; // Reference to main dashboard if needed for initial state
        this.app = express();
        this.app.use(express.json({ limit: '1mb' })); // Limit body size
        
        // Security headers
        this.app.use((req, res, next) => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('X-XSS-Protection', '1; mode=block');
            next();
        });

        // Simple rate limiter (per IP, 100 req/min)
        this._rateLimits = new Map();
        this.app.use((req, res, next) => {
            const ip = req.ip || req.connection.remoteAddress;
            const now = Date.now();
            const limit = this._rateLimits.get(ip) || { count: 0, resetAt: now + 60000 };
            if (now > limit.resetAt) { limit.count = 0; limit.resetAt = now + 60000; }
            limit.count++;
            this._rateLimits.set(ip, limit);
            if (limit.count > 100) { return res.status(429).json({ error: 'Too many requests' }); }
            next();
        }); // Enable JSON body parsing
        this.server = http.createServer(this.app);
        this.io = new Server(this.server, {
            cors: {
                origin: [process.env.DASHBOARD_ORIGIN || "http://localhost:3000", "http://127.0.0.1:3000"], // Allow Next.js dev server
                methods: ["GET", "POST"]
            }
        });
        this.port = process.env.DASHBOARD_PORT || 3000;

        this.brain = null;
        this.memory = null;

        this.init();
        this.logBuffer = []; // Store last 200 logs
    }

    setContext(brain, memory) {
        this.brain = brain;
        this.memory = memory;
        console.log("🔗 [WebServer] Context linked: Brain & Memory");
    }

    init() {
        // Serve static files
        const publicPath = path.join(__dirname, 'out');
        this.app.use(express.static(publicPath));

        // Fix Next.js static export routing
        this.app.get('/', (req, res) => {
            res.redirect('/dashboard');
        });
        this.app.get('/dashboard', (req, res) => {
            res.sendFile(path.join(publicPath, 'dashboard.html'));
        });
        this.app.get('/dashboard/agents', (req, res) => {
            res.sendFile(path.join(publicPath, 'dashboard', 'agents.html'));
        });
        this.app.get('/dashboard/office', (req, res) => {
            res.sendFile(path.join(publicPath, 'dashboard', 'office.html'));
        });


        // --- API Routes ---
        this.app.get('/api/memory', async (req, res) => {
            if (!this.memory) return res.status(503).json({ error: "Memory not engaged" });
            try {
                // If using Qmd/Native, we might need a way to list all. 
                // For now, let's assume valid search or exposed method.
                // If ExperienceMemory (JSON based):
                if (this.memory.data) return res.json(this.memory.data);

                // If SystemNativeDriver or Qmd, we need a implementation to "list all" or search empty
                const results = await this.memory.recall("");
                return res.json(results);
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.post('/api/memory', async (req, res) => {
            if (!this.memory) return res.status(503).json({ error: "Memory not engaged" });
            try {
                const { text, metadata } = req.body;
                if (!text || typeof text !== 'string' || text.length > 10000) {
                    return res.status(400).json({ error: 'Invalid text (max 10000 chars)' });
                }
                await this.memory.memorize(text, metadata || {});
                this.io.emit('memory_update', { action: 'add', text, metadata });
                return res.json({ success: true });
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.get('/api/agent/logs', (req, res) => {
            if (!this.brain || !this.brain.chatLogFile) return res.json([]);
            try {
                if (!fs.existsSync(this.brain.chatLogFile)) return res.json([]);
                const content = fs.readFileSync(this.brain.chatLogFile, 'utf8');
                const logs = content.trim().split('\n').map(line => {
                    try { return JSON.parse(line); } catch (e) { return null; }
                }).filter(x => x);

                // Return last 1000 logs (approx 1 day of heavy usage)
                // Mask potential secrets in logs
                const masked = logs.slice(-1000).map(log => {
                    if (log.content) log.content = log.content.replace(/(?:AIza|sk-|ghp_|gho_|Bearers+)[A-Za-z0-9_-]{10,}/g, '[REDACTED]');
                    if (log.response) log.response = log.response.replace(/(?:AIza|sk-|ghp_|gho_|Bearers+)[A-Za-z0-9_-]{10,}/g, '[REDACTED]');
                    return log;
                });
                return res.json(masked);
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }
        });

        this.app.post('/api/system/reload', (req, res) => {
            console.log("🔄 [WebServer] Received reload request. Restarting system...");
            res.json({ success: true, message: "System is restarting..." });

            // Small delay to ensure the response is sent before the process exits
            setTimeout(() => {
                const { spawn } = require('child_process');
                const subprocess = spawn(process.argv[0], process.argv.slice(1), {
                    detached: true,
                    stdio: 'ignore'
                });
                subprocess.unref();
                process.exit(0);
            }, 1000);
        });

        // Socket.io connection handler
        this.io.on('connection', (socket) => {
            // Send initial state upon connection
            if (this.dashboard) {
                socket.emit('init', {
                    queueCount: this.dashboard.queueCount,
                    lastSchedule: this.dashboard.lastSchedule,
                    uptime: process.uptime(),
                    logs: this.logBuffer // Send buffered logs
                });
            } else {
                socket.emit('init', {
                    queueCount: 0,
                    lastSchedule: 'N/A',
                    uptime: process.uptime(),
                    logs: this.logBuffer
                });
            }

            // Allow client to manually request logs (for page navigation)
            socket.on('request_logs', () => {
                socket.emit('init', { logs: this.logBuffer });
            });
        });

        // Start Server
        this.server.listen(this.port, () => {
            const url = `http://localhost:${this.port}/dashboard`;
            console.log(`🚀 [WebServer] Dashboard running at ${url}`);

            // Auto-open browser (MacOS 'open', Windows 'start', Linux 'xdg-open')
            const startCmd = process.platform == 'darwin' ? 'open' : process.platform == 'win32' ? 'start' : 'xdg-open';
            const { exec } = require('child_process');
            exec(`${startCmd} ${url}`);
        });
    }

    broadcastLog(data) {
        // Add to buffer
        this.logBuffer.push(data);
        if (this.logBuffer.length > 200) {
            this.logBuffer.shift();
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
