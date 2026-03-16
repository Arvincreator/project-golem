// ============================================================
// 🧠 SDK Brain — Drop-in GolemBrain replacement using @google/generative-ai
// Eliminates Puppeteer, DOM Doctor, 200-400MB Chrome overhead
// Activated via golem-config.xml: <gemini engine="sdk" />
// ============================================================
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const ConfigManager = require('../config');
const ProtocolFormatter = require('../services/ProtocolFormatter');
const ChatLogManager = require('../managers/ChatLogManager');
const SkillIndexManager = require('../managers/SkillIndexManager');
const NodeRouter = require('./NodeRouter');
const SystemNativeDriver = require('../memory/SystemNativeDriver');

class SdkBrain {
    constructor(options = {}) {
        this.golemId = options.golemId || 'default';
        this.userDataDir = options.userDataDir || path.resolve(ConfigManager.CONFIG.USER_DATA_DIR || './golem_memory');
        this.skillIndex = new SkillIndexManager(this.userDataDir);

        // No browser needed
        this.browser = null;
        this.page = null;

        // v10.5: RAG provider (optional)
        this._ragProvider = options.ragProvider || null;

        // Memory engine (accept injected or create new)
        this.memoryDriver = options.memoryDriver || new SystemNativeDriver();

        // Chat log (accept injected or create new)
        this.chatLogManager = options.chatLogManager || new ChatLogManager({
            golemId: this.golemId,
            logDir: options.logDir || ConfigManager.LOG_BASE_DIR,
            isSingleMode: options.isSingleMode !== undefined ? options.isSingleMode : (ConfigManager.GOLEM_MODE === 'SINGLE')
        });

        // Gemini SDK
        this._apiKeys = (ConfigManager.CONFIG.API_KEYS || []).filter(k => k.length > 10);
        this._keyIndex = 0;
        this._model = options.model || process.env.GEMINI_SDK_MODEL || 'gemini-2.0-flash-lite';
        this._chat = null;    // ChatSession
        this._genAI = null;   // GoogleGenerativeAI instance
        this._systemPrompt = null;

        this.status = 'idle';
    }

    // ─── Public API (GolemBrain-compatible) ────────────────

    async init(forceReload = false) {
        if (this._chat && !forceReload) return;

        if (this._apiKeys.length === 0) {
            throw new Error('[SdkBrain] No valid GEMINI_API_KEYS configured');
        }

        // Initialize memory
        try {
            await this.memoryDriver.init();
        } catch (e) {
            console.warn('[SdkBrain] Memory driver init failed, continuing without memory:', e.message);
        }

        // Initialize chat log
        await this.chatLogManager.init();

        // Sync skill index
        try {
            const fs = require('fs');
            const personaPath = path.resolve(this.userDataDir, 'persona.json');
            if (fs.existsSync(personaPath)) {
                const persona = JSON.parse(fs.readFileSync(personaPath, 'utf-8'));
                if (persona.skills) {
                    await this.skillIndex.syncToDb(persona.skills);
                }
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

        // Create SDK client and chat session
        this._initChat();

        this.status = 'running';
        console.log(`✅ [SdkBrain:${this.golemId}] Initialized with model ${this._model} (${this._apiKeys.length} API keys)`);
    }

    _initChat() {
        try {
            const apiKey = this._apiKeys[this._keyIndex % this._apiKeys.length];
            this._genAI = new GoogleGenerativeAI(apiKey);

            const model = this._genAI.getGenerativeModel({
                model: this._model,
                systemInstruction: this._systemPrompt || undefined,
            });

            this._chat = model.startChat({
                generationConfig: {
                    maxOutputTokens: 8192,
                    temperature: 0.7,
                },
            });
        } catch (e) {
            console.error(`[SdkBrain] _initChat failed with key ${this._keyIndex}: ${e.message}`);
            // Try next key
            if (this._apiKeys.length > 1) {
                this._keyIndex = (this._keyIndex + 1) % this._apiKeys.length;
                const apiKey = this._apiKeys[this._keyIndex];
                this._genAI = new GoogleGenerativeAI(apiKey);
                const model = this._genAI.getGenerativeModel({
                    model: this._model,
                    systemInstruction: this._systemPrompt || undefined,
                });
                this._chat = model.startChat({
                    generationConfig: { maxOutputTokens: 8192, temperature: 0.7 },
                });
                console.log(`[SdkBrain] Rotated to key ${this._keyIndex}`);
            } else {
                throw e;
            }
        }
    }

    async sendMessage(text, isSystem = false, options = {}) {
        if (!this._chat) await this.init();

        // Slash command interception (same as GolemBrain)
        if (text.startsWith('/') || text.startsWith('GOLEM_SKILL::')) {
            const commandResult = await NodeRouter.handle({ text, isAdmin: true }, this);
            if (commandResult) {
                console.log(`⚡ [SdkBrain] Command intercepted: ${text}`);
                return commandResult;
            }
        }

        // For SDK mode, we still wrap in envelope for ResponseParser compatibility
        const reqId = ProtocolFormatter.generateReqId();
        const payload = ProtocolFormatter.buildEnvelope(text, reqId, options);

        console.log(`📡 [SdkBrain] Sending request: ${reqId}`);

        try {
            const result = await this._chat.sendMessage(payload);
            const response = result.response;
            const responseText = response.text();

            console.log(`📨 [SdkBrain] Response received (${responseText.length} chars)`);
            return responseText;
        } catch (e) {
            // Handle rate limits and key rotation
            if (e.message && (e.message.includes('429') || e.message.includes('RESOURCE_EXHAUSTED'))) {
                console.warn(`[SdkBrain] Rate limited on key ${this._keyIndex}, rotating...`);
                this._keyIndex = (this._keyIndex + 1) % this._apiKeys.length;
                this._initChat();

                // Retry once with new key
                const result = await this._chat.sendMessage(payload);
                return result.response.text();
            }

            // Handle 403 CONSUMER_SUSPENDED
            if (e.message && (e.message.includes('403') || e.message.includes('SUSPENDED'))) {
                console.error(`[SdkBrain] API key ${this._keyIndex} suspended, rotating...`);
                this._keyIndex = (this._keyIndex + 1) % this._apiKeys.length;
                this._initChat();
                const result = await this._chat.sendMessage(payload);
                return result.response.text();
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
        try { await this.memoryDriver.memorize(text, metadata); } catch (e) { console.warn('[SdkBrain] memorize failed:', e.message); }
    }

    async switchModel(model) {
        if (model) this._model = model;
        this._chat = null;
        this._initChat();
        return `已切換至 ${this._model} (SDK 模式)`;
    }

    _appendChatLog(entry) {
        this.chatLogManager.init().then(() => {
            this.chatLogManager.append(entry);
        }).catch(e => console.warn('[ChatLog]', e.message));
    }

    async reloadSkills() {
        ProtocolFormatter._lastScanTime = 0;
        console.log(`🔄 [SdkBrain:${this.golemId}] Resetting chat session for skill reload...`);

        const { systemPrompt, skillMemoryText } = await ProtocolFormatter.buildSystemPrompt(true, {
            userDataDir: this.userDataDir,
            golemId: this.golemId
        });

        if (skillMemoryText) {
            await this.memorize(skillMemoryText, { type: 'system_skills', source: 'boot_init' });
        }

        this._systemPrompt = ProtocolFormatter.compress(systemPrompt);
        this._initChat();
        console.log(`✅ [SdkBrain:${this.golemId}] Chat session reset with updated skills.`);
    }

    _linkDashboard() {
        if (!process.argv.includes('dashboard')) return;
        try {
            const dashboard = require('../../dashboard');
            dashboard.setContext(this.golemId, this, this.memoryDriver);
        } catch (e) { /* optional */ }
    }
}

module.exports = SdkBrain;
