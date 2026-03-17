const ErrorPatternLearner = require('../src/core/ErrorPatternLearner');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('ErrorPatternLearner', () => {
    let learner;
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epl-test-'));
        learner = new ErrorPatternLearner({ dataDir: tmpDir });
    });

    afterEach(() => {
        if (learner._writer) learner._writer.destroy();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('constructor initializes empty patterns', () => {
        expect(learner.getPatterns()).toEqual([]);
        expect(learner.getStats().totalPatterns).toBe(0);
    });

    test('recordError stores a new pattern', () => {
        const pattern = learner.recordError('WebResearcher.search', 'API key invalid', 'rotate key');
        expect(pattern.context).toBe('WebResearcher.search');
        expect(pattern.error).toBe('API key invalid');
        expect(pattern.resolution).toBe('rotate key');
        expect(pattern.occurrences).toBe(1);
        expect(learner.getPatterns().length).toBe(1);
    });

    test('recordError increments occurrences for duplicate error', () => {
        learner.recordError('search', 'timeout', 'retry');
        const second = learner.recordError('search', 'timeout', 'retry with backoff');
        expect(second.occurrences).toBe(2);
        expect(second.resolution).toBe('retry with backoff');
        expect(learner.getPatterns().length).toBe(1);
    });

    test('hasSeenBefore returns true for known errors', () => {
        learner.recordError('scan', new Error('rate limit 429'), 'wait');
        expect(learner.hasSeenBefore('scan', 'rate limit 429')).toBe(true);
        expect(learner.hasSeenBefore('scan', 'unknown error')).toBe(false);
    });

    test('hasSeenBefore works with Error objects', () => {
        learner.recordError('test', new Error('fail'), 'fix');
        expect(learner.hasSeenBefore('test', new Error('fail'))).toBe(true);
    });

    test('getSuggestedFix returns resolution for known errors', () => {
        learner.recordError('debate', 'brain unavailable', 'use heuristic');
        expect(learner.getSuggestedFix('debate', 'brain unavailable')).toBe('use heuristic');
        expect(learner.getSuggestedFix('debate', 'unknown')).toBeNull();
    });

    test('normalizes numbers in error messages for better matching', () => {
        learner.recordError('api', 'timeout after 5000ms', 'increase timeout');
        // Different number should still match due to normalization
        expect(learner.hasSeenBefore('api', 'timeout after 3000ms')).toBe(true);
    });

    test('normalizes timestamps in error messages', () => {
        learner.recordError('scan', 'failed at 2026-03-17T10:30:00.000Z', 'retry');
        expect(learner.hasSeenBefore('scan', 'failed at 2026-03-18T12:00:00.000Z')).toBe(true);
    });

    test('caps patterns at MAX_PATTERNS (200)', () => {
        for (let i = 0; i < 210; i++) {
            learner.recordError(`ctx_${i}`, `unique_error_${i}_abc`, 'fix');
        }
        expect(learner.getPatterns().length).toBeLessThanOrEqual(200);
    });

    test('getStats returns correct statistics', () => {
        learner.recordError('a', 'err1', 'fix1');
        learner.recordError('b', 'err2', 'fix2');
        learner.recordError('a', 'err1', 'fix1'); // duplicate
        const stats = learner.getStats();
        expect(stats.totalPatterns).toBe(2);
        expect(stats.totalOccurrences).toBe(3);
        expect(stats.topErrors.length).toBe(2);
    });

    test('clear removes all patterns', () => {
        learner.recordError('x', 'y', 'z');
        learner.clear();
        expect(learner.getPatterns().length).toBe(0);
    });

    test('persistence: load from file', async () => {
        learner.recordError('persist', 'test error', 'test fix');
        await learner._writer.forceFlush();

        const learner2 = new ErrorPatternLearner({ dataDir: tmpDir });
        expect(learner2.getPatterns().length).toBe(1);
        expect(learner2.getSuggestedFix('persist', 'test error')).toBe('test fix');
        learner2._writer.destroy();
    });

    test('handles corrupted data file gracefully', () => {
        fs.writeFileSync(path.join(tmpDir, 'error_patterns.json'), 'not json');
        const learner2 = new ErrorPatternLearner({ dataDir: tmpDir });
        expect(learner2.getPatterns()).toEqual([]);
        learner2._writer.destroy();
    });

    test('recordError without resolution stores empty string', () => {
        const pattern = learner.recordError('ctx', 'err');
        expect(pattern.resolution).toBe('');
    });
});
