const fs = require('fs');
const path = require('path');
const { LOG_RETENTION_MS } = require('../core/constants');

/**
 * 📝 ChatLogManager - 專注於對話日誌的生命週期管理
 */
class ChatLogManager {
    constructor(options = {}) {
        this.logFilePath = options.logFilePath || path.join(process.cwd(), 'logs', 'agent_chat.jsonl');
        this.retentionMs = options.retentionMs || LOG_RETENTION_MS;

        this._ensureDirectory();
        this.cleanup();
    }

    /**
     * 確保日誌目錄存在
     */
    _ensureDirectory() {
        const dir = path.dirname(this.logFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    /**
     * 清理過期日誌
     */
    cleanup() {
        if (!fs.existsSync(this.logFilePath)) return;
        try {
            const now = Date.now();
            const content = fs.readFileSync(this.logFilePath, 'utf8');
            if (!content.trim()) return;

            const lines = content.trim().split('\n');
            const keptLines = lines.filter(line => {
                try {
                    const entry = JSON.parse(line);
                    return (now - entry.timestamp) < this.retentionMs;
                } catch (e) { return false; }
            });

            if (keptLines.length < lines.length) {
                fs.writeFileSync(this.logFilePath, keptLines.join('\n') + '\n');
                console.log(`🧹 [LogManager] 已清理過期日誌 (${lines.length - keptLines.length} 條)`);
            }
        } catch (e) {
            console.error("❌ [LogManager] 日誌清理失敗:", e.message);
        }
    }

    /**
     * 寫入日誌
     * @param {Object} entry 
     */
    append(entry) {
        try {
            const logEntry = {
                timestamp: Date.now(),
                ...entry
            };
            fs.appendFileSync(this.logFilePath, JSON.stringify(logEntry) + '\n');
        } catch (e) {
            console.error("❌ [LogManager] 日誌寫入失敗:", e.message);
        }
    }
}

module.exports = ChatLogManager;
