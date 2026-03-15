// security-manager.test.js — vitest globals mode
const SecurityManager = require('../src/managers/SecurityManager');

describe('SecurityManager', () => {
    let sm;

    beforeEach(() => {
        sm = new SecurityManager();
    });

    describe('assess()', () => {
        it('should block rm -rf /', () => {
            expect(sm.assess('rm -rf /').level).toBe('BLOCKED');
        });

        it('should block fork bomb', () => {
            // SecurityManager regex: :()\{:|:&\};: (no spaces)
            expect(sm.assess(':(){:|:&};:').level).toBe('BLOCKED');
        });

        it('should block mkfs', () => {
            expect(sm.assess('mkfs.ext4 /dev/sda1').level).toBe('BLOCKED');
        });

        it('should block dd if=', () => {
            expect(sm.assess('dd if=/dev/zero of=/dev/sda').level).toBe('BLOCKED');
        });

        it('should block Windows Format-Volume', () => {
            expect(sm.assess('Format-Volume -DriveLetter C').level).toBe('BLOCKED');
        });

        it('should block redirect to /dev/sd', () => {
            expect(sm.assess('echo x > /dev/sda').level).toBe('BLOCKED');
        });

        it('should allow safe commands', () => {
            expect(sm.assess('ls -la').level).toBe('SAFE');
            expect(sm.assess('node index.js').level).toBe('SAFE');
            expect(sm.assess('npm test').level).toBe('SAFE');
            expect(sm.assess('cat /etc/hostname').level).toBe('SAFE');
        });

        it('should handle empty/null input', () => {
            expect(sm.assess('').level).toBe('SAFE');
            expect(sm.assess(null).level).toBe('SAFE');
            expect(sm.assess(undefined).level).toBe('SAFE');
        });

        it('should return reason for blocked commands', () => {
            const result = sm.assess('rm -rf /');
            expect(result.reason).toBe('Destructive operation');
        });
    });
});
