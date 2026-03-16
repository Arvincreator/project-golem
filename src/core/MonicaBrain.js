// ============================================================
// MonicaBrain — Monica.im API integration (OpenAI-compatible)
// Per-model token limits, rate limiting, cost tracking
// ============================================================
const OpenAICompatBrain = require('./OpenAICompatBrain');
const { MODEL_SPECS, getModelSpec, resolveForBrain, estimateTokens } = require('./monica-constants');

class MonicaBrain extends OpenAICompatBrain {
    constructor(options = {}) {
        const apiKeys = (process.env.MONICA_API_KEYS || process.env.MONICA_API_KEY || '').split(',').map(k => k.trim()).filter(k => k.length > 10);

        super({
            ...options,
            baseURL: process.env.MONICA_API_URL || 'https://openapi.monica.im/v1',
            apiKey: apiKeys[0] || '',
            defaultModel: process.env.MONICA_DEFAULT_MODEL || 'gpt-4o',
            serviceId: 'monica',
            maxTokens: 8192,
            timeout: 60000,
        });

        this._monicaKeys = apiKeys;
        this._monicaKeyIndex = 0;
        this._requestTimestamps = []; // RPM tracking
        this._totalCost = 0; // Cumulative cost (USD)
        this._rateLimitLock = null; // v10.0: mutex for RPM check

        if (this._monicaKeys.length === 0) {
            console.warn('[MonicaBrain] No MONICA_API_KEY configured — will fail on first request');
        }
    }

    _getApiKey() {
        if (this._monicaKeys.length === 0) throw new Error('[MonicaBrain] No API key configured');
        return this._monicaKeys[this._monicaKeyIndex % this._monicaKeys.length];
    }

    async switchModel(model) {
        const resolved = resolveForBrain(model, 'api');
        if (!resolved) {
            console.warn(`[MonicaBrain] Model ${model} has no API support and no fallback`);
            return `⚠️ ${model} 無 API 支援`;
        }
        const spec = getModelSpec(resolved.model);
        this._model = resolved.apiId;
        this._maxTokens = spec.maxOutput || 8192;
        const fallbackNote = resolved.fallbackFrom ? ` (fallback from ${resolved.fallbackFrom})` : '';
        console.log(`[MonicaBrain] Switched to ${resolved.model} → ${resolved.apiId} (maxOut: ${spec.maxOutput}, ctx: ${spec.context})${fallbackNote}`);
        return `已切換至 ${resolved.model} → ${resolved.apiId}${fallbackNote} (Monica API)`;
    }

    // v10.0: Check RPM limit with simple mutex to prevent race conditions
    async _checkRateLimit(model) {
        // Wait for any in-flight rate limit check to complete
        while (this._rateLimitLock) {
            await this._rateLimitLock;
        }

        let resolve;
        this._rateLimitLock = new Promise(r => { resolve = r; });

        try {
            const spec = getModelSpec(model);
            const now = Date.now();
            this._requestTimestamps = this._requestTimestamps.filter(t => now - t < 60000);
            if (this._requestTimestamps.length >= spec.rpm) {
                const waitMs = 60000 - (now - this._requestTimestamps[0]);
                throw new Error(`[MonicaBrain] Rate limit: ${spec.rpm} RPM exceeded for ${model}, wait ${Math.ceil(waitMs / 1000)}s`);
            }
            this._requestTimestamps.push(now);
        } finally {
            this._rateLimitLock = null;
            resolve();
        }
    }

    // Track cost after successful response
    _trackCost(model, inputText, outputText) {
        const spec = getModelSpec(model);
        const inputTokens = estimateTokens(inputText);
        const outputTokens = estimateTokens(outputText);
        const cost = (inputTokens * spec.costIn + outputTokens * spec.costOut) / 1000000;
        this._totalCost += cost;
        return cost;
    }

    _rotateKey() {
        if (this._monicaKeys.length > 1) {
            this._monicaKeyIndex = (this._monicaKeyIndex + 1) % this._monicaKeys.length;
            console.log(`[MonicaBrain] Rotated to key index ${this._monicaKeyIndex}`);
        }
    }

    async _callCompletion(retryCount = 0) {
        // Pre-flight rate check
        const modelName = Object.entries(MODEL_SPECS).find(([, s]) => s.apiId === this._model)?.[0] || this._model;
        try {
            await this._checkRateLimit(modelName);
        } catch (e) {
            // On rate limit, try key rotation first
            if (this._monicaKeys.length > 1 && retryCount < 1) {
                this._rotateKey();
                return this._callCompletion(retryCount + 1);
            }
            throw e;
        }

        try {
            const inputText = this._messages.map(m => m.content || '').join('');
            const result = await super._callCompletion(retryCount);
            const cost = this._trackCost(modelName, inputText, result);
            if (cost > 0.01) {
                console.log(`[MonicaBrain] Cost: $${cost.toFixed(4)} (total: $${this._totalCost.toFixed(4)})`);
            }
            return result;
        } catch (e) {
            if ((e.message.includes('429') || e.message.includes('401')) && retryCount < 1) {
                this._rotateKey();
                return this._callCompletion(retryCount + 1);
            }
            throw e;
        }
    }

    // Expose stats for router/skill
    getStats() {
        const modelName = Object.entries(MODEL_SPECS).find(([, s]) => s.apiId === this._model)?.[0] || this._model;
        const spec = getModelSpec(modelName);
        return {
            model: this._model,
            modelName,
            maxOutput: spec.maxOutput,
            context: spec.context,
            rpm: spec.rpm,
            tier: spec.tier,
            recentRPM: this._requestTimestamps.filter(t => Date.now() - t < 60000).length,
            totalCost: this._totalCost,
            keyCount: this._monicaKeys.length,
            activeKeyIndex: this._monicaKeyIndex,
        };
    }
}

module.exports = MonicaBrain;
