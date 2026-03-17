const RAGQualityMonitor = require('../src/core/RAGQualityMonitor');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('RAGQualityMonitor', () => {
    let monitor;
    let tmpDir;
    let mockVectorStore;
    let mockTipMemory;
    let mockRAGProvider;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rqm-test-'));

        mockVectorStore = {
            getStats: jest.fn().mockReturnValue({ totalVectors: 150, dbPath: '/tmp/vectors.db' }),
        };

        mockTipMemory = {
            getStats: jest.fn().mockReturnValue({ totalTips: 25, byType: { strategy: 10, recovery: 8, optimization: 7 } }),
            getTopTips: jest.fn().mockReturnValue([
                { confidence: 0.8, outcomes: { success: 5, failure: 1 } },
                { confidence: 0.6, outcomes: { success: 2, failure: 2 } },
            ]),
        };

        mockRAGProvider = {
            augmentedRecall: jest.fn().mockResolvedValue({
                merged: [
                    { content: 'AGI research breakthrough in safety alignment' },
                    { content: 'New model architecture for reasoning' },
                ],
            }),
        };

        monitor = new RAGQualityMonitor({
            dataDir: tmpDir,
            vectorStore: mockVectorStore,
            tipMemory: mockTipMemory,
            ragProvider: mockRAGProvider,
        });
    });

    afterEach(() => {
        if (monitor._writer) monitor._writer.destroy();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('constructor stores dependencies', () => {
        expect(monitor._vectorStore).toBe(mockVectorStore);
        expect(monitor._tipMemory).toBe(mockTipMemory);
        expect(monitor._ragProvider).toBe(mockRAGProvider);
    });

    test('measureVectorGrowth returns stats', () => {
        const result = monitor.measureVectorGrowth();
        expect(result.totalVectors).toBe(150);
        expect(result.dbPath).toBe('/tmp/vectors.db');
    });

    test('measureVectorGrowth handles missing vectorStore', () => {
        const m = new RAGQualityMonitor({ dataDir: tmpDir });
        const result = m.measureVectorGrowth();
        expect(result.totalVectors).toBe(0);
        expect(result.error).toBe('No VectorStore');
        m._writer.destroy();
    });

    test('measureTipEffectiveness returns stats', () => {
        const result = monitor.measureTipEffectiveness();
        expect(result.totalTips).toBe(25);
        expect(result.byType).toEqual({ strategy: 10, recovery: 8, optimization: 7 });
        expect(result.successRate).toBeGreaterThan(0);
        expect(result.avgConfidence).toBeGreaterThan(0);
    });

    test('measureTipEffectiveness uses getEffectivenessStats if available', () => {
        mockTipMemory.getEffectivenessStats = jest.fn().mockReturnValue({
            successRate: 0.75,
            avgConfidence: 0.65,
        });
        const result = monitor.measureTipEffectiveness();
        expect(result.successRate).toBe(0.75);
        expect(result.avgConfidence).toBe(0.65);
    });

    test('measureTipEffectiveness handles missing tipMemory', () => {
        const m = new RAGQualityMonitor({ dataDir: tmpDir });
        const result = m.measureTipEffectiveness();
        expect(result.totalTips).toBe(0);
        expect(result.error).toBe('No TipMemory');
        m._writer.destroy();
    });

    test('measureSearchQuality runs test queries', async () => {
        const result = await monitor.measureSearchQuality();
        expect(result.queryResults.length).toBe(10); // default 10 test queries
        expect(result.avgLatencyMs).toBeGreaterThanOrEqual(0);
        expect(result.recall).toBeGreaterThanOrEqual(0);
    });

    test('measureSearchQuality handles missing ragProvider', async () => {
        const m = new RAGQualityMonitor({ dataDir: tmpDir });
        const result = await m.measureSearchQuality();
        expect(result.error).toBe('No RAGProvider');
        m._writer.destroy();
    });

    test('measureSearchQuality handles search errors', async () => {
        mockRAGProvider.augmentedRecall.mockRejectedValue(new Error('search failed'));
        const result = await monitor.measureSearchQuality();
        expect(result.queryResults.every(r => r.error)).toBe(true);
    });

    test('measureSearchQuality with custom queries', async () => {
        const custom = [{ query: 'test query', expectedTopics: ['test'] }];
        const result = await monitor.measureSearchQuality(custom);
        expect(result.queryResults.length).toBe(1);
    });

    test('generateReport produces full report', async () => {
        const report = await monitor.generateReport();
        expect(report).toHaveProperty('timestamp');
        expect(report).toHaveProperty('vectorGrowth');
        expect(report).toHaveProperty('tipEffectiveness');
        expect(report).toHaveProperty('searchQuality');
        expect(report.vectorGrowth.totalVectors).toBe(150);
    });

    test('generateReport saves to file', async () => {
        await monitor.generateReport();
        await monitor._writer.forceFlush();
        const filePath = path.join(tmpDir, 'rag_quality_metrics.json');
        expect(fs.existsSync(filePath)).toBe(true);
    });
});
