const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

async function requestJson(baseUrl, targetPath, init) {
    const response = await fetch(`${baseUrl}${targetPath}`, init);
    let body = null;
    try {
        body = await response.json();
    } catch {
        body = null;
    }
    return { status: response.status, body };
}

async function stopServer(httpServer) {
    if (!httpServer) return;
    await new Promise((resolve) => httpServer.close(resolve));
}

describe('System routes gemini auth open', () => {
    const originalCwd = process.cwd();
    let tempCwd = '';
    let httpServer = null;
    let baseUrl = '';

    beforeEach(async () => {
        jest.resetModules();
        jest.doMock('child_process', () => {
            const actual = jest.requireActual('child_process');
            return {
                ...actual,
                execSync: jest.fn(() => Buffer.from('')),
            };
        });
        delete process.env.PLAYWRIGHT_BROWSER_CHANNEL;
        tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'system-gemini-auth-open-'));
        process.chdir(tempCwd);

        fs.writeFileSync(path.join(tempCwd, '.env'), [
            'SYSTEM_CONFIGURED=true',
            'USER_DATA_DIR=./golem_memory',
            'GOLEM_MODE=SINGLE',
            'GOLEM_BACKEND=gemini',
        ].join('\n') + '\n', 'utf8');
    });

    afterEach(async () => {
        await stopServer(httpServer);
        httpServer = null;
        baseUrl = '';

        process.chdir(originalCwd);
        if (tempCwd) {
            fs.rmSync(tempCwd, { recursive: true, force: true });
            tempCwd = '';
        }
    });

    test('POST /api/system/gemini-auth/open navigates to Google login page', async () => {
        const registerSystemRoutes = require('../web-dashboard/routes/api.system');
        const { installSecurityContext } = require('../web-dashboard/server/security');

        const authPage = {
            goto: jest.fn().mockResolvedValue(undefined),
            bringToFront: jest.fn().mockResolvedValue(undefined),
            url: jest.fn(() => 'https://accounts.google.com/ServiceLogin'),
            evaluate: jest.fn().mockResolvedValue({
                hasSignInUi: true,
                hasPromptInput: false,
                title: 'Google Account Sign In',
            }),
        };

        const brain = {
            userDataDir: path.join(tempCwd, 'golem_memory'),
            backend: 'gemini',
            isInitialized: true,
            page: authPage,
            context: {
                pages: jest.fn(() => [authPage]),
                cookies: jest.fn().mockResolvedValue([]),
            },
            init: jest.fn().mockResolvedValue(undefined),
        };

        const serverContext = {
            app: express(),
            allowRemote: false,
            contexts: new Map([['golem_A', { brain }]]),
            golemFactory: async () => ({ brain }),
        };

        serverContext.app.use(express.json());
        installSecurityContext(serverContext);
        serverContext.app.use(registerSystemRoutes(serverContext));

        httpServer = http.createServer(serverContext.app);
        await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
        const address = httpServer.address();
        baseUrl = `http://127.0.0.1:${address.port}`;

        const { status } = await requestJson(baseUrl, '/api/system/gemini-auth/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        expect(status).toBe(200);
        expect(authPage.goto).toHaveBeenCalledTimes(1);
        const [targetUrl] = authPage.goto.mock.calls[0];
        expect(String(targetUrl)).toContain('accounts.google.com');

        const { execSync } = require('child_process');
        expect(execSync).toHaveBeenCalledTimes(1);
        const [command] = execSync.mock.calls[0];
        expect(String(command)).toContain('Google Chrome for Testing');
    });

    test('POST /api/system/gemini-auth/open uses auth-only bootstrap when context is absent', async () => {
        const registerSystemRoutes = require('../web-dashboard/routes/api.system');
        const { installSecurityContext } = require('../web-dashboard/server/security');

        const authPage = {
            goto: jest.fn().mockResolvedValue(undefined),
            bringToFront: jest.fn().mockResolvedValue(undefined),
            url: jest.fn(() => 'https://accounts.google.com/ServiceLogin'),
            evaluate: jest.fn().mockResolvedValue({
                hasSignInUi: true,
                hasPromptInput: false,
                title: 'Google Account Sign In',
            }),
        };

        const brain = {
            userDataDir: path.join(tempCwd, 'golem_memory'),
            backend: 'gemini',
            isInitialized: false,
            page: null,
            context: null,
            init: jest.fn().mockImplementation(async (_force, _skip, options) => {
                if (options && options.authOnly) {
                    brain.context = {
                        pages: jest.fn(() => [authPage]),
                        cookies: jest.fn().mockResolvedValue([]),
                    };
                    brain.page = authPage;
                }
            }),
        };

        const contexts = new Map();
        const golemFactory = jest.fn().mockImplementation(async (config) => {
            contexts.set('golem_A', { brain });
            return { brain };
        });

        const serverContext = {
            app: express(),
            allowRemote: false,
            contexts,
            golemFactory,
        };

        serverContext.app.use(express.json());
        installSecurityContext(serverContext);
        serverContext.app.use(registerSystemRoutes(serverContext));

        httpServer = http.createServer(serverContext.app);
        await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
        const address = httpServer.address();
        baseUrl = `http://127.0.0.1:${address.port}`;

        const { status } = await requestJson(baseUrl, '/api/system/gemini-auth/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        expect(status).toBe(200);
        expect(golemFactory).toHaveBeenCalledTimes(1);
        expect(golemFactory.mock.calls[0][0]).toEqual(expect.objectContaining({
            __authOnlyBootstrap: true,
        }));
        expect(brain.init).toHaveBeenCalledWith(false, true, expect.objectContaining({
            navigationTarget: 'none',
            authOnly: true,
        }));
    });

    test('POST /api/system/gemini-auth/open uses Google Chrome app when PLAYWRIGHT_BROWSER_CHANNEL=chrome', async () => {
        process.env.PLAYWRIGHT_BROWSER_CHANNEL = 'chrome';

        const registerSystemRoutes = require('../web-dashboard/routes/api.system');
        const { installSecurityContext } = require('../web-dashboard/server/security');

        const authPage = {
            goto: jest.fn().mockResolvedValue(undefined),
            bringToFront: jest.fn().mockResolvedValue(undefined),
            url: jest.fn(() => 'https://accounts.google.com/ServiceLogin'),
            evaluate: jest.fn().mockResolvedValue({
                hasSignInUi: true,
                hasPromptInput: false,
                title: 'Google Account Sign In',
            }),
        };

        const brain = {
            userDataDir: path.join(tempCwd, 'golem_memory'),
            backend: 'gemini',
            isInitialized: true,
            page: authPage,
            context: {
                pages: jest.fn(() => [authPage]),
                cookies: jest.fn().mockResolvedValue([]),
            },
            init: jest.fn().mockResolvedValue(undefined),
        };

        const serverContext = {
            app: express(),
            allowRemote: false,
            contexts: new Map([['golem_A', { brain }]]),
            golemFactory: async () => ({ brain }),
        };

        serverContext.app.use(express.json());
        installSecurityContext(serverContext);
        serverContext.app.use(registerSystemRoutes(serverContext));

        httpServer = http.createServer(serverContext.app);
        await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
        const address = httpServer.address();
        baseUrl = `http://127.0.0.1:${address.port}`;

        const { status } = await requestJson(baseUrl, '/api/system/gemini-auth/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        expect(status).toBe(200);
        const { execSync } = require('child_process');
        expect(execSync).toHaveBeenCalledTimes(1);
        const [command] = execSync.mock.calls[0];
        expect(String(command)).toContain('Google Chrome');
        expect(String(command)).not.toContain('Google Chrome for Testing');
    });
});
