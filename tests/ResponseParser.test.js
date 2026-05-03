const ResponseParser = require('../src/utils/ResponseParser');

describe('ResponseParser', () => {
    describe('parse', () => {
        test('returns empty structure for null input', () => {
            const result = ResponseParser.parse(null);
            expect(result).toEqual({ memory: null, actions: [], reply: '' });
        });

        test('parses GOLEM_REPLY tag', () => {
            const raw = '[GOLEM_REPLY]Hello World';
            const result = ResponseParser.parse(raw);
            expect(result.reply).toBe('Hello World');
        });

        test('parses GOLEM_MEMORY tag', () => {
            const raw = '[GOLEM_MEMORY]Remember this.[GOLEM_REPLY]ok';
            const result = ResponseParser.parse(raw);
            expect(result.memory).toBe('Remember this.');
        });

        test('ignores null memory', () => {
            const raw = '[GOLEM_MEMORY]null[GOLEM_REPLY]ok';
            const result = ResponseParser.parse(raw);
            expect(result.memory).toBeNull();
        });

        test('parses GOLEM_ACTION with a valid JSON array', () => {
            const actions = JSON.stringify([{ action: 'command', parameter: 'ls' }]);
            const raw = `[GOLEM_ACTION]${actions}[GOLEM_REPLY]done`;
            const result = ResponseParser.parse(raw);
            expect(result.actions).toHaveLength(1);
            expect(result.actions[0].action).toBe('command');
        });

        test('repairs action that only contains parameters.command', () => {
            const actions = JSON.stringify([{ parameters: { command: 'pwd' } }]);
            const raw = `[GOLEM_ACTION]${actions}[GOLEM_REPLY]done`;
            const result = ResponseParser.parse(raw);
            expect(result.actions).toHaveLength(1);
            expect(result.actions[0].action).toBe('command');
            expect(result.actions[0].parameter).toBe('pwd');
        });

        test('auto-wraps single JSON object into array', () => {
            const action = JSON.stringify({ action: 'command', parameter: 'pwd' });
            const raw = `[GOLEM_ACTION]${action}[GOLEM_REPLY]done`;
            const result = ResponseParser.parse(raw);
            expect(result.actions).toHaveLength(1);
        });

        test('corrects run_command action name to command', () => {
            const actions = JSON.stringify([{ action: 'run_command', parameter: 'ls' }]);
            const raw = `[GOLEM_ACTION]${actions}[GOLEM_REPLY]done`;
            const result = ResponseParser.parse(raw);
            expect(result.actions[0].action).toBe('command');
        });

        test('corrects "execute" action name to command', () => {
            const actions = JSON.stringify([{ action: 'execute', parameter: 'ls' }]);
            const raw = `[GOLEM_ACTION]${actions}`;
            const result = ResponseParser.parse(raw);
            expect(result.actions[0].action).toBe('command');
        });

        test('corrects params.command to parameter', () => {
            const actions = JSON.stringify([{ action: 'command', params: { command: 'ls -la' } }]);
            const raw = `[GOLEM_ACTION]${actions}[GOLEM_REPLY]ok`;
            const result = ResponseParser.parse(raw);
            expect(result.actions[0].parameter).toBe('ls -la');
        });

        test('handles JSON wrapped in markdown code block', () => {
            const raw = '[GOLEM_ACTION]```json\n[{"action":"command","parameter":"pwd"}]\n```[GOLEM_REPLY]ok';
            const result = ResponseParser.parse(raw);
            expect(result.actions[0].action).toBe('command');
        });

        test('uses fallback regex parser for broken JSON syntax', () => {
            // Trailing garbage breaks standard parser, but regex \{[\s\S]*\} extracts the object
            // Just provide the bare minimum that works for \{[\s\S]*\}
            const raw = '[GOLEM_ACTION] { "action": "command", "parameter": "ls" } \n \n junk';
            const result = ResponseParser.parse(raw);
            expect(result.actions).toHaveLength(1);
            expect(result.actions[0].action).toBe('command');
        });

        test('uses ultimate regex fallback when parameter contains unescaped quotes', () => {
            // Unescaped quotes inside parameter breaks JSON.parse entirely, ultimate regex fixes it
            // We must put the array closing bracket ] so the lookahead comma|]|EOF matches.
            const raw = `[GOLEM_ACTION] [{ "action": "command", "parameter": "echo "hello" \n world" }] `;
            const result = ResponseParser.parse(raw);
            expect(result.actions).toHaveLength(1);
            expect(result.actions[0].parameter).toContain('echo "hello" \n world');
        });

        test('ultimate fallback catches errors safely', () => {
            const raw = `[GOLEM_ACTION] [{ "action": "cmd\\x00", "parameter": "test" }]`;
            const result = ResponseParser.parse(raw);
            expect(result).toBeDefined();
        });

        test('treats untagged text as reply (fallback)', () => {
            const raw = 'Just a plain text response.';
            const result = ResponseParser.parse(raw);
            expect(result.reply).toBe('Just a plain text response.');
        });

        test('strips internal envelope tags from replies', () => {
            const raw = '[[BEGIN:pu7l]][GOLEM_REPLY]完成了\n[[END:pu7l]]';
            const result = ResponseParser.parse(raw);
            expect(result.reply).toBe('完成了');
        });

        test('strips malformed trailing envelope tags from replies', () => {
            const raw = '[GOLEM_REPLY]完成了\n[END:pu7l]]';
            const result = ResponseParser.parse(raw);
            expect(result.reply).toBe('完成了');
        });

        test('strips envelope tags from fallback replies', () => {
            const raw = '純文字回覆\n[[END:abcd]]';
            const result = ResponseParser.parse(raw);
            expect(result.reply).toBe('純文字回覆');
        });

        test('handles empty text with default error message', () => {
            const raw = 'Assessing My Capabilities Answer now Gemini said';
            const result = ResponseParser.parse(raw);
            expect(result.reply).toBe('⚠️ 系統已接收回應，但內容為空或無法解析。');
        });
    });

    describe('extractJson', () => {
        test('returns empty array for null input', () => {
            expect(ResponseParser.extractJson(null)).toEqual([]);
        });

        test('extracts from markdown json block', () => {
            const text = '```json\n[{"action":"command"}]\n```';
            const result = ResponseParser.extractJson(text);
            expect(result).toHaveLength(1);
        });

        test('extracts from raw JSON array string', () => {
            const text = '[{"action":"command","parameter":"ls"}]';
            const result = ResponseParser.extractJson(text);
            expect(result).toHaveLength(1);
        });

        test('extractJson returns steps from markdown json block with steps property', () => {
            const text = '```json\n{"steps": [{"action":"command"}]}\n```';
            const result = ResponseParser.extractJson(text);
            expect(result).toHaveLength(1);
        });

        test('extractJson returns empty array for parse error', () => {
            const text = '```json\n{{broken json}}\n```';
            const result = ResponseParser.extractJson(text);
            expect(result).toEqual([]);
        });
    });
});
