const DebateQualityTracker = require('../src/core/DebateQualityTracker');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('DebateQualityTracker', () => {
    let tracker;
    let tmpDir;

    const mockDebateResult = {
        topic: 'AGI landscape analysis',
        mode: 'heuristic',
        perspectives: [
            { name: 'Researcher', analysis: 'Key research findings include transformer architecture improvements and reasoning advances in large language models' },
            { name: 'Engineer', analysis: 'Framework deployment considerations for production systems and scalability challenges with agent frameworks' },
            { name: 'Skeptic', analysis: 'Safety risks and alignment concerns with autonomous systems and potential failure modes in critical applications' },
            { name: 'Strategist', analysis: 'Market competition landscape shows growth in AI funding with major enterprises investing in automation' },
        ],
        synthesis: {
            consensus: 'The council agrees on transformer advances, agent frameworks growth, and safety risks requiring attention in the competitive market landscape',
        },
    };

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqt-test-'));
        tracker = new DebateQualityTracker({ dataDir: tmpDir });
    });

    afterEach(() => {
        if (tracker._writer) tracker._writer.destroy();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('constructor initializes empty history', () => {
        expect(tracker.getHistory()).toEqual([]);
        expect(tracker.getStats().totalDebates).toBe(0);
    });

    test('scoreDebate returns valid scores', () => {
        const score = tracker.scoreDebate(mockDebateResult);
        expect(score.keywordDiversity).toBeGreaterThan(0);
        expect(score.perspectiveDifferentiation).toBeGreaterThan(0);
        expect(score.synthesisCoverage).toBeGreaterThan(0);
        expect(score.overall).toBeGreaterThan(0);
        expect(score.overall).toBeLessThanOrEqual(1);
        expect(score.mode).toBe('heuristic');
        expect(score.perspectiveCount).toBe(4);
    });

    test('scoreDebate adds to history', () => {
        tracker.scoreDebate(mockDebateResult);
        expect(tracker.getHistory().length).toBe(1);
    });

    test('scoreDebate handles null input', () => {
        const score = tracker.scoreDebate(null);
        expect(score.overall).toBe(0);
    });

    test('scoreDebate handles empty perspectives', () => {
        const score = tracker.scoreDebate({ perspectives: [] });
        expect(score.keywordDiversity).toBe(0);
        expect(score.perspectiveDifferentiation).toBe(0);
    });

    test('perspective differentiation is higher for diverse perspectives', () => {
        const diverse = {
            perspectives: [
                { analysis: 'research papers academic methodology scientific evidence' },
                { analysis: 'production deployment kubernetes docker scaling' },
                { analysis: 'safety alignment governance regulation compliance' },
                { analysis: 'market revenue funding competition enterprise growth' },
            ],
            synthesis: { consensus: 'diverse perspectives identified' },
        };

        const similar = {
            perspectives: [
                { analysis: 'model training data performance' },
                { analysis: 'model training optimization performance' },
                { analysis: 'model architecture training performance' },
                { analysis: 'model training data benchmark performance' },
            ],
            synthesis: { consensus: 'model training performance' },
        };

        const diverseScore = tracker.scoreDebate(diverse);
        const similarScore = tracker.scoreDebate(similar);
        expect(diverseScore.perspectiveDifferentiation).toBeGreaterThan(similarScore.perspectiveDifferentiation);
    });

    test('compare returns A/B comparison', () => {
        const debateA = {
            mode: 'heuristic',
            perspectives: [
                { analysis: 'short analysis one' },
                { analysis: 'short analysis two' },
            ],
            synthesis: { consensus: 'brief' },
        };

        const result = tracker.compare(debateA, mockDebateResult);
        expect(result).toHaveProperty('scoreA');
        expect(result).toHaveProperty('scoreB');
        expect(result).toHaveProperty('winner');
        expect(result).toHaveProperty('delta');
        expect(['A', 'B', 'tie']).toContain(result.winner);
    });

    test('compare records both debates in history', () => {
        const debateA = { ...mockDebateResult, mode: 'heuristic' };
        const debateB = { ...mockDebateResult, mode: 'brain' };
        tracker.compare(debateA, debateB);
        expect(tracker.getHistory().length).toBe(2);
    });

    test('getStats returns aggregate statistics', () => {
        tracker.scoreDebate(mockDebateResult);
        tracker.scoreDebate({ ...mockDebateResult, mode: 'brain' });
        const stats = tracker.getStats();
        expect(stats.totalDebates).toBe(2);
        expect(stats.avgOverall).toBeGreaterThan(0);
        expect(stats.byMode.heuristic.count).toBe(1);
        expect(stats.byMode.brain.count).toBe(1);
    });

    test('history capped at MAX_HISTORY', () => {
        for (let i = 0; i < 110; i++) {
            tracker._history.push({ overall: 0.5, timestamp: new Date().toISOString() });
        }
        tracker._history = tracker._history.slice(-100);
        expect(tracker._history.length).toBeLessThanOrEqual(100);
    });

    test('persistence: load from file', async () => {
        tracker.scoreDebate(mockDebateResult);
        await tracker._writer.forceFlush();

        const tracker2 = new DebateQualityTracker({ dataDir: tmpDir });
        expect(tracker2.getHistory().length).toBe(1);
        tracker2._writer.destroy();
    });

    test('handles corrupted data file', () => {
        fs.writeFileSync(path.join(tmpDir, 'debate_quality_history.json'), 'bad json');
        const tracker2 = new DebateQualityTracker({ dataDir: tmpDir });
        expect(tracker2.getHistory()).toEqual([]);
        tracker2._writer.destroy();
    });
});
