// tests/VectorStore.test.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const VectorStore = require('../src/memory/VectorStore');

// Mock EmbeddingProvider that returns deterministic vectors
class MockEmbeddingProvider {
    constructor() {
        this._dim = 768;
    }

    async embed(text) {
        // Generate a deterministic vector based on text hash
        const vec = new Float32Array(this._dim);
        let seed = 0;
        for (let i = 0; i < text.length; i++) seed += text.charCodeAt(i);
        for (let i = 0; i < this._dim; i++) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            vec[i] = (seed / 0x7fffffff) * 2 - 1;
        }
        // Normalize
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

describe('VectorStore', () => {
    let vs, ep, dbPath;

    beforeEach(async () => {
        dbPath = path.join(os.tmpdir(), `golem_test_vectors_${Date.now()}.db`);
        ep = new MockEmbeddingProvider();
        vs = new VectorStore(dbPath, ep);
        await vs.init();
    });

    afterEach(() => {
        vs.close();
        try { fs.unlinkSync(dbPath); } catch (e) {}
        try { fs.unlinkSync(dbPath + '-wal'); } catch (e) {}
        try { fs.unlinkSync(dbPath + '-shm'); } catch (e) {}
    });

    test('init creates database and table', () => {
        expect(vs._db).not.toBeNull();
        const stats = vs.getStats();
        expect(stats.totalVectors).toBe(0);
    });

    test('upsert and search basic', async () => {
        await vs.upsert('doc1', 'The quick brown fox jumps over the lazy dog');
        await vs.upsert('doc2', 'Machine learning is a subset of artificial intelligence');
        await vs.upsert('doc3', 'The fox is a clever animal');

        const results = await vs.search('fox animal', { limit: 2 });
        expect(results.length).toBeLessThanOrEqual(2);
        expect(results[0]).toHaveProperty('id');
        expect(results[0]).toHaveProperty('content');
        expect(results[0]).toHaveProperty('score');
        expect(typeof results[0].score).toBe('number');
    });

    test('upsert replaces existing entry', async () => {
        await vs.upsert('doc1', 'original content');
        await vs.upsert('doc1', 'updated content');

        const stats = vs.getStats();
        expect(stats.totalVectors).toBe(1);

        const results = await vs.search('updated', { limit: 1 });
        expect(results[0].content).toBe('updated content');
    });

    test('upsertBatch inserts multiple items', async () => {
        await vs.upsertBatch([
            { id: 'b1', content: 'batch item one', metadata: { source: 'test' } },
            { id: 'b2', content: 'batch item two', metadata: { source: 'test' } },
            { id: 'b3', content: 'batch item three' },
        ]);

        const stats = vs.getStats();
        expect(stats.totalVectors).toBe(3);
    });

    test('search with source filter', async () => {
        await vs.upsert('s1', 'source A content', { source: 'alpha' });
        await vs.upsert('s2', 'source B content', { source: 'beta' });

        const results = await vs.search('content', { source: 'alpha' });
        expect(results.length).toBe(1);
        expect(results[0].id).toBe('s1');
    });

    test('delete removes entry', async () => {
        await vs.upsert('del1', 'to be deleted');
        expect(vs.getStats().totalVectors).toBe(1);

        await vs.delete('del1');
        expect(vs.getStats().totalVectors).toBe(0);
    });

    test('upsert ignores empty id or content', async () => {
        await vs.upsert('', 'no id');
        await vs.upsert('noid', '');
        expect(vs.getStats().totalVectors).toBe(0);
    });

    test('search returns sorted by score descending', async () => {
        await vs.upsert('a', 'apple pie recipe baking');
        await vs.upsert('b', 'quantum physics research paper');
        await vs.upsert('c', 'apple orchard farming');

        const results = await vs.search('apple', { limit: 3 });
        for (let i = 1; i < results.length; i++) {
            expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
        }
    });

    test('getStats returns correct structure', () => {
        const stats = vs.getStats();
        expect(stats).toHaveProperty('totalVectors');
        expect(stats).toHaveProperty('dbPath');
    });

    test('upsert handles SQLite error gracefully', async () => {
        // Close DB to trigger error
        const closedVs = new VectorStore(dbPath, ep);
        await closedVs.init();
        closedVs._db.close();
        closedVs._db = null;
        // Should resolve without throwing (error caught internally)
        await closedVs.upsert('err1', 'error content');
        // If we get here, the error was swallowed gracefully
    });

    test('search respects maxCandidates', async () => {
        // Insert a few items
        for (let i = 0; i < 5; i++) {
            await vs.upsert(`mc${i}`, `max candidates test content ${i}`);
        }
        const results = await vs.search('test', { limit: 3, maxCandidates: 2 });
        // Should work, results capped by maxCandidates then topK
        expect(results.length).toBeLessThanOrEqual(3);
    });

    test('getRecent returns recent vectors', async () => {
        await vs.upsert('r1', 'recent content one');
        await vs.upsert('r2', 'recent content two');
        await vs.upsert('r3', 'recent content three');

        const recent = vs.getRecent(2);
        expect(recent.length).toBe(2);
        expect(recent[0]).toHaveProperty('id');
        expect(recent[0]).toHaveProperty('content');
    });
});
