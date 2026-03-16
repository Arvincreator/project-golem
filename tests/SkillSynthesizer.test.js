const SkillSynthesizer = require('../src/core/SkillSynthesizer');

describe('SkillSynthesizer', () => {
    let synth;

    beforeEach(() => {
        synth = new SkillSynthesizer({ golemId: 'test' });
    });

    test('should reject synthesis without brain', async () => {
        const result = await synth.synthesize({ pattern: 'test→test', occurrences: 3, steps: ['a', 'b'] });
        expect(result.success).toBe(false);
        expect(result.error).toContain('No brain');
    });

    test('should reject insufficient steps', async () => {
        synth.brain = { sendMessage: jest.fn() };
        const result = await synth.synthesize({ pattern: 'x', occurrences: 3, steps: ['a'] });
        expect(result.success).toBe(false);
        expect(result.error).toContain('Insufficient');
    });

    test('_validateSafety should reject dangerous code', () => {
        expect(synth._validateSafety('const x = eval("bad")').safe).toBe(false);
        expect(synth._validateSafety('require("child_process")').safe).toBe(false);
        expect(synth._validateSafety('process.exit(1)').safe).toBe(false);
        expect(synth._validateSafety('const fn = new Function("evil")').safe).toBe(false);
    });

    test('_validateSafety should accept safe code', () => {
        const safeCode = `module.exports = { name: 'test', execute: async () => 'ok' };`;
        expect(synth._validateSafety(safeCode).safe).toBe(true);
    });

    test('_validateSafety should reject network access', () => {
        expect(synth._validateSafety('fetch("http://evil.com")').safe).toBe(false);
        expect(synth._validateSafety('axios.get("url")').safe).toBe(false);
    });

    test('_dryRunValidate should pass valid JS', () => {
        expect(synth._dryRunValidate('const x = 1;').valid).toBe(true);
    });

    test('_dryRunValidate should fail invalid JS', () => {
        expect(synth._dryRunValidate('const = ;').valid).toBe(false);
    });

    test('_extractSkillName should extract from code', () => {
        const code = `module.exports = { name: 'auto_greet' };`;
        expect(synth._extractSkillName(code, 'test')).toBe('auto_greet');
    });

    test('_extractSkillName should derive from pattern', () => {
        const name = synth._extractSkillName('module.exports = {};', 'search→filter→display');
        expect(name).toContain('auto_');
        expect(name).toContain('search');
    });

    test('should enforce cooldown', async () => {
        synth.brain = { sendMessage: jest.fn().mockResolvedValue('module.exports = { name: "test", execute: async () => {} };') };
        synth._lastSynthesisTime = Date.now(); // Set cooldown

        const result = await synth.synthesize({ pattern: 'a→b', occurrences: 3, steps: ['a', 'b'] });
        expect(result.success).toBe(false);
        expect(result.error).toContain('Cooldown');
    });

    test('getStats should return synthesis stats', () => {
        const stats = synth.getStats();
        expect(stats.synthesizedCount).toBe(0);
        expect(stats.cooldownActive).toBe(false);
    });

    test('rollback should handle non-existent skill', () => {
        expect(synth.rollback('nonexistent')).toBe(false);
    });

    // v9.5: AST validation tests
    test('_validateSafety should use AST validation for require calls', () => {
        const result = synth._validateSafety('const cp = require("child_process"); cp.exec("ls");');
        expect(result.safe).toBe(false);
    });

    test('_validateSafety should use AST validation for eval', () => {
        const result = synth._validateSafety('eval("malicious")');
        expect(result.safe).toBe(false);
    });

    test('_validateSafety should use AST validation for new Function', () => {
        const result = synth._validateSafety('const fn = new Function("return process.env")');
        expect(result.safe).toBe(false);
    });

    test('_validateSafety should use AST validation for process access', () => {
        const result = synth._validateSafety('console.log(process.env.SECRET)');
        expect(result.safe).toBe(false);
    });

    test('_dryRunValidate should use acorn for syntax check', () => {
        const valid = synth._dryRunValidate('const x = 1 + 2;');
        expect(valid.valid).toBe(true);
        const invalid = synth._dryRunValidate('const = ;');
        expect(invalid.valid).toBe(false);
    });
});
