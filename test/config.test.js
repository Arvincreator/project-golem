const { cleanEnv, isPlaceholder } = require('../src/config/index');

describe('cleanEnv', () => {
  test('removes non-ASCII characters', () => {
    expect(cleanEnv('hello\u200Bworld')).toBe('helloworld');
  });

  test('removes whitespace by default', () => {
    expect(cleanEnv('  hello world  ')).toBe('helloworld');
  });

  test('preserves whitespace when allowSpaces is true', () => {
    expect(cleanEnv('  hello world  ', true)).toBe('hello world');
  });

  test('returns empty string for null/undefined', () => {
    expect(cleanEnv(null)).toBe('');
    expect(cleanEnv(undefined)).toBe('');
    expect(cleanEnv('')).toBe('');
  });

  test('preserves normal ASCII strings', () => {
    expect(cleanEnv('abc123-_.')).toBe('abc123-_.');
  });
});

describe('isPlaceholder', () => {
  test('returns true for null/undefined/empty', () => {
    expect(isPlaceholder(null)).toBe(true);
    expect(isPlaceholder(undefined)).toBe(true);
    expect(isPlaceholder('')).toBe(true);
  });

  test('returns true for placeholder patterns', () => {
    expect(isPlaceholder('YOUR_TOKEN_HERE')).toBe(true);
    expect(isPlaceholder('TOKEN_PLACEHOLDER')).toBe(true);
  });

  test('returns true for strings shorter than 10 chars', () => {
    expect(isPlaceholder('short')).toBe(true);
    expect(isPlaceholder('123456789')).toBe(true);
  });

  test('returns false for valid tokens', () => {
    expect(isPlaceholder('8584008728:AAEsxD3SXEkp62CZQc-5tpPp9XwWdntJtbc')).toBe(false);
    expect(isPlaceholder('AIzaSyB1234567890abcdefghijklmnop')).toBe(false);
  });
});
