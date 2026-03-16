// ============================================================
// VectorIndexer — Background vector indexing + deduplication
// v10.5: Periodically indexes episodes, MAGMA nodes, logs, memory files
// ============================================================
const fsp = require('fs').promises;
const path = require('path');

const DEFAULT_INTERVAL = 30000; // 30s
const DEDUP_THRESHOLD = 0.95;

class VectorIndexer {
    constructor(vectorStore, ragProvider, options = {}) {
        this._vectorStore = vectorStore;
        this._ragProvider = ragProvider;
        this._interval = options.interval || DEFAULT_INTERVAL;
        this._timer = null;
        this._running = false;
        this._stats = { indexed: 0, deduplicated: 0, errors: 0, lastRun: null };
    }

    /**
     * Start background indexing timer
     */
    start() {
        console.log('[VectorIndexer] Ready (indexing triggered by sleep consolidation)');
    }

    /**
     * Stop background indexing
     */
    async stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        // Wait for any in-progress cycle to complete
        while (this._running) {
            await new Promise(r => setTimeout(r, 100));
        }
        console.log('[VectorIndexer] Stopped');
    }

    /**
     * Index episodic memory entries
     */
    async indexEpisodes(threeLayerMemory) {
        if (!threeLayerMemory || !this._vectorStore) return 0;
        try {
            const episodes = threeLayerMemory._episodes || [];
            const items = episodes
                .filter(ep => ep.situation && ep.situation.length > 10)
                .map(ep => ({
                    id: ep.id,
                    content: `${ep.situation} | ${ep.outcome || ''}`,
                    metadata: { type: 'episode', source: 'three_layer', reward: ep.reward },
                }));

            if (items.length > 0) {
                await this._vectorStore.upsertBatch(items);
                this._stats.indexed += items.length;
            }
            return items.length;
        } catch (e) {
            this._stats.errors++;
            console.warn('[VectorIndexer] indexEpisodes error:', e.message);
            return 0;
        }
    }

    /**
     * Index MAGMA graph nodes
     */
    async indexMAGMANodes(magma) {
        if (!magma || !this._vectorStore) return 0;
        try {
            const data = magma._data || { nodes: [] };
            const items = data.nodes
                .filter(n => n.name || n.content)
                .map(n => ({
                    id: n.id,
                    content: n.content || n.name || n.id,
                    metadata: { type: 'magma_node', source: 'magma', nodeType: n.type },
                }));

            if (items.length > 0) {
                await this._vectorStore.upsertBatch(items);
                this._stats.indexed += items.length;
            }
            return items.length;
        } catch (e) {
            this._stats.errors++;
            console.warn('[VectorIndexer] indexMAGMANodes error:', e.message);
            return 0;
        }
    }

    /**
     * Index conversation log files
     */
    async indexConversationLogs(logDir) {
        if (!logDir || !this._vectorStore) return 0;
        try {
            let allFiles;
            try { allFiles = await fsp.readdir(logDir); } catch { return 0; }
            const files = allFiles.filter(f => f.endsWith('.log') || f.endsWith('.jsonl'));
            let count = 0;

            for (const file of files.slice(-10)) { // Only recent 10 files
                const filePath = path.join(logDir, file);
                try {
                    const content = await fsp.readFile(filePath, 'utf-8');
                    const lines = content.split('\n').filter(l => l.trim());
                    const summary = lines.slice(-5).join(' ').substring(0, 500);
                    if (summary.length > 20) {
                        await this._vectorStore.upsert(
                            `log_${file}`,
                            summary,
                            { type: 'conversation_log', source: 'logs', file }
                        );
                        count++;
                    }
                } catch (e) { /* skip individual file errors */ }
            }
            this._stats.indexed += count;
            return count;
        } catch (e) {
            this._stats.errors++;
            return 0;
        }
    }

    /**
     * Index memory .md files
     */
    async indexMemoryFiles(memoryDir) {
        if (!memoryDir || !this._vectorStore) return 0;
        try {
            let allFiles;
            try { allFiles = await fsp.readdir(memoryDir); } catch { return 0; }
            const files = allFiles.filter(f => f.endsWith('.md'));
            let count = 0;

            for (const file of files) {
                const filePath = path.join(memoryDir, file);
                try {
                    const content = (await fsp.readFile(filePath, 'utf-8')).substring(0, 1000);
                    if (content.length > 20) {
                        await this._vectorStore.upsert(
                            `mem_${file}`,
                            content,
                            { type: 'memory_file', source: 'memory', file }
                        );
                        count++;
                    }
                } catch (e) { /* skip */ }
            }
            this._stats.indexed += count;
            return count;
        } catch (e) {
            this._stats.errors++;
            return 0;
        }
    }

    /**
     * Consolidate: deduplicate vectors with cosine > threshold
     */
    async consolidate() {
        if (!this._vectorStore || !this._vectorStore._ep) return 0;
        try {
            const recent = this._vectorStore.getRecent(50);
            if (recent.length < 10) return 0;

            const toDelete = new Set();
            const ep = this._vectorStore._ep;
            for (let i = 0; i < recent.length; i++) {
                if (toDelete.has(recent[i].id)) continue;
                const vecA = new Float32Array(
                    recent[i].embedding.buffer,
                    recent[i].embedding.byteOffset,
                    recent[i].embedding.byteLength / 4
                );

                for (let j = 0; j < i; j++) {
                    if (toDelete.has(recent[j].id)) continue;
                    const vecB = new Float32Array(
                        recent[j].embedding.buffer,
                        recent[j].embedding.byteOffset,
                        recent[j].embedding.byteLength / 4
                    );

                    const sim = ep.cosineSimilarity(vecA, vecB);
                    if (sim > DEDUP_THRESHOLD) {
                        // Delete the shorter content
                        const deleteId = recent[i].content.length < recent[j].content.length
                            ? recent[i].id : recent[j].id;
                        toDelete.add(deleteId);
                    }
                }
            }

            for (const id of toDelete) {
                await this._vectorStore.delete(id);
            }

            this._stats.deduplicated += toDelete.size;
            if (toDelete.size > 0) {
                console.log(`[VectorIndexer] Consolidated: ${toDelete.size} duplicates removed`);
                if (this._vectorStore.vacuum) this._vectorStore.vacuum();
            }
            return toDelete.size;
        } catch (e) {
            this._stats.errors++;
            console.warn('[VectorIndexer] consolidate error:', e.message);
            return 0;
        }
    }

    getStats() {
        return { ...this._stats };
    }

    // --- Internal ---
}

module.exports = VectorIndexer;
