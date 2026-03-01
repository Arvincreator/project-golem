const fs = require('fs');
const path = require('path');

/**
 * 📝 SystemLogger - 核心系統日誌持久化工具
 */
class SystemLogger {
    static init(logBaseDir) {
        if (this.initialized) return;
        this.logFile = path.join(logBaseDir, 'system.log');
        this._ensureDirectory(logBaseDir);

        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;

        console.log = (...args) => {
            originalLog(...args);
            this._write('INFO', ...args);
        };

        console.error = (...args) => {
            originalError(...args);
            this._write('ERROR', ...args);
        };

        console.warn = (...args) => {
            originalWarn(...args);
            this._write('WARN', ...args);
        };

        this.initialized = true;
        console.log(`📝 [SystemLogger] 系統核心日誌持久化已啟動: ${this.logFile}`);
    }

    static _ensureDirectory(dir) {
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
            } catch (e) {
                // 如果目錄已存在或權限問題，略過
            }
        }
    }

    static _write(level, ...args) {
        if (!this.logFile) return;
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        const util = require('util');
        const message = args.map(arg => {
            if (arg instanceof Error) {
                return `${arg.name}: ${arg.message}\n${arg.stack}`;
            }
            if (typeof arg === 'object' && arg !== null) {
                // 如果物件看起來像 Error (例如有 stack)，則手動解析
                if (arg.stack || arg.message) {
                    return `${arg.name || 'Error'}: ${arg.message || ''}\n${arg.stack || ''}`;
                }
                return util.inspect(arg, { depth: 2, colors: false });
            }
            return String(arg);
        }).join(' ');

        const logLine = `[${timestamp}] [${level}] ${message}\n`;
        try {
            fs.appendFileSync(this.logFile, logLine);
        } catch (e) {
            // 防止遞迴報錯
        }
    }
}

module.exports = SystemLogger;
