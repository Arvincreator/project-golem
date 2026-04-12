const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { getLocalIp } = require('../../src/utils/HttpUtils');
const { resolveEnabledSkills } = require('../../src/skills/skillsConfig');
const { buildOperationGuard, auditSecurityEvent } = require('../server/security');
const { resolveActiveContext } = require('./utils/context');
const { URLS } = require('../../src/core/constants');

function normalizeMemoryMode(modeRaw) {
    const mode = String(modeRaw || '').trim().toLowerCase();
    if (!mode) return 'lancedb-pro';

    if (mode === 'lancedb' || mode === 'lancedb-pro' || mode === 'lancedb_legacy' || mode === 'lancedb-legacy') {
        return 'lancedb-pro';
    }

    if (mode === 'native' || mode === 'system') {
        return 'native';
    }

    return 'lancedb-pro';
}

function normalizeBackend(backendRaw) {
    const backend = String(backendRaw || '').trim().toLowerCase();
    if (backend === 'gemini' || backend === 'ollama' || backend === 'perplexity') {
        return backend;
    }
    return 'gemini';
}

function normalizeEmbeddingProvider(providerRaw) {
    const provider = String(providerRaw || '').trim().toLowerCase();
    if (provider === 'local' || provider === 'ollama') {
        return provider;
    }
    return 'local';
}

function parseBooleanFlag(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'new'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function isPlaywrightHeadlessEnabled() {
    return parseBooleanFlag(process.env.PLAYWRIGHT_HEADLESS, false);
}

function getProfileMeta(configManager, brain) {
    const profileName = String(configManager.CONFIG.PLAYWRIGHT_PROFILE || '').trim() || 'default';
    const userDataDir = String((brain && brain.userDataDir) || configManager.MEMORY_BASE_DIR || '').trim();
    return { profileName, userDataDir };
}

function getPrimaryGeminiUrl(configManager) {
    const urls = Array.isArray(configManager.CONFIG.GEMINI_URLS)
        ? configManager.CONFIG.GEMINI_URLS.filter((url) => typeof url === 'string' && url.trim() !== '')
        : [];
    return urls[0] || URLS.GEMINI_APP;
}

async function ensureGeminiBrain(server) {
    const ConfigManager = require('../../src/config/index');

    let { golemId, context } = resolveActiveContext(server, 'golem_A');

    if ((!context || !context.brain) && typeof server.golemFactory === 'function') {
        const golemConfig = ConfigManager.GOLEMS_CONFIG.find((cfg) => cfg.id === 'golem_A')
            || ConfigManager.GOLEMS_CONFIG[0]
            || {
                id: 'golem_A',
                tgToken: ConfigManager.CONFIG.TG_TOKEN,
                dcToken: ConfigManager.CONFIG.DC_TOKEN,
                tgAuthMode: ConfigManager.CONFIG.TG_AUTH_MODE,
                adminId: ConfigManager.CONFIG.ADMIN_ID,
                chatId: ConfigManager.CONFIG.TG_CHAT_ID
            };

        await server.golemFactory(golemConfig);
        ({ golemId, context } = resolveActiveContext(server, golemConfig.id || 'golem_A'));
    }

    if (!context || !context.brain) {
        throw new Error('找不到可用的 Golem 實體。請先完成系統初始化。');
    }

    const backend = normalizeBackend((ConfigManager.CONFIG && ConfigManager.CONFIG.GOLEM_BACKEND) || context.brain.backend || 'gemini');
    return {
        golemId: golemId || context.brain.golemId || 'golem_A',
        brain: context.brain,
        backend,
        configManager: ConfigManager
    };
}

async function navigateGeminiPage(brain, configManager) {
    if (!brain.context || !brain.page || !brain.isInitialized) {
        // [Fix] 確保在登入狀態檢查、手動開啟視窗時，不會因為觸發 init() 而自動注入對話
        await brain.init(false, true);
    }
    if (typeof brain._navigateToTarget === 'function') {
        await brain._navigateToTarget('gemini');
        return;
    }
    const targetUrl = getPrimaryGeminiUrl(configManager);
    await brain.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
}

async function detectGeminiLoginState(brain) {
    if (!brain || !brain.page || !brain.context) {
        throw new Error('Gemini 頁面尚未啟動。');
    }

    let pageUrl = '';
    try { pageUrl = brain.page.url(); } catch { }

    let cookies = [];
    try {
        cookies = await brain.context.cookies(['https://gemini.google.com', 'https://accounts.google.com']);
    } catch { }

    const AUTH_COOKIE_NAMES = new Set([
        'SID',
        'HSID',
        'SSID',
        'APISID',
        'SAPISID',
        '__Secure-1PSID',
        '__Secure-3PSID'
    ]);

    const hasGoogleAuthCookie = cookies.some((cookie) => AUTH_COOKIE_NAMES.has(cookie.name));

    const domSignal = { hasSignInUi: false, hasPromptInput: false, title: '' };
    try {
        const result = await brain.page.evaluate(() => {
            const bodyText = String(document.body && document.body.innerText ? document.body.innerText : '').toLowerCase();
            const loginKeywords = [
                'sign in',
                'log in',
                '登入',
                '繼續使用 google 帳戶',
                'continue with google'
            ];
            const hasSignInUi = loginKeywords.some((keyword) => bodyText.includes(keyword.toLowerCase()));
            const hasPromptInput = Boolean(
                document.querySelector('textarea')
                || document.querySelector('div[contenteditable="true"][role="textbox"]')
                || document.querySelector('rich-textarea')
            );
            return {
                hasSignInUi,
                hasPromptInput,
                title: String(document.title || '')
            };
        });
        domSignal.hasSignInUi = Boolean(result.hasSignInUi);
        domSignal.hasPromptInput = Boolean(result.hasPromptInput);
        domSignal.title = String(result.title || '');
    } catch { }

    const redirectedToLogin = /accounts\.google\.com|servicelogin|\/signin/i.test(pageUrl);
    const isLoggedIn = domSignal.hasPromptInput || (hasGoogleAuthCookie && !redirectedToLogin && !domSignal.hasSignInUi);
    const detectionReason = isLoggedIn
        ? (domSignal.hasPromptInput ? 'prompt_input_visible' : 'google_auth_cookie_detected')
        : (redirectedToLogin ? 'redirected_to_google_login' : domSignal.hasSignInUi ? 'login_ui_detected' : 'no_auth_signal');

    return {
        isLoggedIn,
        detectionReason,
        pageUrl,
        pageTitle: domSignal.title,
        cookieCount: cookies.length
    };
}

async function focusGeminiWindow(brain) {
    const focusInfo = {
        pageBroughtToFront: false,
        osWindowActivated: false,
        osMethod: 'none',
        warning: ''
    };

    if (brain && brain.page && typeof brain.page.bringToFront === 'function') {
        try {
            await brain.page.bringToFront();
            focusInfo.pageBroughtToFront = true;
        } catch (e) {
            focusInfo.warning = e.message || String(e);
        }
    }

    if (process.platform === 'darwin') {
        try {
            execSync("osascript -e 'tell application \"Google Chrome\" to activate' -e 'tell application \"Google Chrome\" to set index of front window to 1'", { stdio: 'pipe' });
            focusInfo.osWindowActivated = true;
            focusInfo.osMethod = 'osascript:google_chrome';
        } catch (firstError) {
            try {
                execSync("osascript -e 'tell application \"Google Chrome for Testing\" to activate' -e 'tell application \"Google Chrome for Testing\" to set index of front window to 1'", { stdio: 'pipe' });
                focusInfo.osWindowActivated = true;
                focusInfo.osMethod = 'osascript:chrome_for_testing';
            } catch (secondError) {
                if (!focusInfo.warning) {
                    focusInfo.warning = secondError.message || firstError.message || 'activate_failed';
                }
            }
        }
    }

    return focusInfo;
}

module.exports = function registerSystemRoutes(server) {
    const router = express.Router();
    const requireUpdateExecute = buildOperationGuard(server, 'system_update_execute');
    const requireSystemConfigUpdate = buildOperationGuard(server, 'system_config_update');
    const requireRestart = buildOperationGuard(server, 'system_restart');
    const requireReload = buildOperationGuard(server, 'system_reload');
    const requireShutdown = buildOperationGuard(server, 'system_shutdown');
    const requireGeminiWindowControl = buildOperationGuard(server, 'gemini_window_control');

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

            try { runtime.npm = `v${execSync('npm -v').toString().trim()}`; } catch { }

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
            } catch {
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
            } catch { }

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

    router.get('/api/system/gemini-auth/status', async (req, res) => {
        try {
            const ConfigManager = require('../../src/config/index');
            const { golemId, context } = resolveActiveContext(server, 'golem_A');
            const brain = context ? context.brain : null;
            const configBackend = ConfigManager.CONFIG && ConfigManager.CONFIG.GOLEM_BACKEND;
            const backend = normalizeBackend(configBackend || (brain && brain.backend) || 'gemini');
            
            const profileMeta = getProfileMeta(ConfigManager, brain);
            const headlessMode = isPlaywrightHeadlessEnabled();

            if (backend !== 'gemini') {
                return res.json({
                    success: true,
                    golemId: golemId || 'golem_A',
                    backend,
                    ...profileMeta,
                    primaryUrl: getPrimaryGeminiUrl(ConfigManager),
                    headlessMode,
                    isLoggedIn: false,
                    checkedAt: new Date().toISOString(),
                    detectionReason: 'backend_not_gemini',
                    message: '目前核心引擎不是 Web Gemini。請先切換 GOLEM_BACKEND=gemini 並重啟系統。'
                });
            }

            // ⚠️ [Fix] 如果 GolemBrain 還沒啟動，就不該強制調用 ensureGeminiBrain/navigateGeminiPage，否則一進設定頁就會跳出 Chrome
            if (!brain || !brain.page || !brain.isInitialized) {
                return res.json({
                    success: true,
                    golemId: golemId || 'golem_A',
                    backend,
                    ...profileMeta,
                    primaryUrl: getPrimaryGeminiUrl(ConfigManager),
                    headlessMode,
                    isLoggedIn: false,
                    checkedAt: new Date().toISOString(),
                    detectionReason: 'browser_not_initialized',
                    message: 'Gemini 瀏覽器核心目前尚未啟動。您可以點擊下方按鈕手動開啟登入視窗。'
                });
            }

            const authState = await detectGeminiLoginState(brain);

            return res.json({
                success: true,
                golemId: golemId || 'golem_A',
                backend,
                ...profileMeta,
                primaryUrl: getPrimaryGeminiUrl(ConfigManager),
                headlessMode,
                checkedAt: new Date().toISOString(),
                ...authState,
                detectionReason: authState.detectionReason || 'passive_status_check',
            });
        } catch (e) {
            console.error('[WebServer] Failed to check Gemini auth status:', e);
            const statusCode = Number.isInteger(e.httpStatus) ? e.httpStatus : 500;
            return res.status(statusCode).json({ success: false, error: e.message });
        }
    });

    router.post('/api/system/gemini-auth/open', requireGeminiWindowControl, async (req, res) => {
        try {
            const { golemId, brain, backend, configManager } = await ensureGeminiBrain(server);
            const profileMeta = getProfileMeta(configManager, brain);
            const headlessMode = isPlaywrightHeadlessEnabled();

            if (backend !== 'gemini') {
                return res.status(409).json({
                    success: false,
                    golemId,
                    backend,
                    ...profileMeta,
                    headlessMode,
                    error: '目前核心引擎不是 Web Gemini，無法開啟登入視窗。請先切換 GOLEM_BACKEND=gemini。'
                });
            }

            if (headlessMode) {
                return res.status(409).json({
                    success: false,
                    golemId,
                    backend,
                    ...profileMeta,
                    headlessMode,
                    error: '目前 PLAYWRIGHT_HEADLESS=true，請先關閉無頭模式並重啟系統，才能看到 Gemini 登入視窗。'
                });
            }

            await navigateGeminiPage(brain, configManager);
            const focus = await focusGeminiWindow(brain);
            const authState = await detectGeminiLoginState(brain);

            return res.json({
                success: true,
                golemId,
                backend,
                ...profileMeta,
                primaryUrl: getPrimaryGeminiUrl(configManager),
                headlessMode,
                checkedAt: new Date().toISOString(),
                message: authState.isLoggedIn
                    ? '已開啟目前 Profile 的 Web Gemini，且目前看起來已登入。'
                    : '已開啟目前 Profile 的 Web Gemini，請在彈出的 Chrome 視窗完成登入後再按「確認」。',
                focus,
                ...authState
            });
        } catch (e) {
            console.error('[WebServer] Failed to open Gemini login window:', e);
            const statusCode = Number.isInteger(e.httpStatus) ? e.httpStatus : 500;
            return res.status(statusCode).json({ success: false, error: e.message });
        }
    });

    router.post('/api/system/gemini-auth/focus', requireGeminiWindowControl, async (req, res) => {
        try {
            const { golemId, brain, backend, configManager } = await ensureGeminiBrain(server);
            const profileMeta = getProfileMeta(configManager, brain);
            const headlessMode = isPlaywrightHeadlessEnabled();

            if (backend !== 'gemini') {
                return res.status(409).json({
                    success: false,
                    golemId,
                    backend,
                    ...profileMeta,
                    headlessMode,
                    error: '目前核心引擎不是 Web Gemini，無法置頂確認視窗。'
                });
            }

            if (headlessMode) {
                return res.status(409).json({
                    success: false,
                    golemId,
                    backend,
                    ...profileMeta,
                    headlessMode,
                    error: '目前 PLAYWRIGHT_HEADLESS=true，無法把 Gemini 視窗彈到最上層。'
                });
            }

            await navigateGeminiPage(brain, configManager);
            const focus = await focusGeminiWindow(brain);
            const authState = await detectGeminiLoginState(brain);

            return res.json({
                success: true,
                golemId,
                backend,
                ...profileMeta,
                primaryUrl: getPrimaryGeminiUrl(configManager),
                headlessMode,
                checkedAt: new Date().toISOString(),
                message: '已嘗試將目前 Profile 的 Gemini 視窗置頂，請直接肉眼確認登入狀態。',
                focus,
                ...authState
            });
        } catch (e) {
            console.error('[WebServer] Failed to focus Gemini window:', e);
            const statusCode = Number.isInteger(e.httpStatus) ? e.httpStatus : 500;
            return res.status(statusCode).json({ success: false, error: e.message });
        }
    });

    router.get('/api/system/config', (req, res) => {
        try {
            const EnvManager = require('../../src/utils/EnvManager');
            const envVars = EnvManager.readEnv();
            const rawMemoryMode = String(envVars.GOLEM_MEMORY_MODE || '').trim();

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
                golemBackend: normalizeBackend(envVars.GOLEM_BACKEND),
                golemMemoryMode: normalizeMemoryMode(rawMemoryMode),
                hasCustomMemoryMode: rawMemoryMode.length > 0,
                golemEmbeddingProvider: normalizeEmbeddingProvider(envVars.GOLEM_EMBEDDING_PROVIDER),
                golemLocalEmbeddingModel: envVars.GOLEM_LOCAL_EMBEDDING_MODEL || 'Xenova/bge-small-zh-v1.5',
                golemOllamaBaseUrl: envVars.GOLEM_OLLAMA_BASE_URL || envVars.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
                golemOllamaBrainModel: envVars.GOLEM_OLLAMA_BRAIN_MODEL || envVars.OLLAMA_BRAIN_MODEL || 'llama3.1:8b',
                golemOllamaEmbeddingModel: envVars.GOLEM_OLLAMA_EMBEDDING_MODEL || envVars.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
                golemOllamaRerankModel: envVars.GOLEM_OLLAMA_RERANK_MODEL || envVars.OLLAMA_RERANK_MODEL || '',
                golemOllamaTimeoutMs: envVars.GOLEM_OLLAMA_TIMEOUT_MS || envVars.OLLAMA_TIMEOUT_MS || '60000',
                golemMode: 'SINGLE',
                allowRemoteAccess: server.allowRemote,
                hasRemotePassword: !!(envVars.REMOTE_ACCESS_PASSWORD && envVars.REMOTE_ACCESS_PASSWORD.trim() !== '')
            });
        } catch (e) {
            console.error('[WebServer] Failed to get system config:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/system/config', requireSystemConfigUpdate, (req, res) => {
        try {
            const {
                geminiApiKeys,
                userDataDir,
                golemBackend,
                golemMemoryMode,
                golemEmbeddingProvider,
                golemLocalEmbeddingModel,
                golemOllamaBaseUrl,
                golemOllamaBrainModel,
                golemOllamaEmbeddingModel,
                golemOllamaRerankModel,
                golemOllamaTimeoutMs,
                allowRemoteAccess,
                remoteAccessPassword
            } = req.body;

            const EnvManager = require('../../src/utils/EnvManager');
            const ConfigManager = require('../../src/config/index');
            const updates = {};

            if (geminiApiKeys !== undefined) updates.GEMINI_API_KEYS = geminiApiKeys;
            if (userDataDir) updates.USER_DATA_DIR = userDataDir;
            if (golemBackend !== undefined) updates.GOLEM_BACKEND = normalizeBackend(golemBackend);
            if (golemMemoryMode !== undefined) updates.GOLEM_MEMORY_MODE = normalizeMemoryMode(golemMemoryMode);
            if (golemEmbeddingProvider !== undefined) updates.GOLEM_EMBEDDING_PROVIDER = normalizeEmbeddingProvider(golemEmbeddingProvider);
            if (golemLocalEmbeddingModel) updates.GOLEM_LOCAL_EMBEDDING_MODEL = golemLocalEmbeddingModel;
            if (golemOllamaBaseUrl !== undefined) updates.GOLEM_OLLAMA_BASE_URL = String(golemOllamaBaseUrl).trim();
            if (golemOllamaBrainModel !== undefined) updates.GOLEM_OLLAMA_BRAIN_MODEL = String(golemOllamaBrainModel).trim();
            if (golemOllamaEmbeddingModel !== undefined) updates.GOLEM_OLLAMA_EMBEDDING_MODEL = String(golemOllamaEmbeddingModel).trim();
            if (golemOllamaRerankModel !== undefined) updates.GOLEM_OLLAMA_RERANK_MODEL = String(golemOllamaRerankModel).trim();
            if (golemOllamaTimeoutMs !== undefined) updates.GOLEM_OLLAMA_TIMEOUT_MS = String(golemOllamaTimeoutMs).trim();
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
                auditSecurityEvent(server, 'login_skipped', req, { reason: 'no_remote_password_configured' });
                return res.json({ success: true, message: 'Authentication not required.' });
            }

            if (password === expectedPassword) {
                const token = server.createAuthSession(req);
                const isSecure = req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
                res.cookie('golem_auth_token', token, {
                    maxAge: server.authSessionTtlMs,
                    httpOnly: true,
                    sameSite: 'lax',
                    secure: !!isSecure,
                    path: '/',
                });
                auditSecurityEvent(server, 'login_success', req, { remote: server.requiresRemoteAuth(req) });
                return res.json({ success: true, message: 'Login successful.' });
            }

            auditSecurityEvent(server, 'login_failed', req, { reason: 'invalid_password' });
            return res.status(401).json({ success: false, message: '密碼錯誤 (Invalid password)' });
        } catch (e) {
            console.error('[WebServer] Login failed:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/system/logout', (req, res) => {
        try {
            const token = server.resolveAuthToken(req);
            server.invalidateAuthSession(token);
            res.clearCookie('golem_auth_token', { path: '/' });
            auditSecurityEvent(server, 'logout', req, {});
            return res.json({ success: true, message: 'Logged out' });
        } catch (e) {
            console.error('[WebServer] Logout failed:', e);
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

    router.post('/api/system/update/execute', requireUpdateExecute, async (req, res) => {
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

    router.post('/api/system/restart', requireRestart, (req, res) => {
        try {
            console.log('🔄 [System] Restart requested by user. Triggering hard restart...');
            res.json({ success: true, message: 'Restarting system... Full re-initialization in progress.' });

            if (typeof global.gracefulRestart === 'function') {
                setTimeout(() => {
                    global.gracefulRestart().catch((err) => {
                        console.error('❌ [System] Restart error:', err);
                    });
                }, 1000);
            } else {
                console.warn('⚠️ [System] global.gracefulRestart not found, skipping forced process exit');
            }
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/system/reload', requireReload, (req, res) => {
        console.log('🔄 [WebServer] Received reload request. Restarting system...');
        res.json({ success: true, message: 'System is restarting with full re-initialization...' });

        if (typeof global.gracefulRestart === 'function') {
            setTimeout(() => {
                global.gracefulRestart().catch((err) => {
                    console.error('❌ [System] Reload error:', err);
                });
            }, 1000);
        } else {
            console.warn('⚠️ [System] global.gracefulRestart not found, skipping forced process exit');
        }
    });

    router.post('/api/system/shutdown', requireShutdown, (req, res) => {
        console.log('⛔ [WebServer] Received shutdown request. Stopping system...');
        res.json({ success: true, message: 'System is shutting down... Please restart manually if needed.' });

        if (typeof global.fullShutdown === 'function') {
            setTimeout(() => {
                global.fullShutdown().catch((err) => {
                    console.error('❌ [System] Shutdown error:', err);
                });
            }, 1000);
        } else {
            console.warn('⚠️ [System] global.fullShutdown not found, skipping forced process exit');
        }
    });

    router.get('/api/system/security/events', (req, res) => {
        try {
            const limitRaw = Number(req.query.limit || 100);
            const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;
            const events = (server.securityEvents || []).slice(-limit);
            return res.json({ success: true, events });
        } catch (e) {
            return res.status(500).json({ error: e.message });
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
        } catch { }

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
