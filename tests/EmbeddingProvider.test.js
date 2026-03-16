// tests/EmbeddingProvider.test.js
const EmbeddingProvider = require('../src/memory/EmbeddingProvider');

describe('EmbeddingProvider', () => {
    let ep;

    beforeEach(() => {
        ep = new EmbeddingProvider({ apiKeys: [], cacheSize: 5 });
        // Don't call init() — no real API keys in test
    });

    test('embed returns Float32Array of correct dimension on empty provider', async () => {
        const result = await ep.embed('hello world');
        expect(result).toBeInstanceOf(Float32Array);
        expect(result.length).toBe(768);
    });

    test('embed returns zero vector for empty input', async () => {
        const result = await ep.embed('');
        expect(result).toBeInstanceOf(Float32Array);
        expect(result.length).toBe(768);
        expect(result[0]).toBe(0);
    });

    test('embed returns zero vector for null input', async () => {
        const result = await ep.embed(null);
        expect(result.length).toBe(768);
    });

    test('cosineSimilarity computes correctly', () => {
        const a = new Float32Array([1, 0, 0]);
        const b = new Float32Array([1, 0, 0]);
        expect(ep.cosineSimilarity(a, b)).toBeCloseTo(1.0);

        const c = new Float32Array([0, 1, 0]);
        expect(ep.cosineSimilarity(a, c)).toBeCloseTo(0.0);

        const d = new Float32Array([-1, 0, 0]);
        expect(ep.cosineSimilarity(a, d)).toBeCloseTo(-1.0);
    });

    test('cosineSimilarity handles zero vectors', () => {
        const a = new Float32Array([0, 0, 0]);
        const b = new Float32Array([1, 0, 0]);
        expect(ep.cosineSimilarity(a, b)).toBe(0);
    });

    test('cosineSimilarity handles mismatched lengths', () => {
        const a = new Float32Array([1, 0]);
        const b = new Float32Array([1, 0, 0]);
        expect(ep.cosineSimilarity(a, b)).toBe(0);
    });

    test('LRU cache evicts oldest entries', async () => {
        // Fill cache with 5 items
        for (let i = 0; i < 5; i++) {
            await ep.embed(`text_${i}`);
        }
        expect(ep._cache.size).toBe(5);

        // Add 6th — should evict oldest
        await ep.embed('text_5');
        expect(ep._cache.size).toBe(5);

        // The first hash should be evicted
        const firstHash = ep._hash('text_0');
        expect(ep._cache.has(firstHash)).toBe(false);
        // The latest should still be cached
        const lastHash = ep._hash('text_5');
        expect(ep._cache.has(lastHash)).toBe(true);
    });

    test('LRU cache moves accessed item to end', async () => {
        // Fill cache
        for (let i = 0; i < 5; i++) {
            await ep.embed(`lru_${i}`);
        }
        // Access lru_0 (oldest) — should move it to end
        await ep.embed('lru_0');
        // Now add a new one — should evict lru_1 (the new oldest), not lru_0
        await ep.embed('lru_new');
        expect(ep._cache.has(ep._hash('lru_0'))).toBe(true);
        expect(ep._cache.has(ep._hash('lru_1'))).toBe(false);
    });

    test('embedBatch returns correct number of results', async () => {
        const texts = ['hello', 'world', 'test'];
        const results = await ep.embedBatch(texts, 2);
        expect(results).toHaveLength(3);
        results.forEach(r => {
            expect(r).toBeInstanceOf(Float32Array);
            expect(r.length).toBe(768);
        });
    });

    test('_hash returns consistent hash', () => {
        const h1 = ep._hash('hello');
        const h2 = ep._hash('hello');
        const h3 = ep._hash('world');
        expect(h1).toBe(h2);
        expect(h1).not.toBe(h3);
        expect(h1.length).toBe(16);
    });

    test('getStats returns correct structure', () => {
        const stats = ep.getStats();
        expect(stats).toHaveProperty('cacheSize', 0);
        expect(stats).toHaveProperty('cacheCapacity', 5);
        expect(stats).toHaveProperty('model', 'text-embedding-004');
    });
});
