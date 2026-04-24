const { CONFIG } = require('../config');

function parseNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeMessageContent(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .map((part) => {
            if (typeof part === 'string') return part;
            if (part && typeof part.text === 'string') return part.text;
            return '';
        })
        .join('')
        .trim();
}

class LMStudioClient {
    constructor(options = {}) {
        this.baseUrl = String(options.baseUrl || CONFIG.LMSTUDIO_BASE_URL || 'http://127.0.0.1:1234/v1').replace(/\/+$/, '');
        this.timeoutMs = parseNumber(options.timeoutMs || CONFIG.LMSTUDIO_TIMEOUT_MS, 60000);
        this.apiKey = String(options.apiKey || CONFIG.LMSTUDIO_API_KEY || '').trim();
    }

    async chat(prompt, options = {}) {
        const model = options.model || CONFIG.LMSTUDIO_BRAIN_MODEL;
        if (!model) throw new Error('LM Studio brain model is not configured.');

        const messages = [];
        if (options.system) {
            messages.push({ role: 'system', content: String(options.system) });
        }
        messages.push({ role: 'user', content: String(prompt || '') });

        const payload = { model, messages };
        if (typeof options.temperature === 'number') {
            payload.temperature = options.temperature;
        }

        const data = await this._request('/chat/completions', payload);
        const content = normalizeMessageContent(data?.choices?.[0]?.message?.content);
        if (!content) throw new Error('LM Studio returned an empty chat response.');
        return content;
    }

    async _request(endpoint, payload) {
        const url = `${this.baseUrl}${endpoint}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (this.apiKey) {
                headers.Authorization = `Bearer ${this.apiKey}`;
            }

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            const bodyText = await response.text();
            let data = {};
            if (bodyText) {
                try {
                    data = JSON.parse(bodyText);
                } catch (e) {
                    throw new Error(`Invalid JSON response from ${endpoint}: ${bodyText.slice(0, 200)}`);
                }
            }

            if (!response.ok) {
                const message = data?.error?.message || data?.error || data?.message || response.statusText;
                throw new Error(`[LMStudio:${endpoint}] ${response.status} ${message}`);
            }

            return data;
        } catch (e) {
            if (e.name === 'AbortError') {
                throw new Error(`[LMStudio:${endpoint}] request timeout after ${this.timeoutMs}ms`);
            }
            if (e instanceof Error) throw e;
            throw new Error(String(e));
        } finally {
            clearTimeout(timeoutId);
        }
    }
}

module.exports = LMStudioClient;
