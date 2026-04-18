const fs = require('fs');
const path = require('path');
const util = require('util');
const { LOG_RETENTION_MS, MEMORY_TIERS } = require('../core/constants');
const ResponseParser = require('../utils/ResponseParser');
const TrajectoryCompressor = require('./TrajectoryCompressor');

let sqlite3Instance = null;

function getSqlite3() {
    if (sqlite3Instance) return sqlite3Instance;
    try {
        sqlite3Instance = require('sqlite3').verbose();
        return sqlite3Instance;
    } catch (error) {
        throw new Error(`sqlite3 無法載入，請確認已安裝對應 Node 版本的 native bindings: ${error.message}`);
    }
}

/**
 * 📝 ChatLogManager - 基於 SQLite (WAL) 的記憶壓縮引擎
 */
class ChatLogManager {
    constructor(options = {}) {
        const baseLogDir = options.logDir || path.join(process.cwd(), 'logs');
        this.golemId = options.golemId || 'default';
        this.logDir = baseLogDir;
        this.retentionMs = options.retentionMs || LOG_RETENTION_MS;
        this.dbDir = path.join(this.logDir, 'db');
        this.dbPath = path.join(this.dbDir, `chat_logs_${this.golemId}.sqlite`);

        // Legacy dirs for migration purposes
        this.dirs = {
            hourly: this.logDir,
            daily: path.join(this.logDir, 'daily'),
            monthly: path.join(this.logDir, 'monthly'),
            yearly: path.join(this.logDir, 'yearly'),
            era: path.join(this.logDir, 'era'),
        };

        this._isInitialized = false;
        this.db = null;
        this.runAsync = null;
        this.allAsync = null;
        this.getAsync = null;
    }

    async init() {
        if (this._isInitialized) return;
        
        if (!fs.existsSync(this.dbDir)) {
            fs.mkdirSync(this.dbDir, { recursive: true });
        }

        const sqlite3 = getSqlite3();
        this.db = new sqlite3.Database(this.dbPath);
        this.runAsync = util.promisify(this.db.run.bind(this.db));
        this.allAsync = util.promisify(this.db.all.bind(this.db));
        this.getAsync = util.promisify(this.db.get.bind(this.db));

        await new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run('PRAGMA journal_mode = WAL;');
                this.db.run('PRAGMA synchronous = NORMAL;');
                
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp INTEGER,
                        date_string TEXT,
                        hour_string TEXT,
                        sender TEXT,
                        content TEXT,
                        type TEXT,
                        role TEXT,
                        is_system INTEGER
                    );
                `);
                
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS summaries (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        tier TEXT,
                        date_string TEXT,
                        timestamp INTEGER,
                        content TEXT,
                        original_size INTEGER,
                        summary_size INTEGER
                    );
                `);

                // 🔍 [Hermes-inspired] FTS5 全文搜尋虛擬表
                // 對齊 hermes_state.py 的 messages_fts 設計
                // content= 指定内容表，content_rowid= 指定 rowid 欄
                // 由 Trigger 轉發漯，保持背景同步不採紏主表
                this.db.run(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                        content,
                        sender,
                        content=messages,
                        content_rowid=id
                    );
                `);

                // FTS5 Trigger: INSERT
                this.db.run(`
                    CREATE TRIGGER IF NOT EXISTS messages_fts_insert
                    AFTER INSERT ON messages BEGIN
                        INSERT INTO messages_fts(rowid, content, sender)
                        VALUES (new.id, new.content, new.sender);
                    END;
                `);

                // FTS5 Trigger: UPDATE
                this.db.run(`
                    CREATE TRIGGER IF NOT EXISTS messages_fts_update
                    AFTER UPDATE ON messages BEGIN
                        INSERT INTO messages_fts(messages_fts, rowid, content, sender)
                        VALUES ('delete', old.id, old.content, old.sender);
                        INSERT INTO messages_fts(rowid, content, sender)
                        VALUES (new.id, new.content, new.sender);
                    END;
                `);

                // FTS5 Trigger: DELETE
                this.db.run(`
                    CREATE TRIGGER IF NOT EXISTS messages_fts_delete
                    AFTER DELETE ON messages BEGIN
                        INSERT INTO messages_fts(messages_fts, rowid, content, sender)
                        VALUES ('delete', old.id, old.content, old.sender);
                    END;
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });

        // 進行舊版資料庫移轉 (僅執行一次)
        await this._migrateLegacyJSON();
        
        this._isInitialized = true;
        await this.cleanup();
    }

    // ============================================================
    // 🗂️ 遷移舊版 JSON 日誌
    // ============================================================
    async _migrateLegacyJSON() {
        const flagFile = path.join(this.dbDir, '.legacy_migrated');
        if (fs.existsSync(flagFile)) return;

        console.log(`📦 [LogManager][${this.golemId}] 開始遷移舊版 JSON 日誌至 SQLite...`);
        try {
            await this.runAsync("BEGIN TRANSACTION");

            // Migrate Hourly
            if (fs.existsSync(this.dirs.hourly)) {
                const files = fs.readdirSync(this.dirs.hourly).filter(f => f.length === 14 && f.endsWith('.log'));
                for (const file of files) {
                    try {
                        const logs = JSON.parse(fs.readFileSync(path.join(this.dirs.hourly, file), 'utf8'));
                        for (const l of logs) {
                            const dateString = file.substring(0, 8);
                            const hourString = file.substring(0, 10);
                            await this.runAsync(
                                `INSERT INTO messages (timestamp, date_string, hour_string, sender, content, type, role, is_system) 
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                                [l.timestamp || Date.now(), dateString, hourString, l.sender, l.content, l.type || 'unknown', l.role || l.sender, l.isSystem ? 1 : 0]
                            );
                        }
                    } catch (e) { }
                }
            }

            // Migrate Summaries
            const migrateTier = async (dir, tierName) => {
                if (!fs.existsSync(dir)) return;
                const files = fs.readdirSync(dir).filter(f => f.endsWith('.log'));
                for (const file of files) {
                    try {
                        const logs = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
                        for (const l of logs) {
                            await this.runAsync(
                                `INSERT INTO summaries (tier, date_string, timestamp, content, original_size, summary_size) 
                                 VALUES (?, ?, ?, ?, ?, ?)`,
                                [tierName, l.date || file.replace('.log', ''), l.timestamp || Date.now(), l.content, 0, (l.content || '').length]
                            );
                        }
                    } catch (e) { }
                }
            };

            await migrateTier(this.dirs.daily, 'daily');
            await migrateTier(this.dirs.monthly, 'monthly');
            await migrateTier(this.dirs.yearly, 'yearly');
            await migrateTier(this.dirs.era, 'era');

            await this.runAsync("COMMIT");
            fs.writeFileSync(flagFile, 'migrated');
            console.log(`✅ [LogManager] 遷移完成！`);
        } catch (error) {
            await this.runAsync("ROLLBACK");
            console.error(`❌ [LogManager] 遷移失敗:`, error);
        }
    }

    // ============================================================
    // 📝 日誌寫入
    // ============================================================
    append(entry) {
        if (!this._isInitialized || !this.db) {
            console.warn(`⚠️ [LogManager] 尚未初始化，無法寫入紀錄`);
            return;
        }
        
        const now = new Date();
        const dateString = this._formatDate(now);
        const hourString = dateString + String(now.getHours()).padStart(2, '0');
        
        this.db.run(
            `INSERT INTO messages (timestamp, date_string, hour_string, sender, content, type, role, is_system) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                Date.now(), 
                dateString, 
                hourString, 
                entry.sender || 'System', 
                entry.content || '', 
                entry.type || 'unknown', 
                entry.role || entry.sender, 
                entry.isSystem ? 1 : 0
            ],
            (err) => {
                if (err) console.error("❌ [LogManager] SQLite 寫入失敗:", err.message);
            }
        );
    }

    // ============================================================
    // 🧹 分層清理
    // ============================================================
    async cleanup() {
        if (!this._isInitialized || !this.db) return;
        const now = Date.now();

        try {
            await this.runAsync('BEGIN TRANSACTION');
            // Tier 0: 原則保留 72 小時
            await this.runAsync(`DELETE FROM messages WHERE timestamp < ?`, [now - MEMORY_TIERS.HOURLY_RETENTION_MS]);
            // Tier 1: daily 摘要 → 90 天
            await this.runAsync(`DELETE FROM summaries WHERE tier = 'daily' AND timestamp < ?`, [now - MEMORY_TIERS.DAILY_RETENTION_MS]);
            // Tier 2: monthly 精華 → 5 年
            await this.runAsync(`DELETE FROM summaries WHERE tier = 'monthly' AND timestamp < ?`, [now - MEMORY_TIERS.MONTHLY_RETENTION_MS]);
            await this.runAsync('COMMIT');
            
            // VACUUM 釋放空間 (可選，防止檔案無限增長)
            // this.db.run('VACUUM;'); 
        } catch (e) {
            await this.runAsync('ROLLBACK');
            console.error(`❌ [LogManager] 清理失敗:`, e.message);
        }
    }

    _formatDate(d) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}${mm}${dd}`;
    }

    _getYesterdayDateString() {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return this._formatDate(d);
    }

    _getLastMonthString() {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${yyyy}${mm}`;
    }

    _getLastYearString() {
        const d = new Date();
        return String(d.getFullYear() - 1);
    }

    _getCurrentDecadeString() {
        const year = new Date().getFullYear();
        return 'decade_' + (Math.floor(year / 10) * 10);
    }

    _getLastDecadeString() {
        const year = new Date().getFullYear();
        return 'decade_' + (Math.floor(year / 10) * 10 - 10);
    }

    // ============================================================
    // 🏛️ Tier 0 → Tier 1: Hourly → Daily 壓縮
    // ============================================================
    async compressLogsForDate(dateString, brain, force = false) {
        if (!this._isInitialized || !this.db) {
            console.warn(`⚠️ [LogManager] 尚未初始化，無法執行 Date 壓縮 (${dateString})`);
            return;
        }
        console.log(`📦 [LogManager][${this.golemId}] 檢查 ${dateString} 的日誌狀態...`);
        const messages = await this.allAsync(`SELECT * FROM messages WHERE date_string = ? ORDER BY timestamp ASC`, [dateString]);
        
        if (!force && messages.length < 5) {
            console.log(`ℹ️ [LogManager] ${dateString} 對話過少 (${messages.length} 條)，未達壓縮門檻。`);
            return;
        }
        if (messages.length === 0) return;

        let combinedContent = "";
        messages.forEach(l => {
            const time = new Date(l.timestamp).toLocaleTimeString('zh-TW', { hour12: false });
            combinedContent += `[${time}] ${l.sender}: ${l.content}\n`;
        });

        const totalChars = combinedContent.length;
        console.log(`🤖 [LogManager] 待壓縮對話計 ${messages.length} 條，總字數 ${totalChars}。請求 Gemini...`);
        
        const prompt = `【系統指令：對話回顧與壓縮】\n以下是 ${dateString} 的對話記錄。請整理成約 ${MEMORY_TIERS.DAILY_SUMMARY_CHARS} 字的精煉摘要，保留重要決策、進度與細節：\n\n${combinedContent}`;
        await this._compressAndSave(prompt, dateString, 'daily', brain, totalChars);
    }

    // ============================================================
    // 🏛️ Tier 1 → Tier 2: Daily → Monthly 壓縮
    // ============================================================
    async compressMonthly(monthString, brain) {
        if (!this._isInitialized || !this.db) {
            console.warn(`⚠️ [LogManager] 尚未初始化，無法執行 Monthly 壓縮 (${monthString})`);
            return;
        }
        console.log(`📅 [LogManager][${this.golemId}] 開始 ${monthString} 月度壓縮...`);
        
        const existing = await this.getAsync(`SELECT id FROM summaries WHERE tier = 'monthly' AND date_string = ?`, [monthString]);
        if (existing) {
            console.log(`ℹ️ [LogManager] ${monthString} 已有多月度摘要，跳過。`);
            return;
        }

        const summaries = await this.allAsync(`SELECT * FROM summaries WHERE tier = 'daily' AND date_string LIKE ? ORDER BY date_string ASC`, [monthString + '%']);
        if (summaries.length === 0) return;

        let combinedContent = "";
        summaries.forEach(s => {
            combinedContent += `\n--- [${s.date_string}] ---\n${s.content}\n`;
        });

        const totalChars = combinedContent.length;
        const prompt = `【系統指令：月度記憶壓縮】\n以下是 ${monthString} 的每日摘要。請整合為約 ${MEMORY_TIERS.MONTHLY_SUMMARY_CHARS} 字的月度精華：\n\n${combinedContent}`;
        
        await this._compressAndSave(prompt, monthString, 'monthly', brain, totalChars);
    }

    // ============================================================
    // 🏛️ Tier 2 → Tier 3: Monthly → Yearly 壓縮
    // ============================================================
    async compressYearly(yearString, brain) {
        if (!this._isInitialized || !this.db) {
            console.warn(`⚠️ [LogManager] 尚未初始化，無法執行 Yearly 壓縮 (${yearString})`);
            return;
        }
        console.log(`📆 [LogManager][${this.golemId}] 開始 ${yearString} 年度壓縮...`);
        
        const existing = await this.getAsync(`SELECT id FROM summaries WHERE tier = 'yearly' AND date_string = ?`, [yearString]);
        if (existing) return;

        const summaries = await this.allAsync(`SELECT * FROM summaries WHERE tier = 'monthly' AND date_string LIKE ? ORDER BY date_string ASC`, [yearString + '%']);
        if (summaries.length === 0) return;

        let combinedContent = "";
        summaries.forEach(s => {
            combinedContent += `\n--- [${s.date_string}] ---\n${s.content}\n`;
        });

        const prompt = `【系統指令：年度記憶壓縮】\n以下是 ${yearString} 的月度摘要。請整合為約 ${MEMORY_TIERS.YEARLY_SUMMARY_CHARS} 字的年度回顧：\n\n${combinedContent}`;
        await this._compressAndSave(prompt, yearString, 'yearly', brain, combinedContent.length);
    }

    // ============================================================
    // 🏛️ Tier 3 → Tier 4: Yearly → Era 壓縮
    // ============================================================
    async compressEra(decadeString, brain) {
        if (!this._isInitialized || !this.db) {
            console.warn(`⚠️ [LogManager] 尚未初始化，無法執行 Era 壓縮 (${decadeString})`);
            return;
        }
        console.log(`🏛️ [LogManager][${this.golemId}] 開始 ${decadeString} 紀元壓縮...`);
        const startYear = parseInt(decadeString.replace('decade_', ''));
        const endYear = startYear + 9;

        const existing = await this.getAsync(`SELECT id FROM summaries WHERE tier = 'era' AND date_string = ?`, [decadeString]);
        if (existing) return;

        const summaries = await this.allAsync(`SELECT * FROM summaries WHERE tier = 'yearly' AND CAST(date_string AS INTEGER) BETWEEN ? AND ? ORDER BY date_string ASC`, [startYear, endYear]);
        if (summaries.length === 0) return;

        let combinedContent = "";
        summaries.forEach(s => {
            combinedContent += `\n--- [${s.date_string} 年] ---\n${s.content}\n`;
        });

        const prompt = `【系統指令：紀元記憶壓縮】\n以下是 ${startYear}~${endYear} 的年度摘要。請整合為約 ${MEMORY_TIERS.ERA_SUMMARY_CHARS} 字的紀元里程碑：\n\n${combinedContent}`;
        await this._compressAndSave(prompt, decadeString, 'era', brain, combinedContent.length);
    }

    async _compressAndSave(prompt, dateString, tier, brain, originalSize = 0) {
        const startTime = Date.now();
        try {
            const rawResponse = await brain.sendMessage(prompt, false);
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            const parsed = ResponseParser.parse(rawResponse);
            const summaryText = parsed.reply || "";

            if (!summaryText || summaryText.trim().length === 0) return;

            // Optional: for daily, we could delete the raw messages afterwards. 
            // the legacy json logic did it. We'll rely on cleanup() to delete old messages.

            await this.runAsync(
                `INSERT INTO summaries (tier, date_string, timestamp, content, original_size, summary_size) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [tier, dateString, Date.now(), summaryText, originalSize, summaryText.length]
            );

            console.log(`✅ [LogManager] ${dateString} ${tier} 產出成功！(耗時: ${duration}s, 摘要: ${summaryText.length}字)`);
        } catch (e) {
            console.error(`❌ [LogManager] ${tier} 生成失敗 (${dateString}):`, e.message);
        }
    }

    // ============================================================
    // 📖 多層讀取
    // ============================================================
    async readRecentHourlyAsync(limit = 1000, maxChars = 200000) {
        if (!this._isInitialized || !this.db) return '';
        try {
            // Get most recent messages
            const messages = await this.allAsync(`SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?`, [limit]);
            let result = '';
            for (const l of messages) {
                const time = new Date(l.timestamp).toLocaleString('zh-TW', { hour12: false });
                const entry = `[${time}] ${l.sender}: ${l.content}\n`;
                if (result.length + entry.length > maxChars) break;
                result = entry + result; // prepend to keep chronological order
            }
            return result.trim();
        } catch (e) {
            console.error("❌ [LogManager] 讀取原始日誌失敗:", e);
            return '';
        }
    }



    // ============================================================
    // 🗜️ Trajectory Compression (Hermes-inspired)
    // ============================================================

    /**
     * 壓縮指定日期的原始 messages（依輪次動態壓縮中段）
     * 與 compressLogsForDate 的 LLM 摘要不同：這是即時的輪次瘦身，
     * 不產生 summaries 記錄，而是更新 messages 內容。
     *
     * @param {object} brain  - GolemBrain 實體
     * @param {object} [opts] - TrajectoryCompressor 選項
     * @returns {Promise<{ compressed: boolean, savedChars: number }>}
     */
    async compressCurrentSession(brain, opts = {}) {
        if (!this._isInitialized || !this.db) {
            return { compressed: false, savedChars: 0 };
        }

        // 讀取最近 72 小時的 messages
        const messages = await this.allAsync(
            `SELECT id, sender, content, role FROM messages ORDER BY timestamp ASC LIMIT 2000`
        );

        if (!messages || messages.length === 0) {
            return { compressed: false, savedChars: 0 };
        }

        const turns = TrajectoryCompressor.fromChatLogMessages(messages);

        const compressor = new TrajectoryCompressor(brain, {
            targetChars: opts.targetChars || 80000,
            summaryTargetChars: opts.summaryTargetChars || 1500,
            protectFirstTurns: opts.protectFirstTurns || 3,
            protectLastTurns: opts.protectLastTurns || 5,
        });

        const result = await compressor.compress(turns);

        if (!result.compressed) {
            return { compressed: false, savedChars: 0 };
        }

        // 找出被壓縮換掉的訊息（原始 id 列表 vs 壓縮後數量）
        // 策略：清空 messages、寫回壓縮後的 turns（保留結構）
        try {
            await this.runAsync('BEGIN TRANSACTION');

            // 刪除舊訊息
            await this.runAsync(`DELETE FROM messages WHERE id IN (SELECT id FROM messages ORDER BY timestamp ASC LIMIT ?)`, [messages.length]);

            // 寫回壓縮後的輪次
            const now = Date.now();
            for (const turn of result.turns) {
                const dateString = new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
                const hourString = dateString + String(new Date(now).getHours()).padStart(2, '0');
                await this.runAsync(
                    `INSERT INTO messages (timestamp, date_string, hour_string, sender, content, type, role, is_system)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [now, dateString, hourString, turn.role, turn.content, 'compressed', turn.role, turn.role === 'system' ? 1 : 0]
                );
            }

            await this.runAsync('COMMIT');
            console.log(`🗜️ [ChatLogManager] compressCurrentSession 完成：節省 ${result.savedChars} 字元`);
            return { compressed: true, savedChars: result.savedChars };
        } catch (e) {
            await this.runAsync('ROLLBACK').catch(() => {});
            console.error(`❌ [ChatLogManager] compressCurrentSession 失敗:`, e.message);
            return { compressed: false, savedChars: 0 };
        }
    }

    // ============================================================
    // 🔍 [Hermes-inspired] FTS5 全文搜尋
    // 對齊 hermes_state.py 的 session_search 工具
    // ============================================================

    /**
     * FTS5 全文搜尋——隨最新文字搜尋 messages 表
     * 性能詰強幸於 LIKE 搜尋 (O(log N) vs O(N))
     * 支援 FTS5 語法：多詞、引號、前綴匹配 (keyword*)
     *
     * @param {string} query   - 搜尋詞強 (FTS5 語法)
     * @param {number} [limit=20] - 最多返回比數
     * @param {object} [opts]  - 額外選項
     * @param {string} [opts.sinceDate] - YYYYMMDD 格式，對時間範圍層濃
     * @returns {Promise<Array<{id,timestamp,date_string,sender,content}>>}
     */
    async searchFTS(query, limit = 20, opts = {}) {
        if (!this._isInitialized || !this.db) return [];
        if (!query || !query.trim()) return [];

        try {
            // FTS5 語法安全處理：避免特殊字符欲小搜尋崩潰
            const safeFTSQuery = query.replace(/["()]/g, ' ').trim();

            let sql, params;
            if (opts.sinceDate) {
                sql = `
                    SELECT m.id, m.timestamp, m.date_string, m.sender, m.content
                    FROM messages_fts
                    JOIN messages m ON messages_fts.rowid = m.id
                    WHERE messages_fts MATCH ?
                      AND m.date_string >= ?
                    ORDER BY rank
                    LIMIT ?`;
                params = [safeFTSQuery, opts.sinceDate, limit];
            } else {
                sql = `
                    SELECT m.id, m.timestamp, m.date_string, m.sender, m.content
                    FROM messages_fts
                    JOIN messages m ON messages_fts.rowid = m.id
                    WHERE messages_fts MATCH ?
                    ORDER BY rank
                    LIMIT ?`;
                params = [safeFTSQuery, limit];
            }

            return await this.allAsync(sql, params);
        } catch (e) {
            // FTS5 可能不存在於舊資料庫，降級到 LIKE 匹配
            if (e.message && e.message.includes('no such table: messages_fts')) {
                console.warn('⚠️ [ChatLogManager] messages_fts 表不存在，降級到 LIKE 搜尋。');
                return await this.allAsync(
                    `SELECT id, timestamp, date_string, sender, content FROM messages WHERE content LIKE ? LIMIT ?`,
                    [`%${query}%`, limit]
                );
            }
            console.error('❌ [ChatLogManager] FTS5 搜尋失敗:', e.message);
            return [];
        }
    }

    async readTierAsync(tier, limit = 50, maxChars = 200000) {
        if (!this._isInitialized || !this.db) return [];
        try {
            const summaries = await this.allAsync(`SELECT * FROM summaries WHERE tier = ? ORDER BY timestamp DESC LIMIT ?`, [tier, limit]);
            const results = [];
            let currentChars = 0;

            for (const s of summaries) {
                if (currentChars + s.content.length > maxChars) break;
                results.unshift({ date: s.date_string, content: s.content });
                currentChars += s.content.length;
            }
            return results;
        } catch (e) {
            console.error(`❌ [LogManager] 讀取 ${tier} 失敗:`, e);
            return [];
        }
    }


}

module.exports = ChatLogManager;
