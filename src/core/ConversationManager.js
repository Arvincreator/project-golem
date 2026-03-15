const { v4: uuidv4 } = require('uuid');

// ============================================================
// Conversation Manager (Queue + Adaptive Debounce)
// ============================================================
class ConversationManager {
    constructor(brain, neuroShunterClass, controller, options = {}) {
        this.golemId = options.golemId || 'default';
        this.brain = brain;
        this.NeuroShunter = neuroShunterClass;
        this.controller = controller;
        this.queue = [];
        this.isProcessing = false;
        this.userBuffers = new Map();
        this.silentMode = false;
        this.observerMode = false;
        this.interventionLevel = options.interventionLevel || 'CONSERVATIVE';
        // Adaptive debounce: first message fast, subsequent messages slower
        this.DEBOUNCE_FIRST_MS = 100;
        this.DEBOUNCE_SUBSEQUENT_MS = 1500;
        this._lastMessageTime = new Map(); // chatId → timestamp
    }

    _getDebounceMs(chatId) {
        const now = Date.now();
        const last = this._lastMessageTime.get(chatId) || 0;
        this._lastMessageTime.set(chatId, now);
        // If >5s since last message, treat as first message (fast debounce)
        return (now - last > 5000) ? this.DEBOUNCE_FIRST_MS : this.DEBOUNCE_SUBSEQUENT_MS;
    }

    async enqueue(ctx, text, options = { isPriority: false, bypassDebounce: false }) {
        const chatId = ctx.chatId;

        if (options.bypassDebounce) {
            console.log(`[Queue] Priority bypass (${chatId}): "${text.substring(0, 15)}..."`);
            this._commitDirectly(ctx, text, options.isPriority);
            return;
        }

        let userState = this.userBuffers.get(chatId) || { text: "", timer: null, ctx: ctx };
        userState.text = userState.text ? `${userState.text}\n${text}` : text;
        userState.ctx = ctx;
        console.log(`[Queue] Received (${chatId}): "${text.substring(0, 15)}..."`);
        if (userState.timer) clearTimeout(userState.timer);
        const debounceMs = this._getDebounceMs(chatId);
        userState.timer = setTimeout(() => {
            this._commitToQueue(chatId);
        }, debounceMs);
        this.userBuffers.set(chatId, userState);
    }

    _commitDirectly(ctx, text, isPriority) {
        if (!isPriority && this.queue.length >= 1) {
            const approvalId = uuidv4();
            this.controller.pendingTasks.set(approvalId, {
                type: 'DIALOGUE_QUEUE_APPROVAL',
                ctx, text, timestamp: Date.now()
            });
            ctx.reply(
                `🚨 **大腦思考中**\n目前有 \`${this.queue.length}\` 則訊息正在等待處理。\n\n請問這則新訊息是否要 **急件插隊**？`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '⬆️ 急件插隊', callback_data: `DIAPRIORITY_${approvalId}` },
                            { text: '⬇️ 正常排隊', callback_data: `DIAAPPEND_${approvalId}` }
                        ]]
                    }
                }
            ).then(msg => {
                setTimeout(async () => {
                    const task = this.controller.pendingTasks.get(approvalId);
                    if (task && task.type === 'DIALOGUE_QUEUE_APPROVAL') {
                        this.controller.pendingTasks.delete(approvalId);
                        console.log(`[Queue] Timeout, auto-append ${approvalId}`);
                        try {
                            if (ctx.platform === 'telegram' && msg && msg.message_id) {
                                await ctx.instance.editMessageText(
                                    `🚨 **大腦思考中**\n*(預設) 已將此訊息自動排入隊尾。*`,
                                    { chat_id: ctx.chatId, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } }
                                ).catch(() => { });
                            }
                        } catch (e) { }
                        this._actualCommit(ctx, text, false);
                    }
                }, 30000);
            });
            return;
        }
        this._actualCommit(ctx, text, isPriority);
    }

    _actualCommit(ctx, text, isPriority) {
        console.log(`[Queue] Commit ${isPriority ? '[VIP]' : ''}`);
        if (isPriority) { this.queue.unshift({ ctx, text }); }
        else { this.queue.push({ ctx, text }); }
        this._processQueue();
    }

    _commitToQueue(chatId) {
        const userState = this.userBuffers.get(chatId);
        if (!userState || !userState.text) return;
        const fullText = userState.text;
        const currentCtx = userState.ctx;
        this.userBuffers.delete(chatId);
        this._commitDirectly(currentCtx, fullText, false);
    }

    async _processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;
        const task = this.queue.shift();
        try {
            console.log(`[Queue:${this.golemId}] Processing...`);
            console.log(`[User->${this.golemId}] ${task.text}`);

            this.brain._appendChatLog({
                timestamp: Date.now(),
                sender: 'User',
                content: task.text,
                type: 'user',
                role: 'User',
                isSystem: false
            });

            await task.ctx.sendTyping();
            const memories = await this.brain.recall(task.text);
            let finalInput = task.text;
            if (memories.length > 0) {
                finalInput = `【相關記憶】\n${memories.map(m => `• ${m.text}`).join('\n')}\n---\n${finalInput}`;
            }
            const isMentioned = task.ctx.isMentioned ? task.ctx.isMentioned(task.text) : false;

            if (this.silentMode && !isMentioned) {
                console.log(`[Queue:${this.golemId}] Silent mode, skipping.`);
                return;
            }

            const shouldSuppressReply = this.observerMode && !isMentioned;
            if (shouldSuppressReply) {
                console.log(`[Queue:${this.golemId}] Observer mode, listening...`);
            }

            const raw = await this.brain.sendMessage(finalInput, false, {
                isObserver: this.observerMode,
                interventionLevel: this.interventionLevel
            });
            await this.NeuroShunter.dispatch(task.ctx, raw, this.brain, this.controller, { suppressReply: shouldSuppressReply });
        } catch (e) {
            console.error(`[Queue:${this.golemId}] Error:`, e);
            await task.ctx.reply(`⚠️ 系統暫時無法回應，請稍後再試。`);
        } finally {
            this.isProcessing = false;
            setTimeout(() => this._processQueue(), 500);
        }
    }
}

module.exports = ConversationManager;
