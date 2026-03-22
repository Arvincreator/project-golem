const { v4: uuidv4 } = require('uuid');
const ConfigManager = require('../config');

// ============================================================
// 🚦 Conversation Manager (隊列與防抖系統 - 多用戶隔離版)
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
        this.DEBOUNCE_MS = 1500;
        this.autoTurnCount = 0; // 🎯 [v9.1.15] Track autonomous turns
    }

    async enqueue(ctx, text, options = { isPriority: false, bypassDebounce: false, attachment: null }) {
        const chatId = ctx.chatId;

        // 🚨 Highest Privilege: priority tasks bypass user buffers completely and inject straight into queue
        if (options.bypassDebounce) {
            console.log(`⚡ [Dialogue Queue] 高優先級請求繞過防抖機制 (${chatId}): "${text.substring(0, 15)}..."`);
            
            // 🎯 [v9.1.15] Reset or increment auto turn count
            if (options.isSystemFeedback) {
                this.autoTurnCount++;
                console.log(`🔄 [Dialogue Queue] 自動模式回合數: ${this.autoTurnCount}/${ConfigManager.CONFIG.MAX_AUTO_TURNS || 5}`);
            } else {
                this.autoTurnCount = 0;
            }

            this._commitDirectly(ctx, text, options.isPriority, options.attachment, options);
            return;
        }

        let userState = this.userBuffers.get(chatId) || { text: "", timer: null, ctx: ctx, attachments: [], options: {} };
        userState.text = userState.text ? `${userState.text}\n${text}` : text;
        userState.ctx = ctx;
        if (options.attachment) {
            userState.attachments = userState.attachments || [];
            userState.attachments.push(options.attachment);
        }
        userState.options = { ...userState.options, ...options };

        console.log(`⏳ [Dialogue Queue] 收到對話 (${chatId}): "${text.substring(0, 15)}..."${options.attachment ? ' 📎 含有附件' : ''}`);
        if (userState.timer) clearTimeout(userState.timer);
        userState.timer = setTimeout(() => {
            // 🎯 [v9.1.15] User messages coming through debounce also reset the counter
            this.autoTurnCount = 0;
            this._commitToQueue(chatId);
        }, this.DEBOUNCE_MS);
        this.userBuffers.set(chatId, userState);
    }

    _commitDirectly(ctx, text, isPriority, attachment = null, options = {}) {
        // ✨ [v9.1 插隊系統：大腦層擴充]
        // 如果不是特急件 (isPriority=false)，且隊列中已有任務 (長度 >= 1)，則觸發詢問
        if (!isPriority && this.queue.length >= 1) {
            const approvalId = uuidv4();

            // 將對話任務暫存在 Controller 的 pendingTasks
            this.controller.pendingTasks.set(approvalId, {
                type: 'DIALOGUE_QUEUE_APPROVAL',
                ctx,
                text,
                attachment,
                options, // 🎯 [v9.1.13] 攜帶附加選項
                timestamp: Date.now()
            });

            // 回傳 Telegram 行內鍵盤選項
            ctx.reply(
                `🚨 **大腦思考中**\n目前有 \`${this.queue.length}\` 則訊息正在等待處理，且 Golem 正在專心做其他事。\n\n請問這則新訊息是否要 **急件插隊**？`,
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
                // 30 秒自動 Timeout 防呆 (預設為 Append)
                setTimeout(async () => {
                    const task = this.controller.pendingTasks.get(approvalId);
                    if (task && task.type === 'DIALOGUE_QUEUE_APPROVAL') {
                        this.controller.pendingTasks.delete(approvalId);
                        console.log(`⏳ [Dialogue Queue] 互動超時，任務 ${approvalId} 自動排入隊尾。`);

                        try {
                            if (ctx.platform === 'telegram' && msg && msg.message_id) {
                                await ctx.instance.editMessageText(
                                    `🚨 **大腦思考中**\n目前對話佇列繁忙。\n\n*(預設) 已將此訊息自動排入對話隊尾。*`,
                                    {
                                        chat_id: ctx.chatId,
                                        message_id: msg.message_id,
                                        parse_mode: 'Markdown',
                                        reply_markup: { inline_keyboard: [] }
                                    }
                                ).catch(() => { });
                            }
                        } catch (e) { console.warn("無法更新 Dialogue Timeout 訊息:", e.message); }

                        // 超時後強制以一般優先級入隊
                        this._actualCommit(ctx, text, false, attachment);
                    }
                }, 30000);
            });
            return;
        }

        // 正常入隊
        this._actualCommit(ctx, text, isPriority, attachment, options);
    }

    _actualCommit(ctx, text, isPriority, attachment = null, options = {}) {
        console.log(`📦 [Dialogue Queue] 加入隊列 (Direct) ${isPriority ? '[💥VIP 插隊中]' : ''} - 準備交由大腦處理`);
        if (isPriority) {
            this.queue.unshift({ ctx, text, attachment, options }); // Priority goes to the front of the line
        } else {
            this.queue.push({ ctx, text, attachment, options });
        }
        this._processQueue();
    }

    _commitToQueue(chatId) {
        const userState = this.userBuffers.get(chatId);
        if (!userState || !userState.text) return;
        const fullText = userState.text;
        const currentCtx = userState.ctx;
        const attachment = userState.attachments && userState.attachments.length > 0 ? userState.attachments[0] : null; // 目前僅支援單張，取第一張
        const options = userState.options || {};
        this.userBuffers.delete(chatId);
        this._commitDirectly(currentCtx, fullText, false, attachment, options);
    }

    async _processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;

        // 🎯 [v9.1.15] Enforce Max Auto Turns limit
        const maxTurns = ConfigManager.CONFIG.MAX_AUTO_TURNS || 5;
        if (this.autoTurnCount >= maxTurns) {
            const lastTask = this.queue[0];
            if (lastTask && lastTask.options && lastTask.options.isSystemFeedback) {
                console.warn(`🛑 [Dialogue Queue] 已達到自動模式回合上限 (${maxTurns})，停止自動循環。`);
                this.queue.shift(); // Remove the system feedback task
                await lastTask.ctx.reply(`⚠️ **自動執行已中止**\n已達到連續自動執行上限 (\`${maxTurns}\` 回合)。為了安全起見，請手動介入確認或重新下達指令。`, { parse_mode: 'Markdown' });
                this.autoTurnCount = 0; // Reset for next user interaction
                this._processQueue();
                return;
            }
        }

        this.isProcessing = true;
        const task = this.queue.shift();
        try {
            console.log(`🚀 [Dialogue Queue:${this.golemId}] 從隊列取出，開始處理對話...`);
            console.log(`🗣️ [User->${this.golemId}] 說: ${task.text}${task.attachment ? ' 📎 含有附件' : ''}`, { attachment: task.attachment });

            // ✨ [Log] 記錄用戶輸入 (Fix missing user logs)
            this.brain._appendChatLog({
                timestamp: Date.now(),
                sender: 'User', // 統一顯示為 User，也可由 ctx.userId 區分
                content: task.text,
                type: 'user',
                role: 'User',
                isSystem: false,
                attachment: task.attachment
            });

            await task.ctx.sendTyping();
            
            // 🧠 [v9.2] RAG Skill Retrieval: Dynamically fetch relevant skills
            let dynamicSkills = [];
            if (this.brain.skillIndex && typeof this.brain.skillIndex.searchRelevantSkills === 'function') {
                dynamicSkills = await this.brain.skillIndex.searchRelevantSkills(task.text, 3);
                if (dynamicSkills.length > 0) {
                    console.log(`🎯 [Dialogue Queue:${this.golemId}] RAG 動態提取技能: ${dynamicSkills.map(s => s.id).join(', ')}`);
                }
            }

            const memories = await this.brain.recall(task.text);
            let finalInput = task.text;
            if (memories.length > 0) {
                finalInput = `【相關記憶】\n${memories.map(m => `• ${m.text}`).join('\n')}\n---\n${finalInput}`;
            }
            const isMentioned = task.ctx.isMentioned ? task.ctx.isMentioned(task.text) : false;

            if (this.silentMode && !isMentioned) {
                console.log(`🤫 [Dialogue Queue:${this.golemId}] 完全靜默模式啟動中，且未被標記，跳過大腦處理。`);
                return;
            }

            const shouldSuppressReply = this.observerMode && !isMentioned;

            if (shouldSuppressReply) {
                console.log(`👁️ [Dialogue Queue:${this.golemId}] 觀察者模式監聽中 (背景同步上下文)...`);
            }

            if (isMentioned && (this.silentMode || this.observerMode)) {
                console.log(`📢 [Dialogue Queue:${this.golemId}] 模式中偵測到標記，強制恢復回應。`);
            }

            const brainResponse = await this.brain.sendMessage(finalInput, false, {
                isObserver: this.observerMode,
                interventionLevel: this.interventionLevel,
                attachment: task.attachment,
                dynamicSkills: dynamicSkills, // 🎯 [v9.2] RAG Injected Skills
                ...task.options // 🎯 [v9.1.13] 透傳來自隊列的自定義選項 (如 suppressReply)
            });

            const { text: raw, attachments: responseAttachments } = brainResponse;

            await this.NeuroShunter.dispatch(task.ctx, raw, this.brain, this.controller, { 
                suppressReply: shouldSuppressReply || task.options.suppressReply === true,
                attachments: responseAttachments 
            });
        } catch (e) {
            console.error(`❌ [Dialogue Queue:${this.golemId}] 處理失敗:`, e);
            // ✅ [M-4 Fix] 對外只顯示友善錯誤，避免洩露路徑/Selector 等內部資訊
            await task.ctx.reply(`⚠️ 系統暫時無法回應，請稍後再試。`);
        } finally {
            this.isProcessing = false;
            setTimeout(() => this._processQueue(), 500);
        }
    }
}

module.exports = ConversationManager;
