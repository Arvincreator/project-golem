const PromptScorer = require('../src/core/PromptScorer');
const PromptEvolver = require('../src/core/PromptEvolver');

describe('NL→Prompt Optimization (v12.0)', () => {
    let scorer;
    let evolver;

    beforeEach(() => {
        scorer = new PromptScorer();
        evolver = new PromptEvolver({ scorer });
    });

    // --- PromptScorer.nlToStructured ---

    test('nlToStructured converts free text to structured format', () => {
        const result = scorer.nlToStructured('幫我分析這個數據', '數據分析');
        expect(result.structured).toContain('## 角色');
        expect(result.structured).toContain('## 任務');
        expect(result.improvements.length).toBeGreaterThan(0);
    });

    test('nlToStructured adds missing sections', () => {
        const result = scorer.nlToStructured('分析市場趨勢', '市場分析');
        expect(result.improvements).toContain('added-role');
        expect(result.improvements).toContain('added-context');
        expect(result.improvements).toContain('added-format');
        expect(result.improvements).toContain('added-constraints');
    });

    test('nlToStructured injects CoT for analytical prompts', () => {
        const result = scorer.nlToStructured('請分析這個問題的原因', '推理分析');
        expect(result.improvements).toContain('injected-CoT');
        expect(result.structured).toContain('CoT');
    });

    test('nlToStructured injects ToT for explorative prompts', () => {
        const result = scorer.nlToStructured('探索可能的方案', '探索方案');
        expect(result.improvements).toContain('injected-ToT');
    });

    test('nlToStructured returns positive scoreGain', () => {
        const result = scorer.nlToStructured('幫我查數據', '查詢');
        expect(result.scoreGain).toBeGreaterThanOrEqual(0);
        expect(result.afterScore).toBeGreaterThanOrEqual(result.beforeScore);
    });

    test('nlToStructured handles empty input', () => {
        const result = scorer.nlToStructured('', '');
        expect(result.structured).toBe('');
        expect(result.improvements).toHaveLength(0);
    });

    // --- PromptEvolver 6th mutation operator ---

    test('MUTATION_OPS includes nl-to-structured', () => {
        expect(PromptEvolver.MUTATION_OPS).toContain('nl-to-structured');
        expect(PromptEvolver.MUTATION_OPS.length).toBe(6);
    });

    test('heuristic nl-to-structured mutation adds structure', () => {
        const result = evolver._heuristicMutate('分析股票走勢', '股票分析', 'nl-to-structured');
        expect(result).toContain('## 角色');
        expect(result).toContain('## 任務');
    });
});
