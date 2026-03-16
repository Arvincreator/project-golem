require('./setup');

jest.mock('fs', () => ({
  promises: {
    writeFile: jest.fn().mockResolvedValue(undefined),
    rename: jest.fn().mockResolvedValue(undefined),
  },
  readFileSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(false),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

const fs = require('fs');
const DebouncedWriter = require('../src/utils/DebouncedWriter');

describe('DebouncedWriter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    // Clear all instances between tests
    DebouncedWriter._instances.clear();
  });

  afterEach(() => {
    // Clean up all instances
    for (const inst of DebouncedWriter._instances) {
      inst.destroy();
    }
    jest.useRealTimers();
  });

  test('markDirty schedules a save', () => {
    const writer = new DebouncedWriter('/tmp/test.json', 1000);
    writer.markDirty('{"data":1}');

    // Timer should be set but file not written yet
    expect(fs.promises.writeFile).not.toHaveBeenCalled();

    // Advance past the delay
    jest.advanceTimersByTime(1100);

    // _flush is async, need to flush promises
    return Promise.resolve().then(() => {
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.tmp'),
        '{"data":1}'
      );
    });
  });

  test('forceFlush writes immediately', async () => {
    const writer = new DebouncedWriter('/tmp/test2.json', 5000);
    writer.markDirty('immediate data');

    await writer.forceFlush();

    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.tmp'),
      'immediate data'
    );
    expect(fs.promises.rename).toHaveBeenCalled();
  });

  test('multiple markDirty calls result in one write with last data', async () => {
    const writer = new DebouncedWriter('/tmp/test3.json', 1000);
    writer.markDirty('data-1');
    writer.markDirty('data-2');
    writer.markDirty('data-3');

    await writer.forceFlush();

    // Only last data should be written
    expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.tmp'),
      'data-3'
    );
  });

  test('flushAll flushes all instances', async () => {
    const w1 = new DebouncedWriter('/tmp/a.json', 5000);
    const w2 = new DebouncedWriter('/tmp/b.json', 5000);
    w1.markDirty('a-data');
    w2.markDirty('b-data');

    await DebouncedWriter.flushAll();

    expect(fs.promises.writeFile).toHaveBeenCalledTimes(2);
  });

  test('destroy cleans up timer and removes from instances', () => {
    const writer = new DebouncedWriter('/tmp/test4.json', 5000);
    writer.markDirty('some data');

    expect(DebouncedWriter._instances.has(writer)).toBe(true);

    writer.destroy();

    expect(DebouncedWriter._instances.has(writer)).toBe(false);
    expect(writer._timer).toBeNull();
  });
});
