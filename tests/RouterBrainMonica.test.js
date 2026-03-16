// ============================================================
// RouterBrain — Monica Integration Tests
// Tests: CB recording (F3), cost tracking (F2), quality thresholds (F9),
//        fallback chain
// ============================================================

jest.mock('../src/config', () => ({
    CONFIG: { USER_DATA_DIR: '/tmp/test-golem' },
    LOG_BASE_DIR: '/tmp/test-logs',
    GOLEM_MODE: 'SINGLE',
    MEMORY_BASE_DIR: '/tmp/test-memory',
}));

jest.mock('../src/managers/ChatLogManager', () => {
    return jest.fn().mockImplementation(() => ({
        init: jest.fn().mockResolvedValue(undefined),
        append: jest.fn(),
    }));
});

jest.mock('../src/managers/SkillIndexManager', () => {
    return jest.fn().mockImplementation(() => ({
        syncToDb: jest.fn(),
    }));
});

jest.mock('../src/memory/SystemNativeDriver', () => {
    return jest.fn().mockImplementation(() => ({
        init: jest.fn().mockResolvedValue(undefined),
    }));
});

// Mock circuit breaker
const mockCB = {
    canExecute: jest.fn().mockReturnValue(true),
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
    getStatus: jest.fn().mockReturnValue({}),
};
jest.mock('../src/core/circuit_breaker', () => mockCB);

// Mock brain classes — each must have unique jest.fn() instances
const mockCreateBrain = () => ({
    init: jest.fn(),
    sendMessage: jest.fn(),
    switchModel: jest.fn(),
    reloadSkills: jest.fn(),
});

jest.mock('../src/core/MonicaWebBrain', () => jest.fn().mockImplementation(() => mockCreateBrain()));
jest.mock('../src/core/MonicaBrain', () => jest.fn().mockImplementation(() => mockCreateBrain()));
jest.mock('../src/core/SdkBrain', () => jest.fn().mockImplementation(() => mockCreateBrain()));
jest.mock('../src/core/OllamaBrain', () => jest.fn().mockImplementation(() => mockCreateBrain()));
jest.mock('../src/core/ClaudeBrain', () => jest.fn().mockImplementation(() => mockCreateBrain()));

// Mock RAG dependencies (v10.5: RouterBrain now initializes RAGProvider)
jest.mock('../src/memory/EmbeddingProvider', () => jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(undefined),
})));
jest.mock('../src/memory/VectorStore', () => jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(undefined),
})));
jest.mock('../src/memory/RAGProvider', () => jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(undefined),
    augmentedRecall: jest.fn().mockResolvedValue({ merged: [] }),
    ingest: jest.fn().mockResolvedValue(undefined),
})));

const RouterBrain = require('../src/core/RouterBrain');

describe('RouterBrain — Monica Integration', () => {
    let router;

    beforeEach(async () => {
        jest.clearAllMocks();
        mockCB.canExecute.mockReturnValue(true);
        router = new RouterBrain({ golemId: 'test-router' });
        await router.init();
    });

    describe('F3: Circuit breaker records success/failure', () => {
        test('records success on successful sendMessage', async () => {
            const webBrain = router._brains['monica-web'];
            webBrain.sendMessage.mockResolvedValue('test response');

            await router.sendMessage('hello');
            expect(mockCB.recordSuccess).toHaveBeenCalledWith('monica-web');
        });

        test('records failure on failed sendMessage', async () => {
            // All brains fail
            for (const brain of Object.values(router._brains)) {
                brain.sendMessage.mockRejectedValue(new Error('test error'));
            }

            await expect(router.sendMessage('hello')).rejects.toThrow(/All brain engines exhausted/);
            expect(mockCB.recordFailure).toHaveBeenCalled();
        });

        test('skips brain when circuit is OPEN', async () => {
            mockCB.canExecute.mockImplementation((id) => id !== 'monica-web');
            const monicaBrain = router._brains['monica'];
            monicaBrain.sendMessage.mockResolvedValue('fallback response');

            const result = await router.sendMessage('hello');
            expect(result).toBe('fallback response');
            expect(router._brains['monica-web'].sendMessage).not.toHaveBeenCalled();
        });
    });

    describe('F2: Cost tracking uses actual response text', () => {
        test('_recordRouting calculates cost from response text, not length string', () => {
            const responseText = 'This is a test response with some content';
            router._recordRouting('test input', 'monica-web', 'gpt-4o', true, null, responseText.length, responseText);

            const record = router._routingHistory[router._routingHistory.length - 1];
            expect(record.cost).toBeGreaterThan(0);

            // Previously: estimateTokens(String(42)) = 1 token
            // Now: estimateTokens(responseText) = ~10 tokens
            // Verify cost is proportional to actual response
            const { estimateTokens, getModelSpec } = require('../src/core/monica-constants');
            const spec = getModelSpec('gpt-4o');
            const expectedInputTokens = estimateTokens('test input');
            const expectedOutputTokens = estimateTokens(responseText);
            const expectedCost = (expectedInputTokens * spec.costIn + expectedOutputTokens * spec.costOut) / 1000000;
            expect(record.cost).toBeCloseTo(expectedCost, 8);
        });

        test('cost is 0 for failed requests', () => {
            router._recordRouting('test', 'monica-web', 'gpt-4o', false, 'error msg', 0);
            const record = router._routingHistory[router._routingHistory.length - 1];
            expect(record.cost).toBe(0);
        });
    });

    describe('F9: Quality flag thresholds', () => {
        test('does NOT flag responses between 5 and 50000 chars', () => {
            router._modelFailCounts = {};
            router._recordRouting('test', 'monica-web', 'gpt-4o', true, null, 100, 'x'.repeat(100));
            expect(router._modelFailCounts['gpt-4o'] || 0).toBe(0);
        });

        test('flags responses shorter than 5 chars as empty', () => {
            router._modelFailCounts = {};
            router._recordRouting('test', 'monica-web', 'gpt-4o', true, null, 3, 'abc');
            expect(router._modelFailCounts['gpt-4o']).toBe(1);
        });

        test('v10.0: does NOT flag long responses as excessive (legitimate large output)', () => {
            router._modelFailCounts = {};
            const longText = 'x'.repeat(60000);
            router._recordRouting('test', 'monica-web', 'gpt-4o', true, null, 60000, longText);
            expect(router._modelFailCounts['gpt-4o'] || 0).toBe(0);
        });

        test('does NOT flag 25-char response (was previously flagged at <20)', () => {
            router._modelFailCounts = {};
            router._recordRouting('test', 'monica-web', 'gpt-4o', true, null, 15, 'short but valid!');
            expect(router._modelFailCounts['gpt-4o'] || 0).toBe(0);
        });
    });

    describe('Fallback chain', () => {
        test('falls through to next brain on failure', async () => {
            router._brains['monica-web'].sendMessage.mockRejectedValue(new Error('web fail'));
            router._brains['monica'].sendMessage.mockResolvedValue('api response');

            const result = await router.sendMessage('hello');
            expect(result).toBe('api response');
            expect(mockCB.recordFailure).toHaveBeenCalledWith('monica-web', 'web fail');
            expect(mockCB.recordSuccess).toHaveBeenCalledWith('monica');
        });

        test('throws when all brains fail', async () => {
            for (const brain of Object.values(router._brains)) {
                brain.sendMessage.mockRejectedValue(new Error('fail'));
            }
            await expect(router.sendMessage('hello')).rejects.toThrow(/All brain engines exhausted/);
        });
    });
});
