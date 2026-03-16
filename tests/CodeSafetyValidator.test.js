require('./setup');
const CodeSafetyValidator = require('../src/utils/CodeSafetyValidator');

describe('CodeSafetyValidator', () => {
  describe('validate() — safe code passes', () => {
    test('simple function declaration', () => {
      const result = CodeSafetyValidator.validate('function add(a, b) { return a + b; }');
      expect(result.safe).toBe(true);
    });

    test('expression statement (no variable declaration)', () => {
      const result = CodeSafetyValidator.validate('1 + 2;');
      expect(result.safe).toBe(true);
    });

    test('if statement with block', () => {
      const result = CodeSafetyValidator.validate('if (true) { 1 + 2; }');
      expect(result.safe).toBe(true);
    });
  });

  describe('validate() — rejects dangerous code', () => {
    test('rejects require() calls', () => {
      const result = CodeSafetyValidator.validate('require("child_process");');
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/require/i);
    });

    test('rejects eval() calls', () => {
      const result = CodeSafetyValidator.validate('eval("alert(1)");');
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/eval/i);
    });

    test('rejects new Function()', () => {
      const result = CodeSafetyValidator.validate('new Function("return 1");');
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/Function/);
    });

    test('rejects process.exit() member expression', () => {
      const result = CodeSafetyValidator.validate('process.exit(1);');
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/process/);
    });

    test('rejects global.something access', () => {
      const result = CodeSafetyValidator.validate('global.something;');
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/global/);
    });

    test('rejects __proto__ access', () => {
      const result = CodeSafetyValidator.validate('obj.__proto__;');
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/__proto__/);
    });
  });

  describe('syntaxCheck()', () => {
    test('validates correct syntax', () => {
      const result = CodeSafetyValidator.syntaxCheck('function add(a, b) { return a + b; }');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('rejects invalid syntax', () => {
      const result = CodeSafetyValidator.syntaxCheck('function {{{');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
