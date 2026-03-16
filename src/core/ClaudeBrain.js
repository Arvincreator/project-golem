// ============================================================
// ClaudeBrain — Anthropic Claude API via official SDK
// v10.5: Inherits OpenAICompatBrain, overrides _callCompletion
// ============================================================
const OpenAICompatBrain = require('./OpenAICompatBrain');
const circuitBreaker = require('./circuit_breaker');

class ClaudeBrain extends OpenAICompatBrain {
    constructor(options = {}) {
        super({
            ...options,
            serviceId: 'claude',
            model: options.model || process.env.CLAUDE_MODEL || 'claude-opus-4-6-20250515',
            maxTokens: options.maxTokens || 8192,
            timeout: options.timeout || 120000,
        });
        this._anthropicClient = null;
    }

    async _callCompletion(retryCount = 0) {
        const serviceId = this._serviceId;

        // Circuit breaker check
        if (!circuitBreaker.canExecute(serviceId)) {
            throw new Error(`[${serviceId}] Circuit breaker OPEN — service unavailable`);
        }

        const apiKey = this._getApiKey();
        if (!apiKey) {
            throw new Error(`[${serviceId}] No ANTHROPIC_API_KEY configured`);
        }

        try {
            const Anthropic = require('@anthropic-ai/sdk');
            if (!this._anthropicClient) {
                this._anthropicClient = new Anthropic({ apiKey, maxRetries: 0 });
            }

            // Extract system prompt and filter messages
            const systemPrompt = this._systemPrompt || '';
            const messages = this._messages.filter(m => m.role !== 'system');

            const response = await this._anthropicClient.messages.create({
                model: this._model,
                max_tokens: this._maxTokens,
                system: systemPrompt,
                messages,
            });

            const content = response.content?.[0]?.text;
            if (!content) {
                throw new Error(`[${serviceId}] Empty response from Claude API`);
            }

            circuitBreaker.recordSuccess(serviceId);
            return content;
        } catch (e) {
            // Retry on rate limit (Anthropic SDK has built-in retry, but we add circuit breaker)
            if (e.status === 429 && retryCount < 3) {
                const delay = this._getRetryDelay(retryCount);
                console.warn(`[${serviceId}] Rate limited, retrying in ${Math.round(delay)}ms...`);
                await new Promise(r => setTimeout(r, delay));
                return this._callCompletion(retryCount + 1);
            }

            circuitBreaker.recordFailure(serviceId, e.message);
            throw e;
        }
    }

    _getApiKey() {
        return process.env.ANTHROPIC_API_KEY || '';
    }
}

module.exports = ClaudeBrain;
