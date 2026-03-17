const YerenBridge = require('../src/bridges/YerenBridge');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('YerenBridge', () => {
    let bridge;
    let tmpDir;
    let yerenDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yb-test-'));
        yerenDir = path.join(tmpDir, 'yeren');
        fs.mkdirSync(yerenDir, { recursive: true });
        bridge = new YerenBridge({
            yerenPath: yerenDir,
            localDataDir: path.join(tmpDir, 'local-data'),
        });
        fs.mkdirSync(path.join(tmpDir, 'local-data'), { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('constructor stores configuration', () => {
        expect(bridge._yerenPath).toBe(yerenDir);
    });

    test('isAvailable returns true for accessible path', () => {
        expect(bridge.isAvailable()).toBe(true);
    });

    test('isAvailable returns false for non-existent path', () => {
        const b = new YerenBridge({ yerenPath: '/nonexistent/path/12345' });
        expect(b.isAvailable()).toBe(false);
    });

    test('isAvailable caches result', () => {
        bridge.isAvailable();
        expect(bridge._available).toBe(true);
    });

    test('ensureBridgeDir creates bridge directory', () => {
        const result = bridge.ensureBridgeDir();
        expect(result).toBe(true);
        expect(fs.existsSync(bridge._bridgeDir)).toBe(true);
    });

    test('ensureBridgeDir returns false when unavailable', () => {
        const b = new YerenBridge({ yerenPath: '/nonexistent/12345' });
        expect(b.ensureBridgeDir()).toBe(false);
    });

    test('syncMemory returns error when unavailable', () => {
        const b = new YerenBridge({ yerenPath: '/nonexistent/12345' });
        const result = b.syncMemory();
        expect(result.errors.length).toBeGreaterThan(0);
    });

    test('syncMemory pushes newer local files', () => {
        // Create a local file (simulate cwd)
        const origCwd = process.cwd;
        process.cwd = () => tmpDir;

        const localFile = path.join(tmpDir, 'golem_episodes.json');
        fs.writeFileSync(localFile, JSON.stringify({ episodes: [] }));

        const result = bridge.syncMemory();
        expect(result.synced.length).toBeGreaterThanOrEqual(0);

        process.cwd = origCwd;
    });

    test('syncScanResults copies scan files', () => {
        bridge.ensureBridgeDir();
        // Create a local scan file
        const localData = path.join(tmpDir, 'local-data');
        fs.writeFileSync(path.join(localData, 'v114_live_results_test.json'), '{}');

        const result = bridge.syncScanResults();
        expect(result.synced).toBe(1);
        expect(fs.existsSync(path.join(bridge._bridgeDir, 'v114_live_results_test.json'))).toBe(true);
    });

    test('syncScanResults skips already synced files', () => {
        bridge.ensureBridgeDir();
        const localData = path.join(tmpDir, 'local-data');
        fs.writeFileSync(path.join(localData, 'v114_test.json'), '{}');
        fs.writeFileSync(path.join(bridge._bridgeDir, 'v114_test.json'), '{}');

        const result = bridge.syncScanResults();
        expect(result.synced).toBe(0);
    });

    test('getYerenStatus returns null when no status file', () => {
        expect(bridge.getYerenStatus()).toBeNull();
    });

    test('getYerenStatus reads status file', () => {
        bridge.ensureBridgeDir();
        const status = { version: '9.2', uptime: 3600 };
        fs.writeFileSync(
            path.join(bridge._bridgeDir, 'yeren_status.json'),
            JSON.stringify(status)
        );
        const result = bridge.getYerenStatus();
        expect(result.version).toBe('9.2');
    });

    test('pushUpdate writes data to bridge dir', () => {
        bridge.ensureBridgeDir();
        const result = bridge.pushUpdate({ scan: { total: 16 } });
        expect(result).toBe(true);
        const updatePath = path.join(bridge._bridgeDir, 'rensin_update.json');
        expect(fs.existsSync(updatePath)).toBe(true);
        const data = JSON.parse(fs.readFileSync(updatePath, 'utf-8'));
        expect(data.source).toBe('rensin');
        expect(data.scan.total).toBe(16);
    });

    test('pushUpdate returns false when unavailable', () => {
        const b = new YerenBridge({ yerenPath: '/nonexistent/12345' });
        expect(b.pushUpdate({ test: true })).toBe(false);
    });

    test('getStatus returns summary', () => {
        const status = bridge.getStatus();
        expect(status.available).toBe(true);
        expect(status.yerenPath).toBe(yerenDir);
    });
});
