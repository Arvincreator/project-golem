const mockFs = {
    existsSync: jest.fn(),
    readdirSync: jest.fn(),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    readFileSync: jest.fn(),
    promises: {
        mkdir: jest.fn(),
        stat: jest.fn(),
        readFile: jest.fn(),
        writeFile: jest.fn(),
    },
};

jest.mock('fs', () => mockFs);
jest.mock('../src/skills/modules/log-archive/index.js', () => ({
    run: jest.fn().mockResolvedValue('Archive successful'),
}));
jest.mock('../packages/protocol', () => ({
    NeuroShunter: {
        dispatch: jest.fn(),
    },
}));

const fs = require('fs');
const AutonomyManager = require('../src/managers/AutonomyManager');
const ConfigManager = require('../src/config');
const logArchive = require('../src/skills/modules/log-archive/index.js');
const { NeuroShunter } = require('../packages/protocol');

describe('AutonomyManager', () => {
    let manager;
    let mockBrain;

    beforeEach(() => {
        jest.clearAllMocks();

        mockBrain = {
            sendMessage: jest.fn().mockResolvedValue('brain response'),
            memoryDriver: {
                checkDueTasks: jest.fn().mockResolvedValue([]),
            },
            chatLogManager: {
                dirs: { hourly: '/tmp/logs' },
                _getYesterdayDateString: jest.fn().mockReturnValue('20240101'),
                readTierAsync: jest.fn().mockResolvedValue([]),
            },
        };

        manager = new AutonomyManager(mockBrain, {}, {});

        ConfigManager.CONFIG.TG_TOKEN = 'test_token';
        ConfigManager.CONFIG.DC_TOKEN = '';
        ConfigManager.CONFIG.ADMIN_IDS = ['123'];
        ConfigManager.CONFIG.TG_AUTH_MODE = 'ADMIN';
        ConfigManager.CONFIG.DISCORD_ADMIN_ID = '999';
        ConfigManager.CONFIG.ARCHIVE_THRESHOLD_YESTERDAY = 2;
        ConfigManager.CONFIG.ARCHIVE_THRESHOLD_TODAY = 99;
        ConfigManager.CONFIG.ENABLE_LOG_NOTIFICATIONS = false;
        ConfigManager.LOG_BASE_DIR = '/tmp/logs';

        fs.existsSync.mockReturnValue(false);
        fs.readdirSync.mockReturnValue([]);
        fs.promises.mkdir.mockResolvedValue();
        fs.promises.stat.mockResolvedValue(null);
        fs.promises.readFile.mockResolvedValue('[]');
        fs.promises.writeFile.mockResolvedValue();
    });

    test('setIntegrations sets properties', () => {
        manager.setIntegrations('tg', 'dc', 'convo');
        expect(manager.tgBot).toBe('tg');
        expect(manager.dcClient).toBe('dc');
        expect(manager.convoManager).toBe('convo');
    });

    test('start schedules autonomy loops when tokens exist', () => {
        const resumeSpy = jest.spyOn(manager, 'resumeOrScheduleAwakening').mockImplementation(() => {});
        const archiveSpy = jest.spyOn(manager, 'scheduleNextArchive').mockImplementation(() => {});
        const intervalSpy = jest.spyOn(global, 'setInterval').mockReturnValue(1);

        manager.start();

        expect(resumeSpy).toHaveBeenCalled();
        expect(archiveSpy).toHaveBeenCalled();
        expect(intervalSpy).toHaveBeenCalled();

        intervalSpy.mockRestore();
    });

    test('start aborts when both Telegram and Discord tokens are missing', () => {
        ConfigManager.CONFIG.TG_TOKEN = '';
        ConfigManager.CONFIG.DC_TOKEN = '';
        const resumeSpy = jest.spyOn(manager, 'resumeOrScheduleAwakening');
        const archiveSpy = jest.spyOn(manager, 'scheduleNextArchive');

        manager.start();

        expect(resumeSpy).not.toHaveBeenCalled();
        expect(archiveSpy).not.toHaveBeenCalled();
    });

    test('checkArchiveStatus triggers archive and notifications when threshold is met', async () => {
        ConfigManager.CONFIG.ENABLE_LOG_NOTIFICATIONS = true;
        fs.readdirSync.mockReturnValue(['2024010100.log', '2024010101.log']);
        manager.sendNotification = jest.fn().mockResolvedValue();

        await manager.checkArchiveStatus();

        expect(logArchive.run).toHaveBeenCalledWith({
            brain: mockBrain,
            args: { date: '20240101' },
        });
        expect(manager.sendNotification).toHaveBeenCalledTimes(2);
    });

    test('checkArchiveStatus skips archive when threshold is not met', async () => {
        fs.readdirSync.mockReturnValue(['2024010100.log']);
        manager.sendNotification = jest.fn();

        await manager.checkArchiveStatus();

        expect(logArchive.run).not.toHaveBeenCalled();
        expect(manager.sendNotification).not.toHaveBeenCalled();
    });

    test('timeWatcher executes due tasks and persists remaining schedule', async () => {
        const now = Date.now();
        const dueTask = { time: new Date(now - 1000).toISOString(), task: 'due' };
        const futureTask = { time: new Date(now + 60000).toISOString(), task: 'future' };

        fs.promises.stat.mockResolvedValue({ size: 100 });
        fs.promises.readFile.mockResolvedValue(JSON.stringify([dueTask, futureTask]));

        manager.convoManager = { enqueue: jest.fn().mockResolvedValue() };
        manager.getAdminContext = jest.fn().mockResolvedValue({});

        await manager.timeWatcher();

        expect(manager.convoManager.enqueue).toHaveBeenCalledTimes(1);
        expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
        expect(mockBrain.memoryDriver.checkDueTasks).toHaveBeenCalled();
    });

    test('run sends message and dispatches parsed output', async () => {
        manager.getAdminContext = jest.fn().mockResolvedValue({});

        await manager.run('my task', 'TestType');

        expect(mockBrain.sendMessage).toHaveBeenCalledWith(expect.stringContaining('my task'));
        expect(NeuroShunter.dispatch).toHaveBeenCalled();
    });

    test('performSelfReflection enqueues prompt when trigger context is provided', async () => {
        mockBrain.chatLogManager.readTierAsync.mockResolvedValue([{ date: '2024', content: 'hello' }]);
        manager.convoManager = { enqueue: jest.fn().mockResolvedValue() };

        const triggerCtx = { id: 'ctx' };
        await manager.performSelfReflection(triggerCtx);

        expect(manager.convoManager.enqueue).toHaveBeenCalledWith(
            triggerCtx,
            expect.stringContaining('hello'),
            { isPriority: true }
        );
    });

    test('performSelfReflection auto path uses brain + shunter when trigger context missing', async () => {
        manager.convoManager = null;
        manager.getAdminContext = jest.fn().mockResolvedValue({});

        await manager.performSelfReflection();

        expect(mockBrain.sendMessage).toHaveBeenCalled();
        expect(NeuroShunter.dispatch).toHaveBeenCalled();
    });

    describe('sendNotification', () => {
        test('routes to Telegram admin target', async () => {
            manager.tgBot = { sendMessage: jest.fn().mockResolvedValue() };

            await manager.sendNotification('hello');

            expect(manager.tgBot.sendMessage).toHaveBeenCalledWith('123', 'hello', {});
        });

        test('falls back to Discord user when Telegram fails', async () => {
            manager.tgBot = { sendMessage: jest.fn().mockRejectedValue(new Error('TG failed')) };
            const userSend = jest.fn().mockResolvedValue();
            manager.dcClient = {
                users: { fetch: jest.fn().mockResolvedValue({ send: userSend }) },
                channels: { fetch: jest.fn() },
            };

            await manager.sendNotification('hello');

            expect(manager.tgBot.sendMessage).toHaveBeenCalled();
            expect(manager.dcClient.users.fetch).toHaveBeenCalledWith('999');
            expect(userSend).toHaveBeenCalledWith('hello');
        });
    });
});
