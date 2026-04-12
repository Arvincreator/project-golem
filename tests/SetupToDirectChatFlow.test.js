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
    await new Promise((resolve) => {
        httpServer.close(() => resolve());
    });
}

describe('setup -> direct chat flow', () => {
    const originalCwd = process.cwd();
    let tempCwd = '';
    let httpServer = null;
    let baseUrl = '';
    let warnSpy = null;

    beforeEach(async () => {
        tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'golem-setup-chat-'));
        process.chdir(tempCwd);

        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });

        delete process.env.SYSTEM_OP_TOKEN;
        delete process.env.REMOTE_ACCESS_PASSWORD;
        delete process.env.SYSTEM_CONFIGURED;
        delete process.env.USER_DATA_DIR;
        delete process.env.TELEGRAM_TOKEN;
        delete process.env.DISCORD_TOKEN;

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

    test('completes setup and accepts direct chat message', async () => {
        jest.resetModules();

        const dashboardMessageHandler = jest.fn().mockResolvedValue(undefined);
        jest.doMock('../index.js', () => ({
            handleDashboardMessage: dashboardMessageHandler,
        }));

        const registerGolemRoutes = require('../web-dashboard/routes/api.golems');
        const registerChatRoutes = require('../web-dashboard/routes/api.chat');
        const { installSecurityContext } = require('../web-dashboard/server/security');

        const app = express();
        app.use(express.json());

        const brain = {
            status: 'pending_setup',
            userDataDir: path.join(tempCwd, 'golem_memory'),
            init: jest.fn().mockResolvedValue(undefined),
        };
        const autonomy = { start: jest.fn() };
        const contexts = new Map([['golem_A', { brain, autonomy }]]);

        const serverContext = {
            app,
            allowRemote: false,
            contexts,
            golemFactory: async () => ({ brain, autonomy }),
            chatHistory: new Map(),
            broadcastLog: jest.fn(),
        };
        installSecurityContext(serverContext);

        app.use(registerGolemRoutes(serverContext));
        app.use(registerChatRoutes(serverContext));

        httpServer = http.createServer(app);
        await new Promise((resolve) => {
            httpServer.listen(0, '127.0.0.1', resolve);
        });
        const address = httpServer.address();
        baseUrl = `http://127.0.0.1:${address.port}`;

        const setupRes = await requestJson(baseUrl, '/api/golems/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                golemId: 'golem_A',
                aiName: 'Golem',
                userName: 'Traveler',
                currentRole: 'assistant',
                tone: 'friendly',
                skills: [],
            }),
        });

        expect(setupRes.status).toBe(200);
        expect(setupRes.body.success).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(brain.status).toBe('running');

        const chatRes = await requestJson(baseUrl, '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                golemId: 'golem_A',
                message: 'hello from direct chat',
            }),
        });

        expect(chatRes.status).toBe(200);
        expect(chatRes.body.success).toBe(true);
        expect(dashboardMessageHandler).toHaveBeenCalledTimes(1);
    });
});
