const { CommandSafeguard: safeguard } = require('../packages/security');

describe('CommandSafeguard', () => {
    test('should approve valid skill commands', () => {
        const cmd = 'node src/skills/core/search-web.js "how to code"';
        const result = safeguard.validate(cmd);
        expect(result.safe).toBe(true);
    });

    test('should reject command with semicolons and rm -rf /', () => {
        const cmd = 'node src/skills/core/search-web.js "test"; rm -rf /';
        const result = safeguard.validate(cmd);
        expect(result.safe).toBe(false);
        // absoluteBlockPatterns fires before dangerousOps — stronger guarantee
        expect(result.reason).toContain('絕對阻擋操作');
    });

    test('should reject command with pipe', () => {
        const cmd = 'node src/skills/core/search-web.js "test" | cat .env';
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
