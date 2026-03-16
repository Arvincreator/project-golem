// ============================================================
// EmbeddingProvider — Gemini text-embedding-004 + Ollama fallback
// v10.5: Vector RAG foundation
// ============================================================
const crypto = require('crypto');

const DEFAULT_MODEL = 'text-embedding-004';
const DEFAULT_CACHE_SIZE = 100;
const DEFAULT_BATCH_SIZE = 20;
const EMBEDDING_DIM = 768;

class EmbeddingProvider {
    constructor(options = {}) {
        this._apiKeys = options.apiKeys || [];
        this._model = options.model || DEFAULT_MODEL;
        this._fallbackOllama = options.fallbackOllama || 'nomic-embed-text';
        this._ollamaUrl = options.ollamaUrl || 'http://localhost:11434';
        this._cacheSize = options.cacheSize || DEFAULT_CACHE_SIZE;
        this._batchSize = options.batchSize || DEFAULT_BATCH_SIZE;

        this._client = null;
        this._keyIndex = 0;
        this._cache = new Map(); // LRU: Map preserves insertion order
        this._circuitBreaker = null;
    }

    async init() {
        // Load API keys from env if not provided
        if (this._apiKeys.length === 0) {
            try {
                const ConfigManager = require('../config');
                this._apiKeys = (ConfigManager.CONFIG.API_KEYS || []).filter(k => k && k.length > 10);
            } catch (e) { /* optional */ }
        }

        // Initialize circuit breaker
        try {
            this._circuitBreaker = require('../core/circuit_breaker');
        } catch (e) { /* optional */ }

        // Initialize Gemini client
        if (this._apiKeys.length > 0) {
            try {
                const { GoogleGenAI } = require('@google/genai');
                this._client = new GoogleGenAI({ apiKey: this._apiKeys[this._keyIndex % this._apiKeys.length] });
                console.log(`[EmbeddingProvider] Initialized with ${this._apiKeys.length} API keys, model: ${this._model}`);
            } catch (e) {
                console.warn('[EmbeddingProvider] @google/genai init failed:', e.message);
            }
        }

        if (!this._client) {
            console.warn('[EmbeddingProvider] No Gemini client, will use Ollama fallback');
        }
    }

    /**
     * Embed a single text string
     * @param {string} text
     * @returns {Promise<Float32Array>} 768-dim vector
     */
    async embed(text) {
        if (!text || typeof text !== 'string') {
            return new Float32Array(EMBEDDING_DIM);
        }

        // Check cache
        const hash = this._hash(text);
        if (this._cache.has(hash)) {
            // Move to end of LRU (Map re-insert = move to end)
            const value = this._cache.get(hash);
            this._cache.delete(hash);
            this._cache.set(hash, value);
            return value;
        }

        let vector;
        const execFn = async () => {
            // Try Gemini first
            if (this._client) {
                try {
                    return await this._embedGemini(text);
                } catch (e) {
                    // Rotate key on rate limit
                    if (e.message && (e.message.includes('429') || e.message.includes('RESOURCE_EXHAUSTED'))) {
                        this._rotateKey();
                        try { return await this._embedGemini(text); } catch (e2) { console.warn('[EmbeddingProvider] Key rotation retry failed:', e2.message); }
                    }
                    console.warn('[EmbeddingProvider] Gemini embed failed:', e.message);
                }
            }
            // Ollama fallback
            return await this._embedOllama(text);
        };

        if (this._circuitBreaker) {
            try {
                vector = await this._circuitBreaker.execute('embeddings', execFn);
            } catch (e) {
                console.warn('[EmbeddingProvider] Circuit breaker rejected:', e.message);
                return new Float32Array(EMBEDDING_DIM);
            }
        } else {
            vector = await execFn();
        }

        // Cache result
        this._cacheSet(hash, vector);
        return vector;
    }

    /**
     * Embed multiple texts in batches
     * @param {string[]} texts
     * @param {number} batchSize
     * @returns {Promise<Float32Array[]>}
     */
    async embedBatch(texts, batchSize) {
        batchSize = batchSize || this._batchSize;
        const results = [];
        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(t => this.embed(t)));
            results.push(...batchResults);
        }
        return results;
    }

    /**
     * Cosine similarity between two Float32Arrays
     */
    cosineSimilarity(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom === 0 ? 0 : dot / denom;
    }

    // --- Internal ---

    async _embedGemini(text) {
        const result = await this._client.models.embedContent({
            model: this._model,
            contents: text,
        });
        const values = result.embedding?.values || result.embeddings?.[0]?.values;
        if (!values || values.length === 0) {
            throw new Error('Empty embedding response from Gemini');
        }
        return new Float32Array(values);
    }

    async _embedOllama(text) {
        try {
            const res = await fetch(`${this._ollamaUrl}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: this._fallbackOllama, prompt: text }),
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
            const data = await res.json();
            if (data.embedding) return new Float32Array(data.embedding);
            throw new Error('No embedding in Ollama response');
        } catch (e) {
            console.warn('[EmbeddingProvider] Ollama fallback failed:', e.message);
            return new Float32Array(EMBEDDING_DIM);
        }
    }

    _rotateKey() {
        if (this._apiKeys.length <= 1) return;
        this._keyIndex = (this._keyIndex + 1) % this._apiKeys.length;
        try {
            const { GoogleGenAI } = require('@google/genai');
            this._client = new GoogleGenAI({ apiKey: this._apiKeys[this._keyIndex] });
            console.log(`[EmbeddingProvider] Rotated to key ${this._keyIndex}`);
        } catch (e) { /* keep old client */ }
    }

    _hash(text) {
        return crypto.createHash('sha256').update(text).digest('hex').substring(0, 16);
    }

    _cacheSet(hash, vector) {
        // Evict LRU if cache full (Map.keys().next().value = oldest entry)
        while (this._cache.size >= this._cacheSize) {
            const oldest = this._cache.keys().next().value;
            this._cache.delete(oldest);
        }
        this._cache.set(hash, vector);
    }

    getStats() {
        return {
            cacheSize: this._cache.size,
            cacheCapacity: this._cacheSize,
            apiKeys: this._apiKeys.length,
            keyIndex: this._keyIndex,
            model: this._model,
        };
    }
}

module.exports = EmbeddingProvider;
