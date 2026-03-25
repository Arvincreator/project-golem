const fs = require('fs');
const os = require('os');
const path = require('path');

function writePromptPool(tempCwd, items) {
    const dir = path.join(tempCwd, 'data', 'dashboard');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'prompt-pool.json'), JSON.stringify(items, null, 2), 'utf8');
}

describe('PromptShortcutManager', () => {
    const originalCwd = process.cwd();
    let tempCwd = '';

    beforeEach(() => {
        tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'golem-shortcut-manager-'));
        process.chdir(tempCwd);
        jest.resetModules();
    });

    afterEach(() => {
        process.chdir(originalCwd);
        if (tempCwd) {
            fs.rmSync(tempCwd, { recursive: true, force: true });
        }
        tempCwd = '';
    });

    test('expandPromptShortcutInput expands shortcut and preserves trailing user args', () => {
        writePromptPool(tempCwd, [
            {
                id: 'p1',
                shortcut: '/weekly',
                prompt: '請輸出本週重點摘要',
                note: '每週報告',
            },
        ]);

        const manager = require('../src/managers/PromptShortcutManager');
        const expanded = manager.expandPromptShortcutInput('/weekly@golem_test_bot 再補上風險');

        expect(expanded.changed).toBe(true);
        expect(expanded.matched.shortcut).toBe('/weekly');
        expect(expanded.text).toBe('請輸出本週重點摘要\n再補上風險');
    });

    test('expandPromptShortcutInput matches legacy shortcut without slash when Telegram sends slash command', () => {
        writePromptPool(tempCwd, [
            {
                id: 'p1',
                shortcut: 'weekly',
                prompt: '請輸出本週重點摘要',
                note: '每週報告',
            },
        ]);

        const manager = require('../src/managers/PromptShortcutManager');
        const expanded = manager.expandPromptShortcutInput('/weekly');

        expect(expanded.changed).toBe(true);
        expect(expanded.matched.shortcut).toBe('weekly');
        expect(expanded.text).toBe('請輸出本週重點摘要');
    });

    test('expandPromptShortcutInput does not expand plain text without slash prefix', () => {
        writePromptPool(tempCwd, [
            {
                id: 'p1',
                shortcut: '/weekly',
                prompt: '請輸出本週重點摘要',
                note: '每週報告',
            },
        ]);

        const manager = require('../src/managers/PromptShortcutManager');
        const expanded = manager.expandPromptShortcutInput('weekly 請幫我總結');

        expect(expanded.changed).toBe(false);
        expect(expanded.text).toBe('weekly 請幫我總結');
    });

    test('readPromptPoolItems filters reserved and invalid shortcuts', () => {
        writePromptPool(tempCwd, [
            { id: 'a', shortcut: 'new', prompt: 'reserved' }, // 系統保留（無 / 也應擋下）
            { id: 'b', shortcut: '/ok_cmd', prompt: 'valid' },
            { id: 'c', shortcut: '/bad cmd', prompt: 'invalid' }, // 含空白
        ]);

        const manager = require('../src/managers/PromptShortcutManager');
        const items = manager.readPromptPoolItems();
        const shortcuts = items.map((item) => item.shortcut);

        expect(shortcuts).toContain('/ok_cmd');
        expect(shortcuts).not.toContain('new');
        expect(shortcuts).not.toContain('/bad cmd');
    });

    test('getTelegramPromptCommands returns Telegram-compatible menu commands', () => {
        writePromptPool(tempCwd, [
            { id: 'a', shortcut: '/report_daily', prompt: 'daily prompt', note: '日報捷徑' },
            { id: 'b', shortcut: '/中文', prompt: 'invalid tg command', note: '中文' },
            { id: 'c', shortcut: '/report_daily', prompt: 'duplicate', note: 'duplicate' },
        ]);

        const manager = require('../src/managers/PromptShortcutManager');
        const commands = manager.getTelegramPromptCommands();

        expect(commands.length).toBe(1);
        expect(commands[0].command).toBe('report_daily');
        expect(commands[0].description.startsWith('[Prompt]')).toBe(true);
    });

    test('suggestPromptShortcuts returns likely matches for slash prefixes', () => {
        writePromptPool(tempCwd, [
            { id: 'a', shortcut: '/report_daily', prompt: 'daily prompt' },
            { id: 'b', shortcut: '/review', prompt: 'review prompt' },
            { id: 'c', shortcut: '/weekly_summary', prompt: 'weekly prompt' },
        ]);

        const manager = require('../src/managers/PromptShortcutManager');
        const suggestions = manager.suggestPromptShortcuts('/rep', 3);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions[0].shortcut).toBe('/report_daily');
    });

    test('normalizeShortcutKey is exported and strips slash prefix and bot mention', () => {
        jest.resetModules();
        const manager = require('../src/managers/PromptShortcutManager');

        expect(manager.normalizeShortcutKey('/weekly')).toBe('weekly');
        expect(manager.normalizeShortcutKey('/weekly@golem_test_bot')).toBe('weekly');
        expect(manager.normalizeShortcutKey('weekly')).toBe('weekly');
        expect(manager.normalizeShortcutKey('')).toBe('');
        expect(manager.normalizeShortcutKey(null)).toBe('');
    });
});