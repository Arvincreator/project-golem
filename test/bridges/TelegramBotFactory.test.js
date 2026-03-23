describe('TelegramBotFactory', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('uses legacy engine when TG_ENGINE override is set', () => {
        jest.isolateModules(() => {
            const LegacyBot = jest.fn(function (token, opts) {
                this.token = token;
                this.opts = opts;
            });

            jest.doMock('../../src/config', () => ({
                CONFIG: { TG_ENGINE: 'legacy' },
            }));
            jest.doMock('node-telegram-bot-api', () => LegacyBot, { virtual: true });

            const { detectEngine, createTelegramBot } = require('../../src/bridges/TelegramBotFactory');

            expect(detectEngine()).toBe('legacy');
            const bot = createTelegramBot('dummy:token', { polling: false });

            expect(LegacyBot).toHaveBeenCalledWith('dummy:token', { polling: false });
            expect(bot).toBeInstanceOf(LegacyBot);
        });
    });

    test('uses grammy engine by default when grammy is available', () => {
        jest.isolateModules(() => {
            const GrammyBridge = jest.fn(function (token, opts) {
                this.token = token;
                this.opts = opts;
            });

            jest.doMock('../../src/config', () => ({
                CONFIG: { TG_ENGINE: '' },
            }));
            jest.doMock('grammy', () => ({ Bot: jest.fn() }));
            jest.doMock('../../src/bridges/GrammyBridge', () => GrammyBridge);

            const { detectEngine, createTelegramBot } = require('../../src/bridges/TelegramBotFactory');

            expect(detectEngine()).toBe('grammy');
            const bot = createTelegramBot('dummy:token', { polling: false });

            expect(GrammyBridge).toHaveBeenCalledWith('dummy:token', { polling: false });
            expect(bot).toBeInstanceOf(GrammyBridge);
        });
    });
});
