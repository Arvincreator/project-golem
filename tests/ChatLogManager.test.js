const fs = require('fs');
const path = require('path');

const mockDbInstances = [];
const mockDatabase = jest.fn(() => {
    const db = {
        run: jest.fn((sql, params, cb) => {
            if (typeof params === 'function') cb = params;
            if (cb) cb(null);
            return db;
        }),
        all: jest.fn((sql, params, cb) => {
            if (typeof params === 'function') cb = params;
            if (cb) cb(null, []);
        }),
        get: jest.fn((sql, params, cb) => {
            if (typeof params === 'function') cb = params;
            if (cb) cb(null, null);
        }),
        serialize: jest.fn((fn) => fn()),
    };
    mockDbInstances.push(db);
    return db;
});

jest.mock('sqlite3', () => ({
    verbose: () => ({ Database: mockDatabase }),
}));

jest.mock('fs', () => ({
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    readdirSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
}));

const ChatLogManager = require('../src/managers/ChatLogManager');

describe('ChatLogManager', () => {
    let manager;

    beforeEach(() => {
        jest.clearAllMocks();
        mockDbInstances.length = 0;

        fs.existsSync.mockImplementation((target) => {
            const p = String(target);
            if (p.includes('.legacy_migrated')) return true;
            return true;
        });
        fs.readdirSync.mockReturnValue([]);

        manager = new ChatLogManager({ logDir: '/tmp/test-logs', golemId: 'ut' });
    });

    test('init creates db directory when missing and initializes sqlite handles', async () => {
        fs.existsSync.mockImplementation((target) => {
            const p = String(target);
            if (p.includes('.legacy_migrated')) return true;
            if (p.endsWith(path.sep + 'db') || p.endsWith('/db')) return false;
            return true;
        });

        await manager.init();

        expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('db'), { recursive: true });
        expect(mockDatabase).toHaveBeenCalled();
        expect(manager._isInitialized).toBe(true);
    });

    test('append writes a message record when initialized', async () => {
        await manager.init();
        const db = mockDbInstances[0];

        manager.append({ sender: 'User', content: 'hello', type: 'chat' });

        expect(db.run).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO messages'),
            expect.arrayContaining([expect.any(Number), expect.any(String), expect.any(String), 'User', 'hello', 'chat']),
            expect.any(Function)
        );
    });

    test('cleanup runs retention deletes after init', async () => {
        await manager.init();
        manager.runAsync = jest.fn().mockResolvedValue();

        await manager.cleanup();

        expect(manager.runAsync).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM messages'), expect.any(Array));
        expect(manager.runAsync).toHaveBeenCalledWith(expect.stringContaining("tier = 'daily'"), expect.any(Array));
        expect(manager.runAsync).toHaveBeenCalledWith(expect.stringContaining("tier = 'monthly'"), expect.any(Array));
    });

    test('_getYesterdayDateString returns YYYYMMDD', () => {
        const str = manager._getYesterdayDateString();
        expect(str).toMatch(/^\d{8}$/);
    });

    test('compressLogsForDate skips when message count is below threshold and force is false', async () => {
        manager._isInitialized = true;
        manager.db = {};
        manager.allAsync = jest.fn().mockResolvedValue([
            { timestamp: Date.now(), sender: 'A', content: '1' },
            { timestamp: Date.now(), sender: 'B', content: '2' },
        ]);
        manager._compressAndSave = jest.fn();

        await manager.compressLogsForDate('20240101', { sendMessage: jest.fn() }, false);

        expect(manager._compressAndSave).not.toHaveBeenCalled();
    });

    test('compressLogsForDate calls _compressAndSave when force is true', async () => {
        manager._isInitialized = true;
        manager.db = {};
        manager.allAsync = jest.fn().mockResolvedValue([
            { timestamp: Date.now(), sender: 'A', content: 'alpha' },
            { timestamp: Date.now(), sender: 'B', content: 'beta' },
        ]);
        manager._compressAndSave = jest.fn().mockResolvedValue();

        await manager.compressLogsForDate('20240101', { sendMessage: jest.fn() }, true);

        expect(manager._compressAndSave).toHaveBeenCalledWith(
            expect.stringContaining('alpha'),
            '20240101',
            'daily',
            expect.any(Object),
            expect.any(Number)
        );
    });

    test('_compressAndSave stores parsed summary into summaries table', async () => {
        manager.runAsync = jest.fn().mockResolvedValue();

        await manager._compressAndSave('prompt', '20240101', 'daily', {
            sendMessage: jest.fn().mockResolvedValue('[GOLEM_REPLY]summary text'),
        }, 123);

        expect(manager.runAsync).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO summaries'),
            ['daily', '20240101', expect.any(Number), 'summary text', 123, 'summary text'.length]
        );
    });

    test('readRecentHourlyAsync returns chronological text and readTierAsync returns summaries', async () => {
        manager._isInitialized = true;
        manager.db = {};
        manager.allAsync = jest.fn()
            .mockResolvedValueOnce([
                { timestamp: new Date('2024-01-01T00:00:00Z').getTime(), sender: 'U', content: 'first' },
                { timestamp: new Date('2024-01-01T00:01:00Z').getTime(), sender: 'A', content: 'second' },
            ])
            .mockResolvedValueOnce([
                { date_string: '20240101', content: 'sum1', timestamp: 1 },
                { date_string: '20240102', content: 'sum2', timestamp: 2 },
            ]);

        const hourly = await manager.readRecentHourlyAsync(10, 10000);
        const tier = await manager.readTierAsync('daily', 10, 10000);

        expect(hourly).toContain('U: first');
        expect(hourly).toContain('A: second');
        expect(tier).toEqual([
            { date: '20240102', content: 'sum2' },
            { date: '20240101', content: 'sum1' },
        ]);
    });
});
