// ============================================================
// RAGProvider — Unified vector + Graph + Remote search with RRF fusion
// v10.5: Brain-layer middleware for augmented recall
// ============================================================

const { v4: uuidv4 } = require('uuid');

class RAGProvider {
    constructor({ vectorStore, magma, remoteRAGUrl, circuitBreaker } = {}) {
        this._vectorStore = vectorStore || null;
        this._magma = magma || null;
        this._remoteRAGUrl = remoteRAGUrl || null;
        this._circuitBreaker = circuitBreaker || null;
        this._initialized = false;
        this._readyPromise = null;   // Set by BrainFactory during async init
        this._initFailed = false;    // Set by BrainFactory if init fails
    }

    async init() {
        // Load remote RAG URL from config if not provided
        if (!this._remoteRAGUrl) {
            try {
                const { getConfig } = require('../config/xml-config-loader');
                const cfg = getConfig();
                const ragCfg = cfg.getRagConfig();
                this._remoteRAGUrl = ragCfg.url;
            } catch (e) { /* optional */ }
        }

        // Load circuit breaker if not provided
        if (!this._circuitBreaker) {
            try {
                this._circuitBreaker = require('../core/circuit_breaker');
            } catch (e) { /* optional */ }
        }

        this._initialized = true;
        console.log(`[RAGProvider] Initialized (vector:${!!this._vectorStore} graph:${!!this._magma} remote:${!!this._remoteRAGUrl})`);
    }

    /**
     * Three-way query + RRF fusion
     * @param {string} query
     * @param {{limit?: number}} options
     * @returns {Promise<{vectorResults: object[], graphResults: object[], remoteResults: object[], merged: object[], contextString: string}>}
     */
    async augmentedRecall(query, options = {}) {
        // Wait for init to complete (race condition guard)
        if (this._readyPromise) await this._readyPromise;
        if (this._initFailed) {
            return { vectorResults: [], graphResults: [], remoteResults: [], merged: [], contextString: '' };
        }

        const limit = options.limit || 5;

        // Run three searches in parallel with global timeout
        let timeoutId;
        const timeout = new Promise((_, rej) => {
            timeoutId = setTimeout(() => rej(new Error('RAG timeout')), 15000);
        });
        let vectorResults, graphResults, remoteResults;
        try {
            [vectorResults, graphResults, remoteResults] = await Promise.race([
                Promise.all([
                    this._vectorSearch(query, limit),
                    this._graphSearch(query, limit),
                    this._remoteSearch(query, limit),
                ]),
                timeout,
            ]);
        } catch (e) {
            console.warn('[RAGProvider] augmentedRecall failed:', e.message);
            return { vectorResults: [], graphResults: [], remoteResults: [], merged: [], contextString: '' };
        } finally {
            clearTimeout(timeoutId);
        }

        // RRF merge
        const merged = this._mergeRRF([vectorResults, graphResults, remoteResults], 60);
        const topMerged = merged.slice(0, limit);
        const contextString = this._formatForContext(topMerged);

        return {
            vectorResults,
            graphResults,
            remoteResults,
            merged: topMerged,
            contextString,
        };
    }

    /**
     * Ingest content into both vector store and graph
     * @param {string} content
     * @param {object} metadata
     */
    async ingest(content, metadata = {}) {
        if (!content) return;
        // Wait for init to complete
        if (this._readyPromise) await this._readyPromise;
        if (this._initFailed) return;

        const id = metadata.id || `rag_${uuidv4()}`;

        // Write to vector store
        if (this._vectorStore) {
            try {
                await this._vectorStore.upsert(id, content, metadata);
            } catch (e) {
                console.warn('[RAGProvider] Vector ingest failed:', e.message);
            }
        }

        // Write to MAGMA graph
        if (this._magma) {
            try {
                this._magma.addNode(id, {
                    type: metadata.type || 'rag_memory',
                    name: content.substring(0, 100),
                    content: content.substring(0, 500),
                    source: metadata.source || 'rag_ingest',
                    created_at: new Date().toISOString(),
                });
            } catch (e) {
                console.warn('[RAGProvider] Graph ingest failed:', e.message);
            }
        }
    }

    // --- Internal search methods ---

    async _vectorSearch(query, limit) {
        if (!this._vectorStore) return [];
        try {
            const results = await this._vectorStore.search(query, { limit });
            return results.map(r => ({
                id: r.id,
                content: r.content,
                score: r.score,
                source: 'vector',
                metadata: r.metadata,
            }));
        } catch (e) {
            console.warn('[RAGProvider] Vector search failed:', e.message);
            return [];
        }
    }

    async _graphSearch(query, limit) {
        if (!this._magma) return [];
        try {
            const result = this._magma.query ? this._magma.query(query) : { nodes: [] };
            const nodes = (result.nodes || result || []).slice(0, limit);
            return nodes.map((n, i) => ({
                id: n.id || `graph_${i}`,
                content: n.content || n.name || n.id || '',
                score: n._relevanceScore || 0.5,
                source: 'graph',
                metadata: { type: n.type },
            }));
        } catch (e) {
            console.warn('[RAGProvider] Graph search failed:', e.message);
            return [];
        }
    }

    async _remoteSearch(query, limit) {
        if (!this._remoteRAGUrl) return [];
        try {
            const { getToken } = require('../utils/yedan-auth');
            const token = getToken();
            if (!token) return [];

            const execFn = async () => {
                const res = await fetch(`${this._remoteRAGUrl}/query`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({ query, max_hops: 1, limit }),
                    signal: AbortSignal.timeout(8000),
                });
                if (!res.ok) return [];
                const data = await res.json();
                const entities = data.entities || data.results || [];
                return entities.slice(0, limit).map((e, i) => ({
                    id: e.id || `remote_${i}`,
                    content: e.name || e.content || '',
                    score: e.relevance || 0.5,
                    source: 'remote',
                    metadata: e.properties || {},
                }));
            };

            if (this._circuitBreaker) {
                return await this._circuitBreaker.execute('rag', execFn);
            }
            return await execFn();
        } catch (e) {
            console.warn('[RAGProvider] Remote search failed:', e.message);
            return [];
        }
    }

    /**
     * Reciprocal Rank Fusion
     * score(item) = Σ 1/(k + rank_i) for each source where item appears
     * @param {object[][]} sources - Array of result arrays, each sorted by relevance
     * @param {number} k - RRF constant (default 60)
     * @returns {object[]} Merged results sorted by RRF score
     */
    _mergeRRF(sources, k = 60) {
        const scoreMap = new Map(); // id -> { item, rrfScore }

        for (const results of sources) {
            for (let rank = 0; rank < results.length; rank++) {
                const item = results[rank];
                const rrfContrib = 1 / (k + rank + 1); // rank is 0-based, formula uses 1-based

                if (scoreMap.has(item.id)) {
                    const existing = scoreMap.get(item.id);
                    existing.rrfScore += rrfContrib;
                    // Keep the item with more content
                    if (item.content.length > existing.item.content.length) {
                        existing.item = item;
                    }
                } else {
                    scoreMap.set(item.id, { item, rrfScore: rrfContrib });
                }
            }
        }

        return Array.from(scoreMap.values())
            .sort((a, b) => b.rrfScore - a.rrfScore)
            .map(({ item, rrfScore }) => ({ ...item, rrfScore }));
    }

    /**
     * v12.0: Search by source metadata filter
     * @param {string} query
     * @param {string} source - Source filter (e.g., 'security-audit', 'worker-health', 'error-patterns')
     * @param {{limit?: number}} options
     * @returns {Promise<object[]>}
     */
    async searchBySource(query, source, options = {}) {
        if (this._readyPromise) await this._readyPromise;
        if (this._initFailed) return [];

        const limit = options.limit || 5;

        // Vector search then filter by source metadata
        const vectorResults = await this._vectorSearch(query, limit * 3); // Over-fetch for filtering
        const filtered = vectorResults.filter(r =>
            r.metadata && (r.metadata.source === source || r.metadata.type === source)
        ).slice(0, limit);

        // If not enough results from vector, also check graph
        if (filtered.length < limit && this._magma) {
            const graphResults = await this._graphSearch(query, limit);
            for (const gr of graphResults) {
                if (gr.metadata && (gr.metadata.type === source) && filtered.length < limit) {
                    filtered.push(gr);
                }
            }
        }

        return filtered;
    }

    /**
     * Format merged results into a context string for LLM consumption
     */
    _formatForContext(merged) {
        if (!merged || merged.length === 0) return '';
        return merged.map((r, i) =>
            `[${i + 1}] (${r.source}, score: ${(r.rrfScore || r.score || 0).toFixed(3)}) ${r.content}`
        ).join('\n');
    }
}

module.exports = RAGProvider;
