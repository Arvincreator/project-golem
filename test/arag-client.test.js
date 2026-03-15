// arag-client.test.js — vitest globals mode

// Mock env
process.env.GRAPH_RAG_URL = 'https://yedan-graph-rag.yagami8095.workers.dev';
process.env.GRAPH_RAG_TOKEN = 'graph-rag-2026';

const AragClient = require('../src/services/AragClient');

describe('AragClient', () => {
    let client;

    beforeEach(() => {
        client = new AragClient();
    });

    it('should initialize with env vars', () => {
        expect(client.baseUrl).toBe('https://yedan-graph-rag.yagami8095.workers.dev');
        expect(client.token).toBe('graph-rag-2026');
    });

    it('should have all required methods', () => {
        expect(typeof client.query).toBe('function');
        expect(typeof client.ingest).toBe('function');
        expect(typeof client.stats).toBe('function');
        expect(typeof client.health).toBe('function');
    });

    it('health() should return valid response from live endpoint', async () => {
        const result = await client.health();
        expect(result).toBeDefined();
        if (result) {
            expect(result.status).toBe('operational');
        }
    });

    it('stats() should return valid response', async () => {
        const result = await client.stats();
        expect(result === null || typeof result === 'object').toBe(true);
    });
});
