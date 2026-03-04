const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');

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

        this.io = new Server(this.server, {
            cors: {
                origin: "*", // Allow Next.js dev server
                methods: ["GET", "POST"]
            }
        });
        this.port = process.env.DASHBOARD_PORT || 3000;

        this.contexts = new Map();

        this.init();
        this.logBuffer = []; // Store last 200 logs
    }

    setContext(golemId, brain, memory) {
        this.contexts.set(golemId, { brain, memory });
        console.log(`🔗 [WebServer] Context linked: Brain & Memory for Golem [${golemId}]`);
    }

    init() {
        // Serve static files with .html extension support
        const publicPath = path.join(__dirname, 'out');
        this.app.use(express.static(publicPath, { extensions: ['html'] }));

        // Fix Next.js static export routing
        this.app.get('/', (req, res) => {
            res.redirect('/dashboard');
        });

        // Ensure /dashboard and sub-routes are handled for SPA
        const dashboardRoutes = ['/dashboard', '/dashboard/terminal', '/dashboard/agents', '/dashboard/office'];
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
            res.sendFile(path.join(publicPath, 'dashboard.html'));
        });


        // --- API Routes ---
        this.app.get('/api/skills', async (req, res) => {
            try {
                const libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
                if (!fs.existsSync(libPath)) return res.json([]);

                const files = fs.readdirSync(libPath).filter(f => f.endsWith('.md'));

                const ALL_OPTIONAL_SKILLS = ['git.md', 'image-prompt.md', 'moltbot.md', 'spotify.md', 'youtube.md'];
                const optionalSkillsConfig = process.env.OPTIONAL_SKILLS || '';
                const enabledOptionalSkills = optionalSkillsConfig.split(',').map(s => s.trim().toLowerCase()).filter(s => s !== '');

                const skillsData = files.map(file => {
                    const content = fs.readFileSync(path.join(libPath, file), 'utf8');
                    const isOptional = ALL_OPTIONAL_SKILLS.includes(file);
                    const baseName = file.replace('.md', '').toLowerCase();
                    const isEnabled = !isOptional || enabledOptionalSkills.includes(baseName);

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

                const ALL_OPTIONAL_SKILLS = ['git', 'image-prompt', 'moltbot', 'spotify', 'youtube'];
                if (!ALL_OPTIONAL_SKILLS.includes(id)) {
                    return res.status(400).json({ error: "Cannot toggle core system skills" });
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
                const envPath = path.resolve(process.cwd(), '../.env'); // web-dashboard is in a subfolder
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

                return res.json({ success: true, enabled, skillsStr: newSkillsStr });
            } catch (e) {
                console.error("Failed to toggle skill:", e);
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

        this.app.get('/api/golems', (req, res) => {
            return res.json({ golems: Array.from(this.contexts.keys()) });
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
                    logs: this.logBuffer, // Send buffered logs
                    golems: Array.from(this.contexts.keys()) // Send active golems
                });
            } else {
                socket.emit('init', {
                    queueCount: 0,
                    lastSchedule: 'N/A',
                    uptime: process.uptime(),
                    logs: this.logBuffer,
                    golems: Array.from(this.contexts.keys())
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
