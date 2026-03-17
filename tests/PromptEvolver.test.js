// tests/PromptEvolver.test.js
const PromptEvolver = require('../src/core/PromptEvolver');
const PromptScorer = require('../src/core/PromptScorer');

describe('PromptEvolver', () => {
    let evolver, scorer;

    beforeEach(() => {
        scorer = new PromptScorer();
        evolver = new PromptEvolver({ scorer, populationSize: 3, maxGenerations: 2 });
    });

    describe('constructor', () => {
        it('sets default values', () => {
            const e = new PromptEvolver();
            expect(e.populationSize).toBe(5);
            expect(e.maxGenerations).toBe(3);
            expect(e.brain).toBeNull();
            expect(e.scorer).toBeNull();
        });

        it('accepts custom options', () => {
            expect(evolver.populationSize).toBe(3);
            expect(evolver.maxGenerations).toBe(2);
            expect(evolver.scorer).toBe(scorer);
        });
    });

    describe('_initPopulation', () => {
        it('creates N candidates with heuristic mutations', async () => {
            const pop = await evolver._initPopulation('原始提示詞', '分析', 4);
            expect(pop).toHaveLength(4);
            expect(pop[0]).toBe('原始提示詞');
            // Other candidates should be different
            const unique = new Set(pop);
            expect(unique.size).toBeGreaterThanOrEqual(2);
        });

        it('creates N candidates with mock brain', async () => {
            const mockBrain = {
                sendMessage: jest.fn().mockResolvedValue('LLM 改良版本的提示詞，更好更詳細'),
            };
            const brainEvolver = new PromptEvolver({ brain: mockBrain, scorer, populationSize: 3 });
            const pop = await brainEvolver._initPopulation('測試提示詞', '分析', 3);

            expect(pop).toHaveLength(3);
            expect(mockBrain.sendMessage).toHaveBeenCalled();
        });

        it('falls back to heuristic when brain fails', async () => {
            const failBrain = {
                sendMessage: jest.fn().mockRejectedValue(new Error('offline')),
            };
            const brainEvolver = new PromptEvolver({ brain: failBrain, scorer });
            const pop = await brainEvolver._initPopulation('測試', '分析', 3);

            expect(pop).toHaveLength(3);
            expect(pop[0]).toBe('測試');
        });
    });

    describe('_select', () => {
        it('returns top-K by score', () => {
            const scored = [
                { prompt: 'best', overall: 3.5 },
                { prompt: 'mid', overall: 2.5 },
                { prompt: 'worst', overall: 1.5 },
            ];
            const top = evolver._select(scored, 2);
            expect(top).toHaveLength(2);
            expect(top[0].prompt).toBe('best');
            expect(top[1].prompt).toBe('mid');
        });

        it('handles count > scored length', () => {
            const scored = [{ prompt: 'only', overall: 3.0 }];
            const top = evolver._select(scored, 5);
            expect(top).toHaveLength(1);
        });
    });

    describe('_crossover', () => {
        it('combines two prompts with heuristic (no brain)', async () => {
            const result = await evolver._crossover(
                '第一段。第二段。第三段。',
                '甲部分。乙部分。丙部分。',
                '分析'
            );
            expect(result).toBeTruthy();
            expect(typeof result).toBe('string');
        });

        it('uses brain when available', async () => {
            const mockBrain = {
                sendMessage: jest.fn().mockResolvedValue('合併後的最佳提示詞，包含 A 和 B 的精華元素'),
            };
            const brainEvolver = new PromptEvolver({ brain: mockBrain, scorer });
            const result = await brainEvolver._crossover('A prompt with details', 'B prompt with details', 'test');

            expect(mockBrain.sendMessage).toHaveBeenCalled();
            expect(result).toBe('合併後的最佳提示詞，包含 A 和 B 的精華元素');
        });
    });

    describe('_mutate', () => {
        it('rephrase operator works', async () => {
            const result = await evolver._mutate('請分析這個問題', '分析', 'rephrase');
            expect(result).toBeTruthy();
            expect(result).not.toBe('請分析這個問題');
        });

        it('add-detail operator appends content', async () => {
            const original = '分析問題';
            const result = await evolver._mutate(original, '分析', 'add-detail');
            expect(result.length).toBeGreaterThan(original.length);
        });

        it('remove-detail operator simplifies', async () => {
            const original = '第一段\n\n第二段\n\n第三段';
            const result = await evolver._mutate(original, '分析', 'remove-detail');
            expect(result).toBeTruthy();
        });

        it('restructure operator creates sections', async () => {
            const result = await evolver._mutate('分析股票', '分析股票', 'restructure');
            expect(result).toContain('角色');
            expect(result).toContain('任務');
        });

        it('pattern-inject operator adds reasoning template', async () => {
            const result = await evolver._mutate('分析問題', '分析', 'pattern-inject', 'CoT');
            expect(result).toContain('一步一步');
        });
    });

    describe('optimize', () => {
        it('returns best prompt with trajectory (heuristic only)', async () => {
            const seed = '簡單的分析提示';
            const result = await evolver.optimize(seed, '分析', { generations: 2 });

            expect(result.best).toBeDefined();
            expect(result.best.prompt).toBeTruthy();
            expect(result.best.overall).toBeGreaterThan(0);
            expect(result.population).toBeDefined();
            expect(result.population.length).toBeGreaterThan(0);
            expect(result.trajectory).toHaveLength(2);
            expect(result.trajectory[0].gen).toBe(1);
            expect(result.trajectory[0].bestScore).toBeGreaterThan(0);
        });

        it('works with mock brain', async () => {
            let callCount = 0;
            const mockBrain = {
                sendMessage: jest.fn().mockImplementation(() => {
                    callCount++;
                    return Promise.resolve(`LLM 生成的變體 ${callCount}，包含更詳細的分析步驟和結構`);
                }),
            };
            const brainEvolver = new PromptEvolver({
                brain: mockBrain, scorer, populationSize: 3, maxGenerations: 2,
            });
            const result = await brainEvolver.optimize('初始提示詞', '分析', { generations: 2 });

            expect(result.best).toBeDefined();
            expect(result.trajectory).toHaveLength(2);
            expect(mockBrain.sendMessage).toHaveBeenCalled();
        });

        it('works without scorer (fallback scoring)', async () => {
            const noScorerEvolver = new PromptEvolver({ populationSize: 3, maxGenerations: 1 });
            const result = await noScorerEvolver.optimize('分析問題', '分析', { generations: 1 });

            expect(result.best).toBeDefined();
            expect(result.best.overall).toBeGreaterThan(0);
        });
    });

    describe('MUTATION_OPS', () => {
        it('exports 6 operators', () => {
            expect(PromptEvolver.MUTATION_OPS).toHaveLength(6);
            expect(PromptEvolver.MUTATION_OPS).toContain('rephrase');
            expect(PromptEvolver.MUTATION_OPS).toContain('pattern-inject');
            expect(PromptEvolver.MUTATION_OPS).toContain('nl-to-structured');
        });
    });

    describe('PATTERN_TEMPLATES', () => {
        it('has templates for all patterns', () => {
            expect(PromptEvolver.PATTERN_TEMPLATES.CoT).toBeDefined();
            expect(PromptEvolver.PATTERN_TEMPLATES.ToT).toBeDefined();
            expect(PromptEvolver.PATTERN_TEMPLATES.ReAct).toBeDefined();
            expect(PromptEvolver.PATTERN_TEMPLATES.Reflexion).toBeDefined();
            expect(PromptEvolver.PATTERN_TEMPLATES['Self-Consistency']).toBeDefined();
        });
    });
});
