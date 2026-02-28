const fs = require('fs');
const path = require('path');
const { LOG_RETENTION_MS } = require('../core/constants');
const ResponseParser = require('../utils/ResponseParser');

/**
 * 📝 ChatLogManager - 專注於對話日誌的生命週期管理
 */
class ChatLogManager {
    constructor(options = {}) {
        this.logDir = options.logDir || path.join(process.cwd(), 'logs');
        this.retentionMs = options.retentionMs || LOG_RETENTION_MS;

        this._ensureDirectory();
        this.cleanup();
    }

    /**
     * 確保日誌目錄存在
     */
    _ensureDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    /**
     * 取得日誌路徑 (YYYYMMDDHH.log)
     */
    _getLogPath() {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        return path.join(this.logDir, `${yyyy}${mm}${dd}${hh}.log`);
    }

    /**
     * 清理過期日誌 (以檔案為單位)
     */
    cleanup() {
        if (!fs.existsSync(this.logDir)) return;
        try {
            const now = Date.now();
            const files = fs.readdirSync(this.logDir);

            files.forEach(file => {
                const filePath = path.join(this.logDir, file);
                const stats = fs.statSync(filePath);

                if (file.endsWith('.log') && (now - stats.mtimeMs) > this.retentionMs) {
                    fs.unlinkSync(filePath);
                    console.log(`清理過期日誌檔案: ${file}`);
                }
            });
        } catch (e) {
            console.error("❌ [LogManager] 日誌清理失敗:", e.message);
        }
    }

    /**
     * 取得昨天的日期字串 (YYYYMMDD)
     */
    _getYesterdayDateString() {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}${mm}${dd}`;
    }

    /**
     * 取得摘要日誌路徑 (YYYYMMDD.log)
     */
    _getSummaryPath(dateString) {
        return path.join(this.logDir, `${dateString}.log`);
    }

    /**
     * 壓縮特定日期的每小時日誌為每日摘要
     * @param {string} dateString - YYYYMMDD
     * @param {Object} brain - GolemBrain 實例
     * @param {boolean} [force=false] - 是否無視門檻強制執行
     */
    async compressLogsForDate(dateString, brain, force = false) {
        console.log(`📦 [LogManager] 檢查 ${dateString} 的日誌狀態... (Force: ${force})`);
        const files = fs.readdirSync(this.logDir)
            .filter(f => f.startsWith(dateString) && f.length === 14 && f.endsWith('.log'))
            .sort();

        // ✨ [門檻檢查] 超過 3 個檔案才進行壓縮 (若是 force 則無視門檻)
        if (!force && files.length < 3) {
            console.log(`ℹ️ [LogManager] ${dateString} 目前僅有 ${files.length} 個每小時日誌，未達壓縮門檻 (需 >= 3)。`);
            return;
        }

        let combinedContent = "";
        files.forEach(file => {
            try {
                const logs = JSON.parse(fs.readFileSync(path.join(this.logDir, file), 'utf8'));
                logs.forEach(l => {
                    const time = new Date(l.timestamp).toLocaleTimeString('zh-TW', { hour12: false });
                    combinedContent += `[${time}] ${l.sender}: ${l.content}\n`;
                });
            } catch (e) { }
        });

        if (!combinedContent) return;

        console.log(`🤖 [LogManager] 檔案數 (${files.length}) 達標，請求 Gemini 進行摘要壓縮...`);
        const prompt = `【系統指令：對話回顧與壓縮】\n以下是 ${dateString} 多個時段內的對話記錄。請將這些內容整理成約 2000 字的詳盡摘要，保留所有重要的決策、任務進度、技術細節與核心重點，並以條列式優雅地呈現。\n\n對話內容：\n${combinedContent}`;

        try {
            const rawResponse = await brain.sendMessage(prompt, false);
            const parsed = ResponseParser.parse(rawResponse);
            const summaryText = parsed.reply || "";

            // 🛡️ [安全性檢查] 如果摘要內容為空，則不寫入並中止清理流程
            if (!summaryText || summaryText.trim().length === 0) {
                console.error(`⚠️ [LogManager] ${dateString} Gemini 回傳摘要內容為空，取消歸檔以保護原始數據。`);
                return;
            }

            const summaryEntry = {
                date: dateString,
                timestamp: Date.now(),
                type: 'daily_summary',
                content: summaryText
            };

            // ✨ [追加模式] 讀取既有摘要或建立新陣列
            const summaryPath = this._getSummaryPath(dateString);
            let summaries = [];
            if (fs.existsSync(summaryPath)) {
                try {
                    const existing = fs.readFileSync(summaryPath, 'utf8');
                    summaries = JSON.parse(existing);
                } catch (e) {
                    console.warn(`⚠️ [LogManager] 摘要檔解析失敗，將重啟對應陣列。`);
                }
            }

            summaries.push(summaryEntry);
            fs.writeFileSync(summaryPath, JSON.stringify(summaries, null, 2));
            console.log(`✅ [LogManager] ${dateString} 摘要已產出/更新：${summaryPath}`);

            // 壓縮成功後，才刪除已彙整的小時日誌
            files.forEach(file => {
                const filePath = path.join(this.logDir, file);
                try { fs.unlinkSync(filePath); } catch (e) { }
            });
            console.log(`🗑️ [LogManager] 已清理 ${files.length} 個原始檔案。`);

        } catch (e) {
            console.error(`❌ [LogManager] 摘要生成失敗: ${e.message}`);
        }
    }

    /**
     * 寫入日誌 (JSON Array 格式)
     * @param {Object} entry 
     */
    append(entry) {
        try {
            const logFilePath = this._getLogPath();
            const logEntry = {
                timestamp: Date.now(),
                ...entry
            };

            let logs = [];
            if (fs.existsSync(logFilePath)) {
                try {
                    const content = fs.readFileSync(logFilePath, 'utf8');
                    logs = JSON.parse(content);
                } catch (e) {
                    console.warn(`⚠️ [LogManager] 無法解析舊日誌，將建立新陣列: ${logFilePath}`);
                }
            }

            logs.push(logEntry);
            fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2));
        } catch (e) {
            console.error("❌ [LogManager] 日誌寫入失敗:", e.message);
        }
    }
}

module.exports = ChatLogManager;
