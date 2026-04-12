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
const GolemBrain = require('../src/core/GolemBrain');

describe('GolemBrain Gemini URL failover', () => {
    let originalGeminiUrls;

    beforeEach(() => {
        originalGeminiUrls = [...ConfigManager.CONFIG.GEMINI_URLS];
        jest.clearAllMocks();
    });

    afterEach(() => {
        ConfigManager.CONFIG.GEMINI_URLS.length = 0;
        ConfigManager.CONFIG.GEMINI_URLS.push(...originalGeminiUrls);
    });

    test('switches to second GEMINI_URL when first URL is unavailable', async () => {
        ConfigManager.CONFIG.GEMINI_URLS.length = 0;
        ConfigManager.CONFIG.GEMINI_URLS.push('https://gemini-primary.invalid/app');
        ConfigManager.CONFIG.GEMINI_URLS.push('https://gemini-secondary.example/app');

        const goto = jest.fn()
            .mockRejectedValueOnce(new Error('primary unreachable'))
            .mockResolvedValueOnce(undefined);

        const fakeBrain = { page: { goto } };
        await GolemBrain.prototype._navigateToTarget.call(fakeBrain, 'gemini');

        expect(goto).toHaveBeenCalledTimes(2);
        expect(goto).toHaveBeenNthCalledWith(1, 'https://gemini-primary.invalid/app', { waitUntil: 'domcontentloaded', timeout: 45000 });
        expect(goto).toHaveBeenNthCalledWith(2, 'https://gemini-secondary.example/app', { waitUntil: 'domcontentloaded', timeout: 45000 });
    });

    test('switches to second GEMINI_URL when first URL returns HTTP 502', async () => {
        ConfigManager.CONFIG.GEMINI_URLS.length = 0;
        ConfigManager.CONFIG.GEMINI_URLS.push('https://gemini-primary.example/app');
        ConfigManager.CONFIG.GEMINI_URLS.push('https://gemini-secondary.example/app');

        const goto = jest.fn()
            .mockResolvedValueOnce({ status: () => 502 })
            .mockResolvedValueOnce({ status: () => 200 });

        const fakeBrain = { page: { goto } };
        await GolemBrain.prototype._navigateToTarget.call(fakeBrain, 'gemini');

        expect(goto).toHaveBeenCalledTimes(2);
        expect(goto).toHaveBeenNthCalledWith(1, 'https://gemini-primary.example/app', { waitUntil: 'domcontentloaded', timeout: 45000 });
        expect(goto).toHaveBeenNthCalledWith(2, 'https://gemini-secondary.example/app', { waitUntil: 'domcontentloaded', timeout: 45000 });
    });

    test('throws after all GEMINI_URLS are unavailable', async () => {
        ConfigManager.CONFIG.GEMINI_URLS.length = 0;
        ConfigManager.CONFIG.GEMINI_URLS.push('https://gemini-primary.invalid/app');
        ConfigManager.CONFIG.GEMINI_URLS.push('https://gemini-secondary.invalid/app');

        const goto = jest.fn().mockRejectedValue(new Error('all down'));
        const fakeBrain = { page: { goto } };

        await expect(GolemBrain.prototype._navigateToTarget.call(fakeBrain, 'gemini'))
            .rejects
            .toThrow(/所有嘗試過的網址皆失效/);
        expect(goto).toHaveBeenCalledTimes(2);
    });
});
