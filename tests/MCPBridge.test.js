const MCPBridge = require('../src/bridges/MCPBridge');

describe('MCPBridge', () => {
    test('getToolManifest returns all 9 servers', () => {
        const bridge = new MCPBridge();
        const manifest = bridge.getToolManifest();
        expect(manifest).toHaveLength(9);
        expect(manifest[0]).toHaveProperty('name');
        expect(manifest[0]).toHaveProperty('description');
        expect(manifest[0]).toHaveProperty('server');
    });

    test('callTool rejects unknown server', async () => {
        const bridge = new MCPBridge();
        await expect(bridge.callTool('nonexistent', '/query'))
            .rejects.toThrow('Unknown MCP server');
    });

    test('getStatus shows all servers as CLOSED initially', () => {
        const bridge = new MCPBridge();
        const status = bridge.getStatus();
        expect(Object.keys(status)).toHaveLength(9);
        for (const state of Object.values(status)) {
            expect(state).toBe('CLOSED');
        }
    });
});
