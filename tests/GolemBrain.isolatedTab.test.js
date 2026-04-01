const GolemBrain = require('../src/core/GolemBrain');

describe('GolemBrain.runInIsolatedTab', () => {
    test('opens isolated page, executes callback, closes page, and restores original page', async () => {
        const previousPage = {
            url: jest.fn(() => 'https://gemini.google.com/app'),
            isClosed: jest.fn(() => false),
            bringToFront: jest.fn(async () => {}),
        };
        const isolatedPage = {
            goto: jest.fn(async () => {}),
            close: jest.fn(async () => {}),
        };

        const brainLike = {
            backend: 'gemini',
            context: {
                newPage: jest.fn(async () => isolatedPage),
                pages: jest.fn(() => [previousPage]),
            },
            page: previousPage,
            cdpSession: { id: 'cdp' },
            isInitialized: true,
            _ensureBrowserHealth: jest.fn(async () => true),
            init: jest.fn(async () => true),
        };

        const callback = jest.fn(async () => 'ok');
        const result = await GolemBrain.prototype.runInIsolatedTab.call(brainLike, callback);

        expect(result).toBe('ok');
        expect(brainLike.context.newPage).toHaveBeenCalledTimes(1);
        expect(isolatedPage.goto).toHaveBeenCalled();
        expect(isolatedPage.close).toHaveBeenCalledTimes(1);
        expect(brainLike.page).toBe(previousPage);
        expect(previousPage.bringToFront).toHaveBeenCalled();
    });

    test('still closes isolated page when callback throws', async () => {
        const previousPage = {
            url: jest.fn(() => ''),
            isClosed: jest.fn(() => false),
            bringToFront: jest.fn(async () => {}),
        };
        const isolatedPage = {
            goto: jest.fn(async () => {}),
            close: jest.fn(async () => {}),
        };

        const brainLike = {
            backend: 'gemini',
            context: {
                newPage: jest.fn(async () => isolatedPage),
                pages: jest.fn(() => [previousPage]),
            },
            page: previousPage,
            cdpSession: { id: 'cdp' },
            isInitialized: true,
            _ensureBrowserHealth: jest.fn(async () => true),
            init: jest.fn(async () => true),
        };

        await expect(
            GolemBrain.prototype.runInIsolatedTab.call(brainLike, async () => {
                throw new Error('worker failed');
            })
        ).rejects.toThrow('worker failed');

        expect(isolatedPage.close).toHaveBeenCalledTimes(1);
        expect(brainLike.page).toBe(previousPage);
    });
});
