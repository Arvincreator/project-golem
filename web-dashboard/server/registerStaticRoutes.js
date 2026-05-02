const express = require('express');
const fs = require('fs');
const path = require('path');

module.exports = function registerStaticRoutes(server) {
    const projectRoot = path.resolve(__dirname, '../..');
    const uploadDir = path.join(projectRoot, 'data', 'temp_uploads');
    const rpgPublicPath = path.join(__dirname, '..', 'public', 'rpg');

    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    server.app.use('/api/files', express.static(uploadDir));
    server.app.use('/rpg', express.static(rpgPublicPath, {
        extensions: ['html'],
        setHeaders: (res) => {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        }
    }));

    server.app.get('/api/files-debug', (req, res) => {
        if (fs.existsSync(uploadDir)) {
            const files = fs.readdirSync(uploadDir);
            return res.json({ uploadDir, files });
        }
        return res.status(404).json({ error: 'Upload directory not found', path: uploadDir });
    });

    const isDevMode = process.env.DASHBOARD_DEV_MODE === 'true';
    const publicPath = path.join(__dirname, '..', 'out');

    function sendDashboardFile(res, preferredPath) {
        const fallbackPath = path.join(publicPath, 'dashboard.html');
        if (preferredPath && fs.existsSync(preferredPath)) {
            return res.sendFile(preferredPath);
        }
        if (fs.existsSync(fallbackPath)) {
            return res.sendFile(fallbackPath);
        }

        return res.status(503).send(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dashboard 尚未建置</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b1117; color: #e5edf5; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(680px, calc(100vw - 32px)); border: 1px solid rgba(148, 163, 184, .28); border-radius: 12px; padding: 28px; background: rgba(15, 23, 42, .72); box-shadow: 0 24px 80px rgba(0, 0, 0, .32); }
    h1 { margin: 0 0 12px; font-size: 24px; }
    p { color: #9ca3af; line-height: 1.7; }
    code { display: inline-block; margin-top: 8px; padding: 4px 8px; border-radius: 6px; background: #020617; color: #67e8f9; }
  </style>
</head>
<body>
  <main>
    <h1>Dashboard 尚未建置</h1>
    <p>找不到 <code>web-dashboard/out/dashboard.html</code>。請先完成 Dashboard 建置，或用開發模式啟動。</p>
    <p><code>cd web-dashboard && npm install && npm run build</code></p>
  </main>
</body>
</html>`);
    }

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

    server.app.get('/dashboard/rpg', (req, res) => {
        res.status(200).send(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Golem Text RPG</title>
  <style>
    html, body { width: 100%; height: 100%; margin: 0; background: #0a0a0a; overflow: hidden; }
    .bar { height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; box-sizing: border-box; color: #e5e7eb; background: #111827; border-bottom: 1px solid #263244; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .bar a { color: #93c5fd; text-decoration: none; font-size: 13px; }
    iframe { width: 100%; height: calc(100% - 44px); border: 0; background: #000; }
  </style>
</head>
<body>
  <div class="bar">
    <strong>文字 RPG</strong>
    <a href="/rpg/index.html" target="_blank" rel="noreferrer">新視窗開啟</a>
  </div>
  <iframe title="Golem Text RPG" src="/rpg/index.html" allow="clipboard-read; clipboard-write"></iframe>
</body>
</html>`);
    });

    const dashboardRoutes = [
        '/dashboard',
        '/dashboard/terminal',
        '/dashboard/agents',
        '/dashboard/chat',
        '/dashboard/diary',
        '/dashboard/memory',
        '/dashboard/office',
        '/dashboard/mcp',
        '/dashboard/persona',
        '/dashboard/prompt-pool',
        '/dashboard/prompt-trends',
        '/dashboard/settings',
        '/dashboard/setup',
        '/dashboard/skills',
        '/dashboard/stocks',
        '/dashboard/system-setup'
    ];

    server.app.get(/\/dashboard.*/, (req, res, next) => {
        const normalizedPath = req.path.replace(/\/$/, '');
        if (
            normalizedPath === '/dashboard/system-setup' ||
            normalizedPath === '/dashboard/system-setup.html' ||
            normalizedPath === '/dashboard/login' ||
            normalizedPath === '/dashboard/login.html' ||
            req.path.startsWith('/api/')
        ) {
            return next();
        }

        if (server.requiresRemoteAuth(req) && !server.isAuthenticatedRequest(req)) {
            const clientIp = req.clientIp || req.ip || req.connection.remoteAddress || '';
            console.log(`🔒 [WebServer] Blocked unauthorized remote access to ${req.path} from IP: ${clientIp}`);
            return res.redirect('/dashboard/login');
        }

        try {
            const isConfigured = process.env.SYSTEM_CONFIGURED === 'true';
            if (!isConfigured) {
                console.log(`🚩 [WebServer] System NOT initialized. Redirecting ${req.path} to /dashboard/system-setup.html`);
                return res.redirect('/dashboard/system-setup.html');
            }
        } catch (e) {
            console.error('Failed to check config during redirect:', e.message);
        }
        return next();
    });

    dashboardRoutes.forEach((route) => {
        server.app.get(route, (req, res) => {
            const htmlPath = route === '/dashboard' ? '/dashboard.html' : `${route}.html`;
            return res.redirect(htmlPath);
        });
    });

    server.app.get(/\/dashboard\/.*/, (req, res) => {
        const normalizedPath = req.path.replace(/\/$/, '');
        const htmlPath = normalizedPath.endsWith('.html')
            ? normalizedPath
            : `${normalizedPath}.html`;

        return res.redirect(htmlPath);
    });
};
