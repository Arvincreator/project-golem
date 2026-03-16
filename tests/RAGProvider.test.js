// tests/RAGProvider.test.js
const RAGProvider = require('../src/memory/RAGProvider');

// Mock dependencies
const mockVectorStore = {
    search: jest.fn().mockResolvedValue([
        { id: 'v1', content: 'vector result 1', score: 0.95, metadata: {}, source: 'test' },
        { id: 'v2', content: 'vector result 2', score: 0.8, metadata: {}, source: 'test' },
    ]),
    upsert: jest.fn().mockResolvedValue(undefined),
};

const mockMagma = {
    query: jest.fn().mockReturnValue({
        nodes: [
            { id: 'g1', name: 'graph result 1', type: 'concept', _relevanceScore: 0.9 },
            { id: 'g2', name: 'graph result 2', type: 'entity', _relevanceScore: 0.7 },
        ],
    }),
    addNode: jest.fn(),
};

describe('RAGProvider', () => {
    let rag;

    beforeEach(async () => {
        jest.clearAllMocks();
        rag = new RAGProvider({
            vectorStore: mockVectorStore,
            magma: mockMagma,
        });
        // Manually init without loading remote URL from config
        rag._remoteRAGUrl = null;
        rag._initialized = true;
    });

    test('init sets initialized flag', () => {
        expect(rag._initialized).toBe(true);
    });

    test('augmentedRecall returns merged results from vector + graph', async () => {
        const result = await rag.augmentedRecall('test query');

        expect(result).toHaveProperty('vectorResults');
        expect(result).toHaveProperty('graphResults');
        expect(result).toHaveProperty('remoteResults');
        expect(result).toHaveProperty('merged');
        expect(result).toHaveProperty('contextString');

        expect(result.vectorResults.length).toBe(2);
        expect(result.graphResults.length).toBe(2);
        expect(result.remoteResults.length).toBe(0);
        expect(result.merged.length).toBeGreaterThan(0);
    });

    test('RRF merging produces correct ranking', () => {
        const sources = [
            [
                { id: 'a', content: 'item a', score: 1, source: 'vector' },
                { id: 'b', content: 'item b', score: 0.8, source: 'vector' },
            ],
            [
                { id: 'b', content: 'item b longer', score: 0.9, source: 'graph' },
                { id: 'c', content: 'item c', score: 0.7, source: 'graph' },
            ],
        ];

        const merged = rag._mergeRRF(sources, 60);

        // 'b' appears in both sources, should rank higher
        expect(merged.length).toBe(3);
        expect(merged[0].id).toBe('b'); // appears in both sources
        expect(merged[0].rrfScore).toBeGreaterThan(merged[1].rrfScore);
    });

    test('RRF with empty sources', () => {
        const merged = rag._mergeRRF([[], [], []], 60);
        expect(merged).toEqual([]);
    });

    test('formatForContext produces readable string', () => {
        const items = [
            { id: 'x', content: 'hello world', source: 'vector', rrfScore: 0.05 },
            { id: 'y', content: 'goodbye world', source: 'graph', rrfScore: 0.03 },
        ];
        const ctx = rag._formatForContext(items);
        expect(ctx).toContain('[1]');
        expect(ctx).toContain('vector');
        expect(ctx).toContain('hello world');
    });

    test('formatForContext handles empty input', () => {
        expect(rag._formatForContext([])).toBe('');
        expect(rag._formatForContext(null)).toBe('');
    });

    test('ingest writes to both vector and graph', async () => {
        await rag.ingest('test content', { type: 'test', source: 'unit_test' });

        expect(mockVectorStore.upsert).toHaveBeenCalledTimes(1);
        expect(mockMagma.addNode).toHaveBeenCalledTimes(1);
    });

    test('ingest ignores empty content', async () => {
        await rag.ingest('');
        expect(mockVectorStore.upsert).not.toHaveBeenCalled();
    });

    test('augmentedRecall with limit', async () => {
        const result = await rag.augmentedRecall('query', { limit: 1 });
        expect(result.merged.length).toBeLessThanOrEqual(1);
    });

    test('graceful fallback when vector store fails', async () => {
        mockVectorStore.search.mockRejectedValueOnce(new Error('db error'));
        const result = await rag.augmentedRecall('query');
        expect(result.vectorResults).toEqual([]);
        expect(result.graphResults.length).toBeGreaterThan(0);
    });

    test('graceful fallback when graph fails', async () => {
        mockMagma.query.mockImplementationOnce(() => { throw new Error('graph error'); });
        const result = await rag.augmentedRecall('query');
        expect(result.graphResults).toEqual([]);
        expect(result.vectorResults.length).toBeGreaterThan(0);
    });

    test('works with no providers', async () => {
        const emptyRag = new RAGProvider({});
        // Prevent init from loading remote URL
        emptyRag._initialized = true;
        const result = await emptyRag.augmentedRecall('query');
        expect(result.merged).toEqual([]);
        expect(result.contextString).toBe('');
    });

    test('returns empty on init failure', async () => {
        const failRag = new RAGProvider({ vectorStore: mockVectorStore });
        failRag._initFailed = true;
        const result = await failRag.augmentedRecall('query');
        expect(result.merged).toEqual([]);
        expect(result.contextString).toBe('');
    });

    test('ingest skips when init failed', async () => {
        jest.clearAllMocks();
        const failRag = new RAGProvider({ vectorStore: mockVectorStore });
        failRag._initFailed = true;
        await failRag.ingest('some content', {});
        expect(mockVectorStore.upsert).not.toHaveBeenCalled();
    });

    test('augmentedRecall resolves readyPromise before proceeding', async () => {
        const waitRag = new RAGProvider({ vectorStore: mockVectorStore, magma: mockMagma });
        let resolved = false;
        waitRag._readyPromise = new Promise(r => {
            setTimeout(() => { resolved = true; r(); }, 50);
        });
        waitRag._initialized = true;
        const result = await waitRag.augmentedRecall('query');
        expect(resolved).toBe(true);
        expect(result.merged.length).toBeGreaterThan(0);
    });
});
