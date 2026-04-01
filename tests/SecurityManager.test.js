const { SecurityManager } = require('../packages/security');

describe('SecurityManager', () => {
    let sm;

    beforeEach(() => {
        sm = new SecurityManager();
        delete process.env.COMMAND_WHITELIST;
        delete process.env.GOLEM_TRUST_SYSTEM_COMMANDS;
        delete process.env.GOLEM_STRICT_SAFEGUARD;
        delete process.env.GOLEM_AUTO_APPROVE_ALL;
    });

    afterEach(() => {
        delete process.env.COMMAND_WHITELIST;
        delete process.env.GOLEM_TRUST_SYSTEM_COMMANDS;
        delete process.env.GOLEM_STRICT_SAFEGUARD;
        delete process.env.GOLEM_AUTO_APPROVE_ALL;
    });

    test('assess should BLOCK destructive rm -rf /', () => {
        const result = sm.assess('rm -rf /');
        expect(result.level).toBe('BLOCKED');
    });

    test('assess should BLOCK mkfs command', () => {
        const result = sm.assess('mkfs.ext4 /dev/sda1');
        expect(result.level).toBe('BLOCKED');
    });

    test('assess should BLOCK fork bomb', () => {
        const result = sm.assess(':(){:|:&};:');
        expect(result.level).toBe('BLOCKED');
    });

    test('assess should BLOCK dd if= command', () => {
        const result = sm.assess('dd if=/dev/zero of=/dev/sda');
        expect(result.level).toBe('BLOCKED');
    });

    test('assess should return WARNING for redirection >', () => {
        const result = sm.assess('echo hello > /etc/hosts');
        expect(result.level).toBe('WARNING');
    });

    test('assess should return WARNING for subshell $()', () => {
        const result = sm.assess('cat $(ls)');
        expect(result.level).toBe('WARNING');
    });

    test('assess should return DANGER for rm command', () => {
        const result = sm.assess('rm myfile.txt');
        expect(result.level).toBe('DANGER');
    });

    test('assess should return DANGER for sudo command', () => {
        const result = sm.assess('sudo apt install something');
        expect(result.level).toBe('DANGER');
    });

    test('assess should return WARNING for unknown safe command', () => {
        const result = sm.assess('node index.js');
        expect(result.level).toBe('WARNING');
    });

    test('assess should return SAFE for whitelisted command', () => {
        process.env.COMMAND_WHITELIST = 'node,npm';
        const result = sm.assess('node index.js');
        expect(result.level).toBe('SAFE');
    });

    test('assess should return SAFE for any command when AUTO_APPROVE_ALL is true', () => {
        process.env.GOLEM_AUTO_APPROVE_ALL = 'true';
        const result = sm.assess('rm -rf some_dir');
        expect(result.level).toBe('SAFE');
    });

    test('assess should still return BLOCKED for destructive command even if AUTO_APPROVE_ALL is true', () => {
        process.env.GOLEM_AUTO_APPROVE_ALL = 'true';
        const result = sm.assess('rm -rf /');
        expect(result.level).toBe('BLOCKED');
    });

    test('assess should return SAFE for system safe command when TRUST_SYSTEM_COMMANDS is true', () => {
        process.env.GOLEM_TRUST_SYSTEM_COMMANDS = 'true';
        const result = sm.assess('ls');
        expect(result.level).toBe('SAFE');
    });

    test('assess should return WARNING for system safe command when TRUST_SYSTEM_COMMANDS is false', () => {
        process.env.GOLEM_TRUST_SYSTEM_COMMANDS = 'false';
        const result = sm.assess('ls');
        expect(result.level).toBe('WARNING');
    });

    test('assess compound command with dangerous sub-cmd returns DANGER', () => {
        process.env.COMMAND_WHITELIST = 'ls';
        const result = sm.assess('ls && rm myfile.txt');
        expect(result.level).toBe('DANGER');
    });

    test('assess compound command all whitelisted returns SAFE', () => {
        process.env.COMMAND_WHITELIST = 'ls,pwd';
        const result = sm.assess('ls && pwd');
        expect(result.level).toBe('SAFE');
    });

    test('assess read-only curl fallback command returns SAFE when TRUST_SYSTEM_COMMANDS is true', () => {
        process.env.GOLEM_TRUST_SYSTEM_COMMANDS = 'true';
        const result = sm.assess('curl -s "https://example.com/api" || echo "fallback"');
        expect(result.level).toBe('SAFE');
    });

    test('assess read-only curl fallback command still SAFE when TRUST_SYSTEM_COMMANDS is false (network-readonly policy)', () => {
        process.env.GOLEM_TRUST_SYSTEM_COMMANDS = 'false';
        delete process.env.GOLEM_TRUST_READONLY_NETWORK_COMMANDS;
        const result = sm.assess('curl -s "https://example.com/api" || echo "fallback"');
        expect(result.level).toBe('SAFE');
    });

    test('assess compound command with unknown sub-cmd returns WARNING', () => {
        process.env.COMMAND_WHITELIST = 'ls';
        const result = sm.assess('ls && node');
        expect(result.level).toBe('WARNING');
    });

    test('assess empty string returns WARNING', () => {
        const result = sm.assess('');
        expect(result.level).toBe('WARNING');
    });

    test('assess null returns WARNING', () => {
        const result = sm.assess(null);
        expect(result.level).toBe('WARNING');
    });
});
