const RAGProvider = require('../src/memory/RAGProvider');
const ThreeLayerMemory = require('../src/memory/ThreeLayerMemory');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('RAGProvider.searchBySource (v12.0)', () => {
    let rag;

    beforeEach(() => {
        rag = new RAGProvider({});
        rag._initialized = true;
        rag._initFailed = false;
    });

    test('searchBySource returns empty when no vectorStore', async () => {
        const results = await rag.searchBySource('test query', 'security-audit');
        expect(results).toHaveLength(0);
    });

    test('searchBySource filters by source metadata', async () => {
        rag._vectorStore = {
            search: async () => [
                { id: '1', content: 'audit result', score: 0.9, metadata: { source: 'security-audit' } },
                { id: '2', content: 'other', score: 0.8, metadata: { source: 'worker-health' } },
                { id: '3', content: 'audit 2', score: 0.7, metadata: { source: 'security-audit' } },
            ]
        };
        const results = await rag.searchBySource('test', 'security-audit');
        expect(results.length).toBe(2);
        expect(results.every(r => r.metadata.source === 'security-audit')).toBe(true);
    });

    test('searchBySource respects limit', async () => {
        rag._vectorStore = {
            search: async () => Array.from({ length: 20 }, (_, i) => ({
                id: `${i}`, content: `item ${i}`, score: 0.5, metadata: { source: 'test' }
            }))
        };
        const results = await rag.searchBySource('q', 'test', { limit: 3 });
        expect(results.length).toBe(3);
    });

    test('searchBySource returns empty when init failed', async () => {
        rag._initFailed = true;
        const results = await rag.searchBySource('test', 'test');
        expect(results).toHaveLength(0);
    });
});

describe('ThreeLayerMemory.ingestOperationalMemory (v12.0)', () => {
    let memory;
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlm-'));
        // Override episode file path
        const origCwd = process.cwd;
        process.cwd = () => tmpDir;
        memory = new ThreeLayerMemory({ golemId: 'test' });
        process.cwd = origCwd;
    });

    afterEach(() => {
        if (memory._writer) memory._writer.destroy();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('ingestOperationalMemory creates episode', () => {
        const episode = memory.ingestOperationalMemory('security-audit', { riskScore: 25 });
        expect(episode).not.toBeNull();
        expect(episode.situation).toContain('[security-audit]');
        expect(episode.outcome).toBe('Operational memory: security-audit');
    });

    test('ingestOperationalMemory handles string data', () => {
        const episode = memory.ingestOperationalMemory('worker-health', 'All workers healthy');
        expect(episode.situation).toContain('All workers healthy');
    });

    test('ingestOperationalMemory returns null for invalid input', () => {
        expect(memory.ingestOperationalMemory(null, null)).toBeNull();
        expect(memory.ingestOperationalMemory('', null)).toBeNull();
    });

    test('ingested memory is queryable', () => {
        memory.ingestOperationalMemory('error-patterns', 'timeout errors in WebResearcher');
        const results = memory.queryEpisodesSync('timeout WebResearcher', 5);
        expect(results.length).toBeGreaterThan(0);
    });
});
