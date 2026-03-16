// ============================================================
// MonicaWebBrain — Unit Tests
// Tests: switchModel graceful degradation (F5), BrowserLauncher args (F1),
//        session expiry detection (F12), smart wait (F10), daily limit (F15)
// ============================================================

jest.mock('../src/core/BrowserLauncher', () => ({
    launch: jest.fn().mockResolvedValue({
        pages: jest.fn().mockResolvedValue([{
            setViewport: jest.fn(),
            goto: jest.fn(),
            url: jest.fn().mockReturnValue('https://monica.im/home/chat'),
            cookies: jest.fn().mockResolvedValue([]),
            waitForSelector: jest.fn().mockResolvedValue(true),
            bringToFront: jest.fn(),
            evaluate: jest.fn().mockResolvedValue(''),
            keyboard: { press: jest.fn() },
            click: jest.fn(),
        }]),
        newPage: jest.fn(),
    }),
}));

jest.mock('../src/config', () => ({
    CONFIG: { USER_DATA_DIR: '/tmp/test-golem' },
    LOG_BASE_DIR: '/tmp/test-logs',
    GOLEM_MODE: 'SINGLE',
    MEMORY_BASE_DIR: '/tmp/test-memory',
}));

jest.mock('../src/services/ProtocolFormatter', () => ({
    generateReqId: () => 'test-req-1',
    buildStartTag: () => '<START>',
    buildEndTag: () => '<END>',
    buildEnvelope: (t) => t,
    buildSystemPrompt: jest.fn().mockResolvedValue({ systemPrompt: 'test' }),
    compress: (t) => t,
}));

jest.mock('../src/managers/ChatLogManager', () => {
    return jest.fn().mockImplementation(() => ({
        init: jest.fn().mockResolvedValue(undefined),
        append: jest.fn(),
    }));
});

jest.mock('../src/managers/SkillIndexManager', () => {
    return jest.fn().mockImplementation(() => ({
        syncToDb: jest.fn(),
    }));
});

jest.mock('../src/services/DOMDoctor', () => {
    return jest.fn().mockImplementation(() => ({
        diagnose: jest.fn().mockResolvedValue(null),
    }));
});

jest.mock('../src/memory/SystemNativeDriver', () => {
    return jest.fn().mockImplementation(() => ({
        init: jest.fn().mockResolvedValue(undefined),
    }));
});

jest.mock('../src/core/NodeRouter', () => ({
    handle: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/core/MonicaPageInteractor', () => {
    return jest.fn().mockImplementation(() => ({
        interact: jest.fn().mockResolvedValue('test response'),
    }));
});

const BrowserLauncher = require('../src/core/BrowserLauncher');
const MonicaWebBrain = require('../src/core/MonicaWebBrain');
const { BROWSER_ARGS, LIMITS } = require('../src/core/monica-constants');

describe('MonicaWebBrain', () => {
    let brain;

    beforeEach(() => {
        brain = new MonicaWebBrain({ golemId: 'test' });
    });

    describe('F1: BrowserLauncher receives protocolTimeout + args', () => {
        test('launch is called with protocolTimeout and args from monica-constants', async () => {
            await brain.init();
            expect(BrowserLauncher.launch).toHaveBeenCalledWith(
                expect.objectContaining({
                    protocolTimeout: 300000,
                    args: BROWSER_ARGS,
                })
            );
        });
    });

    describe('F5: switchModel graceful degradation', () => {
        beforeEach(async () => {
            await brain.init();
        });

        test('returns warning for unsupported model', async () => {
            const result = await brain.switchModel('nonexistent-model');
            expect(result).toContain('⚠️');
            expect(result).toContain('不支援');
        });

        test('graceful degradation when UI not found', async () => {
            // Mock page.evaluate to always return false (UI not found)
            brain.page.evaluate.mockResolvedValue(false);
            brain.page.waitForSelector.mockRejectedValue(new Error('timeout'));

            const result = await brain.switchModel('gpt-4o');
            // Should not throw, should record preference
            expect(result).toContain('⚠️');
            expect(result).toContain('已記錄偏好');
            expect(brain._currentModel).toBe('gpt-4o');
        });

        test('strategy A: uses modelPicker selector', async () => {
            brain.selectors.modelPicker = '.model-picker';
            brain.page.waitForSelector.mockResolvedValue(true);
            brain.page.click = jest.fn();
            brain.page.evaluate.mockResolvedValue(true); // found in dropdown

            const result = await brain.switchModel('gpt-4o');
            expect(result).toContain('已切換至');
            expect(brain._currentModel).toBe('gpt-4o');
        });
    });

    describe('F12: Session expiry detection', () => {
        test('throws on expired session cookie', async () => {
            const mockPage = (await BrowserLauncher.launch()).pages()[0]; // get mock
            // Re-mock to return expired cookie
            BrowserLauncher.launch.mockResolvedValueOnce({
                pages: jest.fn().mockResolvedValue([{
                    setViewport: jest.fn(),
                    goto: jest.fn(),
                    url: jest.fn().mockReturnValue('https://monica.im/home/chat'),
                    cookies: jest.fn().mockResolvedValue([
                        { name: 'session_token', expires: (Date.now() / 1000) - 3600 }
                    ]),
                    waitForSelector: jest.fn().mockResolvedValue(true),
                    evaluate: jest.fn(),
                    keyboard: { press: jest.fn() },
                }]),
            });

            const freshBrain = new MonicaWebBrain({ golemId: 'test-session' });
            await expect(freshBrain.init()).rejects.toThrow(/Session 已過期/);
        });
    });

    describe('F15: Daily usage limit', () => {
        test('throws when daily limit exceeded', () => {
            brain._dailyCalls = LIMITS.MAX_DAILY_CALLS;
            brain._callDate = new Date().toISOString().slice(0, 10);
            expect(() => brain._trackUsage()).toThrow(/每日用量已達上限/);
        });

        test('resets counter on new day', () => {
            brain._dailyCalls = LIMITS.MAX_DAILY_CALLS;
            brain._callDate = '2020-01-01'; // old date
            expect(() => brain._trackUsage()).not.toThrow();
            expect(brain._dailyCalls).toBe(1);
        });
    });

    describe('v9.7: _verifyModelSwitch', () => {
        beforeEach(async () => {
            await brain.init();
        });

        test('returns true when UI shows model keyword', async () => {
            brain.page.evaluate.mockResolvedValue(true);
            const result = await brain._verifyModelSwitch('gpt-5.4', ['GPT-5.4']);
            expect(result).toBe(true);
        });

        test('returns false when UI does not show keyword', async () => {
            brain.page.evaluate.mockResolvedValue(false);
            const result = await brain._verifyModelSwitch('gpt-5.4', ['GPT-5.4']);
            expect(result).toBe(false);
        });

        test('returns false on page error', async () => {
            brain.page.evaluate.mockRejectedValue(new Error('page crashed'));
            const result = await brain._verifyModelSwitch('gpt-5.4', ['GPT-5.4']);
            expect(result).toBe(false);
        });
    });

    describe('v9.7: _logSwitchResult', () => {
        test('writes log file without throwing', () => {
            const fs = require('fs');
            const logPath = require('path').resolve(__dirname, '..', 'golem_memory', 'model_switch_log.json');
            try { fs.unlinkSync(logPath); } catch (_) {}

            brain._logSwitchResult('gpt-5.4', true, 'A');

            if (fs.existsSync(logPath)) {
                const log = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
                expect(log).toHaveLength(1);
                expect(log[0].model).toBe('gpt-5.4');
                expect(log[0].success).toBe(true);
                expect(log[0].strategy).toBe('A');
                fs.unlinkSync(logPath);
            }
        });
    });
});
