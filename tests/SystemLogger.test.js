const path = require('path');

// Mock fs before requiring SystemLogger
const mockFsSync = jest.fn();
const mockAppendFileSync = jest.fn();
const mockStatSync = jest.fn();
const mockRenameSync = jest.fn();
const mockUnlinkSync = jest.fn();
const mockReaddirSync = jest.fn();
const mockCreateReadStream = jest.fn();
const mockCreateWriteStream = jest.fn();

jest.mock('fs', () => ({
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: mockFsSync,
    appendFileSync: mockAppendFileSync,
    statSync: mockStatSync,
    renameSync: mockRenameSync,
    unlinkSync: mockUnlinkSync,
    readdirSync: mockReaddirSync,
    createReadStream: mockCreateReadStream,
    createWriteStream: mockCreateWriteStream,
}));

const fs = require('fs');
const SystemLogger = require('../src/utils/SystemLogger');

describe('SystemLogger', () => {
    const logDir = '/tmp/test_logs';

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset singleton state
        SystemLogger.initialized = false;
        SystemLogger.logFile = null;
        SystemLogger.currentDateString = null;
        SystemLogger._isLogging = false; // Reset recursion guard between tests
        delete process.env.ENABLE_SYSTEM_LOG;
        delete process.env.LOG_MAX_SIZE_MB;
        delete process.env.LOG_RETENTION_DAYS;
    });

    afterEach(() => {
        SystemLogger.initialized = false;
    });

    test('init should set logFile and mark initialized', () => {
        SystemLogger.init(logDir);
        expect(SystemLogger.initialized).toBe(true);
        expect(SystemLogger.logFile).toContain('system.log');
    });

    test('init should be idempotent', () => {
        SystemLogger.init(logDir);
        SystemLogger.init(logDir);
        expect(mockFsSync).not.toHaveBeenCalled(); // dir already exists
    });

    test('_ensureDirectory creates directory if missing', () => {
        fs.existsSync.mockReturnValueOnce(false);
        SystemLogger._ensureDirectory('/tmp/new_log_dir');
        expect(mockFsSync).toHaveBeenCalledWith('/tmp/new_log_dir', { recursive: true });
    });

    test('_write does nothing if logFile is not set', () => {
        SystemLogger.logFile = null;
        SystemLogger._write('INFO', 'test message');
        expect(mockAppendFileSync).not.toHaveBeenCalled();
    });

    test('_write skips if ENABLE_SYSTEM_LOG=false', () => {
        process.env.ENABLE_SYSTEM_LOG = 'false';
        SystemLogger.logFile = path.join(logDir, 'system.log');
        SystemLogger._write('INFO', 'test message');
        expect(mockAppendFileSync).not.toHaveBeenCalled();
    });

    test('_write appends to log file', () => {
        SystemLogger.logFile = path.join(logDir, 'system.log');
        fs.existsSync.mockReturnValue(false);
        SystemLogger._write('INFO', 'test message');
        expect(mockAppendFileSync).toHaveBeenCalledWith(
            SystemLogger.logFile,
            expect.stringContaining('[INFO] test message')
        );
    });

    test('_write triggers rotation on date change', () => {
        SystemLogger.logFile = path.join(logDir, 'system.log');
        SystemLogger.currentDateString = '2024-01-01';
        fs.existsSync.mockReturnValue(true);
        fs.statSync.mockReturnValue({ size: 1 });
        
        const mockOn = jest.fn().mockReturnThis();
        mockCreateReadStream.mockReturnValue({ pipe: jest.fn().mockReturnValue({ pipe: jest.fn().mockReturnValue({ on: mockOn }) }) });
        mockCreateWriteStream.mockReturnValue({});

        SystemLogger._write('INFO', 'message on new day');
        expect(mockRenameSync).toHaveBeenCalled();
    });

    test('_write triggers rotation on size limit', () => {
        SystemLogger.logFile = path.join(logDir, 'system.log');
        process.env.LOG_MAX_SIZE_MB = '1';
        fs.existsSync.mockReturnValue(true);
        fs.statSync.mockReturnValue({ size: 2 * 1024 * 1024 }); // 2MB > 1MB limit
        
        const mockOn = jest.fn().mockReturnThis();
        mockCreateReadStream.mockReturnValue({ pipe: jest.fn().mockReturnValue({ pipe: jest.fn().mockReturnValue({ on: mockOn }) }) });
        mockCreateWriteStream.mockReturnValue({});
        
        SystemLogger._write('INFO', 'large log trigger');
        expect(mockRenameSync).toHaveBeenCalled();
    });

    test('_write handles Error objects', () => {
        SystemLogger.logFile = path.join(logDir, 'system.log');
        fs.existsSync.mockReturnValue(false);
        const err = new Error('Test error');
        SystemLogger._write('ERROR', err);
        expect(mockAppendFileSync).toHaveBeenCalledWith(
            SystemLogger.logFile,
            expect.stringContaining('Error: Test error')
        );
    });

    test('_cleanOldLogs deletes old files', () => {
        SystemLogger.logFile = path.join(logDir, 'system.log');
        process.env.LOG_RETENTION_DAYS = '1';
        const oldTime = Date.now() - (2 * 24 * 60 * 60 * 1000);
        fs.existsSync.mockReturnValue(true);
        fs.readdirSync.mockReturnValue(['system-2024-01-01.log.gz']);
        fs.statSync.mockReturnValue({ mtimeMs: oldTime });
        
        SystemLogger._cleanOldLogs();
        expect(mockUnlinkSync).toHaveBeenCalled();
    });
});
