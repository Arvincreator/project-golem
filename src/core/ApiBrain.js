// ============================================================
// 🧠 ApiBrain — API-Only Mode (無需 Chromium)
// ============================================================
// 使用 @google/generative-ai SDK 直接呼叫 Gemini API
// 適用於無法或不需要執行瀏覽器的部署環境

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { CONFIG, cleanEnv } = require('../config');
const ProtocolFormatter = require('../services/ProtocolFormatter');
const ChatLogManager = require('../managers/ChatLogManager');

class ApiBrain {
    constructor() {
        this.genAI = null;
        this.model = null;
        this.chat = null;
        this.chatLogManager = new ChatLogManager();
        this.memoryDriver = null;
        this.page = null; // 保持相容 (health check 用)

        // 記憶引擎 — API mode 只用 native/qmd
        const mode = cleanEnv(process.env.GOLEM_MEMORY_MODE || 'native').toLowerCase();
        console.log(`⚙️ [ApiBrain] 記憶引擎模式: ${mode.toUpperCase()}`);

        if (mode === 'qmd') {
            const SystemQmdDriver = require('../memory/SystemQmdDriver');
            this.memoryDriver = new SystemQmdDriver();
        } else {
            const SystemNativeDriver = require('../memory/SystemNativeDriver');
            this.memoryDriver = new SystemNativeDriver();
        }
    }

    /**
     * 初始化 API 連線
     */
    async init() {
        if (CONFIG.API_KEYS.length === 0) {
            throw new Error('API mode 需要至少一個 GEMINI_API_KEYS');
        }

        const apiKey = CONFIG.API_KEYS[0];
        this.genAI = new GoogleGenerativeAI(apiKey);

        const modelName = cleanEnv(process.env.GOLEM_API_MODEL || 'gemini-2.5-flash');
        console.log(`🧠 [ApiBrain] 使用模型: ${modelName}`);

        this.model = this.genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
                maxOutputTokens: 8192,
                temperature: 0.7,
            }
        });

        // 初始化記憶引擎
        try {
            await this.memoryDriver.init();
        } catch (e) {
            console.warn(`⚠️ [ApiBrain] 記憶引擎初始化失敗: ${e.message}`);
        }

        // 建立 chat session 並注入系統 prompt
        const { systemPrompt } = await ProtocolFormatter.buildSystemPrompt();
        this.chat = this.model.startChat({
            history: [{
                role: 'user',
                parts: [{ text: systemPrompt }]
            }, {
                role: 'model',
                parts: [{ text: '✅ 系統 Prompt 已載入。我是 Golem，隨時為你服務。' }]
            }]
        });

        console.log('✅ [ApiBrain] API Brain 初始化完成 (無瀏覽器模式)');
    }

    /**
     * 發送訊息到 Gemini API
     * @param {string} text - 訊息內容
     * @param {boolean} [isSystem=false] - 是否為系統訊息
     * @returns {Promise<string>} AI 回應
     */
    async sendMessage(text, isSystem = false) {
        if (!this.chat) await this.init();

        try {
            const result = await this.chat.sendMessage(text);
            const response = result.response.text();

            this._appendChatLog({
                role: isSystem ? 'system' : 'user',
                content: text.substring(0, 200),
                response: response.substring(0, 500),
                timestamp: new Date().toISOString(),
                mode: 'api'
            });

            return response;
        } catch (e) {
            // API key 輪替
            if (CONFIG.API_KEYS.length > 1 && e.message.includes('429')) {
                console.warn('⚠️ [ApiBrain] Rate limited, rotating API key...');
                CONFIG.API_KEYS.push(CONFIG.API_KEYS.shift());
                this.genAI = new GoogleGenerativeAI(CONFIG.API_KEYS[0]);
                const modelName = cleanEnv(process.env.GOLEM_API_MODEL || 'gemini-2.5-flash');
                this.model = this.genAI.getGenerativeModel({ model: modelName });
                // Restart chat (loses history but recovers)
                this.chat = this.model.startChat();
                return this.sendMessage(text, isSystem);
            }
            throw e;
        }
    }

    async recall(queryText) {
        if (!queryText) return [];
        try { return await this.memoryDriver.recall(queryText); } catch (e) { return []; }
    }

    async memorize(text, metadata = {}) {
        try { await this.memoryDriver.memorize(text, metadata); } catch (e) { }
    }

    _appendChatLog(entry) {
        this.chatLogManager.append(entry);
    }

    async shutdown() {
        console.log('🔒 [ApiBrain] Shutdown (no browser to close)');
    }
}

module.exports = ApiBrain;
