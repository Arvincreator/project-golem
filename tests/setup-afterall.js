// Global afterAll cleanup — flush DebouncedWriter handles to prevent open handle warnings
afterAll(async () => {
    try {
        const DebouncedWriter = require('../src/utils/DebouncedWriter');
        await DebouncedWriter.flushAll();
        for (const inst of DebouncedWriter._instances) {
            inst.destroy();
        }
    } catch (e) {
        // DebouncedWriter not loaded — nothing to clean
    }
});
