const TokenTracker = require('../src/core/TokenTracker');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('TokenTracker', () => {
    let tracker;
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-test-'));
        tracker = new TokenTracker({
            budget: 10000,
            dataDir: tmpDir,
            dataFile: path.join(tmpDir, 'token_usage.json'),
            warnThresholdPct: 80,
        });
    });

    afterEach(() => {
        if (tracker._writer) tracker._writer.destroy();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('record tracks per-module usage', () => {
        tracker.record('ContextEngineer', 500, 'input');
        tracker.record('ContextEngineer', 200, 'output');
        tracker.record('WebResearcher', 300, 'input');

        const report = tracker.getReport();
        expect(report.totalUsed).toBe(1000);
        expect(report.byModule.ContextEngineer.input).toBe(500);
        expect(report.byModule.ContextEngineer.output).toBe(200);
        expect(report.byModule.ContextEngineer.total).toBe(700);
        expect(report.byModule.WebResearcher.input).toBe(300);
    });

    test('getReport includes budget info', () => {
        tracker.record('Test', 5000, 'input');
        const report = tracker.getReport();
        expect(report.budget).toBe(10000);
        expect(report.budgetRemaining).toBe(5000);
        expect(report.budgetPct).toBe(50);
    });

    test('isOverBudget detects when budget exceeded', () => {
        expect(tracker.isOverBudget()).toBe(false);
        tracker.record('Test', 10000, 'input');
        expect(tracker.isOverBudget()).toBe(true);
    });

    test('resetDaily clears all counters', () => {
        tracker.record('Test', 500, 'input');
        tracker.resetDaily();
        const report = tracker.getReport();
        expect(report.totalUsed).toBe(0);
        expect(Object.keys(report.byModule)).toHaveLength(0);
    });

    test('ignores invalid inputs', () => {
        tracker.record(null, 100, 'input');
        tracker.record('Test', 0, 'input');
        tracker.record('Test', -5, 'input');
        expect(tracker.getReport().totalUsed).toBe(0);
    });

    test('caps records to prevent unbounded growth', () => {
        for (let i = 0; i < 1100; i++) {
            tracker.record('Test', 1, 'input');
        }
        // After cap triggers at 1001, slices to 500, then 99 more added = 599
        expect(tracker._records.length).toBeLessThan(1100);
        expect(tracker.getReport().totalUsed).toBe(1100);
    });
});
