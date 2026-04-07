const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../src/mcp/MCPClient', () => {
    const { EventEmitter } = require('events');
    const instances = [];

    class MockMCPClient extends EventEmitter {
        constructor(config) {
            super();
            this.name = config.name;
            this.config = config;
            this.isConnected = false;
            this.tools = [{ name: 'mock_tool', description: 'mock' }];
            instances.push(this);
        }

        async connect() {
            this.isConnected = true;
        }

        async disconnect() {
            this.isConnected = false;
            this.emit('disconnected', { code: 0, signal: 'SIGTERM' });
        }

        async listTools() {
            return this.tools;
        }

        async callTool() {
            return { ok: true };
        }
    }

    MockMCPClient.__instances = instances;
    return MockMCPClient;
});

jest.mock('child_process', () => ({
    spawn: jest.fn()
}));

describe('MCPManager core mempalace integration', () => {
    const originalCwd = process.cwd();
    const envBackup = {
        GOLEM_MEMPALACE_ENABLED: process.env.GOLEM_MEMPALACE_ENABLED,
        GOLEM_MEMPALACE_BOOTSTRAP_ENABLED: process.env.GOLEM_MEMPALACE_BOOTSTRAP_ENABLED,
    };
    let tmpDir = '';

    const loadManager = () => {
        // eslint-disable-next-line global-require
        const MCPManager = require('../src/mcp/MCPManager');
        MCPManager._instance = null;
        return MCPManager.getInstance();
    };

    beforeEach(() => {
        jest.resetModules();
        jest.useRealTimers();
        const childProcess = require('child_process');
        childProcess.spawn.mockReset();
        childProcess.spawn.mockImplementation(() => {
            const { EventEmitter } = require('events');
            const proc = new EventEmitter();
            proc.stderr = new EventEmitter();
            process.nextTick(() => proc.emit('close', 0));
            return proc;
        });
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-manager-core-'));
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
        process.env.GOLEM_MEMPALACE_ENABLED = 'true';
        process.env.GOLEM_MEMPALACE_BOOTSTRAP_ENABLED = 'false';
    });

    afterEach(() => {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = '';
        process.env.GOLEM_MEMPALACE_ENABLED = envBackup.GOLEM_MEMPALACE_ENABLED;
        process.env.GOLEM_MEMPALACE_BOOTSTRAP_ENABLED = envBackup.GOLEM_MEMPALACE_BOOTSTRAP_ENABLED;
    });

    test('auto-creates core mempalace server when config is empty', async () => {
        const manager = loadManager();
        await manager.load();

        const mempalace = manager.getServer('mempalace');
        expect(mempalace).toBeTruthy();
        expect(mempalace.isCore).toBe(true);
        expect(mempalace.enabled).toBe(true);
        expect(mempalace.connected).toBe(true);
        expect(mempalace.coreStatus).toBe('ok');
        expect(path.isAbsolute(mempalace.command)).toBe(false);
        expect(mempalace.env.MEMPALACE_PALACE_PATH).toBe('$GOLEM_MEMPALACE_PALACE_PATH');

        const cfgPath = path.join(tmpDir, 'data', 'mcp-servers.json');
        const saved = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const core = saved.find((x) => x.name === 'mempalace');
        expect(core).toBeTruthy();
        expect(core.isCore).toBe(true);
        expect(core.enabled).toBe(true);
        expect(core.command).toBe('$GOLEM_MEMPALACE_PYTHON');
        expect(core.env.MEMPALACE_PALACE_PATH).toBe('$GOLEM_MEMPALACE_PALACE_PATH');
    });

    test('preserves existing servers and repairs stale mempalace core entry', async () => {
        const cfgPath = path.join(tmpDir, 'data', 'mcp-servers.json');
        const initial = [
            {
                name: 'custom-a',
                command: 'node',
                args: ['custom.js'],
                env: {},
                enabled: true,
                description: 'custom server'
            },
            {
                name: 'mempalace',
                command: 'broken-python',
                args: ['bad-entry'],
                env: {},
                enabled: false,
                description: 'legacy config',
                isCore: false
            }
        ];
        fs.writeFileSync(cfgPath, JSON.stringify(initial, null, 2), 'utf8');

        const manager = loadManager();
        await manager.load();

        const custom = manager.getServer('custom-a');
        expect(custom).toBeTruthy();
        expect(custom.command).toBe('node');

        const mempalace = manager.getServer('mempalace');
        expect(mempalace).toBeTruthy();
        expect(mempalace.isCore).toBe(true);
        expect(mempalace.enabled).toBe(true);
        expect(mempalace.command).not.toBe('broken-python');
        expect(Array.isArray(mempalace.args)).toBe(true);
        expect(mempalace.args).toEqual(['-m', 'mempalace.mcp_server']);
    });

    test('core server reconnects automatically after disconnect', async () => {
        jest.useFakeTimers();
        const manager = loadManager();
        await manager.load();

        // eslint-disable-next-line global-require
        const MockMCPClient = require('../src/mcp/MCPClient');
        const first = MockMCPClient.__instances.find((x) => x.name === 'mempalace');
        expect(first).toBeTruthy();

        first.emit('disconnected', { code: 1, signal: 'SIGKILL' });
        let mempalace = manager.getServer('mempalace');
        expect(mempalace.coreStatus).toBe('reconnecting');
        expect(mempalace.connected).toBe(false);

        await jest.advanceTimersByTimeAsync(1200);
        await Promise.resolve();

        mempalace = manager.getServer('mempalace');
        expect(mempalace.connected).toBe(true);
        expect(mempalace.coreStatus).toBe('ok');
    });

    test('concurrent load waits for in-flight startup to complete', async () => {
        // eslint-disable-next-line global-require
        const MockMCPClient = require('../src/mcp/MCPClient');
        const connectSpy = jest.spyOn(MockMCPClient.prototype, 'connect')
            .mockImplementation(function mockConnect() {
                return new Promise((resolve) => {
                    setTimeout(() => {
                        this.isConnected = true;
                        resolve();
                    }, 60);
                });
            });

        const manager = loadManager();
        const first = manager.load();
        await manager.load();

        const mempalace = manager.getServer('mempalace');
        expect(mempalace).toBeTruthy();
        expect(mempalace.connected).toBe(true);
        expect(connectSpy).toHaveBeenCalledTimes(1);

        await first;
        connectSpy.mockRestore();
    });

    test('bootstrap creates default mempalace.yaml without interactive init', async () => {
        process.env.GOLEM_MEMPALACE_BOOTSTRAP_ENABLED = 'true';

        const manager = loadManager();
        await manager.load();

        await manager._runMempalaceBootstrap();

        const yamlPath = path.join(tmpDir, 'mempalace.yaml');
        expect(fs.existsSync(yamlPath)).toBe(true);
        const content = fs.readFileSync(yamlPath, 'utf8');
        expect(content).toContain('wing:');
        expect(content).toContain('name: general');

        const childProcess = require('child_process');
        const calls = childProcess.spawn.mock.calls.map((call) => call[1].join(' '));
        const hasInitCall = calls.some((x) => x.includes('-m mempalace init'));
        const hasMineCall = calls.some((x) => x.includes('-m mempalace mine'));
        expect(hasInitCall).toBe(false);
        expect(hasMineCall).toBe(true);

        const statePath = path.join(tmpDir, 'data', 'mempalace-bootstrap-state.json');
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        expect(state.repoRoot).toBe('$GOLEM_WORKSPACE_ROOT');
        expect(path.isAbsolute(String(state.repoRoot || ''))).toBe(false);
    });

    test('uses runtime venv python when local mempalace project is absent', async () => {
        const runtimePython = process.platform === 'win32'
            ? path.join(tmpDir, '.mempalace-runtime', '.venv', 'Scripts', 'python.exe')
            : path.join(tmpDir, '.mempalace-runtime', '.venv', 'bin', 'python');
        fs.mkdirSync(path.dirname(runtimePython), { recursive: true });
        fs.writeFileSync(runtimePython, '', { mode: 0o755 });
        delete process.env.GOLEM_MEMPALACE_PYTHON;

        const manager = loadManager();
        await manager.load();

        const mempalace = manager.getServer('mempalace');
        expect(mempalace).toBeTruthy();
        expect(mempalace.command).toBe('$GOLEM_MEMPALACE_PYTHON');

        // eslint-disable-next-line global-require
        const MockMCPClient = require('../src/mcp/MCPClient');
        const lastClient = MockMCPClient.__instances[MockMCPClient.__instances.length - 1];
        expect(lastClient).toBeTruthy();
        expect(fs.realpathSync(lastClient.config.command)).toBe(fs.realpathSync(runtimePython));
    });

    test('sanitizes bootstrap state repoRoot when legacy absolute path exists', async () => {
        const statePath = path.join(tmpDir, 'data', 'mempalace-bootstrap-state.json');
        fs.writeFileSync(statePath, JSON.stringify({
            done: true,
            doneAt: new Date().toISOString(),
            limit: 200,
            repoRoot: path.join(tmpDir, 'some', 'absolute')
        }, null, 2), 'utf8');

        const manager = loadManager();
        const state = manager._readBootstrapState();

        expect(state).toBeTruthy();
        expect(state.repoRoot).toBe('$GOLEM_WORKSPACE_ROOT');

        const persisted = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        expect(persisted.repoRoot).toBe('$GOLEM_WORKSPACE_ROOT');
    });
});
