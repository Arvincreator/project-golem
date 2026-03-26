const PageInteractor = require('../src/core/PageInteractor');

describe('PageInteractor Improvements', () => {
    let mockPage;
    let mockKeyboard;
    let mockDoctor;
    let interactor;

    beforeEach(() => {
        mockKeyboard = {
            type: jest.fn().mockResolvedValue(undefined),
            press: jest.fn().mockResolvedValue(undefined),
        };
        mockPage = {
            $: jest.fn().mockResolvedValue({ focus: jest.fn().mockResolvedValue(undefined) }),
            focus: jest.fn().mockResolvedValue(undefined),
            evaluate: jest.fn().mockResolvedValue(undefined),
            keyboard: mockKeyboard,
            content: jest.fn().mockResolvedValue('<html></html>'),
            context: jest.fn().mockReturnValue({
                newCDPSession: jest.fn().mockResolvedValue({
                    send: jest.fn().mockResolvedValue({ windowId: 'test-id' }),
                    detach: jest.fn().mockResolvedValue(undefined),
                }),
            }),
        };
        mockDoctor = {
            diagnose: jest.fn(),
            saveSelectors: jest.fn(),
        };
        interactor = new PageInteractor(mockPage, mockDoctor);
    });

    test('_typeInput should focus and simulate keyboard events', async () => {
        const selector = 'textarea';
        const text = 'hello world';
        
        // Internal methods are private, so we'll test via the public interact method or access them directly via prototype if needed.
        // For simplicity in this mock test, we'll check the calls made during _typeInput logic.
        
        await interactor._typeInput(selector, text);

        expect(mockPage.focus).toHaveBeenCalledWith(expect.stringContaining(selector));
        expect(mockPage.evaluate).toHaveBeenCalled();
        expect(mockKeyboard.type).toHaveBeenCalledWith(' ', { delay: 1 });
        expect(mockKeyboard.press).toHaveBeenCalledWith('Backspace');
    });

    test('_clickSend should use Enter and click with ARIA labels', async () => {
        const selector = '.send-button';
        
        await interactor._clickSend(selector);

        expect(mockKeyboard.press).toHaveBeenCalledWith('Enter');
        expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), selector);
    });

    test('_moveWindowToBottom should skip in headless mode', async () => {
        process.env.PLAYWRIGHT_HEADLESS = 'true';
        await interactor._moveWindowToBottom();
        expect(mockPage.context).not.toHaveBeenCalled();

        delete process.env.PLAYWRIGHT_HEADLESS;
        await interactor._moveWindowToBottom();
        expect(mockPage.context).toHaveBeenCalled();
    });

    test('_waitForReady should correctly identify stop buttons by text and aria-label', async () => {
        // Mock page evaluate behavior for _waitForReady
        // We simulate that the page has a button with aria-label="stop generating"
        mockPage.evaluate = jest.fn()
            .mockResolvedValueOnce(true)  // First check: busy (stop button present)
            .mockResolvedValueOnce(false); // Second check: free
            
        // Mock setTimeout to advance quickly in test
        jest.spyOn(global, 'setTimeout').mockImplementation((cb) => cb());
        
        await interactor._waitForReady('.send-btn');
        
        expect(mockPage.evaluate).toHaveBeenCalledTimes(2);
        
        jest.restoreAllMocks();
    });
});
