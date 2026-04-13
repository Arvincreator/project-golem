const express = require('express');
const fs = require('fs');
const path = require('path');

module.exports = function registerStaticRoutes(server) {
    const projectRoot = path.resolve(__dirname, '../..');
    const uploadDir = path.join(projectRoot, 'data', 'temp_uploads');

    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    server.app.use('/api/files', express.static(uploadDir));

    server.app.get('/api/files-debug', (req, res) => {
        if (fs.existsSync(uploadDir)) {
            const files = fs.readdirSync(uploadDir);
            return res.json({ uploadDir, files });
        }
        return res.status(404).json({ error: 'Upload directory not found', path: uploadDir });
    });

    const isDevMode = process.env.DASHBOARD_DEV_MODE === 'true';
    const publicPath = path.join(__dirname, '..', 'out');

    if (!isDevMode) {
        server.app.use(express.static(publicPath, {
            extensions: ['html'],
            setHeaders: (res) => {
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            }
        }));
    } else {
        console.log('🚧 [WebServer] Dashboard Dev Mode active — skipping static file serving.');

        server.app.get('/', (req, res) => {
            res.status(200).send(`
                <body style="background:#0a0a0a; color:#eee; font-family:sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0;">
                    <h1 style="color:#0096ff;">🚧 Golem Backend is Running (Dev Mode)</h1>
                    <p>This is the <b>Backend API</b> port (${server.port}).</p>
                    <div style="background:#1a1a1a; padding:20px; border-radius:12px; border:1px solid #333; text-align:center;">
                        <p>To access the Dashboard UI with Hot Reloading, please go to:</p>
                        <a href="http://localhost:3000" style="color:#00ff9d; font-size:24px; text-decoration:none; font-weight:bold;">http://localhost:3000</a>
                        <p style="font-size:12px; color:#666; margin-top:20px;">Make sure you have run: <code>cd web-dashboard && npm run dev</code></p>
                    </div>
                </body>
            `);
        });
    }

    if (isDevMode) return;

    server.app.get('/', (req, res) => {
        res.redirect('/dashboard');
    });

    const dashboardRoutes = [
        '/dashboard',
        '/dashboard/terminal',
        '/dashboard/agents',
        '/dashboard/office',
        '/dashboard/mcp',
        '/dashboard/system-setup'
    ];

    server.app.get(/\/dashboard.*/, (req, res, next) => {
        const normalizedPath = req.path.replace(/\/$/, '');
        if (normalizedPath === '/dashboard/system-setup' || normalizedPath === '/dashboard/login' || req.path.startsWith('/api/')) {
            return next();
        }

        if (server.requiresRemoteAuth(req) && !server.isAuthenticatedRequest(req)) {
            const clientIp = req.clientIp || req.ip || req.connection.remoteAddress || '';
            console.log(`🔒 [WebServer] Blocked unauthorized remote access to ${req.path} from IP: ${clientIp}`);
            return res.redirect('/dashboard/login');
        }

        try {
            const EnvManager = require('../../src/utils/EnvManager');
            const envVars = EnvManager.readEnv();
            const isConfigured = envVars.SYSTEM_CONFIGURED === 'true';
            if (!isConfigured) {
                console.log(`🚩 [WebServer] System NOT initialized. Redirecting ${req.path} to /dashboard/system-setup`);
                return res.redirect('/dashboard/system-setup');
            }
        } catch (e) {
            console.error('Failed to check config during redirect:', e.message);
        }
        return next();
    });

    dashboardRoutes.forEach((route) => {
        server.app.get(route, (req, res) => {
            const fileName = route === '/dashboard' ? 'dashboard.html' : `${route.replace(/^\//, '')}.html`;
            const fullPath = path.join(publicPath, fileName);
            if (fs.existsSync(fullPath)) {
                return res.sendFile(fullPath);
            }
            return res.sendFile(path.join(publicPath, 'dashboard.html'));
        });
    });

    server.app.get(/\/dashboard\/.*/, (req, res) => {
        const normalizedPath = req.path.replace(/\/$/, '');
        const htmlFileName = `${normalizedPath.replace(/^\//, '')}.html`;
        const fullPath = path.join(publicPath, htmlFileName);

        if (fs.existsSync(fullPath)) {
            return res.sendFile(fullPath);
        }
        return res.sendFile(path.join(publicPath, 'dashboard.html'));
    });
};
