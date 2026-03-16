const fs = require('fs');
const path = require('path');

/**
 * SystemLogger - 核心系統日誌持久化工具
 * v10.0: 緩衝非同步寫入 + 定時 flush，消除事件迴圈阻塞
 */
class SystemLogger {
    static _buffer = [];
    static _flushTimer = null;
    static _isRotating = false;
    static _BUFFER_SIZE = 100;
    static _FLUSH_INTERVAL = 500;

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
    }

    static _ensureDirectory(dir) {
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
            } catch (e) {
                // Avoid recursive console.warn
                process.stderr.write(`[SystemLogger] ${e.message}\n`);
            }
        }
    }

    static _write(level, ...args) {
        if (!this.logFile) return;
        if (process.env.ENABLE_SYSTEM_LOG === 'false') return;

        const now = new Date();
        const dateString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        const timestamp = `${dateString} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        // Rotation check: date change or size exceeded
        let shouldRotate = false;
        let rotateTag = timestamp.replace(/[-:]/g, '').replace(' ', 'T');

        if (this.currentDateString && this.currentDateString !== dateString) {
            shouldRotate = true;
            rotateTag = this.currentDateString;
        }
        this.currentDateString = dateString;

        if (!shouldRotate) {
            const maxSizeMb = parseFloat(process.env.LOG_MAX_SIZE_MB) || 10;
            if (maxSizeMb > 0 && fs.existsSync(this.logFile)) {
                try {
                    const stats = fs.statSync(this.logFile);
                    if (stats.size >= maxSizeMb * 1024 * 1024) {
                        shouldRotate = true;
                    }
                } catch (e) { /* ignore */ }
            }
        }

        if (shouldRotate && !this._isRotating) {
            this._flushSync(); // Flush buffer before rotating
            this._rotateAndCompress(rotateTag);
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

        // v10.0: Buffer writes instead of appendFileSync
        this._buffer.push(logLine);

        // Flush if buffer full or schedule timer flush
        if (this._buffer.length >= this._BUFFER_SIZE) {
            this._flushAsync();
        } else if (!this._flushTimer) {
            this._flushTimer = setTimeout(() => {
                this._flushTimer = null;
                this._flushAsync();
            }, this._FLUSH_INTERVAL);
        }
    }

    /**
     * v10.0: Async flush — non-blocking
     */
    static _flushAsync() {
        if (this._buffer.length === 0 || this._isRotating) return;
        const data = this._buffer.join('');
        this._buffer.length = 0;

        fs.promises.appendFile(this.logFile, data).catch(e => {
            process.stderr.write(`[SystemLogger] async flush failed: ${e.message}\n`);
        });
    }

    /**
     * Sync flush — used before rotation and at shutdown
     */
    static _flushSync() {
        if (this._buffer.length === 0) return;
        const data = this._buffer.join('');
        this._buffer.length = 0;
        try {
            fs.appendFileSync(this.logFile, data);
        } catch (e) {
            process.stderr.write(`[SystemLogger] sync flush failed: ${e.message}\n`);
        }
    }

    /**
     * Graceful shutdown — sync flush remaining buffer
     */
    static shutdown() {
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
        this._flushSync();
    }

    static _rotateAndCompress(oldDateString) {
        if (!fs.existsSync(this.logFile)) return;
        this._isRotating = true;

        try {
            const archivePath = path.join(path.dirname(this.logFile), `system-${oldDateString}.log`);
            const gzPath = `${archivePath}.gz`;

            fs.renameSync(this.logFile, archivePath);

            const zlib = require('zlib');
            const readStream = fs.createReadStream(archivePath);
            const writeStream = fs.createWriteStream(gzPath);
            const gzip = zlib.createGzip();

            readStream.pipe(gzip).pipe(writeStream).on('finish', () => {
                this._isRotating = false;
                try { fs.unlinkSync(archivePath); } catch (e) { /* ignore */ }
                this._cleanOldLogs();
            }).on('error', (err) => {
                this._isRotating = false;
                process.stderr.write(`[SystemLogger] 壓縮日誌失敗: ${err.message}\n`);
            });
        } catch (error) {
            this._isRotating = false;
            process.stderr.write(`[SystemLogger] 日誌輪替失敗: ${error.message}\n`);
        }
    }

    static _cleanOldLogs() {
        const logDir = path.dirname(this.logFile);
        if (!fs.existsSync(logDir)) return;

        const retentionDays = parseInt(process.env.LOG_RETENTION_DAYS, 10) || 7;

        try {
            const files = fs.readdirSync(logDir)
                .filter(file => file.startsWith('system-') && file.endsWith('.log.gz'))
                .map(file => {
                    const filePath = path.join(logDir, file);
                    return { path: filePath, stats: fs.statSync(filePath) };
                });

            const nowTime = Date.now();
            const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

            files.forEach(fileObj => {
                if (nowTime - fileObj.stats.mtimeMs > maxAgeMs) {
                    try { fs.unlinkSync(fileObj.path); } catch (e) { /* ignore */ }
                }
            });
        } catch (error) {
            process.stderr.write(`[SystemLogger] 日誌清理失敗: ${error.message}\n`);
        }
    }
}

module.exports = SystemLogger;
