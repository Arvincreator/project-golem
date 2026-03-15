const SystemUpgrader = require('../src/managers/SystemUpgrader');
const { execSync } = require('child_process');
const fs = require('fs');

jest.mock('fs');
jest.mock('child_process', () => ({
    execSync: jest.fn()
}));
jest.mock('../src/config', () => ({
    CONFIG: { ENABLE_WEB_DASHBOARD: 'false' }
}));

describe('SystemUpgrader', () => {
    let mockCtx;

    beforeEach(() => {
        jest.clearAllMocks();
        mockCtx = {
            reply: jest.fn().mockResolvedValue(),
            sendTyping: jest.fn().mockResolvedValue()
        };
        fs.existsSync.mockReturnValue(true);
        execSync.mockReturnValue(Buffer.from('main'));
    });

    test('should perform full update sequence', async () => {
        await SystemUpgrader.performUpdate(mockCtx);

        expect(execSync).toHaveBeenCalledWith(expect.stringContaining('git fetch'), expect.anything());
        expect(execSync).toHaveBeenCalledWith(expect.stringContaining('git reset'), expect.anything());
        expect(execSync).toHaveBeenCalledWith(expect.stringContaining('npm install'), expect.anything());
        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('更新完成'));
    });

    test('should handle update failures', async () => {
        execSync.mockImplementation((cmd) => {
            if (cmd.includes('npm install')) throw new Error('Network error');
            return Buffer.from('ok');
        });

        await SystemUpgrader.performUpdate(mockCtx);
        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('更新失敗'));
    });

    test('should return early if not a git repository', async () => {
        fs.existsSync.mockImplementation((p) => p !== require('path').join(process.cwd(), '.git'));
        
        await SystemUpgrader.performUpdate(mockCtx);
        
        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('非 Git 存儲庫'));
        expect(execSync).not.toHaveBeenCalled();
    });

    test('should backup using Node.js fs API (no rsync/cp dependency)', async () => {
        execSync.mockImplementation((cmd) => {
            return Buffer.from('main');
        });

        await SystemUpgrader.performUpdate(mockCtx);

        // Verify backup notification was sent
        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('備份'));
    });

    test('should target upstream/main if branch match fails', async () => {
        execSync.mockImplementation((cmd) => {
            if (cmd.includes('rev-parse')) return Buffer.from('feature-branch');
            if (cmd.includes('branch -r')) return Buffer.from('origin/main\nupstream/main');
            if (cmd.includes('remote')) return Buffer.from('upstream\norigin');
            return Buffer.from('ok');
        });

        await SystemUpgrader.performUpdate(mockCtx);

        expect(execSync).toHaveBeenCalledWith(expect.stringContaining('git reset --hard upstream/main'), expect.anything());
    });

    test('should restore node_modules backup if npm install fails', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.renameSync = jest.fn();
        
        execSync.mockImplementation((cmd) => {
            if (cmd.includes('npm install --no-fund')) throw new Error('npm failed');
            return Buffer.from('ok');
        });

        await SystemUpgrader.performUpdate(mockCtx);

        // Expect it to restore from .bak
        expect(fs.renameSync).toHaveBeenCalledWith(expect.stringContaining('node_modules.bak'), expect.stringContaining('node_modules'));
    });

    test('should update dashboard if enabled', async () => {
        const { CONFIG } = require('../src/config');
        CONFIG.ENABLE_WEB_DASHBOARD = 'true';
        
        execSync.mockReturnValue(Buffer.from('ok'));

        await SystemUpgrader.performUpdate(mockCtx);

        expect(execSync).toHaveBeenCalledWith(expect.stringContaining('npm run build'), expect.objectContaining({
            cwd: expect.stringContaining('web-dashboard')
        }));
        
        CONFIG.ENABLE_WEB_DASHBOARD = 'false'; // Reset
    });
});
