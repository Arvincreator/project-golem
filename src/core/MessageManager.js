const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// ============================================================
// 📨 Message Manager (雙模版訊息切片器)
// ============================================================
class MessageManager {
    static async send(ctx, text, options = {}) {
        if (!text) return;
        const MAX_LENGTH = ctx.platform === 'telegram' ? 4000 : 1900;
        const chunks = [];
        let remaining = text;
        while (remaining.length > 0) {
            if (remaining.length <= MAX_LENGTH) { chunks.push(remaining); break; }
            let splitIndex = remaining.lastIndexOf('\n', MAX_LENGTH);
            if (splitIndex === -1) splitIndex = MAX_LENGTH;
            chunks.push(remaining.substring(0, splitIndex));
            remaining = remaining.substring(splitIndex).trim();
        }

        for (const chunk of chunks) {
            let retries = 3;
            while (retries > 0) {
                try {
                    if (ctx.platform === 'telegram') {
                        await ctx.instance.sendMessage(ctx.chatId, chunk, options);
                    } else {
                        const channel = await ctx.instance.channels.fetch(ctx.chatId);
                        const dcOptions = { content: chunk };
                        if (options.reply_markup && options.reply_markup.inline_keyboard) {
                            const row = new ActionRowBuilder();
                            options.reply_markup.inline_keyboard[0].forEach(btn => {
                                row.addComponents(new ButtonBuilder().setCustomId(btn.callback_data).setLabel(btn.text).setStyle(ButtonStyle.Primary));
                            });
                            dcOptions.components = [row];
                        }
                        await channel.send(dcOptions);
                    }
                    break; // 成功就跳出
                } catch (e) {
                    retries--;
                    if (retries > 0 && (e.code === 'ETELEGRAM' || e.code === 'ECONNRESET' || e.message.includes('429'))) {
                        const delay = e.message.includes('429') ? 3000 : 1000;
                        console.warn(`[MessageManager] Retry in ${delay}ms (${retries} left): ${e.message}`);
                        await new Promise(r => setTimeout(r, delay));
                    } else {
                        console.error(`[MessageManager] Send failed: ${e.message}`);
                        break;
                    }
                }
            }
        }
    }
}

module.exports = MessageManager;
