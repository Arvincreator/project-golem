const { CommandSafeguard: safeguard } = require('../packages/security');

describe('CommandSafeguard', () => {
    beforeEach(() => {
        delete process.env.COMMAND_WHITELIST;
        delete process.env.GOLEM_STRICT_SAFEGUARD;
    });

    // Absolute block patterns (cannot be bypassed by skipWhitelist)
    test('should block rm -rf / even if skipWhitelist is true', () => {
        const result = safeguard.validate('ls ; rm -rf /', true);
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('絕對阻擋操作');
    });

    test('should block rm -rf / inside bash -c wrapper even with skipWhitelist', () => {
        const result = safeguard.validate('bash -c "rm -rf /"', true);
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('絕對阻擋操作');
    });

    test('should block dd disk-wipe even with skipWhitelist', () => {
        const result = safeguard.validate('dd if=/dev/zero of=/dev/sda', true);
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('絕對阻擋操作');
    });

    test('should block mkfs commands even with skipWhitelist', () => {
        const result = safeguard.validate('mkfs.ext4 /dev/sdb', true);
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('絕對阻擋操作');
    });

    // Hard-coded whitelist
    test('should allow hard-coded whitelist commands (ls with args)', () => {
        expect(safeguard.validate('ls -la').safe).toBe(true);
    });

    test('should allow bare ls without arguments', () => {
        expect(safeguard.validate('ls').safe).toBe(true);
    });

    // Options object format
    test('should allow manually approved dangerous command with options object', () => {
        const result = safeguard.validate('sudo ls', {
            skipWhitelist: true,
            allowSensitiveSyntax: true,
            allowDangerousOps: true,
        });
        expect(result.safe).toBe(true);
    });

    test('should treat boolean true as all-options-enabled', () => {
        expect(safeguard.validate('sudo ls', true).safe).toBe(true);
    });

    // Sensitive symbol blocking
    test('should block pipe unless allowSensitiveSyntax is set', () => {
        const blocked = safeguard.validate('pwd | grep a');
        expect(blocked.safe).toBe(false);
        expect(blocked.reason).toContain('偵測到敏感關鍵字');
    });

    test('should allow pipe when allowSensitiveSyntax and skipWhitelist are set', () => {
        const allowed = safeguard.validate('pwd | grep a', { skipWhitelist: true, allowSensitiveSyntax: true });
        expect(allowed.safe).toBe(true);
    });

    // Strict mode
    test('should block dangerous ops when GOLEM_STRICT_SAFEGUARD is true', () => {
        process.env.GOLEM_STRICT_SAFEGUARD = 'true';
        const result = safeguard.validate('rm -rf temp_dir');
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('偵測到高度危險操作');
    });

    test('should skip strict dangerous-op check when GOLEM_STRICT_SAFEGUARD is false', () => {
        process.env.GOLEM_STRICT_SAFEGUARD = 'false';
        const result = safeguard.validate('rm -rf temp_dir');
        expect(result.safe).toBe(false);
        expect(result.reason).not.toContain('偵測到高度危險操作');
    });

    // Dynamic COMMAND_WHITELIST
    test('should allow commands in COMMAND_WHITELIST env var', () => {
        process.env.COMMAND_WHITELIST = 'date,docker';
        expect(safeguard.validate('date').safe).toBe(true);
        expect(safeguard.validate('docker ps').safe).toBe(true);
    });

    test('should support wildcard entries in COMMAND_WHITELIST', () => {
        process.env.COMMAND_WHITELIST = 'npm run *';
        expect(safeguard.validate('npm run build').safe).toBe(true);
        expect(safeguard.validate('npm run test').safe).toBe(true);
    });

    test('should support exact multi-word entries in COMMAND_WHITELIST', () => {
        process.env.COMMAND_WHITELIST = 'git status';
        expect(safeguard.validate('git status').safe).toBe(true);
        expect(safeguard.validate('git pull').safe).toBe(false);
    });

    test('should silently drop COMMAND_WHITELIST entries with shell metacharacters', () => {
        process.env.COMMAND_WHITELIST = 'safe-cmd,evil;cmd';
        expect(safeguard.validate('safe-cmd').safe).toBe(true);
        expect(safeguard.validate('evil;cmd').safe).toBe(false);
    });

    // Invalid input
    test('should return safe: false for null/undefined/non-string input', () => {
        expect(safeguard.validate(null).safe).toBe(false);
        expect(safeguard.validate(undefined).safe).toBe(false);
        expect(safeguard.validate(42).safe).toBe(false);
    });

    test('should return safe: false for empty string', () => {
        expect(safeguard.validate('').safe).toBe(false);
    });
});
