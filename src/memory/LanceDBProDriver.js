const fs = require('fs');
const path = require('path');
const KeyChain = require('../services/KeyChain');
const { CONFIG, KNOWLEDGE_BASE_DIR } = require('../config');

/**
 * 🚀 LanceDB Pro Memory Driver
 * Wraps memory-lancedb-pro for project-golem
 */
class LanceDBProDriver {
    constructor(options = {}) {
        this.baseDir = KNOWLEDGE_BASE_DIR;
        this.namespace = options.namespace || 'lancedb-pro';
        this.dbPath = path.join(this.baseDir, this.namespace);
        this.keyChain = new KeyChain();
        
        this.store = null;
        this.retriever = null;
        this.embedder = null;
    }

    async init() {
        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });

        // Use jiti to load memory-lancedb-pro components from sub-modules
        const { createJiti } = require('jiti');
        const jiti = createJiti(__filename);
        
        const { MemoryStore } = await jiti.import('memory-lancedb-pro/src/store.js');
        const { createRetriever, DEFAULT_RETRIEVAL_CONFIG } = await jiti.import('memory-lancedb-pro/src/retriever.js');
        
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
        this.dbPath = path.join(this.baseDir, this.namespace, `dim_${this.embedder.dimensions}`);
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
            
            return results.map(r => ({
                text: r.entry.text,
                score: r.score,
                metadata: JSON.parse(r.entry.metadata || '{}'),
                timestamp: r.entry.timestamp
            }));
        } catch (e) {
            console.warn("⚠️ [Memory:Pro] Recall error:", e.message);
            return [];
        }
    }

    async memorize(text, metadata = {}) {
        if (!this.store) await this.init();
        try {
            const vector = await this.embedder.embedPassage(text);
            await this.store.store({
                text,
                vector,
                category: metadata.category || "other",
                scope: metadata.scope || "global",
                importance: metadata.importance || 0.5,
                metadata: JSON.stringify(metadata)
            });
            console.log(`🧠 [Memory:Pro] 已紀錄記憶 (${text.substring(0, 20)}...)`);
        } catch (e) {
            console.warn("⚠️ [Memory:Pro] Memorize error:", e.message);
        }
    }

    async clearMemory() {
        if (fs.existsSync(this.dbPath)) {
            try {
                // Close store if possible (though MemoryStore doesn't have close() in its public API yet)
                // We'll just force delete the directory
                fs.rmSync(this.dbPath, { recursive: true, force: true });
                this.store = null;
                this.retriever = null;
                console.log(`🗑️ [Memory:Pro] Memory cleared at ${this.dbPath}`);
            } catch (e) {
                console.warn("⚠️ [Memory:Pro] Clear memory error:", e.message);
            }
        }
    }

    async exportMemory() {
        if (!this.store) return JSON.stringify([]);
        const all = await this.store.list([], undefined, 1000);
        return JSON.stringify(all, null, 2);
    }

    async importMemory(jsonData) {
        try {
            const list = JSON.parse(jsonData);
            if (!Array.isArray(list)) return { success: false, error: "Must be an array" };
            for (const item of list) {
                await this.memorize(item.text, item.metadata || item);
            }
            return { success: true, count: list.length };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
}

module.exports = LanceDBProDriver;
