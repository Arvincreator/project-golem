const sqlite3 = require('sqlite3').verbose();
const fs = require('fs').promises;
const path = require('path');
const LanceDBProDriver = require('../memory/LanceDBProDriver');

class SkillIndexManager {
    constructor(userDataDir) {
        if (!userDataDir) {
            const ConfigManager = require('../config');
            userDataDir = ConfigManager.MEMORY_BASE_DIR;
        }
        this.dbPath = path.join(userDataDir, 'skills.db');
        this.db = null;
        this.libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
        this.vectorDb = new LanceDBProDriver({ namespace: 'lancedb-pro-skills' });
    }

    /**
     * 初始化資料庫與資料表
     */
    async init() {
        if (this.db) return;

        // 確保目錄存在
        const dbDir = path.dirname(this.dbPath);
        try {
            await fs.mkdir(dbDir, { recursive: true });
        } catch (e) { }
        
        // 初始化向量資料庫
        if (!this.vectorDb.store) {
            await this.vectorDb.init().catch(e => console.warn("Vector DB Init Warning:", e.message));
        }

        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) return reject(err);

                this.db.run(`
                    CREATE TABLE IF NOT EXISTS skills (
                        id TEXT PRIMARY KEY,
                        name TEXT,
                        description TEXT,
                        content TEXT,
                        path TEXT,
                        category TEXT,
                        last_modified INTEGER
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    }

    /**
     * 同步本地檔案到 SQLite 索引
     * @param {string[]} enabledIds - 可選的啟動技能清單，若提供則只同步清單中的檔案並移除其他的（除了 mandatory）
     */
    async sync(enabledIds = []) {
        await this.init();

        const { MANDATORY_SKILLS } = require('../skills/skillsConfig');
        const effectiveIds = new Set([
            ...MANDATORY_SKILLS,
            ...enabledIds
        ]);

        console.log(`📡 [SkillIndex][${path.basename(path.dirname(this.dbPath))}] 開始同步技能說明書... (目標數量: ${effectiveIds.size})`);

        try {
            const files = await fs.readdir(this.libPath);
            const mdFiles = files.filter(f => f.endsWith('.md'));

            for (const file of mdFiles) {
                const skillId = path.basename(file, '.md').toLowerCase();

                if (effectiveIds.has(skillId)) {
                    await this.addSkill(skillId);
                } else {
                    // 嚴格執行：不在啟動清單中的技能一律從 SQLite 移除
                    await this.removeSkill(skillId);
                }
            }
            console.log(`🏁 [SkillIndex][${path.basename(path.dirname(this.dbPath))}] 同步完成。`);
        } catch (e) {
            console.error('❌ [SkillIndex] 同步失敗:', e.message);
        }
    }

    /**
     * 強制將特定技能載入到 SQLite
     */
    async addSkill(id) {
        await this.init();
        const filePath = path.join(this.libPath, `${id}.md`);
        try {
            await fs.access(filePath);
            const stats = await fs.stat(filePath);
            const lastModified = stats.mtimeMs;

            const needsUpdate = await this._checkNeedsUpdate(id, lastModified);
            if (needsUpdate) {
                let content = await fs.readFile(filePath, 'utf-8');
                const name = this._extractName(content) || id.toUpperCase();
                const description = this._extractDescription(content);

                // 🎯 修正：移除 <SkillModule> 標籤，防止路徑洩漏導致 Golem 產生幻覺
                content = content.replace(/<SkillModule.*?>/gi, '').replace(/<\/SkillModule>/gi, '').trim();

                await this._upsertSkill({
                    id,
                    name,
                    description,
                    content,
                    path: filePath,
                    category: 'lib',
                    last_modified: lastModified
                });
                
                // 📝 Generate Embedding dynamically
                const skillTextForEmbedding = `Skill ID: ${id}\nName: ${name}\nDescription: ${description}\n\nContent:\n${content.substring(0, 1500)}`;
                await this.vectorDb.memorize(skillTextForEmbedding, { type: 'skill', skillId: id, name });
                
                console.log(`✅ [SkillIndex] 已加入/更新 (SQLite+LanceDB): ${id}`);
            }
        } catch (e) {
            console.warn(`⚠️ [SkillIndex] 無法載入技能檔案 ${id}:`, e.message);
        }
    }

    /**
     * 從 SQLite 移除特定技能
     */
    async removeSkill(id) {
        await this.init();
        return new Promise((resolve, reject) => {
            this.db.run("DELETE FROM skills WHERE id = ?", [id], (err) => {
                if (err) reject(err);
                else {
                    console.log(`🗑️ [SkillIndex] 已移除: ${id}`);
                    resolve();
                }
            });
        });
    }

    /**
     * 搜尋相關技能
     */
    async searchSkills(query) {
        await this.init();
        return new Promise((resolve, reject) => {
            this.db.all(
                "SELECT id, name, description FROM skills WHERE name LIKE ? OR description LIKE ? OR content LIKE ? LIMIT 5",
                [`%${query}%`, `%${query}%`, `%${query}%`],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    /**
     * 從 LanceDB 語意搜尋相關技能 (RAG)
     */
    async searchRelevantSkills(queryText, limit = 3) {
        await this.init();
        if (!this.vectorDb || !this.vectorDb.store) return [];
        
        try {
            const results = await this.vectorDb.recall(queryText, limit * 2); // Fetch extra for deduplication
            
            // Extract unique skill IDs
            const skillIds = [];
            const seen = new Set();
            for (const r of results) {
                if (r.metadata && r.metadata.skillId && !seen.has(r.metadata.skillId)) {
                    seen.add(r.metadata.skillId);
                    skillIds.push(r.metadata.skillId);
                    if (skillIds.length >= limit) break;
                }
            }
            
            if (skillIds.length === 0) return [];
            return await this.getEnabledSkills(skillIds);
        } catch (err) {
            console.warn("⚠️ [SkillIndex] RAG 搜尋失敗:", err.message);
            return [];
        }
    }

    /**
     * 取得所有已索引的技能清單
     */
    async listAllSkills() {
        await this.init();
        return new Promise((resolve, reject) => {
            this.db.all("SELECT id, name, description, category FROM skills ORDER BY id ASC", (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    /**
     * 取得啟用的技能內容
     */
    async getEnabledSkills(skillIds) {
        await this.init();
        if (!skillIds || skillIds.length === 0) return [];

        const placeholders = skillIds.map(() => '?').join(',');
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT id, name, content FROM skills WHERE id IN (${placeholders})`,
                skillIds,
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    /**
     * 關閉連線
     */
    async close() {
        if (this.db) {
            return new Promise((resolve) => {
                this.db.close(() => {
                    this.db = null;
                    resolve();
                });
            });
        }
    }

    // --- Private Helpers ---

    async _checkNeedsUpdate(id, lastModified) {
        return new Promise((resolve) => {
            this.db.get("SELECT last_modified FROM skills WHERE id = ?", [id], (err, row) => {
                if (err || !row) resolve(true);
                else resolve(row.last_modified !== lastModified);
            });
        });
    }

    async _upsertSkill(skill) {
        return new Promise((resolve, reject) => {
            this.db.run(`
                INSERT INTO skills (id, name, description, content, path, category, last_modified)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name,
                    description=excluded.description,
                    content=excluded.content,
                    path=excluded.path,
                    category=excluded.category,
                    last_modified=excluded.last_modified
            `, [skill.id, skill.name, skill.description, skill.content, skill.path, skill.category, skill.last_modified], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    _extractName(content) {
        const match = content.match(/【已載入技能：(.*?)\s*\((.*?)\)】/) || content.match(/【已載入技能：(.*?)】/);
        return match ? match[1] : null;
    }

    _extractDescription(content) {
        // 簡單地抓取第一行非空文字
        const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('<'));
        return lines.length > 0 ? lines[0] : "";
    }
}

module.exports = SkillIndexManager;
