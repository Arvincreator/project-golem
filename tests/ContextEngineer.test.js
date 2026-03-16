const ContextEngineer = require('../src/core/ContextEngineer');

describe('ContextEngineer', () => {
    let eng;

    beforeEach(() => {
        eng = new ContextEngineer({ budget: 1000 });
    });

    test('assemble returns empty context when no sections added', () => {
        const { context, stats } = eng.assemble();
        expect(context).toBe('');
        expect(stats.sectionsIncluded).toBe(0);
        expect(stats.totalTokens).toBe(0);
    });

    test('priority ordering: higher priority sections come first', () => {
        eng.addSection('low', 'low priority content', { priority: 1 });
        eng.addSection('high', 'high priority content', { priority: 10 });
        eng.addSection('mid', 'mid priority content', { priority: 5 });
        const { context } = eng.assemble();
        const highPos = context.indexOf('high priority');
        const midPos = context.indexOf('mid priority');
        const lowPos = context.indexOf('low priority');
        expect(highPos).toBeLessThan(midPos);
        expect(midPos).toBeLessThan(lowPos);
    });

    test('token budget enforcement: sections exceeding budget get compressed or paged out', () => {
        // Budget is 1000 tokens, reserve 15% = 850 effective
        // Each section ~250 tokens (1000 chars / 4)
        eng.addSection('a', 'x'.repeat(1000), { priority: 10 });
        eng.addSection('b', 'y'.repeat(1000), { priority: 8 });
        eng.addSection('c', 'z'.repeat(1000), { priority: 6, compressible: true });
        eng.addSection('d', 'w'.repeat(1000), { priority: 4, compressible: true });
        const { stats } = eng.assemble();
        // Not all sections can fit in 850 token budget
        expect(stats.sectionsIncluded).toBeLessThanOrEqual(4);
        expect(stats.totalTokens).toBeLessThanOrEqual(850);
    });

    test('compressible sections are compressed rather than dropped', () => {
        eng = new ContextEngineer({ budget: 500 });
        eng.addSection('a', 'important '.repeat(100), { priority: 10 });
        eng.addSection('b', 'less important '.repeat(200), { priority: 5, compressible: true });
        const { stats } = eng.assemble();
        expect(stats.compressed + stats.pagedOut).toBeGreaterThan(0);
    });

    test('compressToolResult handles JSON arrays', () => {
        // Create a large array that exceeds the token budget
        const items = Array.from({ length: 20 }, (_, i) => ({ id: i, name: `item_${i}`, description: 'x'.repeat(50) }));
        const jsonArray = JSON.stringify(items);
        // Budget large enough to fit compressed form but not the original
        const compressed = eng.compressToolResult(jsonArray, 200);
        expect(compressed).toContain('_count');
        expect(compressed).toContain('20');
        expect(compressed.length).toBeLessThan(jsonArray.length);
    });

    test('compressToolResult handles JSON objects', () => {
        const obj = {};
        for (let i = 0; i < 10; i++) obj[`key${i}`] = 'value'.repeat(20);
        const json = JSON.stringify(obj);
        const compressed = eng.compressToolResult(json, 100);
        expect(compressed.length).toBeLessThan(json.length);
    });

    test('compressToolResult handles error text with head/tail', () => {
        const lines = [];
        for (let i = 0; i < 20; i++) lines.push(`Error line ${i}: something went wrong`);
        const errorText = lines.join('\n');
        const compressed = eng.compressToolResult(errorText, 30);
        expect(compressed).toContain('Error line 0');
        expect(compressed).toContain('omitted');
    });

    test('compressToolResult handles plain text truncation', () => {
        const text = 'a'.repeat(10000);
        const compressed = eng.compressToolResult(text, 100);
        expect(compressed.length).toBeLessThan(text.length);
    });

    test('setBudgetForModel sets correct budget', () => {
        eng.setBudgetForModel('gemini-2.5-pro');
        expect(eng._budget).toBe(800000);
        eng.setBudgetForModel('gpt-4.1-nano');
        expect(eng._budget).toBe(25000);
        eng.setBudgetForModel('unknown-model');
        expect(eng._budget).toBe(100000); // default
    });

    test('estimateTokens delegates correctly', () => {
        expect(eng.estimateTokens('hello world')).toBeGreaterThan(0);
        expect(eng.estimateTokens('')).toBe(0);
    });

    test('single section exceeds budget: truncated not dropped', () => {
        eng = new ContextEngineer({ budget: 100 });
        eng.addSection('huge', 'x'.repeat(5000), { priority: 10 });
        const { context, stats } = eng.assemble();
        expect(stats.sectionsIncluded).toBe(1);
        expect(context.length).toBeLessThan(5000);
    });

    test('skips empty/null content sections', () => {
        eng.addSection('empty', '', { priority: 10 });
        eng.addSection('null', null, { priority: 10 });
        eng.addSection('valid', 'real content', { priority: 5 });
        const { stats } = eng.assemble();
        expect(stats.sectionsIncluded).toBe(1);
    });

    test('reset clears sections', () => {
        eng.addSection('a', 'content', { priority: 5 });
        eng.reset();
        const { stats } = eng.assemble();
        expect(stats.sectionsIncluded).toBe(0);
    });

    test('per-section maxTokens cap is enforced', () => {
        eng = new ContextEngineer({ budget: 10000 });
        eng.addSection('capped', 'x'.repeat(10000), { priority: 10, maxTokens: 50 });
        const { stats } = eng.assemble();
        expect(stats.totalTokens).toBeLessThanOrEqual(55); // small margin
    });
});
