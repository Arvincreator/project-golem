const AGIScanner = require('../src/core/AGIScanner');

describe('AGIScanner', () => {
    let scanner;
    let mockResearcher;
    let mockRag;

    beforeEach(() => {
        mockResearcher = {
            search: jest.fn().mockResolvedValue({
                query: 'test',
                results: [{ title: 'Test Result', url: 'https://example.com', snippet: 'A test' }],
                synthesis: 'Test synthesis content',
                webSearchQueries: ['test query'],
                timestamp: new Date().toISOString(),
                fromCache: false,
            }),
        };
        mockRag = {
            ingest: jest.fn().mockResolvedValue(true),
        };
        scanner = new AGIScanner({ webResearcher: mockResearcher, ragProvider: mockRag });
    });

    describe('constructor', () => {
        test('accepts empty options', () => {
            const s = new AGIScanner();
            expect(s._webResearcher).toBeNull();
            expect(s._ragProvider).toBeNull();
        });

        test('stores injected dependencies', () => {
            expect(scanner._webResearcher).toBe(mockResearcher);
            expect(scanner._ragProvider).toBe(mockRag);
        });
    });

    describe('scanCategory', () => {
        test('returns error for unknown category', async () => {
            const result = await scanner.scanCategory('nonexistent');
            expect(result.errors.length).toBe(1);
            expect(result.queriesRun).toBe(0);
        });

        test('scans research category', async () => {
            const result = await scanner.scanCategory('research', { researcher: mockResearcher, maxQueries: 2 });
            expect(result.category).toBe('research');
            expect(result.queriesRun).toBe(2);
            expect(result.results.length).toBe(2);
            expect(mockResearcher.search).toHaveBeenCalledTimes(2);
        });

        test('handles search failure gracefully', async () => {
            mockResearcher.search.mockRejectedValueOnce(new Error('API down'));
            const result = await scanner.scanCategory('research', { researcher: mockResearcher, maxQueries: 1 });
            expect(result.errors.length).toBe(1);
            expect(result.queriesRun).toBe(1);
        });
    });

    describe('fullScan', () => {
        test('scans all 8 categories', async () => {
            const report = await scanner.fullScan({ maxQueriesPerCategory: 1 });
            expect(Object.keys(report.categories)).toHaveLength(8);
            expect(report.categories.research).toBeDefined();
            expect(report.categories.code).toBeDefined();
            expect(report.categories.safety).toBeDefined();
            expect(report.categories.benchmarks).toBeDefined();
            expect(report.categories.community).toBeDefined();
            expect(report.categories.chinese_ai).toBeDefined();
            expect(report.categories.claude_ecosystem).toBeDefined();
            expect(report.categories.agent_landscape).toBeDefined();
            expect(report.totalQueries).toBe(8);
            expect(report.timestamp).toBeTruthy();
        });

        test('returns error when no researcher available', async () => {
            const s = new AGIScanner();
            // Mock require to fail
            const origCreateDefault = s._createDefaultResearcher.bind(s);
            s._createDefaultResearcher = () => null;
            s._webResearcher = null;
            const report = await s.fullScan();
            expect(report.errors.length).toBeGreaterThan(0);
        });

        test('respects maxQueriesPerCategory', async () => {
            const report = await scanner.fullScan({ maxQueriesPerCategory: 1 });
            for (const cat of Object.values(report.categories)) {
                expect(cat.queriesRun).toBeLessThanOrEqual(1);
            }
        });
    });

    describe('ingestFindings', () => {
        test('returns zeros when no ragProvider', async () => {
            const s = new AGIScanner({ webResearcher: mockResearcher });
            const result = await s.ingestFindings({ categories: {} });
            expect(result).toEqual({ ingested: 0, failed: 0 });
        });

        test('ingests scan results to RAG', async () => {
            const report = await scanner.fullScan({ maxQueriesPerCategory: 1 });
            const result = await scanner.ingestFindings(report);
            expect(result.ingested).toBeGreaterThan(0);
            expect(mockRag.ingest).toHaveBeenCalled();
        });

        test('handles null scanReport', async () => {
            const result = await scanner.ingestFindings(null);
            expect(result).toEqual({ ingested: 0, failed: 0 });
        });

        test('counts failed ingestions', async () => {
            mockRag.ingest.mockRejectedValue(new Error('ingest failed'));
            const report = {
                timestamp: new Date().toISOString(),
                categories: {
                    research: { results: [{ synthesis: 'test', query: 'q' }] },
                },
            };
            const result = await scanner.ingestFindings(report);
            expect(result.failed).toBe(1);
        });
    });

    describe('formatReport', () => {
        test('handles null report', () => {
            expect(scanner.formatReport(null)).toContain('No report');
        });

        test('formats report with categories', async () => {
            const report = await scanner.fullScan({ maxQueriesPerCategory: 1 });
            const formatted = scanner.formatReport(report);
            expect(formatted).toContain('AGI Scan Report');
            expect(formatted).toContain('Total queries:');
        });
    });
});
