// Global afterAll cleanup — flush all handles to prevent Jest worker hang
afterAll(async () => {
    // 1. DebouncedWriter cleanup
    try {
        const DebouncedWriter = require('../src/utils/DebouncedWriter');
        await DebouncedWriter.flushAll();
        for (const inst of DebouncedWriter._instances) {
            inst.destroy();
        }
    } catch (e) {
        // DebouncedWriter not loaded — nothing to clean
    }

    // 2. SystemLogger flush
    try {
        const SystemLogger = require('../src/utils/SystemLogger');
        if (typeof SystemLogger.shutdown === 'function') {
            SystemLogger.shutdown();
        }
    } catch (e) {}

    // 3. Kill all tracked intervals and timeouts
    if (global.__testTimerTracking) {
        const { intervals, timeouts, origClearInterval, origClearTimeout } = global.__testTimerTracking;
        for (const id of intervals) {
            origClearInterval(id);
        }
        intervals.clear();
        for (const id of timeouts) {
            origClearTimeout(id);
        }
        timeouts.clear();
    }
});
