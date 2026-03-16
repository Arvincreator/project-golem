// tests/VectorIndexer.test.js
const os = require('os');
const path = require('path');
const fs = require('fs');
const VectorIndexer = require('../src/memory/VectorIndexer');

describe('VectorIndexer', () => {
    let indexer;
    const mockVectorStore = {
        upsert: jest.fn().mockResolvedValue(undefined),
        upsertBatch: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
        getRecent: jest.fn().mockReturnValue([]),
        _stmtGetAll: { all: jest.fn().mockReturnValue([]) },
        _ep: {
            cosineSimilarity: jest.fn().mockReturnValue(0.5),
        },
    };
    const mockRAG = {};

    beforeEach(() => {
        jest.clearAllMocks();
        indexer = new VectorIndexer(mockVectorStore, mockRAG, { interval: 60000 });
    });

    afterEach(() => {
        indexer.stop();
    });

    test('constructor initializes with defaults', () => {
        const stats = indexer.getStats();
        expect(stats.indexed).toBe(0);
        expect(stats.deduplicated).toBe(0);
        expect(stats.errors).toBe(0);
    });

    test('start and stop without timer (indexing triggered externally)', async () => {
        indexer.start();
        // No timer — indexing is triggered by sleep consolidation
        expect(indexer._timer).toBeNull();
        await indexer.stop();
        expect(indexer._timer).toBeNull();
    });

    test('start is idempotent', () => {
        indexer.start();
        indexer.start(); // should not throw
        expect(indexer._timer).toBeNull();
    });

    test('indexEpisodes processes episodes', async () => {
        const mockMemory = {
            _episodes: [
                { id: 'ep1', situation: 'short', outcome: '' },
                { id: 'ep2', situation: 'this is a longer episode situation', outcome: 'with outcome text' },
                { id: 'ep3', situation: 'another longer episode for testing', outcome: 'result' },
            ],
        };
        const count = await indexer.indexEpisodes(mockMemory);
        expect(count).toBe(2); // only ep2 and ep3 (>10 chars)
        expect(mockVectorStore.upsertBatch).toHaveBeenCalledTimes(1);
    });

    test('indexEpisodes handles null memory', async () => {
        const count = await indexer.indexEpisodes(null);
        expect(count).toBe(0);
    });

    test('indexMAGMANodes processes nodes', async () => {
        const mockMagma = {
            _data: {
                nodes: [
                    { id: 'n1', name: 'test node', type: 'concept' },
                    { id: 'n2', content: 'node with content' },
                    { id: 'n3' }, // no name or content — should be filtered
                ],
            },
        };
        const count = await indexer.indexMAGMANodes(mockMagma);
        expect(count).toBe(2);
    });

    test('indexMAGMANodes handles null magma', async () => {
        const count = await indexer.indexMAGMANodes(null);
        expect(count).toBe(0);
    });

    test('indexConversationLogs indexes log files', async () => {
        const tmpDir = path.join(os.tmpdir(), `golem_test_logs_${Date.now()}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'test1.log'), 'line1\nline2\nline3\nline4\nline5\nline6');
        fs.writeFileSync(path.join(tmpDir, 'test2.jsonl'), '{"msg":"hello"}\n{"msg":"world"}');

        const count = await indexer.indexConversationLogs(tmpDir);
        expect(count).toBe(2);

        // Cleanup
        fs.rmSync(tmpDir, { recursive: true });
    });

    test('indexConversationLogs handles missing dir', async () => {
        const count = await indexer.indexConversationLogs('/nonexistent/dir');
        expect(count).toBe(0);
    });

    test('indexMemoryFiles indexes .md files', async () => {
        const tmpDir = path.join(os.tmpdir(), `golem_test_mem_${Date.now()}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'note1.md'), 'This is a memory note about testing');
        fs.writeFileSync(path.join(tmpDir, 'note2.md'), 'Another memory file with content');
        fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'not a markdown file');

        const count = await indexer.indexMemoryFiles(tmpDir);
        expect(count).toBe(2);

        fs.rmSync(tmpDir, { recursive: true });
    });

    test('consolidate removes duplicates above threshold', async () => {
        const makeBlob = (vals) => {
            const arr = new Float32Array(vals);
            return Buffer.from(arr.buffer);
        };

        mockVectorStore.getRecent.mockReturnValue([
            { id: 'a', content: 'short', embedding: makeBlob([1, 0, 0]) },
            { id: 'b', content: 'longer content', embedding: makeBlob([1, 0, 0]) },
            // Need at least 10 rows for consolidation to run
            ...Array.from({ length: 10 }, (_, i) => ({
                id: `filler_${i}`,
                content: `filler content ${i} padding`,
                embedding: makeBlob([0, 1, 0]),
            })),
        ]);

        // Make similarity very high for first two
        mockVectorStore._ep.cosineSimilarity.mockImplementation((a, b) => {
            // All fillers are identical to each other
            return 0.96;
        });

        const removed = await indexer.consolidate();
        expect(removed).toBeGreaterThan(0);
        expect(mockVectorStore.delete).toHaveBeenCalled();
    });

    test('consolidate skips when few vectors', async () => {
        mockVectorStore.getRecent.mockReturnValue([
            { id: 'a', content: 'only one', embedding: Buffer.from(new Float32Array([1]).buffer) },
        ]);
        const removed = await indexer.consolidate();
        expect(removed).toBe(0);
    });

    test('getStats returns current stats', () => {
        const stats = indexer.getStats();
        expect(stats).toHaveProperty('indexed');
        expect(stats).toHaveProperty('deduplicated');
        expect(stats).toHaveProperty('errors');
        expect(stats).toHaveProperty('lastRun');
    });
});
