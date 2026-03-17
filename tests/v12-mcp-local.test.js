const MCPBridge = require('../src/bridges/MCPBridge');

describe('MCPBridge — Local Module Dispatch (v12.0)', () => {
    let bridge;

    beforeEach(() => {
        bridge = new MCPBridge();
    });

    test('setLocalModules registers modules', () => {
        bridge.setLocalModules({
            'error_pattern': {
                instance: { getStats: () => ({ patterns: 5 }) },
                methods: ['getStats', 'recordError'],
                description: 'Error pattern learner',
            }
        });
        expect(bridge._localModules).toHaveProperty('error_pattern');
    });

    test('getToolManifest includes local modules', () => {
        bridge.setLocalModules({
            'scan_quality': {
                instance: {},
                methods: ['getStats'],
                description: 'Scan quality tracker',
            }
        });
        const manifest = bridge.getToolManifest();
        const localTool = manifest.find(t => t.name === 'local-scan_quality');
        expect(localTool).toBeDefined();
        expect(localTool.type).toBe('local');
    });

    test('callTool dispatches to local module', async () => {
        bridge.setLocalModules({
            'test_mod': {
                instance: { getStats: async () => ({ count: 42 }) },
                methods: ['getStats'],
            }
        });
        const result = await bridge.callTool('local-test_mod', 'getStats', {});
        expect(result.count).toBe(42);
    });

    test('callTool returns error for unknown local module', async () => {
        const result = await bridge.callTool('local-nonexistent', 'method', {});
        expect(result.error).toContain('Unknown local module');
    });

    test('callTool returns error for unknown method', async () => {
        bridge.setLocalModules({
            'test_mod': { instance: {}, methods: [] }
        });
        const result = await bridge.callTool('local-test_mod', 'nonexistent', {});
        expect(result.error).toContain('not found');
    });

    test('setLocalModules ignores null', () => {
        bridge.setLocalModules(null);
        expect(bridge._localModules).toEqual({});
    });
});
