// src/core/WebResearcher.js
// WebResearcher — Web 搜尋 + RAG 融合研究引擎
// 降級鏈: Gemini googleSearch → brain 合成 → 純 RAG → "無可用搜尋"

class WebResearcher {
    constructor(options = {}) {
        this._cacheSize = options.cacheSize || 50;
        this._cache = new Map(); // LRU cache: normalized query → result
    }

    /**
     * Web search via @google/genai googleSearch grounding
     * @returns {{ query, results: [{title, url, snippet}], synthesis, webSearchQueries, timestamp, fromCache }}
     */
    async search(query) {
        if (!query) return { query: '', results: [], synthesis: '請提供搜尋關鍵字', webSearchQueries: [], timestamp: new Date().toISOString(), fromCache: false };

        // Check cache
        const cached = this._getCached(query);
        if (cached) return { ...cached, fromCache: true };

        try {
            const { GoogleGenAI } = require('@google/genai');
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) throw new Error('GEMINI_API_KEY not set');

            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: `搜尋並總結最新資訊: ${query}`,
                config: { tools: [{ googleSearch: {} }] },
            });

            const parsed = this._parseGroundingResults(response);
            const result = {
                query,
                results: parsed.results,
                synthesis: response.text || parsed.synthesis || '無法取得摘要',
                webSearchQueries: parsed.webSearchQueries,
                timestamp: new Date().toISOString(),
                fromCache: false,
            };

            this._setCache(query, result);
            return result;
        } catch (e) {
            console.warn('[WebResearcher] googleSearch failed:', e.message);
            return { query, results: [], synthesis: '', webSearchQueries: [], timestamp: new Date().toISOString(), fromCache: false, error: e.message };
        }
    }

    /**
     * Brain-based synthesis fallback
     * @returns {{ query, synthesis, sources: ['brain-knowledge'], timestamp }}
     */
    async brainSynthesize(query, brain) {
        if (!brain) return { query, synthesis: '', sources: [], timestamp: new Date().toISOString() };

        try {
            const response = await brain.sendMessage(`搜尋並總結: ${query}`);
            const text = typeof response === 'string' ? response : (response?.text || response?.content || '');
            return {
                query,
                synthesis: text,
                sources: ['brain-knowledge'],
                timestamp: new Date().toISOString(),
            };
        } catch (e) {
            console.warn('[WebResearcher] brainSynthesize failed:', e.message);
            return { query, synthesis: '', sources: [], timestamp: new Date().toISOString(), error: e.message };
        }
    }

    /**
     * Research fusion: web search + RAG query → merged synthesis
     * @param {string} query
     * @param {{ brain?, ragSkill? }} options
     * @returns {{ query, web, rag, fused_synthesis, sources, timestamp }}
     */
    async researchFusion(query, options = {}) {
        const { brain, ragSkill } = options;
        const timestamp = new Date().toISOString();

        // Step 1: Web search (primary)
        let web = await this.search(query);

        // Step 2: If web failed, try brain synthesis
        if (!web.synthesis && brain) {
            const brainResult = await this.brainSynthesize(query, brain);
            if (brainResult.synthesis) {
                web = { ...web, synthesis: brainResult.synthesis, sources: ['brain-fallback'] };
            }
        }

        // Step 3: RAG query
        let rag = null;
        if (ragSkill) {
            try {
                const ragResult = await ragSkill.execute({ task: 'query', query, limit: 10 });
                rag = { raw: ragResult, timestamp };
            } catch (e) {
                console.warn('[WebResearcher] RAG query failed:', e.message);
            }
        }

        // Step 4: Fuse results
        const sources = [];
        const parts = [];

        if (web.synthesis) {
            parts.push(`【Web 搜尋】\n${web.synthesis}`);
            sources.push(...(web.results || []).map(r => r.url).filter(Boolean));
            sources.push(...(web.sources || []));
        }

        if (rag && rag.raw) {
            const ragText = typeof rag.raw === 'string' ? rag.raw : JSON.stringify(rag.raw);
            parts.push(`【RAG 知識庫】\n${ragText.substring(0, 2000)}`);
            sources.push('rag-knowledge');
        }

        const fused_synthesis = parts.length > 0
            ? parts.join('\n\n')
            : '無可用搜尋結果。Web 搜尋和 RAG 均未返回有效資訊。';

        // Deduplicate sources
        const uniqueSources = [...new Set(sources)];

        return { query, web, rag, fused_synthesis, sources: uniqueSources, timestamp };
    }

    /**
     * Parse grounding metadata from Gemini response
     */
    _parseGroundingResults(response) {
        const results = [];
        const webSearchQueries = [];
        let synthesis = '';

        try {
            const candidate = response?.candidates?.[0];
            const metadata = candidate?.groundingMetadata;

            if (metadata) {
                // Extract search queries
                if (metadata.webSearchQueries) {
                    webSearchQueries.push(...metadata.webSearchQueries);
                }

                // Extract grounding chunks (sources)
                if (metadata.groundingChunks) {
                    for (const chunk of metadata.groundingChunks) {
                        if (chunk.web) {
                            results.push({
                                title: chunk.web.title || '',
                                url: chunk.web.uri || '',
                                snippet: '',
                            });
                        }
                    }
                }
            }

            synthesis = response?.text || '';
        } catch (e) {
            console.warn('[WebResearcher] _parseGroundingResults error:', e.message);
        }

        return { results, webSearchQueries, synthesis };
    }

    /**
     * LRU cache lookup (normalized key)
     */
    _getCached(query) {
        const key = query.trim().toLowerCase();
        if (this._cache.has(key)) {
            const entry = this._cache.get(key);
            // Move to end (most recent)
            this._cache.delete(key);
            this._cache.set(key, entry);
            return entry;
        }
        return null;
    }

    /**
     * LRU cache insert
     */
    _setCache(query, result) {
        const key = query.trim().toLowerCase();
        if (this._cache.size >= this._cacheSize) {
            // Delete oldest (first entry)
            const firstKey = this._cache.keys().next().value;
            this._cache.delete(firstKey);
        }
        this._cache.set(key, result);
    }
}

module.exports = WebResearcher;
