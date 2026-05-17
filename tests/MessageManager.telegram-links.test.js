jest.mock('../dashboard', () => ({
    webServer: {
        broadcastLog: jest.fn(),
    },
}));

const MessageManager = require('../src/core/MessageManager');

describe('MessageManager Telegram markdown links', () => {
    test('converts markdown links to escaped Telegram HTML only for Telegram send payload', async () => {
        const sendMessage = jest.fn().mockResolvedValue();
        const ctx = {
            platform: 'telegram',
            chatId: 123,
            instance: { sendMessage },
        };

        await MessageManager.send(
            ctx,
            '參考：[A & B <News>](https://example.com/a?x=1&y=2)\n裸網址 https://example.com/raw',
            { _telegramHtmlLinks: true }
        );

        expect(sendMessage).toHaveBeenCalledWith(
            123,
            '參考：<a href="https://example.com/a?x=1&amp;y=2">A &amp; B &lt;News&gt;</a>\n裸網址 https://example.com/raw',
            { parse_mode: 'HTML' }
        );
    });

    test('leaves plain Telegram messages untouched when no html-link option is set', async () => {
        const sendMessage = jest.fn().mockResolvedValue();
        const ctx = {
            platform: 'telegram',
            chatId: 123,
            instance: { sendMessage },
        };

        await MessageManager.send(ctx, '[Title](https://example.com)', {});

        expect(sendMessage).toHaveBeenCalledWith(123, '[Title](https://example.com)', {});
    });
});
