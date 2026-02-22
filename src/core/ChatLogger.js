// ============================================================
// 📝 ChatLogger - 對話日誌管理
// ============================================================
const fs = require('fs');
const path = require('path');

class ChatLogger {
    /**
     * @param {string} logFilePath - 日誌檔案的絕對路徑
     */
    constructor(logFilePath) {
        this.logFilePath = logFilePath;

        const dir = path.dirname(this.logFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    /**
     * 清理超過保留期限的日誌紀錄
     * @param {number} maxAgeMs - 最大保留時間 (毫秒)
     */
    cleanup(maxAgeMs) {
        if (!fs.existsSync(this.logFilePath)) return;
        try {
            const now = Date.now();
            const content = fs.readFileSync(this.logFilePath, 'utf8');
            const lines = content.trim().split('\n');
            const keptLines = lines.filter(line => {
                try {
                    const entry = JSON.parse(line);
                    return (now - entry.timestamp) < maxAgeMs;
                } catch (e) { return false; }
            });

            if (keptLines.length < lines.length) {
                fs.writeFileSync(this.logFilePath, keptLines.join('\n') + '\n');
                console.log(`🧹 [System] 已清理過期對話日誌 (${lines.length - keptLines.length} 條)`);
            }
        } catch (e) {
            console.error("Cleanup logs failed:", e);
        }
    }

    /**
     * 附加一筆日誌紀錄
     * @param {Object} entry - 要寫入的日誌物件
     */
    append(entry) {
        try {
            fs.appendFileSync(this.logFilePath, JSON.stringify(entry) + '\n');
        } catch (e) {
            console.error("Failed to write chat log:", e);
        }
    }
}

module.exports = ChatLogger;
