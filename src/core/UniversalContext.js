const { CONFIG } = require('../config');
const MessageManager = require('./MessageManager');

// ============================================================
// 🔌 Universal Context (通用語境層)
// ============================================================
class UniversalContext {
    constructor(platform, event, instance) {
        this.platform = platform;
        this.event = event;
        this.instance = instance;
        this.isInteraction = platform === 'discord' && (event.isButton?.() || event.isCommand?.());
    }

    get userId() {
        return this.platform === 'telegram' ? String(this.event.from?.id || this.event.user?.id) : this.event.user ? this.event.user.id : this.event.author?.id;
    }

    get chatId() {
        if (this.platform === 'telegram') return this.event.message ? this.event.message.chat.id : this.event.chat.id;
        return this.event.channelId || this.event.channel.id;
    }

    get text() {
        if (this.platform === 'telegram') return this.event.text || this.event.caption || "";
        return this.event.content || "";
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

    get isAdmin() {
        if (this.platform === 'telegram') {
            if (CONFIG.TG_AUTH_MODE === 'CHAT') {
                return String(this.chatId) === String(CONFIG.TG_CHAT_ID);
            }
            // Default ADMIN mode
            if (CONFIG.ADMIN_IDS.length === 0) return true;
            return CONFIG.ADMIN_IDS.includes(String(this.userId));
        }

        // Other platforms (Discord)
        if (CONFIG.ADMIN_IDS.length === 0) return true;
        return CONFIG.ADMIN_IDS.includes(String(this.userId));
    }

    async reply(content, options) {
        if (this.isInteraction) {
            try {
                if (!this.event.deferred && !this.event.replied) {
                    return await this.event.reply({ content, flags: 64 });
                } else {
                    return await this.event.followUp({ content, flags: 64 });
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

        // ✨ [V9.0.2 修正] Telegram Topic (Forum) 支援
        let sendOptions = options || {};
        if (this.platform === 'telegram') {
            const threadId = this.event.message_thread_id || (this.event.message && this.event.message.message_thread_id);
            if (threadId) {
                sendOptions = { ...sendOptions, message_thread_id: threadId };
            }
        }

        return await MessageManager.send(this, content, sendOptions);
    }

    async sendDocument(filePath) {
        try {
            if (this.platform === 'telegram') {
                // ✨ [V9.0.2 修正] Telegram Topic (Forum) 支援
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
