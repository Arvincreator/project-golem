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
    return jest.fn();
});

jest.mock('../src/core/NodeRouter', () => ({
    handle: jest.fn().mockResolvedValue(null)
}));

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

jest.mock('../src/services/LMStudioClient', () => {
    return jest.fn().mockImplementation(() => ({
        chat: jest.fn().mockResolvedValue('LMSTUDIO_REPLY')
    }));
});

const ConfigManager = require('../src/config');
const BrowserLauncher = require('../src/core/BrowserLauncher');
const LMStudioClient = require('../src/services/LMStudioClient');
const GolemBrain = require('../src/core/GolemBrain');

describe('GolemBrain lmstudio backend', () => {
    const snapshot = {};

    beforeEach(() => {
        snapshot.backend = ConfigManager.CONFIG.GOLEM_BACKEND;
        snapshot.lmstudioModel = ConfigManager.CONFIG.LMSTUDIO_BRAIN_MODEL;
        ConfigManager.CONFIG.GOLEM_BACKEND = 'lmstudio';
        ConfigManager.CONFIG.LMSTUDIO_BRAIN_MODEL = 'qwen2.5-14b-instruct';
        jest.clearAllMocks();
    });

    afterEach(() => {
        ConfigManager.CONFIG.GOLEM_BACKEND = snapshot.backend;
        ConfigManager.CONFIG.LMSTUDIO_BRAIN_MODEL = snapshot.lmstudioModel;
    });

    test('sendMessage routes through LM Studio without launching Playwright', async () => {
        const brain = new GolemBrain({ golemId: 'test-golem' });
        const result = await brain.sendMessage('hello lmstudio');

        expect(result).toEqual({ text: 'LMSTUDIO_REPLY', attachments: [] });
        expect(BrowserLauncher.launch).not.toHaveBeenCalled();
        expect(LMStudioClient).toHaveBeenCalled();

        const client = LMStudioClient.mock.results[0].value;
        const payloads = client.chat.mock.calls.map(call => call[0]);
        expect(payloads.some(payload => String(payload).includes('hello lmstudio'))).toBe(true);

        if (brain._backgroundMemoryInjectionTask) {
            await brain._backgroundMemoryInjectionTask;
        }
    });
});
