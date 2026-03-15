const fs = require('fs');
const Checkpoint = require('../src/core/Checkpoint');

describe('Checkpoint', () => {
    afterEach(() => {
        Checkpoint.clear();
    });

    test('save/load cycle works', () => {
        Checkpoint.save({ step: 3, golemId: 'test' });
        const loaded = Checkpoint.load();
        expect(loaded).not.toBeNull();
        expect(loaded.step).toBe(3);
        expect(loaded.golemId).toBe('test');
        expect(loaded.savedAt).toBeDefined();
    });

    test('clear removes checkpoint', () => {
        Checkpoint.save({ step: 1 });
        Checkpoint.clear();
        const loaded = Checkpoint.load();
        expect(loaded).toBeNull();
    });

    test('load returns null for expired checkpoint', () => {
        // Manually write expired checkpoint
        fs.writeFileSync('golem_checkpoint.json', JSON.stringify({
            step: 1,
            savedAt: Date.now() - 4000000 // > 1 hour ago
        }));
        const loaded = Checkpoint.load();
        expect(loaded).toBeNull();
    });

    test('load returns null when file does not exist', () => {
        const loaded = Checkpoint.load();
        expect(loaded).toBeNull();
    });
});
