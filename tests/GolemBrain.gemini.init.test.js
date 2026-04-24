jest.mock('dotenv', () => ({
    config: jest.fn()
}), { virtual: true });

jest.mock('../src/services/DOMDoctor', () => {
    return jest.fn().mockImplementation(() => ({
        loadSelectors: () => ({}),
        saveSelectors: jest.fn()
    }));
});

jest.mock('../src/core/BrowserLauncher', () => ({
    launch: jest.fn()
}));

jest.mock('../src/core/PageInteractor', () => {
    return jest.fn().mockImplementation(() => ({
        interact: jest.fn().mockResolvedValue({ text: 'BOOT_OK', attachments: [] })
    }));
});

jest.mock('../src/core/NodeRouter', () => ({
    handle: jest.fn().mockResolvedValue(null)
}));

jest.mock('../src/managers/WikiManager', () => {
    return jest.fn().mockImplementation(() => ({
        init: jest.fn(),
        getInjectionContext: jest.fn(() => '')
    }));
});

jest.mock('../src/managers/ChatLogManager', () => {
    return jest.fn().mockImplementation(() => ({
        _isInitialized: true,
        init: jest.fn().mockResolvedValue(),
        append: jest.fn(),
        readTierAsync: jest.fn().mockResolvedValue([]),
        readRecentHourlyAsync: jest.fn().mockResolvedValue('')
    }));
});

jest.mock('../src/managers/SkillIndexManager', () => {
    return jest.fn().mockImplementation(() => ({
        sync: jest.fn().mockResolvedValue()
    }));
});

jest.mock('../src/skills/core/persona', () => ({
    exists: jest.fn(() => false),
    get: jest.fn(() => ({ skills: [] }))
}));

jest.mock('../packages/memory', () => {
    const Driver = jest.fn().mockImplementation(() => ({
        init: jest.fn().mockResolvedValue(),
        recall: jest.fn().mockResolvedValue([]),
        memorize: jest.fn().mockResolvedValue(),
        clearMemory: jest.fn().mockResolvedValue()
    }));

    return {
        LanceDBProDriver: Driver,
        SystemNativeDriver: Driver
    };
});

jest.mock('../packages/protocol', () => ({
    ProtocolFormatter: {
        _lastScanTime: 0,
        generateReqId: jest.fn(() => 'req-test'),
        buildStartTag: jest.fn(() => '[START]'),
        buildEndTag: jest.fn(() => '[END]'),
        buildEnvelope: jest.fn((text) => text),
        buildSystemPrompt: jest.fn().mockResolvedValue({ systemPrompt: 'boot', skillMemoryText: '' }),
        compress: jest.fn((text) => text)
    }
}));

const ConfigManager = require('../src/config');
const BrowserLauncher = require('../src/core/BrowserLauncher');
const PageInteractor = require('../src/core/PageInteractor');
const GolemBrain = require('../src/core/GolemBrain');

describe('GolemBrain gemini bootstrap init', () => {
    const snapshot = {};

    beforeEach(() => {
        snapshot.backend = ConfigManager.CONFIG.GOLEM_BACKEND;
        ConfigManager.CONFIG.GOLEM_BACKEND = 'gemini';
        jest.clearAllMocks();
    });

    afterEach(() => {
        ConfigManager.CONFIG.GOLEM_BACKEND = snapshot.backend;
    });

    test('init does not re-enter while injecting system prompt', async () => {
        const cdpSession = { send: jest.fn().mockResolvedValue() };
        const page = {
            goto: jest.fn().mockResolvedValue(),
            bringToFront: jest.fn().mockResolvedValue(),
            evaluate: jest.fn().mockResolvedValue(1),
            context: jest.fn(() => ({
                newCDPSession: jest.fn().mockResolvedValue(cdpSession)
            }))
        };

        const context = {
            pages: jest.fn(() => [page]),
            newPage: jest.fn().mockResolvedValue(page),
            browser: jest.fn(() => ({
                isConnected: () => true
            }))
        };
        BrowserLauncher.launch.mockResolvedValue(context);

        const brain = new GolemBrain({ golemId: 'gemini-test' });
        const navigateSpy = jest.spyOn(brain, '_navigateToTarget');

        await brain.init();

        expect(brain.isInitialized).toBe(true);
        expect(navigateSpy).toHaveBeenCalledTimes(1);
        expect(PageInteractor).toHaveBeenCalledTimes(1);
        expect(brain.lastInitMetrics).toEqual(expect.objectContaining({
            backend: 'gemini',
            status: 'ok',
            totalMs: expect.any(Number),
            segments: expect.objectContaining({
                browser_launch: expect.any(Number),
                page_prepare: expect.any(Number),
                navigate_target: expect.any(Number),
                chatlog_init: expect.any(Number),
                memory_driver_init: expect.any(Number),
                system_prompt_injection: expect.any(Number)
            })
        }));
    });

    test('phase 2 memory injection is deferred to background after init', async () => {
        const cdpSession = { send: jest.fn().mockResolvedValue() };
        const page = {
            goto: jest.fn().mockResolvedValue(),
            bringToFront: jest.fn().mockResolvedValue(),
            evaluate: jest.fn().mockResolvedValue(1),
            context: jest.fn(() => ({
                newCDPSession: jest.fn().mockResolvedValue(cdpSession)
            }))
        };

        const context = {
            pages: jest.fn(() => [page]),
            newPage: jest.fn().mockResolvedValue(page),
            browser: jest.fn(() => ({
                isConnected: () => true
            }))
        };
        BrowserLauncher.launch.mockResolvedValue(context);

        const brain = new GolemBrain({ golemId: 'gemini-test-bg-memory' });
        const memoryPhaseSpy = jest.spyOn(brain, '_injectHistoricalMemoryPhase').mockResolvedValue();

        await brain.init();
        expect(memoryPhaseSpy).not.toHaveBeenCalled();

        await new Promise(resolve => setImmediate(resolve));
        expect(memoryPhaseSpy).toHaveBeenCalledTimes(1);
    });

    test('createEphemeralWorker reuses parent context and creates a new worker tab', async () => {
        const workerPage = { close: jest.fn(), isClosed: jest.fn(() => false) };
        const parent = new GolemBrain({ golemId: 'parent' });
        parent.context = {
            newPage: jest.fn().mockResolvedValue(workerPage)
        };
        parent.isInitialized = true;
        jest.spyOn(parent, '_ensureBrowserHealth').mockResolvedValue();

        const worker = await parent.createEphemeralWorker({
            golemId: 'child',
            toolset: 'research'
        });

        expect(parent.context.newPage).toHaveBeenCalledTimes(1);
        expect(worker.context).toBe(parent.context);
        expect(worker.page).toBe(workerPage);
        expect(worker._isSharedSessionWorker).toBe(true);
        expect(worker._disableHistoricalMemoryInjection).toBe(true);
        expect(worker._toolsetOverrideScene).toBe('research');
    });

    test('shared-session worker dispose only closes page by default', async () => {
        const page = {
            isClosed: jest.fn(() => false),
            close: jest.fn().mockResolvedValue()
        };
        const context = {
            close: jest.fn().mockResolvedValue()
        };
        const worker = new GolemBrain({
            golemId: 'child',
            context,
            page,
            sharedSessionWorker: true
        });

        await worker.dispose();

        expect(page.close).toHaveBeenCalledTimes(1);
        expect(context.close).not.toHaveBeenCalled();
    });
});
