const ResponseParser = require('../src/utils/ResponseParser');

describe('ResponseParser.parse', () => {
  test('parses all three blocks correctly', () => {
    const raw = `[GOLEM_MEMORY]User prefers dark mode
[GOLEM_ACTION]
[{"action": "command", "parameter": "ls -la"}]
[GOLEM_REPLY]Here are your files!`;

    const result = ResponseParser.parse(raw);
    expect(result.memory).toBe('User prefers dark mode');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].action).toBe('command');
    expect(result.actions[0].parameter).toBe('ls -la');
    expect(result.reply).toBe('Here are your files!');
  });

  test('handles reply-only response', () => {
    const raw = `[GOLEM_REPLY]Hello! How can I help you?`;
    const result = ResponseParser.parse(raw);
    expect(result.memory).toBeNull();
    expect(result.actions).toHaveLength(0);
    expect(result.reply).toBe('Hello! How can I help you?');
  });

  test('falls back to raw text when no tags present', () => {
    const raw = 'Just a plain response without any tags.';
    const result = ResponseParser.parse(raw);
    expect(result.reply).toBe('Just a plain response without any tags.');
  });

  test('handles null/empty input', () => {
    expect(ResponseParser.parse(null).reply).toBe('');
    expect(ResponseParser.parse('').reply).toBe('');
    expect(ResponseParser.parse(undefined).reply).toBe('');
  });

  test('corrects run_command to command', () => {
    const raw = `[GOLEM_ACTION]
[{"action": "run_command", "parameter": "pwd"}]
[GOLEM_REPLY]Done.`;

    const result = ResponseParser.parse(raw);
    expect(result.actions[0].action).toBe('command');
  });

  test('corrects params.command to parameter', () => {
    const raw = `[GOLEM_ACTION]
[{"action": "command", "params": {"command": "echo hi"}}]
[GOLEM_REPLY]Done.`;

    const result = ResponseParser.parse(raw);
    expect(result.actions[0].parameter).toBe('echo hi');
  });

  test('handles markdown-wrapped JSON in actions', () => {
    const raw = '[GOLEM_ACTION]\n```json\n[{"action": "command", "parameter": "date"}]\n```\n[GOLEM_REPLY]Here is the date.';

    const result = ResponseParser.parse(raw);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].parameter).toBe('date');
  });

  test('handles memory with null value', () => {
    const raw = `[GOLEM_MEMORY]null
[GOLEM_REPLY]Nothing to remember.`;

    const result = ResponseParser.parse(raw);
    expect(result.memory).toBeNull();
  });
});

describe('ResponseParser.extractJson', () => {
  test('extracts JSON from markdown code block', () => {
    const text = 'Some text\n```json\n[{"step": 1}]\n```\nMore text';
    const result = ResponseParser.extractJson(text);
    expect(result).toHaveLength(1);
    expect(result[0].step).toBe(1);
  });

  test('returns empty array for invalid input', () => {
    expect(ResponseParser.extractJson(null)).toEqual([]);
    expect(ResponseParser.extractJson('')).toEqual([]);
    expect(ResponseParser.extractJson('no json here')).toEqual([]);
  });
});
