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

        this.originalLog = console.log;
        this.originalError = console.error;
        this.originalWarn = console.warn;

        console.log = (...args) => {
            const ts = new Date().toLocaleTimeString('zh-TW', { hour12: false });
            this.originalLog(`\x1b[90m[${ts}]\x1b[0m`, ...args);
            this._write('INFO', ...args);
        };

        console.error = (...args) => {
            const ts = new Date().toLocaleTimeString('zh-TW', { hour12: false });
            this.originalError(`\x1b[90m[${ts}]\x1b[0m`, ...args);
            this._write('ERROR', ...args);
        };

        console.warn = (...args) => {
            const ts = new Date().toLocaleTimeString('zh-TW', { hour12: false });
            this.originalWarn(`\x1b[90m[${ts}]\x1b[0m`, ...args);
            this._write('WARN', ...args);
        };

        this.initialized = true;
        this._isLogging = false; 
        this.lastRotationFailure = 0; // ✨ [新增] 避免寫入失敗時無限嘗試輪替 (造成 EIO 循環)
        this.rotationCooldown = 60000; // 60s cooldown
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

        // 🛡️ [Recursion Guard] 防止 console.error 觸發輪替失敗時又呼叫 console.error 導致無限循環
        if (this._isLogging) return;
        this._isLogging = true;

        try {
            // 檢查是否手動關閉了系統日誌
            if (process.env.ENABLE_SYSTEM_LOG === 'false') { this._isLogging = false; return; }
        } catch (e) {
            this._isLogging = false;
            return;
        }

        const now = new Date();
        const dateString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        const timestamp = `${dateString} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        // == 輪替條件 1: 換日 ==
        let shouldRotate = false;
        let rotateTag = timestamp.replace(/[-:]/g, '').replace(' ', 'T');

        if (this.currentDateString && this.currentDateString !== dateString) {
            shouldRotate = true;
            rotateTag = this.currentDateString; // 依據原先的日期標籤
        }
        this.currentDateString = dateString;

        // == 輪替條件 2: 容量達標 ==
        if (!shouldRotate) {
            const maxSizeMb = parseFloat(process.env.LOG_MAX_SIZE_MB) || 10;
            if (maxSizeMb > 0) {
                const maxBytes = maxSizeMb * 1024 * 1024;
                if (fs.existsSync(this.logFile)) {
                    try {
                        const stats = fs.statSync(this.logFile);
                        if (stats.size >= maxBytes) {
                            shouldRotate = true;
                        }
                    } catch (e) { }
                }
            }
        }

        // 執行輪替 (增加冷卻機制防止磁碟滿額時無限嘗試)
        if (shouldRotate) {
            const nowTime = Date.now();
            if (nowTime - this.lastRotationFailure > this.rotationCooldown) {
                this._rotateAndCompress(rotateTag);
            }
        }

        const util = require('util');
        const message = args.map(arg => {
            if (arg instanceof Error) {
                return `${arg.name}: ${arg.message}\n${arg.stack}`;
            }
            if (typeof arg === 'object' && arg !== null) {
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
            // 防止遞迴報錯 (雙重保險)
        } finally {
            this._isLogging = false; // 解鎖
        }
    }

    static _rotateAndCompress(oldDateString) {
        if (!fs.existsSync(this.logFile)) return;

        try {
            const archivePath = path.join(path.dirname(this.logFile), `system-${oldDateString}.log`);
            const gzPath = `${archivePath}.gz`;

            // 將當前日誌更名
            fs.renameSync(this.logFile, archivePath);

            // 非同步進行 gzip 壓縮
            const zlib = require('zlib');
            const readStream = fs.createReadStream(archivePath);
            const writeStream = fs.createWriteStream(gzPath);
            const gzip = zlib.createGzip();

            readStream.pipe(gzip).pipe(writeStream).on('finish', () => {
                // 壓縮完成後刪除原本尚未壓縮的歷史重命名檔
                try { fs.unlinkSync(archivePath); } catch (e) { }
                this._cleanOldLogs();
            }).on('error', (err) => {
                this.lastRotationFailure = Date.now();
                if (this.originalError) {
                    this.originalError(`[SystemLogger] 壓縮日誌失敗 (磁碟可能已滿): ${err.message}`);
                }
            });
        } catch (error) {
            this.lastRotationFailure = Date.now();
            if (this.originalError) {
                this.originalError(`[SystemLogger] 日誌輪替重大失敗: ${error.message}`);
            }
        }
    }

    static _cleanOldLogs() {
        const logDir = path.dirname(this.logFile);
        if (!fs.existsSync(logDir)) return;

        // 從目前的環境變數取得保留參數，預設 7 天
        const retentionDays = parseInt(process.env.LOG_RETENTION_DAYS, 10) || 7;

        try {
            const files = fs.readdirSync(logDir)
                .filter(file => file.startsWith('system-') && file.endsWith('.log.gz'))
                .map(file => {
                    const filePath = path.join(logDir, file);
                    return { path: filePath, stats: fs.statSync(filePath) };
                });

            // 統一以檔案的新舊時間 (Retention Days) 作為清理依據
            const nowTime = Date.now();
            const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

            files.forEach(fileObj => {
                if (nowTime - fileObj.stats.mtimeMs > maxAgeMs) {
                    try { fs.unlinkSync(fileObj.path); } catch (e) { }
                }
            });
        } catch (error) {
            if (this.originalError) {
                this.originalError(`[SystemLogger] 日誌清理失敗: ${error.message}`);
            }
        }
    }
}

module.exports = SystemLogger;
