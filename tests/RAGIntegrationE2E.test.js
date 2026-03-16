// tests/RAGIntegrationE2E.test.js — E2E: ingest → search → RRF merge → contextString
const path = require('path');
const fs = require('fs');
const os = require('os');
const VectorStore = require('../src/memory/VectorStore');
const RAGProvider = require('../src/memory/RAGProvider');

// Deterministic mock embedding provider
class MockEmbeddingProvider {
    constructor() { this._dim = 768; }

    async embed(text) {
        const vec = new Float32Array(this._dim);
        let seed = 0;
        for (let i = 0; i < text.length; i++) seed += text.charCodeAt(i);
        for (let i = 0; i < this._dim; i++) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            vec[i] = (seed / 0x7fffffff) * 2 - 1;
        }
        let norm = 0;
        for (let i = 0; i < this._dim; i++) norm += vec[i] * vec[i];
        norm = Math.sqrt(norm);
        if (norm > 0) for (let i = 0; i < this._dim; i++) vec[i] /= norm;
        return vec;
    }

    async embedBatch(texts) {
        return Promise.all(texts.map(t => this.embed(t)));
    }

    cosineSimilarity(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom === 0 ? 0 : dot / denom;
    }
}

describe('RAG Integration E2E', () => {
    let vs, ep, rag, dbPath;

    const mockMagma = {
        query: jest.fn().mockReturnValue({
            nodes: [
                { id: 'graph_deploy', name: 'deployment pipeline', type: 'concept', _relevanceScore: 0.85 },
            ],
        }),
        addNode: jest.fn(),
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        dbPath = path.join(os.tmpdir(), `golem_e2e_rag_${Date.now()}.db`);
        ep = new MockEmbeddingProvider();
        vs = new VectorStore(dbPath, ep);
        await vs.init();

        rag = new RAGProvider({ vectorStore: vs, magma: mockMagma });
        rag._initialized = true;
    });

    afterEach(() => {
        vs.close();
        try { fs.unlinkSync(dbPath); } catch (e) {}
        try { fs.unlinkSync(dbPath + '-wal'); } catch (e) {}
        try { fs.unlinkSync(dbPath + '-shm'); } catch (e) {}
    });

    test('full flow: ingest → search → RRF merge → contextString', async () => {
        // Ingest documents
        await rag.ingest('deploying application to production server', { type: 'episode', source: 'test' });
        await rag.ingest('debugging authentication module errors', { type: 'episode', source: 'test' });
        await rag.ingest('server deployment configuration guide', { type: 'knowledge', source: 'test' });

        // Verify vector store has entries
        expect(vs.getStats().totalVectors).toBe(3);

        // Query — should return RRF-merged results from vector + graph
        const result = await rag.augmentedRecall('deploy production', { limit: 5 });

        expect(result.vectorResults.length).toBeGreaterThan(0);
        expect(result.graphResults.length).toBeGreaterThan(0);
        expect(result.merged.length).toBeGreaterThan(0);
        expect(result.contextString).toBeTruthy();

        // RRF should boost items appearing in both vector and graph
        expect(result.contextString).toContain('[1]');
        expect(result.contextString).toMatch(/score: \d+\.\d+/);
    });

    test('ingest writes to both vector store and graph', async () => {
        await rag.ingest('test content for graph', { type: 'test', source: 'e2e' });

        expect(vs.getStats().totalVectors).toBe(1);
        expect(mockMagma.addNode).toHaveBeenCalledTimes(1);
    });

    test('empty query returns results from recent entries', async () => {
        await rag.ingest('some content', { source: 'test' });
        const result = await rag.augmentedRecall('completely unrelated query');
        // Should still return something (low score)
        expect(result).toHaveProperty('merged');
        expect(result).toHaveProperty('contextString');
    });

    test('initFailed returns empty gracefully', async () => {
        rag._initFailed = true;
        const result = await rag.augmentedRecall('any query');
        expect(result.merged).toEqual([]);
        expect(result.contextString).toBe('');
    });

    test('getRecent works with real SQLite', async () => {
        await vs.upsert('e2e_1', 'first entry');
        await vs.upsert('e2e_2', 'second entry');
        const recent = vs.getRecent(10);
        expect(recent.length).toBe(2);
    });
});
