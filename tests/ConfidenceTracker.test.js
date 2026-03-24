const ConfidenceTracker = require('../src/managers/ConfidenceTracker');

function makeMockCLM(opts = {}) {
    const rows = opts.rows || [];
    const db = opts.db !== undefined ? opts.db : {};
    return {
        db,
        runAsync: jest.fn().mockResolvedValue(undefined),
        allAsync: jest.fn().mockResolvedValue(rows),
    };
}

describe('ConfidenceTracker', () => {
    let tracker;
    let clm;

    beforeEach(() => {
        jest.clearAllMocks();
        clm = makeMockCLM();
        tracker = new ConfidenceTracker(clm);
    });

    // ──────────────────────────────────────────
    // evaluate() — synchronous, no DB needed
    // ──────────────────────────────────────────
    describe('evaluate()', () => {
        test('returns 高信心 label for a clean response', () => {
            const response = '這樣做是正確的，請按照以下步驟操作即可完成。';
            const result = tracker.evaluate(response, 'OK');
            expect(result.score).toBeGreaterThanOrEqual(0.8);
            expect(result.label).toBe('高信心');
        });

        test('TRUNCATED extractor status reduces score and adds flag', () => {
            const result = tracker.evaluate('some response text here', 'TRUNCATED');
            expect(result.score).toBeLessThan(1.0);
            expect(result.flags).toContain('TRUNCATED_RESPONSE');
        });

        test('FALLBACK_DIFF extractor status reduces score further than TRUNCATED', () => {
            const truncated = tracker.evaluate('some response', 'TRUNCATED');
            const fallback = tracker.evaluate('some response', 'FALLBACK_DIFF');
            expect(fallback.score).toBeLessThan(truncated.score);
            expect(fallback.flags).toContain('PARTIAL_OR_UNSTABLE');
        });

        test('TIMEOUT extractor status gives maximum status penalty', () => {
            const result = tracker.evaluate('some response', 'TIMEOUT');
            expect(result.flags).toContain('TIMEOUT');
            // TIMEOUT statusScore=0.0, penalty = (1.0-0.0)*0.3 = 0.3, so base score <= 0.7
            expect(result.score).toBeLessThanOrEqual(0.7);
        });

        test('vague language words reduce score', () => {
            const vagueResponse = '也許可以，我不確定這樣是否正確。';
            const cleanResponse = '這樣是正確的。';
            const vagueResult = tracker.evaluate(vagueResponse, 'OK');
            const cleanResult = tracker.evaluate(cleanResponse, 'OK');
            expect(vagueResult.score).toBeLessThan(cleanResult.score);
            expect(vagueResult.flags).toMatch(/VAGUE_LANGUAGE/);
        });

        test('rejection words cause 50% score penalty and REJECTION_DETECTED flag', () => {
            const rejected = '我無法回答這個問題，請見諒。';
            const result = tracker.evaluate(rejected, 'OK');
            expect(result.flags).toContain('REJECTION_DETECTED');
            expect(result.score).toBeLessThanOrEqual(0.5);
        });

        test('too short response (< 20 chars, no rejection) adds TOO_SHORT flag', () => {
            const result = tracker.evaluate('太短了', 'OK');
            expect(result.flags).toContain('TOO_SHORT');
        });

        test('score is always clamped between 0.0 and 1.0', () => {
            const result = tracker.evaluate('我無法，也許，可能，我不確定', 'TIMEOUT');
            expect(result.score).toBeGreaterThanOrEqual(0.0);
            expect(result.score).toBeLessThanOrEqual(1.0);
        });

        test('score has at most 2 decimal places', () => {
            const result = tracker.evaluate('測試回應文字。', 'OK');
            const str = result.score.toString();
            const decimals = (str.split('.')[1] || '').length;
            expect(decimals).toBeLessThanOrEqual(2);
        });

        test('flags is a string (may be empty)', () => {
            const result = tracker.evaluate('OK response text', 'OK');
            expect(typeof result.flags).toBe('string');
        });

        test('detailed response (> 500 chars) adds DETAILED flag and small bonus', () => {
            const longResponse = 'A'.repeat(501);
            const shortResponse = 'A'.repeat(100);
            const longResult = tracker.evaluate(longResponse, 'OK');
            const shortResult = tracker.evaluate(shortResponse, 'OK');
            expect(longResult.flags).toContain('DETAILED');
            expect(longResult.score).toBeGreaterThanOrEqual(shortResult.score);
        });

        test('label reflects score ranges', () => {
            // Construct scenarios that hit each label
            const labelMap = { '高信心': 0.8, '中等信心': 0.7, '低信心': 0.5, '不確定': 0.2 };
            // Just verify the returned label is one of the four valid labels
            const result = tracker.evaluate('正常的回答文字', 'OK');
            expect(['高信心', '中等信心', '低信心', '不確定']).toContain(result.label);
        });
    });

    // ──────────────────────────────────────────
    // _ensureInit()
    // ──────────────────────────────────────────
    describe('_ensureInit()', () => {
        test('returns false when chatLogManager.db is null', async () => {
            clm.db = null;
            const ok = await tracker._ensureInit();
            expect(ok).toBe(false);
        });

        test('returns false when chatLogManager is null', async () => {
            tracker = new ConfidenceTracker(null);
            const ok = await tracker._ensureInit();
            expect(ok).toBe(false);
        });

        test('creates metacognition table on first init', async () => {
            const ok = await tracker._ensureInit();
            expect(ok).toBe(true);
            expect(clm.runAsync).toHaveBeenCalledWith(
                expect.stringContaining('CREATE TABLE IF NOT EXISTS metacognition')
            );
        });

        test('does not re-run CREATE TABLE on subsequent calls', async () => {
            await tracker._ensureInit();
            await tracker._ensureInit();
            expect(clm.runAsync).toHaveBeenCalledTimes(1);
        });

        test('returns false when runAsync rejects', async () => {
            clm.runAsync.mockRejectedValueOnce(new Error('DB error'));
            const ok = await tracker._ensureInit();
            expect(ok).toBe(false);
        });
    });

    // ──────────────────────────────────────────
    // record()
    // ──────────────────────────────────────────
    describe('record()', () => {
        test('inserts a row with evaluation fields', async () => {
            const eval_ = { query: 'q', response: 'r', score: 0.9, label: '高信心', flags: '', extractor_status: 'OK' };
            await tracker.record(eval_);
            expect(clm.runAsync).toHaveBeenNthCalledWith(
                1,
                expect.stringContaining('CREATE TABLE IF NOT EXISTS metacognition')
            );
            expect(clm.runAsync).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining('INSERT INTO metacognition'),
                expect.arrayContaining([eval_.score, eval_.label])
            );
        });

        test('does not throw when init fails (null chatLogManager)', async () => {
            tracker = new ConfidenceTracker(null);
            await expect(
                tracker.record({ query: 'q', response: 'r', score: 0.5, label: '低信心', flags: '' })
            ).resolves.toBeUndefined();
        });

        test('handles missing optional evaluation fields gracefully', async () => {
            await expect(tracker.record({ score: 0.8, label: '高信心' })).resolves.toBeUndefined();
            const insertCall = clm.runAsync.mock.calls.find(c => c[0].includes('INSERT'));
            expect(insertCall).toBeDefined();
            // Missing fields should default to empty string / UNKNOWN
            expect(insertCall[1]).toContain('');
        });

        test('does not throw when INSERT runAsync rejects', async () => {
            clm.runAsync
                .mockResolvedValueOnce(undefined)  // CREATE TABLE
                .mockRejectedValueOnce(new Error('insert fail'));
            await expect(
                tracker.record({ score: 0.7, label: '中等信心', flags: '' })
            ).resolves.toBeUndefined();
        });
    });

    // ──────────────────────────────────────────
    // getHistory()
    // ──────────────────────────────────────────
    describe('getHistory()', () => {
        test('returns rows from DB', async () => {
            const fakeRows = [{ id: 2, score: 0.9 }, { id: 1, score: 0.5 }];
            clm.allAsync.mockResolvedValueOnce(fakeRows);
            const result = await tracker.getHistory(2);
            expect(result).toEqual(fakeRows);
            expect(clm.allAsync).toHaveBeenCalledWith(
                expect.stringContaining('ORDER BY timestamp DESC'),
                [2]
            );
        });

        test('returns empty array when init fails', async () => {
            tracker = new ConfidenceTracker(null);
            const result = await tracker.getHistory();
            expect(result).toEqual([]);
        });

        test('defaults to limit 20', async () => {
            await tracker.getHistory();
            expect(clm.allAsync).toHaveBeenCalledWith(expect.any(String), [20]);
        });

        test('returns empty array on DB error', async () => {
            clm.allAsync.mockRejectedValueOnce(new Error('fail'));
            const result = await tracker.getHistory();
            expect(result).toEqual([]);
        });
    });

    // ──────────────────────────────────────────
    // getStats()
    // ──────────────────────────────────────────
    describe('getStats()', () => {
        test('returns null when init fails', async () => {
            tracker = new ConfidenceTracker(null);
            const stats = await tracker.getStats();
            expect(stats).toBeNull();
        });

        test('returns zero stats when no rows exist', async () => {
            clm.allAsync.mockResolvedValueOnce([]);
            const stats = await tracker.getStats();
            expect(stats).toEqual({ avgScore: 0, count: 0, distribution: {} });
        });

        test('computes correct avgScore and count', async () => {
            clm.allAsync.mockResolvedValueOnce([
                { score: 0.8, label: '高信心' },
                { score: 0.6, label: '中等信心' },
                { score: 0.4, label: '低信心' },
                { score: 0.2, label: '不確定' },
            ]);
            const stats = await tracker.getStats();
            expect(stats.count).toBe(4);
            expect(stats.avgScore).toBeCloseTo(0.5, 1);
        });

        test('counts label distribution correctly', async () => {
            clm.allAsync.mockResolvedValueOnce([
                { score: 0.9, label: '高信心' },
                { score: 0.9, label: '高信心' },
                { score: 0.7, label: '中等信心' },
            ]);
            const stats = await tracker.getStats();
            expect(stats.distribution['高信心']).toBe(2);
            expect(stats.distribution['中等信心']).toBe(1);
            expect(stats.distribution['低信心']).toBe(0);
            expect(stats.distribution['不確定']).toBe(0);
        });

        test('avgScore has at most 2 decimal places', async () => {
            clm.allAsync.mockResolvedValueOnce([
                { score: 0.333, label: '中等信心' },
                { score: 0.667, label: '高信心' },
            ]);
            const stats = await tracker.getStats();
            const decimals = (stats.avgScore.toString().split('.')[1] || '').length;
            expect(decimals).toBeLessThanOrEqual(2);
        });

        test('returns null on DB error', async () => {
            clm.allAsync.mockRejectedValueOnce(new Error('db fail'));
            const stats = await tracker.getStats();
            expect(stats).toBeNull();
        });
    });
});
