const ScanQualityTracker = require('../src/core/ScanQualityTracker');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('ScanQualityTracker', () => {
    let tracker;
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqt-test-'));
        tracker = new ScanQualityTracker({ dataDir: tmpDir });
    });

    afterEach(() => {
        if (tracker._writer) tracker._writer.destroy();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('constructor initializes empty records', () => {
        expect(tracker.getStats().totalQueries).toBe(0);
    });

    test('recordScanResult tracks a query', () => {
        tracker.recordScanResult('AGI breakthroughs 2026', 'research', { resultCount: 5, hasSynthesis: true });
        const stats = tracker.getStats();
        expect(stats.totalQueries).toBe(1);
        expect(stats.totalRuns).toBe(1);
    });

    test('recordScanResult increments success on results', () => {
        tracker.recordScanResult('query1', 'cat', { resultCount: 3 });
        tracker.recordScanResult('query1', 'cat', { resultCount: 2 });
        const effectiveness = tracker.getQueryEffectiveness();
        const q = effectiveness.find(e => e.query === 'query1');
        expect(q.successRate).toBe(1);
        expect(q.totalRuns).toBe(2);
    });

    test('recordScanResult tracks failures and consecutive zeros', () => {
        tracker.recordScanResult('bad query', 'cat', { resultCount: 0 });
        tracker.recordScanResult('bad query', 'cat', { resultCount: 0 });
        tracker.recordScanResult('bad query', 'cat', { resultCount: 0 });
        const effectiveness = tracker.getQueryEffectiveness();
        const q = effectiveness.find(e => e.query === 'bad query');
        expect(q.successRate).toBe(0);
        expect(q.consecutive_zeros).toBe(3);
    });

    test('getWorthlessQueries returns queries with 3+ consecutive zeros', () => {
        tracker.recordScanResult('bad', 'cat', { resultCount: 0 });
        tracker.recordScanResult('bad', 'cat', { resultCount: 0 });
        tracker.recordScanResult('bad', 'cat', { resultCount: 0 });
        expect(tracker.getWorthlessQueries()).toContain('bad');
    });

    test('consecutive_zeros resets on success', () => {
        tracker.recordScanResult('q', 'cat', { resultCount: 0 });
        tracker.recordScanResult('q', 'cat', { resultCount: 0 });
        tracker.recordScanResult('q', 'cat', { resultCount: 1 }); // reset
        tracker.recordScanResult('q', 'cat', { resultCount: 0 });
        expect(tracker.isWorthless('q')).toBe(false);
    });

    test('isWorthless returns correct result', () => {
        expect(tracker.isWorthless('unknown')).toBe(false);
        tracker.recordScanResult('w', 'cat', { resultCount: 0 });
        tracker.recordScanResult('w', 'cat', { resultCount: 0 });
        tracker.recordScanResult('w', 'cat', { resultCount: 0 });
        expect(tracker.isWorthless('w')).toBe(true);
    });

    test('hasSynthesis counts as success even with 0 resultCount', () => {
        tracker.recordScanResult('synth', 'cat', { resultCount: 0, hasSynthesis: true });
        const q = tracker.getQueryEffectiveness().find(e => e.query === 'synth');
        expect(q.successRate).toBe(1);
    });

    test('getTopQueries returns best performing queries', () => {
        tracker.recordScanResult('good', 'cat', { resultCount: 5 });
        tracker.recordScanResult('good', 'cat', { resultCount: 3 });
        tracker.recordScanResult('bad', 'cat', { resultCount: 0 });
        tracker.recordScanResult('bad', 'cat', { resultCount: 0 });
        const top = tracker.getTopQueries(5);
        expect(top.length).toBe(2);
        expect(top[0].query).toBe('good');
    });

    test('caps records at MAX_RECORDS', () => {
        for (let i = 0; i < 510; i++) {
            tracker.recordScanResult(`query_${i}_unique`, 'cat', { resultCount: 1 });
        }
        expect(tracker.getStats().totalQueries).toBeLessThanOrEqual(500);
    });

    test('persistence: load from file', async () => {
        tracker.recordScanResult('persist_q', 'test', { resultCount: 3 });
        await tracker._writer.forceFlush();

        const tracker2 = new ScanQualityTracker({ dataDir: tmpDir });
        expect(tracker2.getStats().totalQueries).toBe(1);
        tracker2._writer.destroy();
    });

    test('normalizes query case for matching', () => {
        tracker.recordScanResult('AGI Breakthroughs', 'research', { resultCount: 1 });
        tracker.recordScanResult('agi breakthroughs', 'research', { resultCount: 1 });
        expect(tracker.getStats().totalQueries).toBe(1);
        expect(tracker.getStats().totalRuns).toBe(2);
    });

    test('handles corrupted data file gracefully', () => {
        fs.writeFileSync(path.join(tmpDir, 'scan_quality_tracker.json'), '{invalid');
        const tracker2 = new ScanQualityTracker({ dataDir: tmpDir });
        expect(tracker2.getStats().totalQueries).toBe(0);
        tracker2._writer.destroy();
    });
});
