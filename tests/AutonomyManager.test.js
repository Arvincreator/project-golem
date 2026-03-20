const AutonomyManager = require('../src/managers/AutonomyManager');
const ConfigManager = require('../src/config');
const fs = require('fs');

jest.mock('fs');
jest.mock('../src/managers/ChatLogManager');
jest.mock('../src/skills/core/log-archive', () => ({
    run: jest.fn().mockResolvedValue('Archive successful')
}));
jest.mock('../src/core/NeuroShunter', () => ({
    dispatch: jest.fn()
}));

describe('AutonomyManager', () => {
    let manager;
    const mockBrain = {
        sendMessage: jest.fn().mockResolvedValue('brain response'),
        memoryDriver: {
            checkDueTasks: jest.fn().mockResolvedValue([])
        }
    };
    const mockController = {};

    beforeEach(() => {
        jest.clearAllMocks();
        manager = new AutonomyManager(mockBrain, mockController, {});
        ConfigManager.CONFIG.TG_TOKEN = 'test_token';
        ConfigManager.LOG_BASE_DIR = '/tmp/logs';
    });

    test('setIntegrations sets properties', () => {
        manager.setIntegrations('tg', 'dc', 'convo');
        expect(manager.tgBot).toBe('tg');
        expect(manager.dcClient).toBe('dc');
        expect(manager.convoManager).toBe('convo');
    });

    test('start begins scheduling', () => {
        jest.useFakeTimers();
        const spy = jest.spyOn(manager, 'scheduleNextAwakening').mockImplementation(() => {});
        manager.start();
        expect(spy).toHaveBeenCalled();
        jest.useRealTimers();
    });

    test('start always schedules regardless of tokens (v9.1 decoupled)', () => {
        // v9.1: start() no longer gates on tokens; bots are managed by golemFactory
        jest.useFakeTimers();
        ConfigManager.CONFIG.TG_TOKEN = '';
        ConfigManager.CONFIG.DC_TOKEN = '';
        const spy = jest.spyOn(manager, 'scheduleNextAwakening').mockImplementation(() => {});
        manager.start();
        expect(spy).toHaveBeenCalled();
        jest.useRealTimers();
    });

    test('checkArchiveStatus triggers archive if threshold met', async () => {
        const ChatLogManager = require('../src/managers/ChatLogManager');
        ChatLogManager.mockImplementation(() => ({
            dirs: { hourly: '/tmp/logs' },
            _getYesterdayDateString: () => '20240101'
        }));
        
        fs.readdirSync.mockReturnValue([
            '2024010100.log', '2024010101.log', '2024010102.log' // 3 files meets yesterday threshold
        ]);
        
        // v9.1: sendNotification is gated behind ENABLE_LOG_NOTIFICATIONS flag
        ConfigManager.CONFIG.ENABLE_LOG_NOTIFICATIONS = true;
        ConfigManager.CONFIG.ARCHIVE_THRESHOLD_YESTERDAY = 3;
        ConfigManager.CONFIG.ARCHIVE_THRESHOLD_TODAY = 1;
        manager.sendNotification = jest.fn().mockResolvedValue();
        await manager.checkArchiveStatus();
        
        // 2 calls: one start notification + one done notification for yesterday batch
        expect(manager.sendNotification).toHaveBeenCalledTimes(2);
        ConfigManager.CONFIG.ENABLE_LOG_NOTIFICATIONS = false; // restore
    });

    test('checkArchiveStatus skips if threshold not met', async () => {
        const ChatLogManager = require('../src/managers/ChatLogManager');
        ChatLogManager.mockImplementation(() => ({
            dirs: { hourly: '/tmp/logs' },
            _getYesterdayDateString: () => '20240101'
        }));
        
        fs.readdirSync.mockReturnValue(['2024010100.log']); // 1 file, doesn't meet 3 threshold
        manager.sendNotification = jest.fn();
        await manager.checkArchiveStatus();
        
        expect(manager.sendNotification).not.toHaveBeenCalled();
    });

    test('timeWatcher triggers scheduled tasks', async () => {
        const now = Date.now();
        const oldTask = { time: new Date(now - 1000).toISOString(), task: 'do something' };
        
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue(JSON.stringify([oldTask]));
        
        manager.convoManager = { enqueue: jest.fn().mockResolvedValue() };
        manager.getAdminContext = jest.fn().mockResolvedValue({});
        
        await manager.timeWatcher();
        
        expect(manager.convoManager.enqueue).toHaveBeenCalled();
        expect(fs.writeFileSync).toHaveBeenCalled(); // Update schedules
    });

    test('manifestFreeWill executes reflection 20% of time', async () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.1);
        manager.performSelfReflection = jest.fn();
        await manager.manifestFreeWill();
        expect(manager.performSelfReflection).toHaveBeenCalled();
        Math.random.mockRestore();
    });

    test('manifestFreeWill executes news chat 40% of time', async () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.4);
        manager.performNewsChat = jest.fn();
        await manager.manifestFreeWill();
        expect(manager.performNewsChat).toHaveBeenCalled();
        Math.random.mockRestore();
    });

    test('getAdminContext creates fake context with sendNotification', async () => {
        manager.sendNotification = jest.fn();
        const ctx = await manager.getAdminContext();
        expect(ctx.isAdmin).toBe(true);
        expect(ctx.chatId).toBe('system_autonomy');
        await ctx.reply('test');
        expect(manager.sendNotification).toHaveBeenCalledWith('test', undefined);
    });

    test('run sends message and dispatches', async () => {
        const NeuroShunter = require('../src/core/NeuroShunter');
        manager.getAdminContext = jest.fn().mockResolvedValue({});
        await manager.run('my task', 'testType');
        
        expect(mockBrain.sendMessage).toHaveBeenCalled();
        expect(NeuroShunter.dispatch).toHaveBeenCalled();
    });

    describe('performSpontaneousChat', () => {
        test('selects interest and calls run', async () => {
            manager.run = jest.fn();
            ConfigManager.CONFIG.USER_INTERESTS = 'Coding, AI';
            jest.spyOn(Math, 'random').mockReturnValue(0.5); // will select 'AI' (index 1)
            
            await manager.performSpontaneousChat();
            
            expect(manager.run).toHaveBeenCalledWith(expect.stringContaining('AI'), 'SpontaneousChat');
            Math.random.mockRestore();
        });
    });

    describe('performSelfReflection', () => {
        test('reads logs and calls enqueue if triggerCtx is provided', async () => {
            const ChatLogManager = require('../src/managers/ChatLogManager');
            ChatLogManager.mockImplementation(() => ({
                readTier: jest.fn().mockReturnValue([{ date: '2024', content: 'hello' }])
            }));
            
            manager.convoManager = { enqueue: jest.fn() };
            manager.getAdminContext = jest.fn();

            const triggerCtx = { some: 'ctx' };
            await manager.performSelfReflection(triggerCtx);

            expect(manager.convoManager.enqueue).toHaveBeenCalledWith(triggerCtx, expect.stringContaining('hello'), { isPriority: true });
        });

        test('reads logs and calls sendMessage/dispatch if auto-triggered', async () => {
            const ChatLogManager = require('../src/managers/ChatLogManager');
            ChatLogManager.mockImplementation(() => ({
                readTier: jest.fn().mockReturnValue([]) // empty logs
            }));

            const NeuroShunter = require('../src/core/NeuroShunter');
            manager.convoManager = null; // auto trigger
            manager.getAdminContext = jest.fn().mockResolvedValue({});

            await manager.performSelfReflection();

            expect(mockBrain.sendMessage).toHaveBeenCalled();
            expect(NeuroShunter.dispatch).toHaveBeenCalled();
        });
    });

    describe('sendNotification', () => {
        let mockTgBot;
        let mockDcClient;

        beforeEach(() => {
            mockTgBot = { sendMessage: jest.fn().mockResolvedValue() };
            mockDcClient = { 
                channels: { fetch: jest.fn().mockResolvedValue({ send: jest.fn() }) },
                users: { fetch: jest.fn().mockResolvedValue({ send: jest.fn() }) }
            };
            manager.tgBot = mockTgBot;
            manager.dcClient = mockDcClient;
        });

        test('returns early if no text', async () => {
            await manager.sendNotification('');
            expect(mockTgBot.sendMessage).not.toHaveBeenCalled();
        });

        test('routes to Telegram ADMIN target using default config', async () => {
            ConfigManager.CONFIG.ADMIN_IDS = ['123'];
            ConfigManager.CONFIG.TG_AUTH_MODE = 'ADMIN';
            
            await manager.sendNotification('hello');
            
            expect(mockTgBot.sendMessage).toHaveBeenCalledWith('123', 'hello', expect.any(Object));
        });

        test('routes to Telegram CHAT target using bot specific config', async () => {
            mockTgBot.golemConfig = { tgAuthMode: 'CHAT', chatId: '456' };
            
            await manager.sendNotification('hello');
            
            expect(mockTgBot.sendMessage).toHaveBeenCalledWith('456', 'hello', expect.any(Object));
        });

        test('falls back to Discord if Telegram fails', async () => {
            ConfigManager.CONFIG.ADMIN_IDS = ['123'];
            ConfigManager.CONFIG.DISCORD_ADMIN_ID = '999';
            mockTgBot.sendMessage.mockRejectedValue(new Error('TG failed'));
            
            await manager.sendNotification('hello');
            
            expect(mockTgBot.sendMessage).toHaveBeenCalled();
            expect(mockDcClient.users.fetch).toHaveBeenCalledWith('999');
        });

        test('routes to Discord CHAT target', async () => {
            manager.tgBot = null; // No telegram
            mockDcClient.golemConfig = { dcAuthMode: 'CHAT', dcChatId: '888' };
            
            await manager.sendNotification('hello');
            
            expect(mockDcClient.channels.fetch).toHaveBeenCalledWith('888');
        });
    });

    describe('scheduleNextAwakening', () => {
        test('schedules next awakening considering sleep hours', () => {
            jest.useFakeTimers().setSystemTime(new Date('2024-01-01T02:00:00Z').getTime()); // Sleep time (01:00-07:00)
            ConfigManager.CONFIG.SLEEP_START = 1;
            ConfigManager.CONFIG.SLEEP_END = 7;
            
            jest.spyOn(global, 'setTimeout');
            manager.scheduleNextAwakening();
            
            // Should add a timeout waking up at 08:00 (sleepEnd + 1)
            expect(setTimeout).toHaveBeenCalled();
            jest.useRealTimers();
        });
    });
});
