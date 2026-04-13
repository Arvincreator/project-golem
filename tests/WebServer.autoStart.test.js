const fs = require('fs');
const os = require('os');
const path = require('path');

describe('WebServer auto-start policy', () => {
    const originalCwd = process.cwd();
    let tempCwd = '';
    let initSpy = null;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.resetModules();

        tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'webserver-autostart-'));
        process.chdir(tempCwd);

        fs.mkdirSync(path.join(tempCwd, 'golem_memory'), { recursive: true });
        fs.writeFileSync(path.join(tempCwd, 'golem_memory', 'persona.json'), JSON.stringify({
            aiName: 'Golem',
            userName: 'Traveler',
            currentRole: 'assistant',
            tone: 'friendly',
            skills: [],
            isNew: false,
        }), 'utf8');

        fs.writeFileSync(path.join(tempCwd, '.env'), [
            'SYSTEM_CONFIGURED=true',
            'USER_DATA_DIR=./golem_memory',
            'GOLEM_MODE=SINGLE',
            'GOLEM_BACKEND=gemini',
        ].join('\n') + '\n', 'utf8');

        const WebServer = require('../web-dashboard/server');
        initSpy = jest.spyOn(WebServer.prototype, 'init').mockImplementation(() => { });
    });

    afterEach(() => {
        if (initSpy) {
            initSpy.mockRestore();
            initSpy = null;
        }
        jest.useRealTimers();
        process.chdir(originalCwd);
        if (tempCwd) {
            fs.rmSync(tempCwd, { recursive: true, force: true });
            tempCwd = '';
        }
    });

    test('setGolemFactory does not auto-start golem by default', async () => {
        const WebServer = require('../web-dashboard/server');
        const server = new WebServer({});
        const factory = jest.fn().mockResolvedValue({
            brain: { init: jest.fn().mockResolvedValue(undefined) },
        });

        server.setGolemFactory(factory);

        await jest.advanceTimersByTimeAsync(600);
        await Promise.resolve();

        expect(factory).not.toHaveBeenCalled();
    });
});
