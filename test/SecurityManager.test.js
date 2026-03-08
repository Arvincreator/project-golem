const SecurityManager = require('../src/managers/SecurityManager');

const sm = new SecurityManager();

describe('SecurityManager.assess', () => {
  test('marks safe commands as SAFE', () => {
    expect(sm.assess('ls -la').level).toBe('SAFE');
    expect(sm.assess('pwd').level).toBe('SAFE');
    expect(sm.assess('date').level).toBe('SAFE');
    expect(sm.assess('echo hello').level).toBe('SAFE');
    expect(sm.assess('whoami').level).toBe('SAFE');
    expect(sm.assess('cat file.txt').level).toBe('SAFE');
  });

  test('blocks destructive commands', () => {
    expect(sm.assess('rm -rf /').level).toBe('BLOCKED');
    expect(sm.assess('mkfs /dev/sda').level).toBe('BLOCKED');
    expect(sm.assess('dd if=/dev/zero').level).toBe('BLOCKED');
  });

  test('flags dangerous commands as DANGER', () => {
    expect(sm.assess('rm file.txt').level).toBe('DANGER');
    expect(sm.assess('sudo apt update').level).toBe('DANGER');
    expect(sm.assess('chmod 777 script.sh').level).toBe('DANGER');
    expect(sm.assess('reboot').level).toBe('DANGER');
  });

  test('marks unknown commands as WARNING', () => {
    expect(sm.assess('curl https://example.com').level).toBe('WARNING');
    expect(sm.assess('npm install express').level).toBe('WARNING');
    expect(sm.assess('python3 script.py').level).toBe('WARNING');
  });

  test('handles empty/null input', () => {
    expect(sm.assess('').level).toBe('WARNING');
    expect(sm.assess(null).level).toBe('WARNING');
    expect(sm.assess(undefined).level).toBe('WARNING');
  });
});
