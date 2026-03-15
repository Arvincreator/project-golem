const safeguard = require('../src/utils/CommandSafeguard');

describe('CommandSafeguard', () => {
    beforeEach(() => {
        delete process.env.COMMAND_WHITELIST;
    });

    test('should block dangerous operations even with skipWhitelist', () => {
        const result = safeguard.validate('ls ; rm -rf /', true);
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('禁止操作');
    });

    test('should allow hard-coded whitelist commands', () => {
        const result = safeguard.validate('ls -la');
        expect(result.safe).toBe(true);
    });

    test('should allow dynamic whitelist via process.env', () => {
        process.env.COMMAND_WHITELIST = 'date,docker';
        const resultDate = safeguard.validate('date');
        const resultDocker = safeguard.validate('docker ps');
        
        expect(resultDate.safe).toBe(true);
        expect(resultDocker.safe).toBe(true);
    });

    test('should allow non-whitelisted command if skipWhitelist is true', () => {
        const result = safeguard.validate('unknown-cmd', true);
        expect(result.safe).toBe(true);
    });

    test('should allow pipe operator if skipWhitelist is true', () => {
        const result = safeguard.validate('pwd | grep a', true);
        expect(result.safe).toBe(true);
    });

    test('should still block dangerous keywords even if skipWhitelist is true', () => {
        const result = safeguard.validate('date ; rm -rf /', true);
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('禁止操作');
    });
});
