const SOPMultiAgent = require('../src/core/SOPMultiAgent');

describe('SOPMultiAgent', () => {
    let sop, mockBrain;

    beforeEach(() => {
        mockBrain = {
            sendMessage: jest.fn().mockResolvedValue('[GOLEM_REPLY]\nTest output from agent role.'),
        };
        sop = new SOPMultiAgent(mockBrain, { golemId: 'test' });
    });

    test('should list available presets', () => {
        const presets = SOPMultiAgent.getPresets();
        expect(presets.length).toBeGreaterThanOrEqual(3);
        expect(presets.map(p => p.key)).toContain('DEV_TEAM');
        expect(presets.map(p => p.key)).toContain('RESEARCH');
        expect(presets.map(p => p.key)).toContain('STRATEGY');
    });

    test('should throw on unknown preset', async () => {
        const ctx = { reply: jest.fn() };
        await expect(sop.run(ctx, 'test task', 'NONEXISTENT'))
            .rejects.toThrow('Unknown SOP preset');
    });

    test('should run DEV_TEAM workflow', async () => {
        const ctx = { reply: jest.fn() };
        const result = await sop.run(ctx, 'Build a login page', 'DEV_TEAM');

        expect(result.artifacts).toBeDefined();
        expect(result.messages.length).toBeGreaterThan(0);
        expect(result.summary).toBeDefined();
        expect(ctx.reply).toHaveBeenCalled();
    });

    test('should run RESEARCH workflow', async () => {
        const ctx = { reply: jest.fn() };
        const result = await sop.run(ctx, 'Research AI trends', 'RESEARCH');

        expect(result.artifacts).toBeDefined();
        expect(result.messages.length).toBeGreaterThan(0);
    });

    test('should run STRATEGY workflow', async () => {
        const ctx = { reply: jest.fn() };
        const result = await sop.run(ctx, 'Market strategy for Q2', 'STRATEGY');

        expect(result.artifacts).toBeDefined();
        expect(result.cycles).toBeGreaterThanOrEqual(1);
    });

    test('_checkCondition should detect bugs', () => {
        expect(sop._checkCondition('bugs_found', {}, [{ content: 'Found a bug in the login flow' }])).toBe(true);
        expect(sop._checkCondition('bugs_found', {}, [{ content: 'Everything looks great' }])).toBe(false);
    });

    test('_checkCondition should detect gaps', () => {
        expect(sop._checkCondition('gaps_found', {}, [{ content: 'There are missing pieces' }])).toBe(true);
        expect(sop._checkCondition('gaps_found', {}, [{ content: 'Complete analysis' }])).toBe(false);
    });

    test('should handle brain failure gracefully', async () => {
        mockBrain.sendMessage.mockRejectedValue(new Error('Brain offline'));
        const ctx = { reply: jest.fn() };
        const result = await sop.run(ctx, 'Test task', 'STRATEGY');

        // Should complete without throwing
        expect(result.messages.length).toBeGreaterThan(0);
        expect(result.messages.some(m => m.content.includes('Error'))).toBe(true);
    });

    test('PRESETS should have correct structure', () => {
        for (const [key, preset] of Object.entries(SOPMultiAgent.PRESETS)) {
            expect(preset.name).toBeDefined();
            expect(preset.roles.length).toBeGreaterThan(0);
            expect(preset.handoffs.length).toBeGreaterThan(0);
            expect(preset.maxCycles).toBeGreaterThan(0);

            for (const role of preset.roles) {
                expect(role.name).toBeDefined();
                expect(role.role).toBeDefined();
                expect(role.outputKey).toBeDefined();
                expect(role.expertise.length).toBeGreaterThan(0);
            }
        }
    });
});
