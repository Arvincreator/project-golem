const AutonomyScheduler = require('../src/core/AutonomyScheduler');
const WebResearcher = require('../src/core/WebResearcher');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('AutonomyScheduler — RSS Grading + Error Recovery (v12.0)', () => {
    let scheduler;
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-'));
        fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
        const origCwd = process.cwd;
        process.cwd = () => tmpDir;
        scheduler = new AutonomyScheduler({ golemId: 'test' });
        process.cwd = origCwd;
    });

    afterEach(() => {
        if (scheduler._writer) scheduler._writer.destroy();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('_assessRSSLevel returns normal for low RSS', () => {
        expect(scheduler._assessRSSLevel(100)).toBe('normal');
        expect(scheduler._assessRSSLevel(249)).toBe('normal');
    });

    test('_assessRSSLevel returns elevated for moderate RSS', () => {
        expect(scheduler._assessRSSLevel(350)).toBe('elevated');
        expect(scheduler._assessRSSLevel(400)).toBe('elevated');
    });

    test('_assessRSSLevel returns critical for high RSS', () => {
        expect(scheduler._assessRSSLevel(500)).toBe('critical');
        expect(scheduler._assessRSSLevel(800)).toBe('critical');
    });

    test('_safeExec catches errors and returns failure result', async () => {
        const result = await scheduler._safeExec('test', async () => {
            throw new Error('test error');
        });
        expect(result.action).toBe('test_failed');
        expect(result.summary).toBe('test error');
    });

    test('_safeExec records error in ErrorPatternLearner', async () => {
        const recorded = [];
        scheduler._errorPatternLearner = {
            recordError: (ctx, err, res) => recorded.push({ ctx, err, res }),
        };
        await scheduler._safeExec('scan', async () => { throw new Error('timeout'); });
        expect(recorded.length).toBe(1);
        expect(recorded[0].ctx).toBe('AutonomyScheduler.scan');
    });

    test('tick returns noop with RSS level in summary', async () => {
        const result = await scheduler.tick({ rss: 100, uptime: 60, episodeCount: 5, tipCount: 2 });
        expect(result.action).toBe('noop');
        expect(result.summary).toContain('normal');
    });
});

describe('WebResearcher — Circuit Breaker (v12.0)', () => {
    test('accepts circuitBreaker in constructor', () => {
        const mockCB = { execute: jest.fn() };
        const wr = new WebResearcher({ circuitBreaker: mockCB });
        expect(wr._circuitBreaker).toBe(mockCB);
    });

    test('works without circuit breaker', () => {
        const wr = new WebResearcher();
        expect(wr._circuitBreaker).toBeNull();
    });
});
