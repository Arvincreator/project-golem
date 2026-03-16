// tests/BrainRAGIntegration.test.js
// Verify that OpenAICompatBrain and SdkBrain properly integrate with RAGProvider

describe('Brain RAG Integration', () => {
    const mockRAG = {
        augmentedRecall: jest.fn(),
        ingest: jest.fn().mockResolvedValue(undefined),
        init: jest.fn().mockResolvedValue(undefined),
    };

    afterEach(() => jest.clearAllMocks());

    describe('OpenAICompatBrain', () => {
        let brain;

        beforeEach(() => {
            const OpenAICompatBrain = require('../src/core/OpenAICompatBrain');
            brain = new OpenAICompatBrain({
                ragProvider: mockRAG,
                serviceId: 'test',
            });
        });

        test('constructor accepts ragProvider', () => {
            expect(brain._ragProvider).toBe(mockRAG);
        });

        test('recall uses RAG when available and has results', async () => {
            mockRAG.augmentedRecall.mockResolvedValue({
                merged: [{ id: 'r1', content: 'rag result', score: 0.9 }],
            });
            const results = await brain.recall('test query');
            expect(results).toHaveLength(1);
            expect(results[0].content).toBe('rag result');
            expect(mockRAG.augmentedRecall).toHaveBeenCalledWith('test query');
        });

        test('recall falls back to memoryDriver when RAG returns empty', async () => {
            mockRAG.augmentedRecall.mockResolvedValue({ merged: [] });
            // Falls back to memoryDriver.recall — may return results from filesystem
            const results = await brain.recall('test query');
            expect(Array.isArray(results)).toBe(true);
        });

        test('recall falls back to memoryDriver when RAG throws', async () => {
            mockRAG.augmentedRecall.mockRejectedValue(new Error('rag error'));
            const results = await brain.recall('test query');
            expect(Array.isArray(results)).toBe(true);
        });

        test('memorize ingests into RAG', async () => {
            await brain.memorize('test text', { type: 'test' });
            expect(mockRAG.ingest).toHaveBeenCalledWith('test text', { type: 'test' });
        });

        test('memorize continues when RAG ingest fails', async () => {
            mockRAG.ingest.mockRejectedValue(new Error('ingest error'));
            // Should not throw
            await brain.memorize('test text');
        });
    });

    describe('OpenAICompatBrain without RAG', () => {
        test('recall works without ragProvider', async () => {
            const OpenAICompatBrain = require('../src/core/OpenAICompatBrain');
            const brain = new OpenAICompatBrain({ serviceId: 'test' });
            expect(brain._ragProvider).toBeNull();
            const results = await brain.recall('query');
            expect(results).toEqual([]);
        });
    });

    describe('SdkBrain', () => {
        test('accepts ragProvider option', () => {
            const SdkBrain = require('../src/core/SdkBrain');
            const brain = new SdkBrain({ ragProvider: mockRAG });
            expect(brain._ragProvider).toBe(mockRAG);
        });

        test('recall uses RAG', async () => {
            const SdkBrain = require('../src/core/SdkBrain');
            const brain = new SdkBrain({ ragProvider: mockRAG });
            mockRAG.augmentedRecall.mockResolvedValue({
                merged: [{ id: 's1', content: 'sdk rag result' }],
            });
            const results = await brain.recall('query');
            expect(results[0].content).toBe('sdk rag result');
        });
    });

    describe('RouterBrain', () => {
        test('has _ragProvider property', () => {
            const RouterBrain = require('../src/core/RouterBrain');
            const brain = new RouterBrain({});
            expect(brain).toHaveProperty('_ragProvider');
        });
    });

    describe('BrainFactory', () => {
        test('includes claude case', () => {
            const factorySource = require('fs').readFileSync(
                require('path').join(__dirname, '../src/core/BrainFactory.js'), 'utf-8'
            );
            expect(factorySource).toContain("case 'claude':");
            expect(factorySource).toContain('ClaudeBrain');
        });
    });
});
