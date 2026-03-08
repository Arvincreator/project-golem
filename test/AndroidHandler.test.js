const AndroidHandler = require('../src/core/action_handlers/AndroidHandler');

describe('AndroidHandler', () => {
    let handler;

    beforeEach(() => {
        handler = new AndroidHandler();
    });

    describe('constructor', () => {
        test('uses default adb path', () => {
            expect(handler._adbPath).toBe('adb');
        });

        test('respects ADB_PATH env var', () => {
            const original = process.env.ADB_PATH;
            process.env.ADB_PATH = '/custom/adb';
            const h = new AndroidHandler();
            expect(h._adbPath).toBe('/custom/adb');
            if (original) process.env.ADB_PATH = original;
            else delete process.env.ADB_PATH;
        });

        test('starts disconnected', () => {
            expect(handler._connected).toBe(false);
        });
    });

    describe('_routeAction', () => {
        // Mock _ensureConnected and _adb for unit tests
        beforeEach(() => {
            handler._connected = true;
            handler._adb = jest.fn(() => Buffer.from(''));
        });

        test('routes android_tap correctly', () => {
            const result = handler._routeAction({ action: 'android_tap', parameter: '500 800' });
            expect(result).toContain('Tapped at (500, 800)');
            expect(handler._adb).toHaveBeenCalledWith('shell input tap 500 800');
        });

        test('routes android_swipe correctly', () => {
            const result = handler._routeAction({ action: 'android_swipe', parameter: '100 200 300 400 500' });
            expect(result).toContain('Swiped');
            expect(handler._adb).toHaveBeenCalledWith('shell input swipe 100 200 300 400 500');
        });

        test('routes android_type correctly', () => {
            handler._routeAction({ action: 'android_type', parameter: 'hello' });
            expect(handler._adb).toHaveBeenCalledWith(expect.stringContaining('input text'));
        });

        test('routes android_key correctly', () => {
            handler._routeAction({ action: 'android_key', parameter: 'KEYCODE_HOME' });
            expect(handler._adb).toHaveBeenCalledWith('shell input keyevent KEYCODE_HOME');
        });

        test('routes android_launch correctly', () => {
            handler._adb = jest.fn(() => Buffer.from('Events injected: 1'));
            const result = handler._routeAction({ action: 'android_launch', parameter: 'com.whatsapp' });
            expect(result).toContain('Launched');
        });

        test('returns error for unknown action', () => {
            const result = handler._routeAction({ action: 'android_fly', parameter: '' });
            expect(result).toContain('Unknown Android action');
        });
    });

    describe('shell safety', () => {
        beforeEach(() => {
            handler._connected = true;
            handler._adb = jest.fn(() => Buffer.from('output'));
        });

        test('blocks rm -rf', () => {
            const result = handler.shell('rm -rf /');
            expect(result).toContain('BLOCKED');
        });

        test('blocks format', () => {
            const result = handler.shell('format /dev/sda');
            expect(result).toContain('BLOCKED');
        });

        test('blocks factory reset', () => {
            const result = handler.shell('factory reset');
            expect(result).toContain('BLOCKED');
        });

        test('allows safe commands', () => {
            const result = handler.shell('ls /sdcard');
            expect(result).toBe('output');
        });
    });

    describe('checkConnection', () => {
        test('returns error when adb not found', () => {
            handler._adbPath = '/nonexistent/adb';
            const result = handler.checkConnection();
            expect(result.connected).toBe(false);
            expect(result.error).toContain('ADB not found');
        });
    });
});
