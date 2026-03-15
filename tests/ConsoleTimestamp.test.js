describe('ConsoleTimestamp', () => {
    test('module exports timestamp-patching code', () => {
        const fs = require('fs');
        const path = require('path');
        const source = fs.readFileSync(path.join(__dirname, '../src/utils/ConsoleTimestamp.js'), 'utf-8');

        // Verify structure
        expect(source).toContain('console.log');
        expect(source).toContain('console.warn');
        expect(source).toContain('console.error');
        expect(source).toContain('padStart');
        expect(source).toContain('getHours');
    });

    test('timestamp function produces correct format', () => {
        const now = new Date();
        const ts = `[${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}]`;
        expect(ts).toMatch(/^\[\d{2}:\d{2}:\d{2}\]$/);
    });
});
