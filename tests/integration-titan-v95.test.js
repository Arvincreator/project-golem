require('./setup');

const fs = require('fs');
const path = require('path');

// Mock DebouncedWriter to avoid open timer handles
jest.mock('../src/utils/DebouncedWriter', () => {
  return class MockDebouncedWriter {
    static _instances = new Set();
    constructor() { MockDebouncedWriter._instances.add(this); }
    markDirty() {}
    forceFlush() { return Promise.resolve(); }
    destroy() { MockDebouncedWriter._instances.delete(this); }
    static async flushAll() {}
  };
});

// Mock fs for persistence tests
const mockFiles = {};
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn((p) => {
      if (mockFiles[p]) return true;
      if (p.includes('core_memory_') || p.includes('golem_experience') || p.includes('golem_strategies')) return !!mockFiles[p];
      return false;
    }),
    readFileSync: jest.fn((p, enc) => {
      if (mockFiles[p]) return mockFiles[p];
      throw new Error('ENOENT');
    }),
    writeFileSync: jest.fn((p, data) => {
      mockFiles[p] = data;
    }),
    mkdirSync: jest.fn(),
    promises: {
      writeFile: jest.fn().mockResolvedValue(undefined),
      rename: jest.fn().mockResolvedValue(undefined),
    },
  };
});

describe('Integration: TITAN v9.5', () => {
  beforeEach(() => {
    // Clear mock file system
    for (const key of Object.keys(mockFiles)) {
      delete mockFiles[key];
    }
    jest.clearAllMocks();
  });

  describe('1. CoreMemory persistence roundtrip', () => {
    test('create, write, reload, verify', () => {
      const CoreMemory = require('../src/core/CoreMemory');

      // Create and write
      const cm1 = new CoreMemory({ golemId: 'integ_test' });
      cm1.append('user_profile', 'User prefers dark mode');

      // Simulate save (force sync write since DebouncedWriter is mocked)
      const saveData = JSON.stringify({ blocks: cm1.blocks }, null, 2);
      mockFiles[cm1._file] = saveData;
      fs.existsSync.mockImplementation((p) => !!mockFiles[p]);
      fs.readFileSync.mockImplementation((p) => {
        if (mockFiles[p]) return mockFiles[p];
        throw new Error('ENOENT');
      });

      // Reload
      const cm2 = new CoreMemory({ golemId: 'integ_test' });

      expect(cm2.read('user_profile')).toContain('User prefers dark mode');
    });
  });

  describe('2. ExperienceReplay reflect -> coreMemory.learned_rules', () => {
    test('reflection writes action items to coreMemory', async () => {
      const CoreMemory = require('../src/core/CoreMemory');
      const ExperienceReplay = require('../src/core/ExperienceReplay');

      const cm = new CoreMemory({ golemId: 'reflect_test' });
      const er = new ExperienceReplay({
        golemId: 'reflect_test',
        coreMemory: cm,
        brain: null,
      });

      // Record multiple failures to create patterns
      for (let i = 0; i < 5; i++) {
        er.recordTrace({
          goal: 'fetch data',
          action: 'api_call',
          result: 'error: timeout',
          success: false,
          reward: 0,
        });
      }

      // Reflect
      const reflection = await er.reflect();

      expect(reflection).not.toBeNull();
      expect(reflection.actionItems.length).toBeGreaterThan(0);

      // coreMemory.learned_rules should have been updated (via system append)
      const rules = cm.read('learned_rules');
      expect(rules).toBeTruthy();
      expect(rules.length).toBeGreaterThan(0);
    });
  });

  describe('3. EMA values update on recordTrace', () => {
    test('EMA values change after recording traces', () => {
      const ExperienceReplay = require('../src/core/ExperienceReplay');
      const er = new ExperienceReplay({ golemId: 'ema_test' });

      const emaBefore = er.getEmaValues();
      expect(emaBefore.L1).toBe(0.5); // default

      // Record a successful trace (reward = 1.0)
      er.recordTrace({
        goal: 'test',
        action: 'brain_response',
        result: 'good',
        success: true,
        reward: 1.0,
      });

      const emaAfter = er.getEmaValues();
      // EMA = 0.1 * 1.0 + 0.9 * 0.5 = 0.55
      expect(emaAfter.L1).toBeCloseTo(0.55, 2);

      // Record a failed trace (reward = 0.0)
      er.recordTrace({
        goal: 'test2',
        action: 'brain_response',
        result: 'bad',
        success: false,
        reward: 0.0,
      });

      const emaAfter2 = er.getEmaValues();
      // EMA = 0.1 * 0.0 + 0.9 * 0.55 = 0.495
      expect(emaAfter2.L1).toBeCloseTo(0.495, 2);
    });
  });

  describe('4. CodeSafetyValidator blocks all known bypass patterns', () => {
    test('blocks require, eval, Function, process, global, __proto__', () => {
      const CodeSafetyValidator = require('../src/utils/CodeSafetyValidator');

      const bypasses = [
        { code: 'require("child_process").exec("rm -rf /")', desc: 'require' },
        { code: 'eval("alert(1)")', desc: 'eval' },
        { code: 'new Function("return process")()', desc: 'new Function' },
        { code: 'process.env.SECRET', desc: 'process access' },
        { code: 'global.Buffer', desc: 'global access' },
        { code: 'globalThis.fetch', desc: 'globalThis access' },
        { code: 'obj.__proto__.polluted = true', desc: '__proto__' },
        { code: 'Function("return this")()', desc: 'Function call' },
      ];

      for (const { code, desc } of bypasses) {
        const result = CodeSafetyValidator.validate(code);
        expect(result.safe).toBe(false);
      }
    });

    test('allows safe patterns', () => {
      const CodeSafetyValidator = require('../src/utils/CodeSafetyValidator');

      const safeCodes = [
        'const x = 1 + 2;',
        'function greet(name) { return "Hello " + name; }',
        'const arr = [1, 2, 3].map(x => x * 2);',
        'if (true) { const a = 1; }',
        'const obj = { key: "value" };',
      ];

      for (const code of safeCodes) {
        const result = CodeSafetyValidator.validate(code);
        expect(result.safe).toBe(true);
      }
    });
  });
});
