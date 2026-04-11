const fs = require('fs');
const os = require('os');
const path = require('path');

describe('MCPManager mempalace startup prepare', () => {
    const originalCwd = process.cwd();
    let tempCwd = '';

    beforeEach(() => {
        jest.resetModules();
        tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'golem-mcp-manager-'));
        process.chdir(tempCwd);
        fs.mkdirSync(path.join(tempCwd, 'data'), { recursive: true });
    });

    afterEach(() => {
        process.chdir(originalCwd);
        if (tempCwd) {
            fs.rmSync(tempCwd, { recursive: true, force: true });
            tempCwd = '';
        }
    });

    function writeConfig(config) {
        const filePath = path.join(tempCwd, 'data', 'mcp-servers.json');
        fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
        return filePath;
    }

    test('load auto-rewrites enabled mempalace to isolated venv python before connect', async () => {
        const configPath = writeConfig([
            {
                name: 'mempalace',
                command: '/opt/homebrew/opt/python@3.14/bin/python3.14',
                args: ['-m', 'mempalace.mcp_server'],
                env: {},
                enabled: true,
                description: 'MemPalace',
            },
        ]);

        const installMempalace = jest.fn().mockReturnValue({
            installAction: 'installed',
            pythonBin: '/tmp/golem-mempalace/.venv/bin/python',
            palaceDir: '/tmp/golem-mempalace/palace',
        });
        jest.doMock('../src/mcp/mempalaceInstaller', () => ({ installMempalace }));

        const MCPManager = require('../src/mcp/MCPManager');
        const mgr = new MCPManager();
        mgr._startClient = jest.fn().mockResolvedValue(null);

        await mgr.load();

        expect(installMempalace).toHaveBeenCalledTimes(1);
        expect(mgr._startClient).toHaveBeenCalledWith(expect.objectContaining({
            name: 'mempalace',
            command: '/tmp/golem-mempalace/.venv/bin/python',
        }));

        const updated = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        expect(updated[0].command).toBe('/tmp/golem-mempalace/.venv/bin/python');
        expect(updated[0].env.MEMPALACE_PALACE_DIR).toBe('/tmp/golem-mempalace/palace');
        expect(updated[0].enabled).toBe(true);
    });

    test('load disables mempalace on setup failure but continues with other enabled servers', async () => {
        const configPath = writeConfig([
            {
                name: 'mempalace',
                command: '/opt/homebrew/opt/python@3.14/bin/python3.14',
                args: ['-m', 'mempalace.mcp_server'],
                env: {},
                enabled: true,
                description: 'MemPalace',
            },
            {
                name: 'chrome-devtools',
                command: 'npx',
                args: ['-y', 'chrome-devtools-mcp@latest'],
                env: {},
                enabled: true,
                description: 'Chrome',
            },
        ]);

        const installMempalace = jest.fn().mockImplementation(() => {
            throw new Error('dependency conflict');
        });
        jest.doMock('../src/mcp/mempalaceInstaller', () => ({ installMempalace }));

        const MCPManager = require('../src/mcp/MCPManager');
        const mgr = new MCPManager();
        mgr._startClient = jest.fn().mockResolvedValue(null);

        await mgr.load();

        expect(installMempalace).toHaveBeenCalledTimes(1);
        expect(mgr._startClient).toHaveBeenCalledTimes(1);
        expect(mgr._startClient).toHaveBeenCalledWith(expect.objectContaining({
            name: 'chrome-devtools',
        }));

        const updated = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const mempalace = updated.find((item) => item.name === 'mempalace');
        expect(mempalace.enabled).toBe(false);
    });
});
