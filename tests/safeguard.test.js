const { CommandSafeguard: safeguard } = require('../packages/security');

describe('CommandSafeguard', () => {
    test('should approve valid skill commands', () => {
        const cmd = 'node src/skills/modules/search-web/index.js "how to code"';
        const result = safeguard.validate(cmd);
        expect(result.safe).toBe(true);
    });

    test('should reject command with semicolons', () => {
        const cmd = 'node src/skills/modules/search-web/index.js "test"; rm -rf /';
        const result = safeguard.validate(cmd);
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('偵測到高度危險操作');
    });


    test('should reject command with pipe', () => {
        const cmd = 'node src/skills/modules/search-web/index.js "test" | cat .env';
        const result = safeguard.validate(cmd);
        expect(result.safe).toBe(false);
    });

    test('should reject unknown commands', () => {
        const cmd = 'curl http://malicious.com';
        const result = safeguard.validate(cmd);
        expect(result.safe).toBe(false);
        expect(result.reason).toBe('指令未列於白名單中');
    });
});
