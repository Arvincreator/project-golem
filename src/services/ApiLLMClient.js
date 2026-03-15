// ============================================================
// ApiLLMClient — Direct API LLM (Monica → Groq → OpenRouter)
// Supports dynamic model switching via setModel()
// ============================================================
const https = require('https');

class ApiLLMClient {
    constructor(options = {}) {
        this.providers = [];
        this._currentModel = null;

        // Priority 1: Monica API (OpenAI-compatible)
        if (process.env.MONICA_API_KEY) {
            this.providers.push({
                name: 'Monica',
                hostname: 'openapi.monica.im',
                path: '/v1/chat/completions',
                apiKey: process.env.MONICA_API_KEY,
                model: 'gpt-4o',
                maxTokens: 4096,
            });
        }

        // Priority 2: Groq (free, fast)
        if (process.env.GROQ_API_KEY) {
            this.providers.push({
                name: 'Groq',
                hostname: 'api.groq.com',
                path: '/openai/v1/chat/completions',
                apiKey: process.env.GROQ_API_KEY,
                model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
                maxTokens: 4096,
            });
        }

        // Priority 3: OpenRouter
        if (process.env.OPENROUTER_API_KEY) {
            this.providers.push({
                name: 'OpenRouter',
                hostname: 'openrouter.ai',
                path: '/api/v1/chat/completions',
                apiKey: process.env.OPENROUTER_API_KEY,
                model: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash',
                maxTokens: 4096,
            });
        }

        this.conversationHistory = [];
        this.maxHistory = 20;
    }

    get available() {
        return this.providers.length > 0;
    }

    get providerName() {
        return this.providers.length > 0 ? this.providers[0].name : 'none';
    }

    /**
     * Set the model for the primary provider (Monica).
     * Only affects the first provider that supports the model.
     */
    setModel(modelId) {
        if (!modelId) return;
        this._currentModel = modelId;
        // Set on Monica provider if it exists
        const monica = this.providers.find(p => p.name === 'Monica');
        if (monica) {
            monica.model = modelId;
            console.log(`[ApiLLM] Model set: ${modelId} (Monica)`);
        }
    }

    /**
     * Get current active model
     */
    getModel() {
        return this._currentModel || (this.providers[0] ? this.providers[0].model : null);
    }

    /**
     * Send a message and get response (with fallback chain)
     */
    async sendMessage(userMessage, systemPrompt) {
        if (!this.available) {
            throw new Error('No API LLM providers configured');
        }

        const messages = [];
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        for (const msg of this.conversationHistory.slice(-this.maxHistory)) {
            messages.push(msg);
        }
        messages.push({ role: 'user', content: userMessage });

        let lastError = null;
        for (const provider of this.providers) {
            try {
                const startTime = Date.now();
                const response = await this._callProvider(provider, messages);
                const latencyMs = Date.now() - startTime;

                this.conversationHistory.push({ role: 'user', content: userMessage });
                this.conversationHistory.push({ role: 'assistant', content: response });
                if (this.conversationHistory.length > this.maxHistory * 2) {
                    this.conversationHistory = this.conversationHistory.slice(-this.maxHistory * 2);
                }

                // Emit metrics for A/B tracking
                if (this._onResponse) {
                    this._onResponse({
                        provider: provider.name,
                        model: provider.model,
                        latencyMs,
                        responseLen: response.length,
                        error: false,
                    });
                }

                return response;
            } catch (e) {
                console.warn(`[ApiLLM] ${provider.name} failed: ${e.message}`);
                lastError = e;
                if (this._onResponse) {
                    this._onResponse({
                        provider: provider.name,
                        model: provider.model,
                        latencyMs: 0,
                        responseLen: 0,
                        error: true,
                        errorMsg: e.message,
                    });
                }
            }
        }

        throw lastError || new Error('All API providers failed');
    }

    /**
     * Register a callback for response metrics (used by model-router A/B)
     */
    onResponse(callback) {
        this._onResponse = callback;
    }

    _callProvider(provider, messages) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                model: provider.model,
                messages: messages,
                max_tokens: provider.maxTokens,
                temperature: 0.7,
            });

            const req = https.request({
                hostname: provider.hostname,
                path: provider.path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${provider.apiKey}`,
                    'Content-Length': Buffer.byteLength(data),
                },
                timeout: 120000,
            }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(body);
                        if (json.error) {
                            reject(new Error(`${provider.name}: ${json.error.message || JSON.stringify(json.error)}`));
                            return;
                        }
                        const content = json.choices?.[0]?.message?.content;
                        if (!content) {
                            reject(new Error(`${provider.name}: empty response`));
                            return;
                        }
                        console.log(`[ApiLLM] ${provider.name}/${provider.model} responded (${content.length} chars)`);
                        resolve(content);
                    } catch (e) {
                        reject(new Error(`${provider.name}: parse failed - ${body.substring(0, 200)}`));
                    }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error(`${provider.name}: timeout`)); });
            req.write(data);
            req.end();
        });
    }

    resetHistory() {
        this.conversationHistory = [];
    }
}

module.exports = ApiLLMClient;
