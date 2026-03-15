const SecurityManager = require('../src/managers/SecurityManager');

describe('SecurityManager', () => {
    let sm;
    
    beforeEach(() => {
        process.env.COMMAND_WHITELIST = "ls,pwd";
        sm = new SecurityManager();
    });

    test('should allow whitelisted commands', () => {
        expect(sm.assess('ls').level).toBe('SAFE');
        expect(sm.assess('pwd').level).toBe('SAFE');
    });

    test('should block dangerous commands (rm)', () => {
        const result = sm.assess('rm -rf /');
        expect(result.level).toBe('BLOCKED');
        expect(result.reason).toBe('毀滅性指令');
    });

    test('should warn on non-whitelisted commands', () => {
        const result = sm.assess('whoami');
        expect(result.level).toBe('WARNING');
    });

    test('should detect dangerous high-level operations', () => {
        const result = sm.assess('sudo reboot');
        expect(result.level).toBe('DANGER');
        expect(result.reason).toContain('高風險操作');
    });
});
