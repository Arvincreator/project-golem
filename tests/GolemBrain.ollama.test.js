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

jest.mock('../src/services/OllamaClient', () => {
    return jest.fn().mockImplementation(() => ({
        chat: jest.fn().mockResolvedValue('OLLAMA_REPLY')
    }));
});

const ConfigManager = require('../src/config');
const BrowserLauncher = require('../src/core/BrowserLauncher');
const OllamaClient = require('../src/services/OllamaClient');
const GolemBrain = require('../src/core/GolemBrain');

describe('GolemBrain ollama backend', () => {
    const snapshot = {};

    beforeEach(() => {
        snapshot.backend = ConfigManager.CONFIG.GOLEM_BACKEND;
        snapshot.ollamaModel = ConfigManager.CONFIG.OLLAMA_BRAIN_MODEL;
        ConfigManager.CONFIG.GOLEM_BACKEND = 'ollama';
        ConfigManager.CONFIG.OLLAMA_BRAIN_MODEL = 'llama3.1:8b';
        jest.clearAllMocks();
    });

    afterEach(() => {
        ConfigManager.CONFIG.GOLEM_BACKEND = snapshot.backend;
        ConfigManager.CONFIG.OLLAMA_BRAIN_MODEL = snapshot.ollamaModel;
    });

    test('sendMessage routes through Ollama without launching Playwright', async () => {
        const brain = new GolemBrain({ golemId: 'test-golem' });
        const result = await brain.sendMessage('hello ollama');

        expect(result).toEqual({ text: 'OLLAMA_REPLY', attachments: [] });
        expect(BrowserLauncher.launch).not.toHaveBeenCalled();
        expect(OllamaClient).toHaveBeenCalled();

        const client = OllamaClient.mock.results[0].value;
        const payloads = client.chat.mock.calls.map(call => call[0]);
        expect(payloads.some(payload => String(payload).includes('hello ollama'))).toBe(true);

        if (brain._backgroundMemoryInjectionTask) {
            await brain._backgroundMemoryInjectionTask;
        }
    });
});
