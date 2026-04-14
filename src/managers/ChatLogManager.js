const fs = require('fs');
const path = require('path');
const util = require('util');
const { LOG_RETENTION_MS, MEMORY_TIERS } = require('../core/constants');
const ResponseParser = require('../utils/ResponseParser');

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
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS entities (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT UNIQUE,
                        type TEXT,
                        description TEXT
                    );
                `);
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS relationships (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        source_id INTEGER,
                        target_id INTEGER,
                        relation_type TEXT,
                        weight REAL,
                        FOREIGN KEY(source_id) REFERENCES entities(id),
                        FOREIGN KEY(target_id) REFERENCES entities(id)
                    );
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

    async _updateGraph(summaryText, brain) {
        const extractionPrompt = `Extract key entities and their relationships from the following text. 
Output ONLY a valid JSON object with two keys: "entities" (an array of objects with "name", "type", and "description") and "relationships" (an array of objects with "source", "target", and "relation").

Text: ${summaryText}`;
        try {
            const rawResponse = await brain.sendMessage(extractionPrompt, false);
            const parsed = ResponseParser.parse(rawResponse);
            
            if (!parsed.entities && !parsed.relationships) return;

            await this.runAsync('BEGIN TRANSACTION');
            
            if (parsed.entities) {
                for (const ent of parsed.entities) {
                    await this.runAsync(
                        `INSERT OR REPLACE INTO entities (name, type, description) VALUES (?, ?, ?)`,
                        [ent.name, ent.type || 'concept', ent.description || '']
                    );
                }
            }

            if (parsed.relationships) {
                for (const rel of parsed.relationships) {
                    const source = await this.getAsync(`SELECT id FROM entities WHERE name = ?`, [rel.source]);
                    const target = await this.getAsync(`SELECT id FROM entities WHERE name = ?`, [rel.target]);
                    
                    if (source && target) {
                        await this.runAsync(
                            `INSERT INTO relationships (source_id, target_id, relation_type) VALUES (?, ?, ?)`,
                            [source.id, target.id, rel.relation]
                        );
                    }
                }
            }

            await this.runAsync('COMMIT');
            console.log(`🧠 [LogManager] Knowledge Graph updated from summary.`);
        } catch (e) {
            await this.runAsync('ROLLBACK');
            console.error(`❌ [LogManager] Graph update failed:`, e.message);
        }
    }

    async _compressAndSave(prompt, dateString, tier, brain, originalSize = 0) {
        const startTime = Date.now();
        try {
            const rawResponse = await brain.sendMessage(prompt, false);
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            const parsed = ResponseParser.parse(rawResponse);
            const summaryText = parsed.reply || "";

            if (!summaryText || summaryText.trim().length === 0) return;

            await this.runAsync(
                `INSERT INTO summaries (tier, date_string, timestamp, content, original_size, summary_size) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [tier, dateString, Date.now(), summaryText, originalSize, summaryText.length]
            );

            console.log(`✅ [LogManager] ${dateString} ${tier} 產出成功！(耗時: ${duration}s, 摘要: ${summaryText.length}字)`);

            // Hook for Graph-RAG: Update graph from the new summary
            await this._updateGraph(summaryText, brain);

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

    async queryHybridContext(queryText, brain, tier = 'daily', limit = 5) {
        if (!this._isInitialized || !this.db) return '';
        
        console.log(`🔍 [LogManager] 執行 Hybrid 記憶檢索...`);
        
        // 1. Entity Extraction from Query
        let graphContext = '';
        try {
            const entityPrompt = `Identify key entities (people, projects, concepts) mentioned in the following query. 
Output ONLY a comma-separated list of names. If none, output 'NONE'.
Query: ${queryText}`;
            const rawEntities = await brain.sendMessage(entityPrompt, false);
            const entityList = ResponseParser.parse(rawEntities).reply || 'NONE';
            
            if (entityList !== 'NONE') {
                const names = entityList.split(',').map(n => n.trim());
                const facts = [];
                
                for (const name of names) {
                    const entity = await this.getAsync(`SELECT id FROM entities WHERE name = ?`, [name]);
                    if (entity) {
                        const relations = await this.allAsync(
                            `SELECT e2.name as target, r.relation_type 
                             FROM relationships r 
                             JOIN entities e2 ON r.target_id = e2.id 
                             WHERE r.source_id = ? 
                             UNION 
                             SELECT e1.name as target, r.relation_type 
                             FROM relationships r 
                             JOIN entities e1 ON r.source_id = e1.id 
                             WHERE r.target_id = ?`, 
                            [entity.id, entity.id]
                        );
                        
                        relations.forEach(rel => {
                            facts.push(`${name} ${rel.relation_type} ${rel.target}`);
                        });
                    }
                }
                if (facts.length > 0) {
                    graphContext = `\n[知識圖譜事實]:\n${facts.join('\n')}\n`;
                }
            }
        } catch (e) {
            console.error(`⚠️ [LogManager] 圖譜檢索失敗:`, e.message);
        }

        // 2. Tiered Summary Retrieval
        const summaries = await this.readTierAsync(tier, limit);
        const summaryContext = summaries.map(s => `[${s.date}] ${s.content}`).join('\n\n');

        return `[分層記憶摘要]:\n${summaryContext}\n${graphContext}`;
    }
}

module.exports = ChatLogManager;
