const fs = require('fs');
const path = require('path');
const { LOG_RETENTION_MS, MEMORY_TIERS } = require('../core/constants');
const ResponseParser = require('../utils/ResponseParser');

/**
 * ChatLogManager - 金字塔式分層記憶壓縮引擎
 * v10.0: JSONL append O(1) 取代 JSON 陣列 readAll+rewrite O(n)
 *
 * 架構：Hourly → Daily → Monthly → Yearly → Era
 * 每一層有獨立的保留期與摘要字數上限
 */
class ChatLogManager {
    constructor(options = {}) {
        const baseLogDir = options.logDir || path.join(process.cwd(), 'logs');
        this.golemId = (options.golemId || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
        this.logDir = options.isSingleMode
            ? baseLogDir
            : path.join(baseLogDir, this.golemId);
        this.retentionMs = options.retentionMs || LOG_RETENTION_MS;

        // 分層子目錄
        this.dirs = {
            hourly: this.logDir,                              // Tier 0: 原始日誌 (根目錄)
            daily: path.join(this.logDir, 'daily'),           // Tier 1: 每日摘要
            monthly: path.join(this.logDir, 'monthly'),       // Tier 2: 每月精華
            yearly: path.join(this.logDir, 'yearly'),         // Tier 3: 年度回顧
            era: path.join(this.logDir, 'era'),               // Tier 4: 紀元里程碑
        };

        this._isInitialized = false;
    }

    /**
     * 延遲初始化：確保目錄存在並處理遷移
     */
    async init() {
        if (this._isInitialized) return;
        this._ensureDirectories();
        this._migrateExistingDailySummaries();
        await this._migrateJsonToJsonl();
        this.cleanup();
        this._isInitialized = true;
    }

    // ============================================================
    // 目錄管理
    // ============================================================

    _ensureDirectories() {
        Object.values(this.dirs).forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    /**
     * 遷移舊版每日摘要 (根目錄的 YYYYMMDD.log) 到 daily/ 子目錄
     */
    _migrateExistingDailySummaries() {
        try {
            const files = fs.readdirSync(this.dirs.hourly)
                .filter(f => f.length === 12 && f.endsWith('.log'));

            files.forEach(file => {
                const src = path.join(this.dirs.hourly, file);
                const dest = path.join(this.dirs.daily, file);
                if (!fs.existsSync(dest)) {
                    fs.renameSync(src, dest);
                    console.log(`[LogManager] 遷移舊版摘要至 daily/: ${file}`);
                }
            });
        } catch (e) {
            // 靜默忽略：首次啟動時可能無舊檔案
        }
    }

    /**
     * v10.0: 遷移舊 JSON 陣列格式 (.log) 為 JSONL 格式
     * 偵測方式：若檔案內容以 '[' 開頭，則為舊格式
     */
    async _migrateJsonToJsonl() {
        try {
            const files = fs.readdirSync(this.dirs.hourly)
                .filter(f => f.length === 14 && f.endsWith('.log'));

            for (const file of files) {
                const filePath = path.join(this.dirs.hourly, file);
                try {
                    const content = fs.readFileSync(filePath, 'utf8').trim();
                    if (content.startsWith('[')) {
                        // Old JSON array format — convert to JSONL
                        const entries = JSON.parse(content);
                        if (Array.isArray(entries) && entries.length > 0) {
                            const jsonl = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
                            await fs.promises.writeFile(filePath, jsonl);
                            console.log(`[LogManager] 遷移 JSON→JSONL: ${file} (${entries.length} entries)`);
                        }
                    }
                } catch (e) {
                    // Skip corrupted files
                }
            }
        } catch (e) {
            // Ignore migration errors
        }
    }

    // ============================================================
    // 日誌寫入 (v10.0: JSONL append O(1))
    // ============================================================

    _getLogPath() {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        return path.join(this.dirs.hourly, `${yyyy}${mm}${dd}${hh}.log`);
    }

    /**
     * v10.0: JSONL append — O(1) per entry, no readAll+rewrite
     */
    append(entry) {
        const logFilePath = this._getLogPath();
        const logEntry = { timestamp: Date.now(), ...entry };
        fs.promises.appendFile(logFilePath, JSON.stringify(logEntry) + '\n')
            .catch(e => console.error("[LogManager] 日誌寫入失敗:", e.message));
    }

    // ============================================================
    // JSONL 讀取工具
    // ============================================================

    /**
     * Parse a JSONL file, returning array of parsed entries
     * Tolerant of corrupted lines (skips them)
     */
    _readJsonlFile(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            // Handle both JSONL and legacy JSON array format
            const trimmed = content.trim();
            if (trimmed.startsWith('[')) {
                try {
                    return JSON.parse(trimmed);
                } catch (e) {
                    // Fall through to JSONL parsing
                }
            }
            return trimmed.split('\n').filter(Boolean).map(line => {
                try { return JSON.parse(line); } catch { return null; }
            }).filter(Boolean);
        } catch (e) {
            return [];
        }
    }

    // ============================================================
    // 分層清理 (各層獨立清理)
    // ============================================================

    cleanup() {
        const now = Date.now();

        // Tier 0: hourly 原始日誌 → 72 小時
        this._cleanDir(this.dirs.hourly, now, MEMORY_TIERS.HOURLY_RETENTION_MS, 14);

        // Tier 1: daily 摘要 → 90 天
        this._cleanDir(this.dirs.daily, now, MEMORY_TIERS.DAILY_RETENTION_MS);

        // Tier 2: monthly 精華 → 5 年
        this._cleanDir(this.dirs.monthly, now, MEMORY_TIERS.MONTHLY_RETENTION_MS);

        // Tier 3 & 4: yearly / era → 永不刪除
    }

    _cleanDir(dir, now, retentionMs, filenameLength = null) {
        if (!fs.existsSync(dir)) return;
        try {
            fs.readdirSync(dir).forEach(file => {
                if (!file.endsWith('.log')) return;
                if (filenameLength && file.length !== filenameLength) return;

                const filePath = path.join(dir, file);
                const stats = fs.statSync(filePath);
                if ((now - stats.mtimeMs) > retentionMs) {
                    fs.unlinkSync(filePath);
                    console.log(`[LogManager] 清理過期檔案: ${path.relative(this.logDir, filePath)}`);
                }
            });
        } catch (e) {
            console.error(`[LogManager] 清理失敗 (${dir}):`, e.message);
        }
    }

    // ============================================================
    // 工具函式
    // ============================================================

    _getYesterdayDateString() {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return this._formatDate(d);
    }

    _formatDate(d) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}${mm}${dd}`;
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
        const decadeStart = Math.floor(year / 10) * 10;
        return `decade_${decadeStart}`;
    }

    _getLastDecadeString() {
        const year = new Date().getFullYear();
        const lastDecadeStart = Math.floor(year / 10) * 10 - 10;
        return `decade_${lastDecadeStart}`;
    }

    // ============================================================
    // Tier 0 → Tier 1: Hourly → Daily 壓縮
    // ============================================================

    async compressLogsForDate(dateString, brain, force = false) {
        console.log(`[LogManager][${this.golemId}] 檢查 ${dateString} 的日誌狀態... (Force: ${force})`);

        const summaryPath = path.join(this.dirs.daily, `${dateString}.log`);
        if (fs.existsSync(summaryPath)) {
            console.log(`[LogManager] ${dateString} 已有每日摘要，跳過壓縮。`);
            return;
        }

        const files = fs.readdirSync(this.dirs.hourly)
            .filter(f => f.startsWith(dateString) && f.length === 14 && f.endsWith('.log'))
            .sort();

        if (!force && files.length < 3) {
            console.log(`[LogManager] ${dateString} 僅有 ${files.length} 個 hourly 日誌，未達壓縮門檻 (需 >= 3)。`);
            return;
        }

        if (files.length === 0) return;

        let combinedContent = "";
        files.forEach(file => {
            try {
                const logs = this._readJsonlFile(path.join(this.dirs.hourly, file));
                logs.forEach(l => {
                    const time = new Date(l.timestamp).toLocaleTimeString('zh-TW', { hour12: false });
                    combinedContent += `[${time}] ${l.sender}: ${l.content}\n`;
                });
            } catch (e) { console.warn('[ChatLogManager]', e.message); }
        });

        if (!combinedContent) return;

        const totalChars = combinedContent.length;
        const totalLines = combinedContent.split('\n').length - 1;

        console.log(`[LogManager] 檔案數(${files.length}) 達標，待壓縮對話計 ${totalLines} 條，總字數計 ${totalChars}。`);
        const prompt = `【系統指令：對話回顧與壓縮】\n以下是 ${dateString} 多個時段內的對話記錄。請將這些內容整理成約 ${MEMORY_TIERS.DAILY_SUMMARY_CHARS} 字的精煉摘要，保留所有重要的決策、任務進度、技術細節與核心重點，並以條列式優雅地呈現。\n\n對話內容：\n${combinedContent}`;

        await this._compressAndSave(prompt, summaryPath, dateString, 'daily_summary', files, this.dirs.hourly, brain, totalChars);
    }

    // ============================================================
    // Tier 1 → Tier 2: Daily → Monthly 壓縮
    // ============================================================

    async compressMonthly(monthString, brain) {
        console.log(`[LogManager][${this.golemId}] 開始 ${monthString} 月度壓縮...`);

        const outputPath = path.join(this.dirs.monthly, `${monthString}.log`);
        if (fs.existsSync(outputPath)) {
            console.log(`[LogManager] ${monthString} 已有月度摘要，跳過。`);
            return;
        }

        const files = fs.readdirSync(this.dirs.daily)
            .filter(f => f.startsWith(monthString) && f.endsWith('.log'))
            .sort();

        if (files.length === 0) {
            console.log(`[LogManager] ${monthString} 無每日摘要可壓縮。`);
            return;
        }

        let combinedContent = "";
        files.forEach(file => {
            try {
                const logs = this._readJsonlFile(path.join(this.dirs.daily, file));
                const dateStr = file.replace('.log', '');
                logs.forEach(entry => {
                    if (entry.content && entry.content.trim()) {
                        combinedContent += `\n--- [${dateStr}] ---\n${entry.content}\n`;
                    }
                });
            } catch (e) { console.warn('[ChatLogManager]', e.message); }
        });

        if (!combinedContent) return;

        const totalChars = combinedContent.length;

        console.log(`[LogManager] 每日摘要數(${files.length}) 達標，待壓縮內容計 ${totalChars} 字。`);
        const prompt = `【系統指令：月度記憶壓縮】\n以下是 ${monthString} 一整個月的每日對話摘要，共 ${files.length} 天。請將這些內容整合為約 ${MEMORY_TIERS.MONTHLY_SUMMARY_CHARS} 字的月度精華報告。\n\n重點保留：\n- 該月的主要里程碑與重大決策\n- 技術進展與架構變更\n- 使用者偏好與行為模式的變化\n- 尚未完成的待辦事項\n\n每日摘要：\n${combinedContent}`;

        await this._compressAndSave(prompt, outputPath, monthString, 'monthly_summary', files, this.dirs.daily, brain, totalChars);
    }

    // ============================================================
    // Tier 2 → Tier 3: Monthly → Yearly 壓縮
    // ============================================================

    async compressYearly(yearString, brain) {
        console.log(`[LogManager][${this.golemId}] 開始 ${yearString} 年度壓縮...`);

        const outputPath = path.join(this.dirs.yearly, `${yearString}.log`);
        if (fs.existsSync(outputPath)) {
            console.log(`[LogManager] ${yearString} 已有年度摘要，跳過。`);
            return;
        }

        const files = fs.readdirSync(this.dirs.monthly)
            .filter(f => f.startsWith(yearString) && f.endsWith('.log'))
            .sort();

        if (files.length === 0) {
            console.log(`[LogManager] ${yearString} 無月度摘要可壓縮。`);
            return;
        }

        let combinedContent = "";
        files.forEach(file => {
            try {
                const logs = this._readJsonlFile(path.join(this.dirs.monthly, file));
                const monthStr = file.replace('.log', '');
                logs.forEach(entry => {
                    if (entry.content && entry.content.trim()) {
                        combinedContent += `\n--- [${monthStr}] ---\n${entry.content}\n`;
                    }
                });
            } catch (e) { console.warn('[ChatLogManager]', e.message); }
        });

        if (!combinedContent) return;

        const prompt = `【系統指令：年度記憶壓縮】\n以下是 ${yearString} 年一整年的月度精華摘要，共 ${files.length} 個月。請將這些內容整合為約 ${MEMORY_TIERS.YEARLY_SUMMARY_CHARS} 字的年度回顧報告。\n\n重點保留：\n- 年度重大事件與里程碑\n- 長期目標的演進與成果\n- 核心人際關係與偏好變化\n- 重大技術決策與架構演進\n\n月度摘要：\n${combinedContent}`;

        await this._compressAndSave(prompt, outputPath, yearString, 'yearly_summary', null, null, brain);
    }

    // ============================================================
    // Tier 3 → Tier 4: Yearly → Era 壓縮
    // ============================================================

    async compressEra(decadeString, brain) {
        console.log(`[LogManager][${this.golemId}] 開始 ${decadeString} 紀元壓縮...`);

        const outputPath = path.join(this.dirs.era, `${decadeString}.log`);
        if (fs.existsSync(outputPath)) {
            console.log(`[LogManager] ${decadeString} 已有紀元摘要，跳過。`);
            return;
        }

        const startYear = parseInt(decadeString.replace('decade_', ''));
        const endYear = startYear + 9;

        const files = fs.readdirSync(this.dirs.yearly)
            .filter(f => {
                const year = parseInt(f.replace('.log', ''));
                return year >= startYear && year <= endYear && f.endsWith('.log');
            })
            .sort();

        if (files.length === 0) {
            console.log(`[LogManager] ${decadeString} 無年度摘要可壓縮。`);
            return;
        }

        let combinedContent = "";
        files.forEach(file => {
            try {
                const logs = this._readJsonlFile(path.join(this.dirs.yearly, file));
                const yearStr = file.replace('.log', '');
                logs.forEach(entry => {
                    if (entry.content && entry.content.trim()) {
                        combinedContent += `\n--- [${yearStr} 年] ---\n${entry.content}\n`;
                    }
                });
            } catch (e) { console.warn('[ChatLogManager]', e.message); }
        });

        if (!combinedContent) return;

        const prompt = `【系統指令：紀元記憶壓縮】\n以下是 ${startYear}~${endYear} 十年間的年度回顧摘要，共 ${files.length} 年。請將這些內容整合為約 ${MEMORY_TIERS.ERA_SUMMARY_CHARS} 字的紀元里程碑。\n\n重點保留：\n- 這十年中最重大的人生事件\n- 核心價值觀與世界觀的演變\n- 最重要的人際關係和技術成就\n- 人格特質與興趣愛好的長期變化\n\n年度摘要：\n${combinedContent}`;

        await this._compressAndSave(prompt, outputPath, decadeString, 'era_summary', null, null, brain);
    }

    // ============================================================
    // 通用壓縮核心 (v10.0: 加 60s timeout 保護)
    // ============================================================

    async _compressAndSave(prompt, outputPath, label, type, sourceFiles, sourceDir, brain, originalSize = 0) {
        const startTime = Date.now();
        try {
            // v10.0: 60s timeout protection
            const result = await Promise.race([
                brain.sendMessage(prompt, false),
                new Promise((_, rej) => setTimeout(() => rej(new Error('Compression timeout (60s)')), 60000))
            ]);

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            const parsed = ResponseParser.parse(result);
            const summaryText = parsed.reply || "";
            const summarySize = summaryText.length;
            const ratio = originalSize > 0 ? ((1 - (summarySize / originalSize)) * 100).toFixed(1) : 0;

            if (!summaryText || summaryText.trim().length === 0) {
                console.error(`[LogManager] ${label} 回傳摘要為空，取消歸檔以保護原始數據。`);
                return;
            }

            const summaryEntry = {
                date: label,
                timestamp: Date.now(),
                type: type,
                content: summaryText
            };

            // v10.0: Write summary as JSONL (append mode)
            fs.appendFileSync(outputPath, JSON.stringify(summaryEntry) + '\n');
            console.log(`[LogManager] ${label} ${type} 產出成功！(耗時: ${duration}s, 原始: ${originalSize}字 -> 摘要: ${summarySize}字, 壓縮率: ${ratio}%)`);

            // v10.0: 先驗證輸出檔可解析，再刪除源檔案
            if (sourceFiles && sourceDir) {
                const verification = this._readJsonlFile(outputPath);
                if (verification.length > 0) {
                    sourceFiles.forEach(file => {
                        try { fs.unlinkSync(path.join(sourceDir, file)); } catch (e) { console.warn('[ChatLogManager]', e.message); }
                    });
                    console.log(`[LogManager] 歸檔完成，已從 Tier 0 清理 ${sourceFiles.length} 個源檔案。`);
                } else {
                    console.error(`[LogManager] 輸出檔驗證失敗，保留源檔案以防資料遺失。`);
                }
            }

        } catch (e) {
            console.error(`[LogManager] ${type} 生成失敗 (${label}): ${e.message}`);
        }
    }

    // ============================================================
    // 多層讀取 (供 GolemBrain 注入使用)
    // ============================================================

    /**
     * 讀取最近的原始 hourly 日誌 (Tier 0)
     */
    readRecentHourly(limit = null) {
        const dir = this.dirs.hourly;
        if (!dir || !fs.existsSync(dir)) return '';

        try {
            let files = fs.readdirSync(dir)
                .filter(f => f.length === 14 && f.endsWith('.log'))
                .sort();

            if (limit) files = files.slice(-limit);

            let result = '';
            files.forEach(file => {
                try {
                    const logs = this._readJsonlFile(path.join(dir, file));
                    logs.forEach(l => {
                        const time = new Date(l.timestamp).toLocaleString('zh-TW', { hour12: false });
                        result += `[${time}] ${l.sender}: ${l.content}\n`;
                    });
                } catch (e) {
                    console.warn(`[LogManager] readRecentHourly 解析失敗，略過: ${file} — ${e.message}`);
                }
            });

            return result.trim();
        } catch (e) {
            return '';
        }
    }

    getRecentEntries(limit = 50) {
        try {
            const hourlyDir = this.dirs.hourly;
            if (!fs.existsSync(hourlyDir)) return [];

            const files = fs.readdirSync(hourlyDir)
                .filter(f => f.endsWith('.log') && f.length === 14)
                .sort()
                .reverse()
                .slice(0, 3);

            const entries = [];
            for (const file of files) {
                try {
                    const logs = this._readJsonlFile(path.join(hourlyDir, file));
                    entries.push(...logs);
                } catch (e) { /* skip unreadable files */ }
            }

            return entries.slice(-limit);
        } catch (e) {
            console.warn('[ChatLogManager] getRecentEntries failed:', e.message);
            return [];
        }
    }

    readTier(tier, limit = null) {
        const dir = this.dirs[tier];
        if (!dir || !fs.existsSync(dir)) return [];

        try {
            let files = fs.readdirSync(dir)
                .filter(f => f.endsWith('.log'))
                .sort();

            if (limit) files = files.slice(-limit);

            const results = [];
            files.forEach(file => {
                try {
                    const logs = this._readJsonlFile(path.join(dir, file));
                    const dateStr = file.replace('.log', '');
                    logs.forEach(entry => {
                        if (entry.content && entry.content.trim()) {
                            results.push({ date: dateStr, content: entry.content });
                        }
                    });
                } catch (e) {
                    console.warn(`[LogManager] readTier(${tier}) 解析失敗，略過: ${file} — ${e.message}`);
                }
            });

            return results;
        } catch (e) {
            return [];
        }
    }
}

module.exports = ChatLogManager;
