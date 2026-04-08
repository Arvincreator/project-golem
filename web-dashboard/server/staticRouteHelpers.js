const fs = require('fs');
const path = require('path');

function hasDashboardBuild(publicPath, existsSync = fs.existsSync) {
    return existsSync(path.join(publicPath, 'dashboard.html'));
}

function resolveDashboardHtmlPath(publicPath, reqPath, existsSync = fs.existsSync) {
    const normalizedPath = String(reqPath || '/dashboard').replace(/\/$/, '') || '/dashboard';
    const htmlFileName = normalizedPath === '/dashboard'
        ? 'dashboard.html'
        : `${normalizedPath.replace(/^\//, '')}.html`;
    const fullPath = path.join(publicPath, htmlFileName);
    if (existsSync(fullPath)) return fullPath;

    const fallback = path.join(publicPath, 'dashboard.html');
    if (existsSync(fallback)) return fallback;
    return null;
}

function buildDashboardUnavailablePage(publicPath) {
    const escapedPath = String(publicPath || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `
        <body style="background:#0a0a0a; color:#eee; font-family:sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0;">
            <h1 style="color:#ffcc66;">⚠️ Dashboard Static Files Missing</h1>
            <p>Golem backend is running, but Dashboard build artifacts were not found.</p>
            <p style="color:#aaa;">Expected file: <code>${escapedPath}/dashboard.html</code></p>
            <div style="background:#1a1a1a; padding:16px; border-radius:12px; border:1px solid #333; max-width:760px;">
                <p>Fix options:</p>
                <ol>
                    <li>Run <code>./setup.sh --install --components core,dashboard</code> to rebuild Dashboard.</li>
                    <li>Or disable dashboard startup: <code>GOLEM_DASHBOARD_ENABLED=false</code>.</li>
                </ol>
            </div>
        </body>
    `;
}

module.exports = {
    hasDashboardBuild,
    resolveDashboardHtmlPath,
    buildDashboardUnavailablePage,
};
