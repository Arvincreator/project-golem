// ============================================================
// OllamaBrain — Local Ollama fallback (OpenAI-compatible API)
// ============================================================
const OpenAICompatBrain = require('./OpenAICompatBrain');

class OllamaBrain extends OpenAICompatBrain {
    constructor(options = {}) {
        super({
            ...options,
            baseURL: process.env.OLLAMA_URL || 'http://localhost:11434/v1',
            apiKey: 'ollama', // Ollama accepts any string
            defaultModel: process.env.OLLAMA_MODEL || 'qwen2:8b',
            serviceId: 'ollama',
            maxTokens: 4096,
            temperature: 0.7,
            timeout: 15000, // Local should be fast
        });
    }

    _getApiKey() {
        return 'ollama'; // No auth needed
    }
}

module.exports = OllamaBrain;
