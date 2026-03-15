const os = require('os');
const { execFileSync } = require('child_process');

// ============================================================
// ToolScanner (工具自動探測器)
// ============================================================
class ToolScanner {
    static check(toolName) {
        // 安全: 限制 toolName 為英數字、連字號、底線
        const safeName = String(toolName).replace(/[^a-zA-Z0-9_.-]/g, '');
        if (!safeName) return '指令名稱無效';

        const isWin = os.platform() === 'win32';
        const findCmd = isWin ? 'where' : 'which';
        try {
            // 安全: 使用 execFileSync 不走 shell
            const result = execFileSync(findCmd, [safeName], {
                encoding: 'utf-8', stdio: 'pipe', timeout: 5000
            }).trim().split('\n')[0].trim();
            return `**已安裝**: \`${safeName}\`\n路徑: ${result}`;
        } catch (e) {
            return `**未安裝**: \`${safeName}\`\n(系統找不到此指令)`;
        }
    }
}

module.exports = ToolScanner;
