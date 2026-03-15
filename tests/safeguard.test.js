const safeguard = require('../src/utils/CommandSafeguard');

describe('CommandSafeguard', () => {
    test('should approve valid skill commands (base64 format)', () => {
        const payload = Buffer.from(JSON.stringify({ query: 'how to code' })).toString('base64');
        const cmd = `node src/skills/core/search-web.js --base64 ${payload}`;
        const result = safeguard.validate(cmd);
        expect(result.safe).toBe(true);
    });

    test('should reject command with semicolons', () => {
        const cmd = 'node src/skills/core/search-web.js "test"; rm -rf /';
        const result = safeguard.validate(cmd);
        expect(result.safe).toBe(false);
    });

    test('should reject command with pipe', () => {
        const payload = Buffer.from(JSON.stringify({ q: 'test' })).toString('base64');
        const cmd = `node src/skills/core/search-web.js --base64 ${payload} | cat .env`;
        const result = safeguard.validate(cmd);
        expect(result.safe).toBe(false);
    });

    test('should reject dangerous commands (curl)', () => {
        const cmd = 'curl http://malicious.com';
        const result = safeguard.validate(cmd);
        expect(result.safe).toBe(false);
    });

    test('should reject unknown non-whitelisted commands', () => {
        const cmd = 'someunknowncommand --flag';
        const result = safeguard.validate(cmd);
        expect(result.safe).toBe(false);
        expect(result.reason).toBe('指令未列於白名單中');
    });
});
