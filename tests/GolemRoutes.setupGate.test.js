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

async function startServer(registerGolemRoutes, installSecurityContext, contexts, golemFactory) {
    const app = express();
    app.use(express.json());

    const serverContext = {
        app,
        allowRemote: false,
        contexts: contexts || new Map(),
        golemFactory,
    };
    installSecurityContext(serverContext);
    app.use(registerGolemRoutes(serverContext));

    const httpServer = http.createServer(app);
    await new Promise((resolve) => {
        httpServer.listen(0, '127.0.0.1', resolve);
    });

    const address = httpServer.address();
    return {
        httpServer,
        baseUrl: `http://127.0.0.1:${address.port}`,
        serverContext,
    };
}

async function stopServer(httpServer) {
    if (!httpServer) return;
    await new Promise((resolve) => {
        httpServer.close(() => resolve());
    });
}

function writeEnvFile(tempCwd, values = {}) {
    const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`);
    fs.writeFileSync(path.join(tempCwd, '.env'), `${lines.join('\n')}\n`, 'utf8');
}

describe('Golem setup/start setup-first gates', () => {
    const originalCwd = process.cwd();
    let tempCwd = '';
    let httpServer = null;
    let baseUrl = '';
    let warnSpy = null;

    beforeEach(async () => {
        tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'golem-setup-gate-'));
        process.chdir(tempCwd);
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });

        delete process.env.SYSTEM_OP_TOKEN;
        delete process.env.REMOTE_ACCESS_PASSWORD;
        delete process.env.SYSTEM_CONFIGURED;
        delete process.env.USER_DATA_DIR;
        delete process.env.TELEGRAM_TOKEN;
        delete process.env.DISCORD_TOKEN;

        writeEnvFile(tempCwd, {
            SYSTEM_CONFIGURED: 'false',
            USER_DATA_DIR: './golem_memory',
            GOLEM_MODE: 'SINGLE',
            GOLEM_BACKEND: 'gemini',
        });
    });

    afterEach(async () => {
        await stopServer(httpServer);
        httpServer = null;
        baseUrl = '';
        if (warnSpy) {
            warnSpy.mockRestore();
            warnSpy = null;
        }

        process.chdir(originalCwd);
        if (tempCwd) {
            fs.rmSync(tempCwd, { recursive: true, force: true });
            tempCwd = '';
        }
    });

    test('POST /api/golems/setup rejects when system setup is incomplete', async () => {
        jest.resetModules();
        const registerGolemRoutes = require('../web-dashboard/routes/api.golems');
        const { installSecurityContext } = require('../web-dashboard/server/security');
        const started = await startServer(registerGolemRoutes, installSecurityContext, new Map(), async () => null);
        httpServer = started.httpServer;
        baseUrl = started.baseUrl;

        const { status, body } = await requestJson(baseUrl, '/api/golems/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                golemId: 'golem_A',
                aiName: 'Golem',
                userName: 'Traveler',
            }),
        });

        expect(status).toBe(409);
        expect(body).toMatchObject({ error: 'system_setup_required' });
    });

    test('POST /api/golems/create rejects when system setup is incomplete', async () => {
        jest.resetModules();
        const registerGolemRoutes = require('../web-dashboard/routes/api.golems');
        const { installSecurityContext } = require('../web-dashboard/server/security');
        const started = await startServer(registerGolemRoutes, installSecurityContext, new Map(), async () => null);
        httpServer = started.httpServer;
        baseUrl = started.baseUrl;

        const { status, body } = await requestJson(baseUrl, '/api/golems/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: 'golem_A',
            }),
        });

        expect(status).toBe(409);
        expect(body).toMatchObject({ error: 'system_setup_required' });
    });

    test('POST /api/golems/start rejects when persona is missing', async () => {
        writeEnvFile(tempCwd, {
            SYSTEM_CONFIGURED: 'true',
            USER_DATA_DIR: './golem_memory',
            GOLEM_MODE: 'SINGLE',
            GOLEM_BACKEND: 'gemini',
        });

        jest.resetModules();
        const registerGolemRoutes = require('../web-dashboard/routes/api.golems');
        const { installSecurityContext } = require('../web-dashboard/server/security');
        const started = await startServer(registerGolemRoutes, installSecurityContext, new Map(), async () => null);
        httpServer = started.httpServer;
        baseUrl = started.baseUrl;

        const { status, body } = await requestJson(baseUrl, '/api/golems/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 'golem_A' }),
        });

        expect(status).toBe(409);
        expect(body).toMatchObject({ error: 'persona_setup_required' });
    });

    test('POST /api/golems/setup transitions status from booting to running', async () => {
        writeEnvFile(tempCwd, {
            SYSTEM_CONFIGURED: 'true',
            USER_DATA_DIR: './golem_memory',
            GOLEM_MODE: 'SINGLE',
            GOLEM_BACKEND: 'gemini',
        });

        jest.resetModules();
        const registerGolemRoutes = require('../web-dashboard/routes/api.golems');
        const { installSecurityContext } = require('../web-dashboard/server/security');

        let resolveInit = null;
        const initPromise = new Promise((resolve) => {
            resolveInit = resolve;
        });
        const brain = {
            status: 'pending_setup',
            userDataDir: path.join(tempCwd, 'golem_memory'),
            init: jest.fn().mockImplementation(() => initPromise),
        };
        const autonomy = { start: jest.fn() };
        const contexts = new Map([['golem_A', { brain, autonomy }]]);

        const started = await startServer(registerGolemRoutes, installSecurityContext, contexts, async () => null);
        httpServer = started.httpServer;
        baseUrl = started.baseUrl;

        const { status, body } = await requestJson(baseUrl, '/api/golems/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                golemId: 'golem_A',
                aiName: 'Golem',
                userName: 'Traveler',
            }),
        });

        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(brain.status).toBe('booting');

        resolveInit();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(brain.init).toHaveBeenCalledTimes(1);
        expect(brain.status).toBe('running');
        expect(autonomy.start).toHaveBeenCalledTimes(1);
    });
});
