jest.mock('../src/mcp/mempalaceInstaller', () => ({
    installMempalace: jest.fn(),
}));

const { installMempalace } = require('../src/mcp/mempalaceInstaller');
const registerMcpRoutes = require('../web-dashboard/routes/api.mcp');

const {
    buildMempalaceProbePlan,
    verifyMempalaceServer,
    toggleServerWithMempalaceSetup,
} = registerMcpRoutes.__test__;

describe('MCP mempalace toggle helper', () => {
    let mgr = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mgr = {
            getServer: jest.fn(),
            toggleServer: jest.fn(),
            updateServer: jest.fn(),
            testServer: jest.fn(),
            callTool: jest.fn(),
        };
    });

    test('buildMempalaceProbePlan chooses mempalace_search when available', () => {
        const probe = buildMempalaceProbePlan([
            { name: 'other_tool' },
            { name: 'mempalace_search' },
        ]);
        expect(probe.tool).toBe('mempalace_search');
        expect(probe.parameters).toEqual(expect.objectContaining({ query: expect.any(String) }));
    });

    test('verifyMempalaceServer passes when tool listing and probe succeed', async () => {
        mgr.testServer.mockResolvedValue({
            success: true,
            tools: [{ name: 'mempalace_search' }],
        });
        mgr.callTool.mockResolvedValue({ results: [] });

        const result = await verifyMempalaceServer(mgr, 'mempalace');

        expect(result.connection.success).toBe(true);
        expect(result.functionality.checked).toBe(true);
        expect(result.functionality.tool).toBe('mempalace_search');
    });

    test('toggle helper installs and verifies mempalace when enabling', async () => {
        mgr.getServer.mockReturnValue({ name: 'mempalace', command: 'python3', enabled: false });
        mgr.toggleServer.mockResolvedValue({ name: 'mempalace', enabled: true });
        mgr.updateServer.mockResolvedValue({ name: 'mempalace', command: '/tmp/runtime/.venv/bin/python', enabled: false });
        mgr.testServer.mockResolvedValue({
            success: true,
            tools: [{ name: 'mempalace_search' }],
        });
        mgr.callTool.mockResolvedValue({ results: [] });
        installMempalace.mockReturnValue({
            installAction: 'already_installed',
            pythonBin: '/tmp/runtime/.venv/bin/python',
            palaceDir: '/tmp/runtime/palace',
        });

        const result = await toggleServerWithMempalaceSetup(mgr, 'mempalace', true);

        expect(installMempalace).toHaveBeenCalledWith(expect.objectContaining({
            preferredPython: 'python3',
        }));
        expect(result.entry.enabled).toBe(true);
        expect(result.install.installAction).toBe('already_installed');
        expect(result.verification.functionality.checked).toBe(true);
        expect(result.serverConfigUpdated).toBe(true);
        expect(mgr.updateServer).toHaveBeenCalledWith('mempalace', expect.objectContaining({
            command: '/tmp/runtime/.venv/bin/python',
            enabled: false,
        }));
    });

    test('toggle helper auto-disables mempalace when probe fails', async () => {
        mgr.getServer.mockReturnValue({ name: 'mempalace', command: 'python3', enabled: false });
        mgr.toggleServer
            .mockResolvedValueOnce({ name: 'mempalace', enabled: true })
            .mockResolvedValueOnce({ name: 'mempalace', enabled: false });
        mgr.updateServer.mockResolvedValue({ name: 'mempalace', command: '/tmp/runtime/.venv/bin/python', enabled: false });
        mgr.testServer.mockResolvedValue({
            success: true,
            tools: [{ name: 'mempalace_search' }],
        });
        mgr.callTool.mockRejectedValue(new Error('probe failed'));
        installMempalace.mockReturnValue({
            installAction: 'installed',
            pythonBin: '/tmp/runtime/.venv/bin/python',
            palaceDir: '/tmp/runtime/palace',
        });

        await expect(toggleServerWithMempalaceSetup(mgr, 'mempalace', true)).rejects.toThrow('MemPalace 安裝後驗證失敗');
        expect(mgr.toggleServer).toHaveBeenNthCalledWith(1, 'mempalace', true);
        expect(mgr.toggleServer).toHaveBeenNthCalledWith(2, 'mempalace', false);
    });

    test('toggle helper skips install when disabling mempalace', async () => {
        mgr.getServer.mockReturnValue({ name: 'mempalace', command: 'python3', enabled: true });
        mgr.toggleServer.mockResolvedValue({ name: 'mempalace', enabled: false });

        const result = await toggleServerWithMempalaceSetup(mgr, 'mempalace', false);

        expect(installMempalace).not.toHaveBeenCalled();
        expect(result.entry.enabled).toBe(false);
        expect(result.install).toBeNull();
        expect(result.verification).toBeNull();
    });
});
