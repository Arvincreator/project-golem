// tests/OODALoopRAG.test.js
// Test RAG-augmented features in AutonomyManager and ThreeLayerMemory

const AutonomyManager = require('../src/managers/AutonomyManager');
const ThreeLayerMemory = require('../src/memory/ThreeLayerMemory');

describe('RAG-augmented Autonomy', () => {
    describe('AutonomyManager RAG integration', () => {
        let autonomy;
        const mockBrain = {
            sendMessage: jest.fn().mockResolvedValue('ok'),
            memoryDriver: { checkDueTasks: jest.fn().mockResolvedValue([]) },
        };
        const mockController = {};
        const mockMemory = {};

        beforeEach(() => {
            autonomy = new AutonomyManager(mockBrain, mockController, mockMemory, { golemId: 'test' });
        });

        test('setRAGProvider stores provider', () => {
            const mockRAG = { augmentedRecall: jest.fn() };
            autonomy.setRAGProvider(mockRAG);
            expect(autonomy._ragProvider).toBe(mockRAG);
        });

        test('setVectorIndexer stores indexer', () => {
            const mockIndexer = { consolidate: jest.fn() };
            autonomy.setVectorIndexer(mockIndexer);
            expect(autonomy._vectorIndexer).toBe(mockIndexer);
        });

        test('_ragAugmentedDecision returns false for empty results', async () => {
            const result = await autonomy._ragAugmentedDecision([]);
            expect(result).toBe(false);
        });

        test('_ragAugmentedDecision returns false for null', async () => {
            const result = await autonomy._ragAugmentedDecision(null);
            expect(result).toBe(false);
        });

        test('_ragAugmentedDecision returns true when >60% failures', async () => {
            const results = [
                { content: 'Action: test | Success: false' },
                { content: 'Action: test | Success: false' },
                { content: 'Action: test | Success: true' },
            ];
            const result = await autonomy._ragAugmentedDecision(results);
            expect(result).toBe(true);
        });

        test('_ragAugmentedDecision returns false when <60% failures', async () => {
            const results = [
                { content: 'Action: test | Success: true' },
                { content: 'Action: test | Success: true' },
                { content: 'Action: test | Success: false' },
            ];
            const result = await autonomy._ragAugmentedDecision(results);
            expect(result).toBe(false);
        });

        test('recordActionOutcome calls RAG ingest', async () => {
            const mockRAG = {
                ingest: jest.fn().mockResolvedValue(undefined),
            };
            autonomy.setRAGProvider(mockRAG);

            await autonomy.recordActionOutcome(
                { action: 'test_action', task: 'test_task' },
                'success result',
                true
            );

            expect(mockRAG.ingest).toHaveBeenCalledTimes(1);
            const [content, metadata] = mockRAG.ingest.mock.calls[0];
            expect(content).toContain('test_action');
            expect(metadata.type).toBe('action_outcome');
        });

        test('recordActionOutcome works without RAG', async () => {
            // Should not throw
            await autonomy.recordActionOutcome(
                { action: 'test' },
                'result',
                true
            );
        });
    });

    describe('ThreeLayerMemory RAG integration', () => {
        let memory;

        beforeEach(() => {
            memory = new ThreeLayerMemory({ golemId: 'test' });
        });

        test('setRAGProvider stores provider', () => {
            const mockRAG = { augmentedRecall: jest.fn() };
            memory.setRAGProvider(mockRAG);
            expect(memory._ragProvider).toBe(mockRAG);
        });

        test('queryEpisodes uses RAG when available', async () => {
            const mockRAG = {
                augmentedRecall: jest.fn().mockResolvedValue({
                    merged: [
                        { id: 'r1', content: 'rag episode', score: 0.9 },
                    ],
                }),
            };
            memory.setRAGProvider(mockRAG);

            const results = await memory.queryEpisodes('test situation');
            expect(results[0]).toHaveProperty('_source', 'rag');
            expect(results[0].situation).toBe('rag episode');
        });

        test('queryEpisodes falls back to keyword when RAG empty', async () => {
            const mockRAG = {
                augmentedRecall: jest.fn().mockResolvedValue({ merged: [] }),
            };
            memory.setRAGProvider(mockRAG);

            // Add some episodes
            memory.recordEpisode('test situation', ['action'], 'outcome', 1);
            const results = await memory.queryEpisodes('test');
            expect(results.length).toBeGreaterThan(0);
            expect(results[0]).not.toHaveProperty('_source');
        });

        test('queryEpisodes falls back when RAG throws', async () => {
            const mockRAG = {
                augmentedRecall: jest.fn().mockRejectedValue(new Error('rag error')),
            };
            memory.setRAGProvider(mockRAG);

            memory.recordEpisode('test situation', ['action'], 'outcome', 1);
            const results = await memory.queryEpisodes('test');
            expect(results.length).toBeGreaterThan(0);
        });

        test('queryEpisodes works without RAG', async () => {
            memory.recordEpisode('hello world', ['greet'], 'greeted', 1);
            const results = await memory.queryEpisodes('hello');
            expect(results.length).toBeGreaterThan(0);
        });
    });
});
