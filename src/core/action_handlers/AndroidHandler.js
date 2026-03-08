/**
 * AndroidHandler — Phase 1 ADB Bridge for Android automation
 *
 * Handles android_* actions routed from the brain:
 *   - android_tap: Tap at coordinates
 *   - android_swipe: Swipe gesture
 *   - android_type: Input text
 *   - android_screenshot: Capture screen
 *   - android_launch: Launch app by package name
 *   - android_shell: Run shell command on device
 *
 * Requires: ADB installed and device connected (USB or WiFi)
 * @see https://github.com/Arvincreator/project-golem/issues/26
 */

const { execSync } = require('child_process');

class AndroidHandler {
    constructor() {
        this._adbPath = process.env.ADB_PATH || 'adb';
        this._deviceId = process.env.ADB_DEVICE || null;
        this._connected = false;
    }

    // --- Device Management ---

    /**
     * Check if ADB is available and a device is connected
     */
    checkConnection() {
        try {
            const devices = this._adb('devices').toString().trim().split('\n');
            const connected = devices.slice(1).filter(l => l.includes('\tdevice'));

            if (connected.length === 0) {
                this._connected = false;
                return { connected: false, error: 'No Android devices connected. Connect via USB or `adb connect <ip>:5555`' };
            }

            if (!this._deviceId) {
                this._deviceId = connected[0].split('\t')[0];
            }

            this._connected = true;
            return {
                connected: true,
                deviceId: this._deviceId,
                totalDevices: connected.length,
                devices: connected.map(l => l.split('\t')[0])
            };
        } catch (e) {
            this._connected = false;
            return { connected: false, error: `ADB not found: ${e.message}. Install Android SDK Platform Tools.` };
        }
    }

    // --- Core Actions ---

    tap(x, y) {
        this._ensureConnected();
        this._adb(`shell input tap ${parseInt(x)} ${parseInt(y)}`);
        return `Tapped at (${x}, ${y})`;
    }

    swipe(x1, y1, x2, y2, duration = 300) {
        this._ensureConnected();
        this._adb(`shell input swipe ${parseInt(x1)} ${parseInt(y1)} ${parseInt(x2)} ${parseInt(y2)} ${parseInt(duration)}`);
        return `Swiped (${x1},${y1}) to (${x2},${y2}) in ${duration}ms`;
    }

    type(text) {
        this._ensureConnected();
        const escaped = text.replace(/[\\'"& ]/g, c => `\\${c}`);
        this._adb(`shell input text "${escaped}"`);
        return `Typed: "${text}"`;
    }

    pressKey(keycode) {
        this._ensureConnected();
        this._adb(`shell input keyevent ${keycode}`);
        return `Pressed key: ${keycode}`;
    }

    screenshot(localPath = '/tmp/golem-android-screen.png') {
        this._ensureConnected();
        const remotePath = '/sdcard/golem_screenshot.png';
        this._adb(`shell screencap -p ${remotePath}`);
        this._adb(`pull ${remotePath} ${localPath}`);
        this._adb(`shell rm ${remotePath}`);
        return `Screenshot saved to ${localPath}`;
    }

    launchApp(packageName) {
        this._ensureConnected();
        try {
            const result = this._adb(`shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`).toString();
            if (result.includes('No activities found')) {
                return `App not found: ${packageName}`;
            }
            return `Launched: ${packageName}`;
        } catch (e) {
            return `Failed to launch ${packageName}: ${e.message}`;
        }
    }

    listPackages(filter = '') {
        this._ensureConnected();
        const cmd = filter
            ? `shell pm list packages | grep -i ${filter}`
            : 'shell pm list packages -3';
        const result = this._adb(cmd).toString().trim();
        const packages = result.split('\n').map(l => l.replace('package:', '').trim()).filter(Boolean);
        return { count: packages.length, packages };
    }

    getDeviceInfo() {
        this._ensureConnected();
        return {
            model: this._adbShell('getprop ro.product.model'),
            brand: this._adbShell('getprop ro.product.brand'),
            android: this._adbShell('getprop ro.build.version.release'),
            sdk: this._adbShell('getprop ro.build.version.sdk'),
            resolution: this._adbShell('wm size').replace('Physical size: ', ''),
            battery: this._parseBattery(),
        };
    }

    dumpUI(localPath = '/tmp/golem-ui-dump.xml') {
        this._ensureConnected();
        const remotePath = '/sdcard/golem_ui_dump.xml';
        this._adb(`shell uiautomator dump ${remotePath}`);
        this._adb(`pull ${remotePath} ${localPath}`);
        this._adb(`shell rm ${remotePath}`);
        return `UI dump saved to ${localPath}`;
    }

    shell(command) {
        this._ensureConnected();

        const blocked = ['rm -rf', 'format', 'factory', 'wipe', 'flash'];
        const cmdLower = command.toLowerCase();
        for (const b of blocked) {
            if (cmdLower.includes(b)) {
                return `BLOCKED: "${command}" contains dangerous operation "${b}"`;
            }
        }

        const result = this._adb(`shell ${command}`).toString().trim();
        return result || '(no output)';
    }

    // --- Action Router ---

    static async execute(ctx, actions, controller, brain, dispatchFn) {
        const handler = new AndroidHandler();
        const conn = handler.checkConnection();

        if (!conn.connected) {
            await ctx.reply(`Android: ${conn.error}`);
            return;
        }

        const results = [];
        for (const action of actions) {
            try {
                const result = handler._routeAction(action);
                results.push(result);
            } catch (e) {
                results.push(`Error ${action.action}: ${e.message}`);
            }
        }

        if (results.length > 0) {
            const observation = `[Android Result]\n${results.join('\n')}`;
            const feedbackPrompt = `[System Observation]\n${observation}\n\nPlease reply to user naturally using [GOLEM_REPLY].`;
            if (ctx.sendTyping) await ctx.sendTyping();
            const finalRes = await brain.sendMessage(feedbackPrompt);
            await dispatchFn(ctx, finalRes, brain, controller);
        }
    }

    // --- Internal ---

    _routeAction(action) {
        const params = action.parameter || action.params || '';

        switch (action.action) {
            case 'android_tap': {
                const [x, y] = params.split(/[\s,]+/).map(Number);
                return this.tap(x, y);
            }
            case 'android_swipe': {
                const [x1, y1, x2, y2, dur] = params.split(/[\s,]+/).map(Number);
                return this.swipe(x1, y1, x2, y2, dur || 300);
            }
            case 'android_type':
                return this.type(params);
            case 'android_key':
                return this.pressKey(params);
            case 'android_screenshot':
                return this.screenshot(params || undefined);
            case 'android_launch':
                return this.launchApp(params);
            case 'android_packages':
                return JSON.stringify(this.listPackages(params));
            case 'android_info':
                return JSON.stringify(this.getDeviceInfo());
            case 'android_dump_ui':
                return this.dumpUI(params || undefined);
            case 'android_shell':
                return this.shell(params);
            default:
                return `Unknown Android action: ${action.action}`;
        }
    }

    _ensureConnected() {
        if (!this._connected) {
            const conn = this.checkConnection();
            if (!conn.connected) {
                throw new Error(conn.error);
            }
        }
    }

    _adb(args) {
        const deviceFlag = this._deviceId ? `-s ${this._deviceId}` : '';
        return execSync(`${this._adbPath} ${deviceFlag} ${args}`, {
            timeout: 15000,
            maxBuffer: 10 * 1024 * 1024
        });
    }

    _adbShell(cmd) {
        try {
            return this._adb(`shell ${cmd}`).toString().trim();
        } catch (e) {
            return 'N/A';
        }
    }

    _parseBattery() {
        try {
            const dump = this._adbShell('dumpsys battery');
            const level = dump.match(/level:\s*(\d+)/)?.[1] || 'N/A';
            const status = dump.match(/status:\s*(\d+)/)?.[1] || 'N/A';
            const statusMap = { '1': 'Unknown', '2': 'Charging', '3': 'Discharging', '4': 'Not Charging', '5': 'Full' };
            return { level: `${level}%`, status: statusMap[status] || status };
        } catch (e) {
            return { level: 'N/A', status: 'N/A' };
        }
    }
}

module.exports = AndroidHandler;
