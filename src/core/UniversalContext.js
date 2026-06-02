const { CONFIG } = require('../config');
const MessageManager = require('./MessageManager');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function buildDiscordComponentsFromInlineKeyboard(inlineKeyboard) {
    const rows = (Array.isArray(inlineKeyboard) ? inlineKeyboard : [])
        .filter((row) => Array.isArray(row) && row.length > 0)
        .slice(0, 5);
    if (rows.length === 0) return null;

    const canUseBuilders =
        typeof ActionRowBuilder === 'function' &&
        typeof ButtonBuilder === 'function' &&
        ButtonStyle && typeof ButtonStyle.Primary !== 'undefined';

    if (canUseBuilders) {
        return rows.map((row) => {
            const actionRow = new ActionRowBuilder();
            row.slice(0, 5).forEach((btn) => {
                actionRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(String(btn.callback_data || 'RPG_STATUS').slice(0, 100))
                        .setLabel(String(btn.text || '選項').slice(0, 80))
                        .setStyle(ButtonStyle.Primary)
                );
            });
            return actionRow;
        });
    }

    return rows.map((row) => ({
        type: 1,
        components: row.slice(0, 5).map((btn) => ({
            type: 2,
            style: 1,
            custom_id: String(btn.callback_data || 'RPG_STATUS').slice(0, 100),
            label: String(btn.text || '選項').slice(0, 80)
        }))
    }));
}

// ============================================================
// 🔌 Universal Context (通用語境層)
// ============================================================
class UniversalContext {
    constructor(platform, event, instance) {
        this.platform = platform;
        this.event = event;
        this.instance = instance;
        this.isInteraction = platform === 'discord' && (event.isButton?.() || event.isCommand?.());
        this._textOverride = null;
    }

    /**
     * 偵測訊息中是否包含對機器人的標記
     * @param {string} text 待檢查的文字
     * @returns {boolean}
     */
    isMentioned(text) {
        if (!text) return false;
        if (this.platform === 'telegram') {
            const username = this.instance.username;
            if (!username) return false;
            return text.toLowerCase().includes(`@${username.toLowerCase()}`);
        }
        if (this.platform === 'discord') {
            const botId = this.instance.user?.id;
            if (!botId) return false;
            return text.includes(`<@${botId}>`) || text.includes(`<@!${botId}>`);
        }
        return false;
    }

    isReplyingToBot() {
        if (this.platform === 'discord') {
            const botId = this.instance.user?.id;
            const repliedAuthorId = this.event.reference?.messageId
                ? this.event.channel?.messages?.cache?.get(this.event.reference.messageId)?.author?.id
                : null;
            return Boolean(botId && repliedAuthorId && String(repliedAuthorId) === String(botId));
        }
        return false;
    }

    get userId() {
        return this.platform === 'telegram' ? String(this.event.from?.id || this.event.user?.id) : this.event.user ? this.event.user.id : this.event.author?.id;
    }

    get senderName() {
        return this._formatName(this.platform === 'telegram' ? (this.event.from || this.event.user) : (this.event.user || this.event.author));
    }

    get senderMention() {
        if (this.platform === 'telegram') {
            const user = this.event.from || this.event.user;
            if (user && user.username) return `@${user.username}`;
            return this.senderName;
        }
        if (this.platform === 'discord') {
            return `<@${this.userId}>`;
        }
        return this.senderName;
    }

    get isPrivate() {
        if (this.platform === 'telegram') {
            const chat = this.event.message ? this.event.message.chat : this.event.chat;
            return chat && chat.type === 'private';
        }
        return !this.event.guildId;
    }

    get authMode() {
        if (this.platform === 'telegram' && this.instance.golemConfig && this.instance.golemConfig.tgAuthMode) {
            return String(this.instance.golemConfig.tgAuthMode).toUpperCase();
        }
        if (this.platform === 'discord' && this.instance.golemConfig && this.instance.golemConfig.dcAuthMode) {
            return String(this.instance.golemConfig.dcAuthMode).toUpperCase();
        }
        if (this.platform === 'discord') {
            return CONFIG.DISCORD_AUTH_MODE || 'ADMIN';
        }
        return CONFIG.TG_AUTH_MODE;
    }

    get shouldMentionSender() {
        if (this.platform === 'telegram') {
            // 在 ADMIN 模式或私聊中，不需要 @ 使用者
            if (this.authMode === 'ADMIN' || this.isPrivate) return false;
            return true;
        }
        return !this.isPrivate;
    }

    get replyToName() {
        if (this.platform === 'telegram') {
            const replyMsg = this.event.reply_to_message || (this.event.message && this.event.message.reply_to_message);
            if (replyMsg && replyMsg.from) {
                return this._formatName(replyMsg.from);
            }
        }
        if (this.platform === 'discord') {
            const referencedMessage = this.event.reference?.messageId ? this.event.channel.messages.cache.get(this.event.reference.messageId) : null;
            if (referencedMessage) {
                return referencedMessage.author.globalName || referencedMessage.author.username;
            }
        }
        return null;
    }

    _formatName(user) {
        if (!user) return "未知使用者";
        if (this.platform === 'telegram') {
            const firstName = user.first_name || "";
            const lastName = user.last_name || "";
            const username = user.username ? `@${user.username}` : "";
            const fullName = [firstName, lastName].filter(Boolean).join(" ");
            return fullName || username || "未知使用者";
        }
        return user.globalName || user.username || "未知使用者";
    }

    get chatId() {
        if (this.platform === 'telegram') return this.event.message ? this.event.message.chat.id : this.event.chat.id;
        return this.event.channelId || this.event.channel.id;
    }

    get text() {
        if (typeof this._textOverride === 'string') return this._textOverride;
        if (this.platform === 'telegram') return this.event.text || this.event.caption || "";
        return this.event.content || "";
    }

    setTextOverride(text) {
        this._textOverride = String(text || '');
    }

    async getAttachment() {
        if (this.platform === 'telegram') {
            const msg = this.event;
            let fileId = null;
            let mimeType = 'image/jpeg';
            if (msg.photo) fileId = msg.photo[msg.photo.length - 1].file_id;
            else if (msg.document) {
                fileId = msg.document.file_id;
                mimeType = msg.document.mime_type;
            }
            if (fileId) {
                try {
                    const file = await this.instance.getFile(fileId);
                    return { url: `https://api.telegram.org/file/bot${CONFIG.TG_TOKEN}/${file.file_path}`, mimeType: mimeType };
                } catch (e) { console.error("TG File Error:", e); }
            }
        } else {
            const attachment = this.event.attachments && this.event.attachments.first();
            if (attachment) {
                return { url: attachment.url, mimeType: attachment.contentType || 'application/octet-stream' };
            }
        }
        return null;
    }

    get targetChatId() {
        if (this.platform === 'telegram' && this.instance.golemConfig && this.instance.golemConfig.chatId) {
            return String(this.instance.golemConfig.chatId);
        }
        if (this.platform === 'discord' && this.instance.golemConfig && this.instance.golemConfig.dcChatId) {
            return String(this.instance.golemConfig.dcChatId);
        }
        if (this.platform === 'discord') {
            return CONFIG.DISCORD_CHAT_ID;
        }
        return CONFIG.TG_CHAT_ID;
    }

    get adminIds() {
        if (this.platform === 'telegram' && this.instance.golemConfig && this.instance.golemConfig.adminId) {
            const adminCfg = this.instance.golemConfig.adminId;
            const ids = Array.isArray(adminCfg) ? adminCfg : String(adminCfg).split(',');
            return ids.map(id => String(id).trim()).filter(Boolean);
        }
        if (this.platform === 'discord' && this.instance.golemConfig && this.instance.golemConfig.dcAdminId) {
            const adminCfg = this.instance.golemConfig.dcAdminId;
            const ids = Array.isArray(adminCfg) ? adminCfg : String(adminCfg).split(',');
            return ids.map(id => String(id).trim()).filter(Boolean);
        }
        return CONFIG.ADMIN_IDS;
    }

    get isAdmin() {
        if (this.platform === 'telegram') {
            if (this.authMode === 'CHAT') {
                return String(this.chatId) === String(this.targetChatId);
            }
            // Default ADMIN mode: 必須是 Admin 本人，且必須是在私聊 (Private) 中
            // 避免 Bot 在 Admin 參與的群組中誤觸發
            if (!this.isPrivate) return false;

            const ids = this.adminIds;
            if (ids.length === 0) return true;
            return ids.includes(String(this.userId));
        }

        if (this.platform === 'discord') {
            if (this.authMode === 'CHAT') {
                return String(this.chatId) === String(this.targetChatId);
            }

            const ids = this.adminIds;
            if (ids.length === 0) return true;
            return ids.includes(String(this.userId));
        }

        if (CONFIG.ADMIN_IDS.length === 0) return true;
        return CONFIG.ADMIN_IDS.includes(String(this.userId));
    }

    get messageId() {
        if (this.platform === 'telegram') {
            return this.event.message_id || (this.event.message && this.event.message.message_id);
        }
        return this.event.id;
    }

    async reply(content, options) {
        if (this.isInteraction) {
            try {
                const payload = { content, flags: 64 };
                if (options && options.reply_markup && options.reply_markup.inline_keyboard) {
                    const rows = buildDiscordComponentsFromInlineKeyboard(options.reply_markup.inline_keyboard);
                    if (rows && rows.length > 0) payload.components = rows;
                }
                if (!this.event.deferred && !this.event.replied) {
                    return await this.event.reply(payload);
                } else {
                    return await this.event.followUp(payload);
                }
            } catch (e) {
                console.error('UniversalContext Discord Reply Error:', e.message);
                try {
                    const channel = await this.instance.channels.fetch(this.chatId);
                    return await channel.send(content);
                } catch (err) {
                    console.error('UniversalContext Fallback Error:', err.message);
                }
            }
        }

        // ✨ [v9.1.5 修正] Telegram Topic (Forum) 支援
        let sendOptions = options || {};
        if (this.platform === 'telegram') {
            const threadId = this.event.message_thread_id || (this.event.message && this.event.message.message_thread_id);
            if (threadId) {
                sendOptions = { ...sendOptions, message_thread_id: threadId };
            }

            // ✨ [v9.1.5 鎖定回覆] 自動物理性掛鈎原始訊息，確保回覆對象絕對準確
            // 僅在需要 Mention 的環境 (群組) 下執行，私聊不使用 reply氣泡 以保持簡潔
            if (this.shouldMentionSender && !sendOptions.reply_to_message_id) {
                sendOptions.reply_to_message_id = this.messageId;
            }

            // [v9.1.5 降級策略] 針對觀察者模式，若回覆 ID 過期或無效，則降級為普通發言
            try {
                return await MessageManager.send(this, content, sendOptions);
            } catch (e) {
                if (e.message.includes('reply_to_message_id_invalid') || e.message.includes('message to reply not found')) {
                    console.warn(`⚠️ [UniversalContext] 回覆 ID ${this.messageId} 失效，切換至一般發言回饋。`);
                    delete sendOptions.reply_to_message_id;
                    return await MessageManager.send(this, content, sendOptions);
                }
                throw e;
            }
        }

        return await MessageManager.send(this, content, sendOptions);
    }

    async sendDocument(filePath) {
        try {
            if (this.platform === 'telegram') {
                // ✨ [v9.1.5 修正] Telegram Topic (Forum) 支援
                let sendOptions = {};
                const threadId = this.event.message_thread_id || (this.event.message && this.event.message.message_thread_id);
                if (threadId) {
                    sendOptions.message_thread_id = threadId;
                }
                await this.instance.sendDocument(this.chatId, filePath, sendOptions);
            }
            else {
                const channel = await this.instance.channels.fetch(this.chatId);
                await channel.send({ files: [filePath] });
            }
        } catch (e) {
            if (e.message.includes('Request entity too large')) await this.reply(`⚠️ 檔案過大 (Discord Limit 25MB)。`);
            else await this.reply(`❌ 傳送失敗: ${e.message}`);
        }
    }

    get messageTime() {
        if (this.platform === 'telegram') {
            const msg = this.event.message || this.event;
            return msg.date ? msg.date * 1000 : null;
        }
        if (this.platform === 'discord') {
            return this.event.createdTimestamp || null;
        }
        return null;
    }

    async sendTyping() {
        if (this.isInteraction) return;
        if (this.platform === 'telegram') {
            this.instance.sendChatAction(this.chatId, 'typing');
        } else {
            try {
                const channel = await this.instance.channels.fetch(this.chatId);
                await channel.sendTyping();
            } catch (e) { }
        }
    }
}

module.exports = UniversalContext;
