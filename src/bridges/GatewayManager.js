// ============================================================
// 🌐 GatewayManager — 統一訊息平台閘道
// 靈感來自 NousResearch/hermes-agent gateway/ 子系統
//
// 將 Telegram / Discord / Web / CLI 等所有訊息來源
// 統一抽象為一致的 MessageContext 格式，
// 讓核心邏輯（ConvoManager, NodeRouter, NeuroShunter）
// 完全不需要感知底層平台差異。
// ============================================================

// ── MessageContext 規格 ────────────────────────────────────────────
/**
 * @typedef {object} MessageContext
 * @property {string}   platform      - 'telegram' | 'discord' | 'web' | 'cli' | 'autonomy'
 * @property {string}   chatId        - 唯一的聊天室/頻道 ID
 * @property {string}   userId        - 使用者 ID
 * @property {string}   text          - 訊息文字內容
 * @property {boolean}  isAdmin       - 是否為管理員
 * @property {Function} reply         - (text, opts?) => Promise<void>  統一回覆函數
 * @property {Function} sendTyping    - () => Promise<void>  傳送輸入中指示
 * @property {object}   [attachments] - 附件（圖片、文件）
 * @property {object}   [raw]         - 原始訊息物件（平台特定）
 */

const EventEmitter = require('events');

// ============================================================
// 抽象基底閘道
// ============================================================
class BaseGateway extends EventEmitter {
    /**
     * @param {string} platformName - 平台標識符
     */
    constructor(platformName) {
        super();
        this.platform = platformName;
        this._handlers = [];
        this._isRunning = false;
    }

    /** 啟動閘道（子類實作） */
    async start() {
        throw new Error(`[${this.platform}Gateway] start() 未實作`);
    }

    /** 優雅關閉 */
    async stop() {
        this._isRunning = false;
    }

    /**
     * 向目標傳送訊息（子類實作）
     * @param {string} targetId - chatId / channelId
     * @param {string} text
     * @param {object} [opts]
     */
    async send(targetId, text, opts = {}) {
        throw new Error(`[${this.platform}Gateway] send() 未實作`);
    }

    /**
     * 建立標準化的 MessageContext
     * @param {object} rawMsg - 平台原始訊息
     * @returns {MessageContext}
     */
    buildContext(rawMsg) {
        throw new Error(`[${this.platform}Gateway] buildContext() 未實作`);
    }

    /** 觸發訊息事件到 GatewayManager */
    _dispatchMessage(ctx) {
        this.emit('message', ctx);
    }
}

// ============================================================
// Telegram 閘道
// ============================================================
class TelegramGateway extends BaseGateway {
    /**
     * @param {object} tgBot - GrammyBridge 或 node-telegram-bot-api 實例
     * @param {object} golemConfig - Golem 的 TG 配置
     */
    constructor(tgBot, golemConfig = {}) {
        super('telegram');
        this._bot = tgBot;
        this._config = golemConfig;
        this._adminIds = new Set(
            (golemConfig.adminId
                ? (Array.isArray(golemConfig.adminId) ? golemConfig.adminId : String(golemConfig.adminId).split(','))
                : []
            ).map(id => String(id).trim())
        );
    }

    async start() {
        if (this._isRunning) return;
        this._isRunning = true;
        console.log(`🚀 [TelegramGateway] 已就緒`);
    }

    async send(chatId, text, opts = {}) {
        if (!this._bot) throw new Error('[TelegramGateway] bot 未初始化');
        return this._bot.sendMessage(chatId, text, opts);
    }

    buildContext(msg, extraOpts = {}) {
        const chatId  = String(msg.chat ? msg.chat.id : msg.chatId);
        const userId  = String(msg.from ? msg.from.id : msg.userId || chatId);
        const text    = msg.text || '';
        const isAdmin = this._adminIds.has(userId) || extraOpts.isAdmin === true;

        const ctx = {
            platform: 'telegram',
            chatId,
            userId,
            text,
            isAdmin,
            raw: msg,
            ...extraOpts,
            reply: async (replyText, replyOpts = {}) => {
                const MAX_LEN = 4000;
                const safeText = typeof replyText === 'string' && replyText.length > MAX_LEN
                    ? replyText.slice(0, MAX_LEN) + '\n...(已截斷)'
                    : replyText;
                return this.send(chatId, safeText, { parse_mode: 'Markdown', ...replyOpts });
            },
            sendTyping: async () => {
                if (this._bot && typeof this._bot.sendChatAction === 'function') {
                    return this._bot.sendChatAction(chatId, 'typing').catch(() => {});
                }
            },
        };
        return ctx;
    }
}

// ============================================================
// Discord 閘道
// ============================================================
class DiscordGateway extends BaseGateway {
    /**
     * @param {object} dcClient - Discord.js Client 實例
     * @param {object} golemConfig
     */
    constructor(dcClient, golemConfig = {}) {
        super('discord');
        this._client = dcClient;
        this._config = golemConfig;
        this._adminIds = new Set(
            (golemConfig.dcAdminId
                ? (Array.isArray(golemConfig.dcAdminId) ? golemConfig.dcAdminId : String(golemConfig.dcAdminId).split(','))
                : []
            ).map(id => String(id).trim())
        );
    }

    async start() {
        if (this._isRunning) return;
        this._isRunning = true;
        console.log(`🚀 [DiscordGateway] 已就緒`);
    }

    async send(channelOrUserId, text, opts = {}) {
        if (!this._client) throw new Error('[DiscordGateway] client 未初始化');
        const MAX_LEN = 1900;
        const safeText = text.length > MAX_LEN ? text.slice(0, MAX_LEN) + '\n...' : text;
        const authMode = this._config.dcAuthMode || 'ADMIN';
        try {
            if (authMode === 'CHAT') {
                const channel = await this._client.channels.fetch(channelOrUserId);
                if (channel) return channel.send(safeText);
            } else {
                const user = await this._client.users.fetch(channelOrUserId);
                if (user) return user.send(safeText);
            }
        } catch (e) {
            console.error(`❌ [DiscordGateway] 傳送失敗:`, e.message);
        }
    }

    buildContext(msg, extraOpts = {}) {
        const chatId  = String(msg.channelId || msg.channel?.id || msg.author?.id || 'unknown');
        const userId  = String(msg.author?.id || 'unknown');
        const text    = msg.content || '';
        const isAdmin = this._adminIds.has(userId) || extraOpts.isAdmin === true;

        const ctx = {
            platform: 'discord',
            chatId,
            userId,
            text,
            isAdmin,
            raw: msg,
            ...extraOpts,
            reply: async (replyText) => {
                return this.send(chatId, replyText);
            },
            sendTyping: async () => {
                if (msg.channel && typeof msg.channel.sendTyping === 'function') {
                    return msg.channel.sendTyping().catch(() => {});
                }
            },
        };
        return ctx;
    }
}

// ============================================================
// Web Dashboard 閘道
// ============================================================
class WebGateway extends BaseGateway {
    constructor(webServer) {
        super('web');
        this._server = webServer;
    }

    async start() {
        this._isRunning = true;
        console.log(`🚀 [WebGateway] 已就緒`);
    }

    async send(sessionId, text, opts = {}) {
        if (this._server && typeof this._server.broadcastLog === 'function') {
            this._server.broadcastLog({
                time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
                msg: text,
                type: opts.type || 'general',
                sessionId,
            });
        }
    }

    buildContext(req, extraOpts = {}) {
        const chatId = req.sessionId || req.chatId || 'web_default';
        const text   = req.text || '';

        const ctx = {
            platform: 'web',
            chatId,
            userId: chatId,
            text,
            isAdmin: extraOpts.isAdmin !== false,
            raw: req,
            ...extraOpts,
            reply: async (replyText) => {
                return this.send(chatId, replyText);
            },
            sendTyping: async () => {},
        };
        return ctx;
    }
}

// ============================================================
// CLI 閘道（本地終端）
// ============================================================
class CliGateway extends BaseGateway {
    constructor() {
        super('cli');
    }

    async start() {
        this._isRunning = true;
        console.log(`🚀 [CliGateway] 已就緒`);
    }

    async send(_, text) {
        console.log(`[Golem CLI] ${text}`);
    }

    buildContext(text, extraOpts = {}) {
        const ctx = {
            platform: 'cli',
            chatId: 'cli_local',
            userId: 'local_user',
            text: String(text),
            isAdmin: true,
            raw: { text },
            ...extraOpts,
            reply: async (replyText) => {
                console.log(`\n🤖 [Golem] ${replyText}\n`);
            },
            sendTyping: async () => {},
        };
        return ctx;
    }
}

// ============================================================
// 🌐 GatewayManager — 統一協調者
// ============================================================
class GatewayManager extends EventEmitter {
    constructor() {
        super();
        this._gateways = new Map(); // platform → BaseGateway
    }

    /**
     * 註冊一個閘道
     * @param {BaseGateway} gateway
     */
    register(gateway) {
        if (!(gateway instanceof BaseGateway)) {
            throw new Error('[GatewayManager] 必須傳入 BaseGateway 的子類實例');
        }

        this._gateways.set(gateway.platform, gateway);

        // 將所有訊息轉發到 GatewayManager 統一事件
        gateway.on('message', (ctx) => {
            this.emit('message', ctx);
            this.emit(`message:${gateway.platform}`, ctx);
        });

        console.log(`📡 [GatewayManager] 已註冊閘道：${gateway.platform}`);
        return this;
    }

    /**
     * 啟動所有已註冊的閘道
     */
    async startAll() {
        for (const [platform, gateway] of this._gateways) {
            try {
                await gateway.start();
                console.log(`✅ [GatewayManager] ${platform} 閘道已啟動`);
            } catch (e) {
                console.error(`❌ [GatewayManager] ${platform} 啟動失敗:`, e.message);
            }
        }
    }

    /**
     * 向特定平台傳送訊息
     * @param {string} platform
     * @param {string} targetId
     * @param {string} text
     * @param {object} [opts]
     */
    async sendTo(platform, targetId, text, opts = {}) {
        const gateway = this._gateways.get(platform);
        if (!gateway) {
            console.warn(`⚠️ [GatewayManager] 平台 "${platform}" 未註冊`);
            return;
        }
        return gateway.send(targetId, text, opts);
    }

    /**
     * 廣播到所有已啟動的閘道
     * @param {string} text
     * @param {object} [targets] - { platform: targetId }，不指定則跳過
     */
    async broadcast(text, targets = {}) {
        for (const [platform, gateway] of this._gateways) {
            if (!gateway._isRunning) continue;
            const targetId = targets[platform];
            if (targetId) {
                await gateway.send(targetId, text).catch(e => {
                    console.error(`❌ [GatewayManager] 廣播到 ${platform} 失敗:`, e.message);
                });
            }
        }
    }

    /**
     * 取得特定平台閘道
     * @param {string} platform
     * @returns {BaseGateway|undefined}
     */
    get(platform) {
        return this._gateways.get(platform);
    }

    /**
     * 關閉所有閘道
     */
    async stopAll() {
        for (const [, gateway] of this._gateways) {
            await gateway.stop().catch(() => {});
        }
        console.log('🛑 [GatewayManager] 所有閘道已關閉');
    }

    /**
     * 列出已註冊的閘道狀態
     */
    status() {
        const result = {};
        for (const [platform, gateway] of this._gateways) {
            result[platform] = { running: gateway._isRunning };
        }
        return result;
    }
}

// ── 單例 GatewayManager ─────────────────────────────────────────────
const gatewayManager = new GatewayManager();

module.exports = {
    GatewayManager,
    BaseGateway,
    TelegramGateway,
    DiscordGateway,
    WebGateway,
    CliGateway,
    gatewayManager,  // 預設單例
};
