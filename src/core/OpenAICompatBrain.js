// ============================================================
// OpenAI-Compatible Brain — Base class for any /v1/chat/completions API
// Subclasses: MonicaBrain, OllamaBrain
// ============================================================
const path = require('path');
const ConfigManager = require('../config');
const ProtocolFormatter = require('../services/ProtocolFormatter');
const ChatLogManager = require('../managers/ChatLogManager');
const SkillIndexManager = require('../managers/SkillIndexManager');
const NodeRouter = require('./NodeRouter');
const SystemNativeDriver = require('../memory/SystemNativeDriver');
const circuitBreaker = require('./circuit_breaker');

const { TimeoutError: GolemTimeoutError } = require('./errors');

const MAX_HISTORY = 50; // Keep last N message pairs in conversation
const MAX_RETRY = 3;
const BASE_DELAY = 1000;
const MAX_DELAY = 30000;
const RETRYABLE_CODES = [429, 500, 502, 503, 504];

class OpenAICompatBrain {
    constructor(options = {}) {
        this.golemId = options.golemId || 'default';
        this.userDataDir = options.userDataDir || path.resolve(ConfigManager.CONFIG.USER_DATA_DIR || './golem_memory');
        this.skillIndex = options.skillIndex || new SkillIndexManager(this.userDataDir);

        this.browser = null;
        this.page = null;

        // v10.5: RAG provider (optional — null guard everywhere)
        this._ragProvider = options.ragProvider || null;

        this.memoryDriver = options.memoryDriver || new SystemNativeDriver();
        this.chatLogManager = options.chatLogManager || new ChatLogManager({
            golemId: this.golemId,
            logDir: options.logDir || ConfigManager.LOG_BASE_DIR,
            isSingleMode: options.isSingleMode !== undefined ? options.isSingleMode : (ConfigManager.GOLEM_MODE === 'SINGLE')
        });

        // Subclass must set these
        this._baseURL = options.baseURL || '';
        this._apiKey = options.apiKey || '';
        this._model = options.model || options.defaultModel || 'gpt-4o';
        this._serviceId = options.serviceId || 'openai';
        this._maxTokens = options.maxTokens || 8192;
        this._temperature = options.temperature || 0.7;
        this._timeout = options.timeout || 30000;

        this._messages = []; // {role, content}[]
        this._systemPrompt = null;
        this.status = 'idle';
    }

    // --- Public API (Brain interface) ---

    async init(forceReload = false) {
        if (this._systemPrompt && !forceReload) return;

        // Init memory
        try { await this.memoryDriver.init(); } catch (e) {
            console.warn(`[${this._serviceId}] Memory init failed:`, e.message);
        }

        // Init chat log
        await this.chatLogManager.init();

        // Sync skill index
        try {
            const fs = require('fs');
            const personaPath = path.resolve(this.userDataDir, 'persona.json');
            if (fs.existsSync(personaPath)) {
                const persona = JSON.parse(fs.readFileSync(personaPath, 'utf-8'));
                if (persona.skills) await this.skillIndex.syncToDb(persona.skills);
            }
        } catch (e) { /* optional */ }

        // Build system prompt
        const { systemPrompt, skillMemoryText } = await ProtocolFormatter.buildSystemPrompt(forceReload, {
            userDataDir: this.userDataDir,
            golemId: this.golemId
        });

        if (skillMemoryText) {
            await this.memorize(skillMemoryText, { type: 'system_skills', source: 'boot_init' });
        }

        this._systemPrompt = ProtocolFormatter.compress(systemPrompt);
        this._messages = [{ role: 'system', content: this._systemPrompt }];

        this.status = 'running';
        console.log(`[${this._serviceId}:${this.golemId}] Initialized with model ${this._model}`);
    }

    async sendMessage(text, isSystem = false, options = {}) {
        if (!this._systemPrompt) await this.init();

        // Command interception
        if (text.startsWith('/') || text.startsWith('GOLEM_SKILL::')) {
            const result = await NodeRouter.handle({ text, isAdmin: true }, this);
            if (result) return result;
        }

        // Build envelope
        const reqId = ProtocolFormatter.generateReqId();
        const payload = ProtocolFormatter.buildEnvelope(text, reqId, options);

        // Add to conversation and record index for precise removal on failure
        this._messages.push({ role: 'user', content: payload });
        const userMsgIndex = this._messages.length - 1;
        this._trimHistory();

        console.log(`[${this._serviceId}] Sending request: ${reqId} (model: ${this._model})`);

        try {
            const responseText = await this._callCompletion();

            // Add assistant response to history
            this._messages.push({ role: 'assistant', content: responseText });
            this._trimHistory();

            console.log(`[${this._serviceId}] Response received (${responseText.length} chars)`);
            return responseText;
        } catch (e) {
            // Remove failed user message by index (not pop — avoids race with concurrent sends)
            const idx = this._messages.indexOf(this._messages[userMsgIndex]);
            if (idx > 0 && this._messages[idx]?.role === 'user') {
                this._messages.splice(idx, 1);
            }
            throw e;
        }
    }

    async recall(queryText) {
        if (!queryText) return [];
        // v10.5: Try RAG-augmented recall first
        if (this._ragProvider) {
            try {
                const result = await this._ragProvider.augmentedRecall(queryText);
                if (result.merged.length > 0) return result.merged;
            } catch (e) { /* fallback to keyword */ }
        }
        try { return await this.memoryDriver.recall(queryText); } catch (e) { return []; }
    }

    async memorize(text, metadata = {}) {
        // v10.5: Also ingest into RAG
        if (this._ragProvider) {
            try { await this._ragProvider.ingest(text, metadata); } catch (e) { /* non-blocking */ }
        }
        try { await this.memoryDriver.memorize(text, metadata); } catch (e) {
            console.warn(`[${this._serviceId}] memorize failed:`, e.message);
        }
    }

    async switchModel(model) {
        if (model) this._model = model;
        // Keep conversation history, just switch model
        console.log(`[${this._serviceId}] Switched to model: ${this._model}`);
        return `已切換至 ${this._model} (${this._serviceId})`;
    }

    async reloadSkills() {
        ProtocolFormatter._lastScanTime = 0;
        console.log(`[${this._serviceId}:${this.golemId}] Reloading skills...`);

        const { systemPrompt, skillMemoryText } = await ProtocolFormatter.buildSystemPrompt(true, {
            userDataDir: this.userDataDir,
            golemId: this.golemId
        });

        if (skillMemoryText) {
            await this.memorize(skillMemoryText, { type: 'system_skills', source: 'boot_init' });
        }

        this._systemPrompt = ProtocolFormatter.compress(systemPrompt);
        // Reset conversation with new system prompt
        this._messages = [{ role: 'system', content: this._systemPrompt }];
        console.log(`[${this._serviceId}:${this.golemId}] Skills reloaded.`);
    }

    _appendChatLog(entry) {
        this.chatLogManager.init().then(() => this.chatLogManager.append(entry));
    }

    // --- Internal methods ---

    _getApiKey() {
        // Subclass can override for key rotation
        return this._apiKey;
    }

    /**
     * Calculate retry delay with decorrelated jitter (AWS recommended)
     */
    _getRetryDelay(attempt, retryAfterMs) {
        if (retryAfterMs) return retryAfterMs;
        const delay = Math.min(BASE_DELAY * Math.pow(2, attempt), MAX_DELAY);
        return delay * (0.5 + Math.random() * 0.5); // 50%-100% jitter
    }

    /**
     * Check if HTTP status code is retryable
     */
    _isRetryable(status) {
        return RETRYABLE_CODES.includes(status);
    }

    async _callCompletion(retryCount = 0) {
        const serviceId = this._serviceId;

        // Circuit breaker check
        if (!circuitBreaker.canExecute(serviceId)) {
            throw new Error(`[${serviceId}] Circuit breaker OPEN — service unavailable`);
        }

        const apiKey = this._getApiKey();
        const url = `${this._baseURL}/chat/completions`;
        const body = this._buildRequestBody();

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(this._timeout),
            });

            if (!res.ok) {
                const errBody = await res.text().catch(() => '');
                const errMsg = `HTTP ${res.status}: ${errBody.substring(0, 500)}`;

                // Retryable status codes — exponential backoff + jitter
                if (this._isRetryable(res.status) && retryCount < MAX_RETRY) {
                    const retryAfterHeader = res.headers.get('Retry-After');
                    const retryAfterMs = retryAfterHeader ? parseInt(retryAfterHeader) * 1000 : 0;
                    const delay = this._getRetryDelay(retryCount, retryAfterMs);
                    console.warn(`[${serviceId}] HTTP ${res.status}, retrying in ${Math.round(delay)}ms (${retryCount + 1}/${MAX_RETRY})...`);
                    await new Promise(r => setTimeout(r, delay));
                    return this._callCompletion(retryCount + 1);
                }

                // Non-retryable or max retries exhausted
                circuitBreaker.recordFailure(serviceId, errMsg);
                throw new Error(`[${serviceId}] ${errMsg}`);
            }

            const data = await res.json();

            if (!data || !data.choices) {
                const errDetail = data && data.error ? JSON.stringify(data.error).substring(0, 500) : 'no choices field';
                throw new Error(`[${serviceId}] Invalid API response: ${errDetail}`);
            }

            const content = data.choices[0]?.message?.content;

            if (!content) {
                throw new Error(`[${serviceId}] Empty response from API`);
            }

            circuitBreaker.recordSuccess(serviceId);
            return content;
        } catch (e) {
            if (e.name === 'TimeoutError' || e.name === 'AbortError') {
                circuitBreaker.recordFailure(serviceId, 'Timeout');
                throw new GolemTimeoutError(serviceId, this._timeout);
            }
            if (!e.message.startsWith(`[${serviceId}]`)) {
                circuitBreaker.recordFailure(serviceId, e.message);
            }
            throw e;
        }
    }

    _buildRequestBody() {
        return {
            model: this._model,
            messages: this._messages,
            max_tokens: this._maxTokens,
            temperature: this._temperature,
        };
    }

    _trimHistory() {
        // Keep system prompt + last MAX_HISTORY messages
        if (this._messages.length > MAX_HISTORY * 2 + 1) {
            const system = this._messages[0];
            this._messages = [system, ...this._messages.slice(-(MAX_HISTORY * 2))];
        }
    }

    _linkDashboard() {
        if (!process.argv.includes('dashboard')) return;
        try {
            const dashboard = require('../../dashboard');
            dashboard.setContext(this.golemId, this, this.memoryDriver);
        } catch (e) { /* optional */ }
    }
}

module.exports = OpenAICompatBrain;
