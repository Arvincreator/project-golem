const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const KeyChain = require('../../src/services/KeyChain');
const OllamaClient = require('../../src/services/OllamaClient');
const { CONFIG, KNOWLEDGE_BASE_DIR } = require('../../src/config');

// ✨ 快取 Jiti 實例，避免重複初始化開銷
let cachedJiti = null;

/**
 * 🚀 LanceDB Pro Memory Driver
 * Wraps memory-lancedb-pro for project-golem
 */
class LanceDBProDriver {
    constructor() {
        this.baseDir = KNOWLEDGE_BASE_DIR;
        this.dbPath = path.join(this.baseDir, 'lancedb-pro');
        this.keyChain = new KeyChain();
        
        this.store = null;
        this.retriever = null;
        this.embedder = null;
        this.ollamaClient = null;
        this.statePath = path.join(this.baseDir, 'lancedb-pro', 'memory-state.json');
        this.state = { hiddenIds: [], deletedIds: [] };
    }

    async init() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = this._doInit().catch(e => {
            this._initPromise = null;
            throw e;
        });
        return this._initPromise;
    }

    async _doInit() {
        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
        this._loadState();

        // Use jiti to load memory-lancedb-pro components from sub-modules
        if (!cachedJiti) {
            const { createJiti } = require('jiti');
            cachedJiti = createJiti(__filename);
        }
        
        const { MemoryStore } = await cachedJiti.import('memory-lancedb-pro/src/store.js');
        const { createRetriever, DEFAULT_RETRIEVAL_CONFIG } = await cachedJiti.import('memory-lancedb-pro/src/retriever.js');
        
        // 1. Setup Embedder Wrapper
        const projectEmbedder = await this._getProjectEmbedder();
        this.embedder = {
            embedQuery: async (text) => projectEmbedder.getEmbedding(text),
            embedPassage: async (text) => projectEmbedder.getEmbedding(text),
            dimensions: projectEmbedder.dimensions || 768
        };

        // Determine dimensions dynamically
        const testEmbedding = await this.embedder.embedQuery("test");
        this.embedder.dimensions = testEmbedding.length;
        
        // 🚀 Set isolated DB Path based on dimensions to avoid mismatch errors
        this.dbPath = path.join(this.baseDir, 'lancedb-pro', `dim_${this.embedder.dimensions}`);
        if (!fs.existsSync(this.dbPath)) fs.mkdirSync(this.dbPath, { recursive: true });
        
        console.log(`🧠 [Memory:Pro] Using embedding dimensions: ${this.embedder.dimensions}`);
        console.log(`📂 [Memory:Pro] Database isolated at: ${this.dbPath}`);

        // 2. Initialize Store
        this.store = new MemoryStore({
            dbPath: this.dbPath,
            vectorDim: this.embedder.dimensions
        });

        // 3. Initialize Retriever
        this.retriever = createRetriever(this.store, this.embedder, {
            ...DEFAULT_RETRIEVAL_CONFIG,
            mode: "hybrid",
        });

        console.log(`✅ [Memory:Pro] LanceDB Pro Driver 就緒`);
    }

    async _getProjectEmbedder() {
        const { EmbeddingFactory } = require('./embeddings');
        return EmbeddingFactory.create(this.keyChain);
    }

    async recall(query, limit = 5) {
        if (!this.retriever) await this.init();
        try {
            const results = await this.retriever.retrieve({
                query,
                limit,
                source: "manual"
            });

            const normalized = results.map(r => ({
                text: r.entry.text,
                score: r.score,
                metadata: this._safeParseMetadata(r.entry.metadata),
                timestamp: r.entry.timestamp
            }));
            const withVisibility = await this._applyVisibilityAndCanonicalize(normalized);
            const visible = withVisibility.filter((item) => item.visible !== false);
            const reranked = await this._maybeRerank(query, visible, limit);
            return reranked.slice(0, limit);
        } catch (e) {
            console.warn("⚠️ [Memory:Pro] Recall error:", e.message);
            return [];
        }
    }

    async memorize(text, metadata = {}) {
        if (!this.store) await this.init();
        try {
            const normalizedMetadata = this._normalizeMetadata(metadata);
            const vector = await this.embedder.embedPassage(text);
            await this.store.store({
                text,
                vector,
                category: normalizedMetadata.category || "other",
                scope: normalizedMetadata.scope || "global",
                importance: normalizedMetadata.importance || 0.5,
                metadata: JSON.stringify(normalizedMetadata)
            });
            console.log(`🧠 [Memory:Pro] 已紀錄記憶 (${text.substring(0, 20)}...)`);
        } catch (e) {
            console.warn("⚠️ [Memory:Pro] Memorize error:", e.message);
        }
    }

    async clearMemory() {
        const rootDir = path.join(this.baseDir, 'lancedb-pro');
        let removedEntries = 0;
        let removedBytes = 0;

        try {
            if (fs.existsSync(rootDir)) {
                const stack = [rootDir];
                while (stack.length > 0) {
                    const current = stack.pop();
                    const stat = fs.statSync(current);
                    if (stat.isDirectory()) {
                        const children = fs.readdirSync(current).map((name) => path.join(current, name));
                        stack.push(...children);
                    } else {
                        removedEntries += 1;
                        removedBytes += Number(stat.size || 0);
                    }
                }
                fs.rmSync(rootDir, { recursive: true, force: true });
                removedEntries += 1; // root dir itself
            }

            this.store = null;
            this.retriever = null;
            this.embedder = null;
            this._initPromise = null;
            this.state = { hiddenIds: [], deletedIds: [] };

            console.log(`🗑️ [Memory:Pro] Memory cleared at ${rootDir} (entries=${removedEntries}, bytes=${removedBytes})`);
            return { cleared: removedEntries, bytes: removedBytes };
        } catch (e) {
            console.warn("⚠️ [Memory:Pro] Clear memory error:", e.message);
            return { cleared: removedEntries, bytes: removedBytes, error: e.message };
        }
    }

    async exportMemory() {
        if (!this.store) return JSON.stringify([]);
        const all = await this.listMemories({ includeHidden: true, includeDeleted: false, limit: 5000 });
        return JSON.stringify(all, null, 2);
    }

    async importMemory(jsonData) {
        try {
            const list = JSON.parse(jsonData);
            if (!Array.isArray(list)) return { success: false, error: "Must be an array" };
            for (const item of list) {
                const sourceMetadata = item.metadata || item;
                const normalized = this._normalizeMetadata(sourceMetadata);
                if (item.id && !normalized.id) normalized.id = String(item.id);
                if (item.visible === false) normalized.visible = false;
                await this.memorize(item.text, normalized);
            }
            return { success: true, count: list.length };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async listMemories(options = {}) {
        if (!this.store) await this.init();
        const includeHidden = options.includeHidden === true;
        const includeDeleted = options.includeDeleted === true;
        const q = String(options.q || '').trim().toLowerCase();
        const type = String(options.type || '').trim().toLowerCase();
        const source = String(options.source || '').trim().toLowerCase();
        const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 200;
        const offset = Number.isFinite(Number(options.offset)) ? Number(options.offset) : 0;
        const allRows = await this.store.list([], undefined, 10000);
        const canonicalMap = new Map();

        for (const row of allRows) {
            const metadata = this._normalizeMetadata(
                this._safeParseMetadata(row.metadata),
                row.timestamp,
                { text: row.text, timestamp: row.timestamp }
            );
            const id = metadata.id;
            const next = {
                id,
                text: row.text,
                score: row.score,
                metadata,
                visible: metadata.visible !== false && !this._isHiddenOrDeleted(id),
                createdAt: metadata.createdAt || row.timestamp || null,
                updatedAt: metadata.updatedAt || row.timestamp || null,
                timestamp: row.timestamp || metadata.updatedAt || metadata.createdAt || null
            };
            const prev = canonicalMap.get(id);
            if (!prev || this._toTime(next.updatedAt) >= this._toTime(prev.updatedAt)) {
                canonicalMap.set(id, next);
            }
        }

        let list = Array.from(canonicalMap.values()).map((item) => ({
            ...item,
            metadata: { ...item.metadata, visible: item.visible }
        }));

        if (!includeDeleted) list = list.filter((item) => !this._isDeleted(item.id));
        if (!includeHidden) list = list.filter((item) => item.visible !== false);
        if (q) list = list.filter((item) => `${item.text}\n${JSON.stringify(item.metadata || {})}`.toLowerCase().includes(q));
        if (type) list = list.filter((item) => String(item.metadata?.type || '').toLowerCase() === type);
        if (source) list = list.filter((item) => String(item.metadata?.source || '').toLowerCase() === source);

        list.sort((a, b) => this._toTime(b.updatedAt || b.createdAt) - this._toTime(a.updatedAt || a.createdAt));
        return list.slice(offset, offset + Math.max(1, Math.min(limit, 5000)));
    }

    async updateMemory(id, patch = {}) {
        const targetId = String(id || '').trim();
        if (!targetId) return { success: false, error: 'id is required' };
        const list = await this.listMemories({ includeHidden: true, includeDeleted: false, limit: 10000 });
        const current = list.find((item) => item.id === targetId);
        if (!current) return { success: false, error: 'Memory not found' };
        if (this._isDeleted(targetId)) return { success: false, error: 'Memory already deleted' };
        const nextVisible = patch.visible === undefined ? current.visible !== false : patch.visible !== false;
        const nextText = typeof patch.text === 'string' ? patch.text : current.text;
        const nextMetadata = {
            ...current.metadata,
            ...(patch.metadata && typeof patch.metadata === 'object' ? patch.metadata : {}),
            id: targetId,
            visible: nextVisible,
            createdAt: current.createdAt || current.metadata.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this._setHidden(targetId, !nextVisible);
        await this.memorize(nextText, nextMetadata);
        return { success: true };
    }

    async deleteMemory(id) {
        const targetId = String(id || '').trim();
        if (!targetId) return { success: false, error: 'id is required' };
        this._setDeleted(targetId, true);
        this._setHidden(targetId, true);
        return { success: true };
    }

    _safeParseMetadata(raw) {
        if (!raw) return {};
        if (typeof raw === 'object') return raw;
        try {
            return JSON.parse(raw);
        } catch (e) {
            return {};
        }
    }

    _normalizeMetadata(metadata = {}, fallbackTimestamp = null, hints = {}) {
        const raw = (metadata && typeof metadata === 'object') ? metadata : {};
        const nowIso = new Date().toISOString();
        const createdAt = raw.createdAt || fallbackTimestamp || nowIso;
        const stableId = this._buildStableId(raw, hints, fallbackTimestamp);
        return {
            ...raw,
            id: String(raw.id || stableId || randomUUID()),
            type: typeof raw.type === 'string' && raw.type.trim() ? raw.type : 'general',
            source: typeof raw.source === 'string' && raw.source.trim() ? raw.source : 'memory',
            visible: raw.visible !== false,
            createdAt,
            updatedAt: raw.updatedAt || nowIso
        };
    }

    async _applyVisibilityAndCanonicalize(items) {
        const canonicalList = await this.listMemories({ includeHidden: true, includeDeleted: false, limit: 10000 });
        const canonicalMap = new Map(canonicalList.map((item) => [item.id, item]));
        const resolved = [];
        const seen = new Set();

        for (const item of items) {
            const metadata = this._normalizeMetadata(item.metadata, item.timestamp, { text: item.text, timestamp: item.timestamp });
            const canonical = canonicalMap.get(metadata.id);
            const merged = canonical || {
                id: metadata.id,
                text: item.text,
                score: item.score,
                metadata,
                visible: metadata.visible !== false && !this._isHiddenOrDeleted(metadata.id),
                createdAt: metadata.createdAt,
                updatedAt: metadata.updatedAt,
                timestamp: item.timestamp || metadata.updatedAt
            };
            if (seen.has(merged.id)) continue;
            seen.add(merged.id);
            resolved.push(merged);
        }
        return resolved;
    }

    _toTime(value) {
        if (!value) return 0;
        const n = Date.parse(value);
        return Number.isFinite(n) ? n : 0;
    }

    _buildStableId(raw = {}, hints = {}, fallbackTimestamp = null) {
        const text = String(hints.text || '').trim();
        const createdAt = String(raw.createdAt || hints.timestamp || fallbackTimestamp || '').trim();
        const type = String(raw.type || '').trim();
        const source = String(raw.source || '').trim();
        if (!text && !createdAt) return '';
        const seed = `${createdAt}|${type}|${source}|${text}`;
        return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 24);
    }

    _loadState() {
        try {
            const parent = path.dirname(this.statePath);
            if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
            if (!fs.existsSync(this.statePath)) {
                this._saveState();
                return;
            }
            const raw = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
            this.state = {
                hiddenIds: Array.isArray(raw.hiddenIds) ? raw.hiddenIds.map(String) : [],
                deletedIds: Array.isArray(raw.deletedIds) ? raw.deletedIds.map(String) : []
            };
        } catch (_) {
            this.state = { hiddenIds: [], deletedIds: [] };
        }
    }

    _saveState() {
        try {
            const parent = path.dirname(this.statePath);
            if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
            fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf8');
        } catch (_) { }
    }

    _isHiddenOrDeleted(id) {
        return this._isHidden(id) || this._isDeleted(id);
    }

    _isHidden(id) {
        return this.state.hiddenIds.includes(String(id));
    }

    _isDeleted(id) {
        return this.state.deletedIds.includes(String(id));
    }

    _setHidden(id, hidden) {
        const key = String(id);
        this.state.hiddenIds = this.state.hiddenIds.filter((x) => x !== key);
        if (hidden) this.state.hiddenIds.push(key);
        this._saveState();
    }

    _setDeleted(id, deleted) {
        const key = String(id);
        this.state.deletedIds = this.state.deletedIds.filter((x) => x !== key);
        if (deleted) this.state.deletedIds.push(key);
        this._saveState();
    }

    _getOllamaClient() {
        if (!this.ollamaClient) {
            this.ollamaClient = new OllamaClient({
                baseUrl: CONFIG.OLLAMA_BASE_URL,
                timeoutMs: CONFIG.OLLAMA_TIMEOUT_MS
            });
        }
        return this.ollamaClient;
    }

    async _maybeRerank(query, results, limit) {
        const rerankModel = String(CONFIG.OLLAMA_RERANK_MODEL || '').trim();
        if (!rerankModel || results.length === 0) return results.slice(0, limit);

        try {
            const reranked = await this._getOllamaClient().rerank(query, results.map(item => item.text), {
                model: rerankModel,
                embeddingFallbackModel: CONFIG.OLLAMA_EMBEDDING_MODEL
            });

            if (!Array.isArray(reranked) || reranked.length === 0) {
                return results.slice(0, limit);
            }

            const ordered = [];
            const seen = new Set();

            for (const item of reranked) {
                if (!Number.isInteger(item.index)) continue;
                if (item.index < 0 || item.index >= results.length) continue;
                if (seen.has(item.index)) continue;
                seen.add(item.index);
                ordered.push({
                    ...results[item.index],
                    score: Number(item.score) || results[item.index].score
                });
            }

            for (let i = 0; i < results.length; i += 1) {
                if (!seen.has(i)) ordered.push(results[i]);
            }

            return ordered.slice(0, limit);
        } catch (e) {
            console.warn(`⚠️ [Memory:Pro] Ollama rerank failed, fallback to original ranking: ${e.message}`);
            return results.slice(0, limit);
        }
    }
}

module.exports = LanceDBProDriver;
