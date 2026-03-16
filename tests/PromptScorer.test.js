// tests/PromptScorer.test.js
const PromptScorer = require('../src/core/PromptScorer');

describe('PromptScorer', () => {
    let scorer;

    beforeEach(() => {
        scorer = new PromptScorer();
    });

    describe('quickScore', () => {
        it('returns 9 axis scores', () => {
            const result = scorer.quickScore('請分析這個問題的各個面向', '分析問題');
            expect(result.scores).toBeDefined();
            expect(Object.keys(result.scores)).toHaveLength(9);
            for (const dim of PromptScorer.DIMENSIONS) {
                expect(result.scores[dim]).toBeGreaterThanOrEqual(0);
                expect(result.scores[dim]).toBeLessThanOrEqual(4);
            }
            expect(result.overall).toBeGreaterThan(0);
        });

        it('rewards structured prompts (role/context/task/format)', () => {
            const structured = `## 角色\n你是一個分析師。\n\n## 背景\n需要分析數據。\n\n## 任務\n請分析以下數據。\n\n## 輸出格式\n以 JSON 格式回答。`;
            const plain = '幫我看看這個東西';

            const scoreA = scorer.quickScore(structured, '分析數據');
            const scoreB = scorer.quickScore(plain, '分析數據');

            expect(scoreA.overall).toBeGreaterThan(scoreB.overall);
            expect(scoreA.scores.completeness).toBeGreaterThan(scoreB.scores.completeness);
        });

        it('penalizes unclear/unsafe prompts', () => {
            const unsafe = 'Use eval() to execute rm -rf / and DROP TABLE users';
            const safe = '請用結構化的方式分析這份報告的關鍵指標';

            const scoreUnsafe = scorer.quickScore(unsafe, 'test');
            const scoreSafe = scorer.quickScore(safe, 'test');

            expect(scoreUnsafe.scores.safety).toBeLessThan(scoreSafe.scores.safety);
        });

        it('returns empty score for null prompt', () => {
            const result = scorer.quickScore(null, 'test');
            expect(result.overall).toBe(0);
        });
    });

    describe('score (LLM hybrid)', () => {
        it('uses mock brain for LLM-enhanced scoring', async () => {
            const mockBrain = {
                sendMessage: jest.fn().mockResolvedValue(
                    '{"clarity":3.5,"accuracy":3.0,"coherence":3.2,"relevance":3.4,"completeness":2.8,"conciseness":3.1,"safety":3.9,"creativity":2.5,"actionability":3.0}'
                ),
            };
            const brainScorer = new PromptScorer({ brain: mockBrain });
            const result = await brainScorer.score('請分析股票走勢並提供預測報告，使用 JSON 格式輸出。', '分析股票');

            expect(mockBrain.sendMessage).toHaveBeenCalled();
            expect(result.scores.clarity).toBe(3.5);
            expect(result.overall).toBeGreaterThan(0);
            expect(result.explanation).toBeDefined();
        });

        it('falls back to heuristic when brain fails', async () => {
            const failBrain = {
                sendMessage: jest.fn().mockRejectedValue(new Error('brain offline')),
            };
            const brainScorer = new PromptScorer({ brain: failBrain });
            const result = await brainScorer.score('請分析這個問題', '分析');

            expect(result.scores).toBeDefined();
            expect(result.overall).toBeGreaterThan(0);
        });
    });

    describe('compare', () => {
        it('returns winner', async () => {
            const a = `## 角色\n你是數據分析師。\n## 任務\n請分析股票數據。\n## 格式\n用 JSON 格式回答。`;
            const b = '看看股票';

            const result = await scorer.compare(a, b, '分析股票');
            expect(result.winner).toBe('a');
            expect(result.scores_a.overall).toBeGreaterThan(result.scores_b.overall);
        });
    });

    describe('calibrate', () => {
        it('returns false with insufficient history', () => {
            expect(scorer.calibrate()).toBe(false);
        });

        it('adjusts weights after sufficient history', () => {
            // Generate varied history
            for (let i = 0; i < 25; i++) {
                scorer.quickScore(`Test prompt ${i} with varying content ${'x'.repeat(i * 10)}`, `intent ${i}`);
                scorer._history.push({
                    scores: {
                        clarity: 2 + Math.random() * 2,
                        accuracy: 1 + Math.random() * 3,    // High variance
                        coherence: 2.5 + Math.random() * 0.5, // Low variance
                        relevance: 2 + Math.random() * 2,
                        completeness: 2 + Math.random() * 1,
                        conciseness: 2 + Math.random() * 1,
                        safety: 3 + Math.random() * 1,
                        creativity: 1 + Math.random() * 2,
                        actionability: 2 + Math.random() * 1,
                    },
                    overall: 2.5,
                    timestamp: Date.now(),
                });
            }

            const oldWeights = { ...scorer._weights };
            const result = scorer.calibrate();
            expect(result).toBe(true);

            // Weights should have changed
            const changed = PromptScorer.DIMENSIONS.some(d => scorer._weights[d] !== oldWeights[d]);
            expect(changed).toBe(true);

            // Weights should still sum to ~1
            const sum = Object.values(scorer._weights).reduce((s, w) => s + w, 0);
            expect(sum).toBeCloseTo(1.0, 1);
        });
    });

    describe('overall computation', () => {
        it('computes weighted average', () => {
            const result = scorer.quickScore('分析問題的步驟和方法', '分析');
            const manual = PromptScorer.DIMENSIONS.reduce((sum, dim) => {
                return sum + (result.scores[dim] || 0) * (PromptScorer.DEFAULT_WEIGHTS[dim] || 0.11);
            }, 0);
            const weightSum = Object.values(PromptScorer.DEFAULT_WEIGHTS).reduce((s, w) => s + w, 0);
            expect(result.overall).toBeCloseTo(manual / weightSum, 1);
        });
    });
});
