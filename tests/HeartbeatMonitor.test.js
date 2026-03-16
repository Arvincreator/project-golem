require('./setup');
const HeartbeatMonitor = require('../src/core/HeartbeatMonitor');

describe('HeartbeatMonitor', () => {
    let hb;
    let mockThreeLayerMemory;
    let mockExperienceReplay;
    let mockCoreMemory;

    beforeEach(() => {
        mockThreeLayerMemory = { getStats: jest.fn().mockReturnValue({ working: 10 }), pageOut: jest.fn() };
        mockExperienceReplay = { getSuccessRate: jest.fn().mockReturnValue({ rate: 0.8, successes: 16, total: 20 }), reflect: jest.fn().mockResolvedValue(null) };
        mockCoreMemory = { getStats: jest.fn().mockReturnValue({ learned_rules: { usagePercent: 30, chars: 150, maxChars: 500 } }), read: jest.fn().mockReturnValue('rule1\nrule2\nrule3'), set: jest.fn().mockReturnValue(true) };
        hb = new HeartbeatMonitor({ experienceReplay: mockExperienceReplay, coreMemory: mockCoreMemory, threeLayerMemory: mockThreeLayerMemory, messageThreshold: 5, intervalMs: 60000 });
    });

    test('tick increments message count', () => {
        expect(hb._messageCount).toBe(0);
        hb.tick();
        expect(hb._messageCount).toBe(1);
        hb.tick();
        expect(hb._messageCount).toBe(2);
    });

    test('_runHeartbeat triggers after message threshold', async () => {
        const spy = jest.spyOn(hb, '_runHeartbeat');
        for (let i = 0; i < 5; i++) {
            hb.tick();
        }
        expect(spy).toHaveBeenCalled();
    });

    test('memory pressure check pages out when working > 40', async () => {
        mockThreeLayerMemory.getStats.mockReturnValue({ working: 45 });
        await hb._runHeartbeat();
        expect(mockThreeLayerMemory.pageOut).toHaveBeenCalled();
        const indices = mockThreeLayerMemory.pageOut.mock.calls[0][0];
        expect(indices.length).toBe(10); // 45 - 35 = 10
    });

    test('memory pressure check skips when working <= 40', async () => {
        mockThreeLayerMemory.getStats.mockReturnValue({ working: 30 });
        await hb._runHeartbeat();
        expect(mockThreeLayerMemory.pageOut).not.toHaveBeenCalled();
    });

    test('max brain call budget respected (cooldown)', async () => {
        mockExperienceReplay.getSuccessRate.mockReturnValue({ rate: 0.3, successes: 6, total: 20 });

        await hb._runHeartbeat();
        expect(mockExperienceReplay.reflect).toHaveBeenCalledTimes(1);

        hb._messageCount = 0;
        hb._lastHeartbeat = Date.now();
        await hb._runHeartbeat();
        // Second call within cooldown should NOT trigger reflect again
        expect(mockExperienceReplay.reflect).toHaveBeenCalledTimes(1);
    });

    test('trims learned_rules when usagePercent > 80', async () => {
        mockCoreMemory.getStats.mockReturnValue({
            learned_rules: { usagePercent: 90, chars: 450, maxChars: 500 },
        });
        mockCoreMemory.read.mockReturnValue('old1\nold2\nold3\nnew1\nnew2');

        await hb._runHeartbeat();
        expect(mockCoreMemory.set).toHaveBeenCalledWith(
            'learned_rules',
            expect.any(String),
            { system: true }
        );
    });

    test('getStats returns current heartbeat statistics', () => {
        hb.tick();
        hb.tick();
        const stats = hb.getStats();
        expect(stats.messageCount).toBe(2);
        expect(stats.lastHeartbeat).toBeDefined();
        expect(stats.nextHeartbeatIn.byMessages).toBe(3);
    });
});
