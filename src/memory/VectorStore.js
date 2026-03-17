// ============================================================
// VectorStore — SQLite-backed vector storage with cosine search
// v10.5: Vector RAG foundation
// ============================================================
const path = require('path');
const fs = require('fs');

class VectorStore {
    constructor(dbPath, embeddingProvider) {
        this._dbPath = path.resolve(dbPath);
        this._ep = embeddingProvider;
        this._db = null;
    }

    async init() {
        // Ensure directory exists
        const dir = path.dirname(this._dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const Database = require('better-sqlite3');
        this._db = new Database(this._dbPath);
        this._db.pragma('journal_mode = WAL');
        this._db.pragma('synchronous = NORMAL');

        this._db.exec(`
            CREATE TABLE IF NOT EXISTS vectors (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                embedding BLOB NOT NULL,
                metadata TEXT DEFAULT '{}',
                source TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now'))
            )
        `);

        this._db.exec(`
            CREATE INDEX IF NOT EXISTS idx_vectors_source ON vectors(source)
        `);

        this._db.exec(`
            CREATE INDEX IF NOT EXISTS idx_vectors_created ON vectors(created_at)
        `);

        // Prepare statements
        this._stmtUpsert = this._db.prepare(`
            INSERT OR REPLACE INTO vectors (id, content, embedding, metadata, source, created_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
        `);
        this._stmtDelete = this._db.prepare('DELETE FROM vectors WHERE id = ?');
        this._stmtGetAll = this._db.prepare('SELECT id, content, embedding, metadata, source, created_at FROM vectors');
        this._stmtGetBySource = this._db.prepare('SELECT id, content, embedding, metadata, source, created_at FROM vectors WHERE source = ?');
        this._stmtGetRecent = this._db.prepare('SELECT id, content, embedding, metadata, source, created_at FROM vectors ORDER BY created_at DESC LIMIT ?');
        this._stmtCount = this._db.prepare('SELECT COUNT(*) as count FROM vectors');

        console.log(`[VectorStore] Initialized: ${this._dbPath} (${this._stmtCount.get().count} vectors)`);
    }

    /**
     * Upsert a single item
     * @param {string} id
     * @param {string} content
     * @param {object} metadata
     * @returns {Promise<void>}
     */
    async upsert(id, content, metadata = {}) {
        if (!id || !content) return;
        const vector = await this._ep.embed(content);
        const embeddingBlob = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
        try {
            this._stmtUpsert.run(id, content, embeddingBlob, JSON.stringify(metadata), metadata.source || '');
        } catch (e) {
            console.warn('[VectorStore] upsert error:', e.message);
        }
    }

    /**
     * Batch upsert
     * @param {{id: string, content: string, metadata?: object}[]} items
     */
    async upsertBatch(items) {
        if (!items || items.length === 0) return;
        const texts = items.map(i => i.content);
        const vectors = await this._ep.embedBatch(texts);

        try {
            const txn = this._db.transaction(() => {
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    const vector = vectors[i];
                    const embeddingBlob = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
                    this._stmtUpsert.run(
                        item.id,
                        item.content,
                        embeddingBlob,
                        JSON.stringify(item.metadata || {}),
                        item.metadata?.source || ''
                    );
                }
            });
            txn();
        } catch (e) {
            console.warn('[VectorStore] upsertBatch error:', e.message);
        }
    }

    /**
     * Semantic search
     * @param {string} query
     * @param {{limit?: number, source?: string}} options
     * @returns {Promise<{id: string, content: string, score: number, metadata: object}[]>}
     */
    async search(query, options = {}) {
        const limit = options.limit || 5;
        const maxCandidates = options.maxCandidates || 1000;
        const queryVec = await this._ep.embed(query);

        // Get candidates (optionally filtered by source, capped at maxCandidates)
        let rows;
        if (options.source) {
            rows = this._stmtGetBySource.all(options.source);
        } else {
            rows = this._stmtGetRecent.all(maxCandidates);
        }

        return this._topK(queryVec, rows, limit);
    }

    /**
     * Get recent vectors (for consolidation/dedup)
     * @param {number} limit
     * @returns {object[]}
     */
    getRecent(limit = 50) {
        return this._stmtGetRecent.all(limit);
    }

    /**
     * Delete by id
     */
    async delete(id) {
        this._stmtDelete.run(id);
    }

    /**
     * Get store statistics
     */
    getStats() {
        const count = this._stmtCount.get().count;
        const result = {
            totalVectors: count,
            dbPath: this._dbPath,
        };

        // v11.5: Extended stats
        try {
            if (count > 0) {
                const oldest = this._db.prepare('SELECT MIN(created_at) as oldest FROM vectors').get();
                const newest = this._db.prepare('SELECT MAX(created_at) as newest FROM vectors').get();
                const sourceDist = this._db.prepare('SELECT source, COUNT(*) as cnt FROM vectors GROUP BY source ORDER BY cnt DESC LIMIT 10').all();
                result.oldest = oldest?.oldest || null;
                result.newest = newest?.newest || null;
                result.sourceDistribution = sourceDist.reduce((acc, r) => { acc[r.source || '(none)'] = r.cnt; return acc; }, {});
            }
        } catch (e) {
            // Extended stats are optional
        }

        return result;
    }

    /**
     * Reclaim disk space after deletions
     */
    vacuum() {
        if (this._db) {
            try { this._db.exec('VACUUM'); } catch (e) {
                console.warn('[VectorStore] VACUUM failed:', e.message);
            }
        }
    }

    /**
     * Close the database
     */
    close() {
        if (this._db) {
            this._db.close();
            this._db = null;
        }
    }

    // --- Internal ---

    _topK(queryVec, rows, k) {
        const scored = [];
        for (const row of rows) {
            const buf = row.embedding;
            const vec = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
            const score = this._ep.cosineSimilarity(queryVec, vec);
            scored.push({
                id: row.id,
                content: row.content,
                score,
                metadata: JSON.parse(row.metadata || '{}'),
                source: row.source,
                created_at: row.created_at,
            });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, k);
    }
}

module.exports = VectorStore;
