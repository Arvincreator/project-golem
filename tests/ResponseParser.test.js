const ResponseParser = require('../src/utils/ResponseParser');

describe('ResponseParser', () => {
    test('parses [GOLEM_REPLY] blocks', () => {
        const raw = '[GOLEM_REPLY]\nHello, how can I help?\n[/GOLEM_REPLY]';
        const result = ResponseParser.parse(raw);
        expect(result.reply).toBeTruthy();
        expect(result.reply).toContain('Hello');
    });

    test('parses [GOLEM_ACTION] blocks', () => {
        const raw = '[GOLEM_ACTION]\n{"action":"command","cmd":"ls -la"}\n[/GOLEM_ACTION]';
        const result = ResponseParser.parse(raw);
        expect(result.actions).toBeDefined();
        expect(result.actions.length).toBeGreaterThan(0);
    });

    test('parses [GOLEM_MEMORY] blocks', () => {
        const raw = '[GOLEM_MEMORY]\nUser prefers dark mode\n[/GOLEM_MEMORY]\n[GOLEM_REPLY]\nGot it!\n[/GOLEM_REPLY]';
        const result = ResponseParser.parse(raw);
        expect(result.memory).toBeTruthy();
    });

    test('handles empty/null input', () => {
        expect(ResponseParser.parse('')).toBeDefined();
        expect(ResponseParser.parse(null)).toBeDefined();
    });

    test('handles malformed JSON in actions gracefully', () => {
        const raw = '[GOLEM_ACTION]\n{broken json\n[/GOLEM_ACTION]';
        const result = ResponseParser.parse(raw);
        // Should not throw
        expect(result).toBeDefined();
    });

    test('handles action array in single block', () => {
        const raw = `[GOLEM_ACTION]
[{"action":"command","cmd":"ls"},{"action":"command","cmd":"pwd"}]
[GOLEM_REPLY]
Done!
[/GOLEM_REPLY]`;
        const result = ResponseParser.parse(raw);
        expect(result.actions.length).toBe(2);
    });

    test('extracts reply text without tags', () => {
        const raw = '[GOLEM_REPLY]\nTest reply\n[/GOLEM_REPLY]';
        const result = ResponseParser.parse(raw);
        expect(result.reply).not.toContain('[GOLEM_REPLY]');
        expect(result.reply).not.toContain('[/GOLEM_REPLY]');
    });
});
