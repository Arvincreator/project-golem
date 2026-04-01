const { randomUUID } = require('crypto');
const ConfigManager = require('../config');
const ConfidenceTracker = require('../managers/ConfidenceTracker');
const PlanningModeExecutor = require('./PlanningModeExecutor');

function parseRatio(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) return fallback;
    return parsed;
}

function parsePositiveInteger(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

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
        this.memoryPressureGuard = null;
        this.planningExecutor = options.planningExecutor || new PlanningModeExecutor({
            brain: this.brain,
            controller: this.controller,
        });
        this.heapGcWarnRatio = parseRatio(
            process.env.GOLEM_HEAP_GC_WARN_PCT,
            parseRatio(process.env.GOLEM_MEMORY_FATAL_PCT, 0.92)
        );
        this.heapGcMinTotalMb = parsePositiveInteger(process.env.GOLEM_HEAP_GC_MIN_TOTAL_MB, 96);

        // 初始化信心追蹤器
        this.confidenceTracker = new ConfidenceTracker(this.brain.chatLogManager);
        this.userConfidenceState = new Map();

        // 🔄 [Instance Pooling] 背景監控與定時重啟定時器
        this.UPTIME_LIMIT_MS = 24 * 60 * 60 * 1000; // 24H
        this._healthCheckInterval = setInterval(() => this._checkInstanceHealth(), 60 * 60 * 1000); // Check every hour
    }

    destroy() {
        if (this._healthCheckInterval) {
            clearInterval(this._healthCheckInterval);
            this._healthCheckInterval = null;
        }
    }

    setMemoryPressureGuard(guard) {
        this.memoryPressureGuard = guard || null;
        if (!process.env.GOLEM_HEAP_GC_WARN_PCT && guard && Number.isFinite(guard.fatalRatio) && guard.fatalRatio > 0 && guard.fatalRatio < 1) {
            this.heapGcWarnRatio = guard.fatalRatio;
        }
    }

    _isRecoverableInteractionError(error) {
        const message = String((error && error.message) || error || '');
        return /Target page, context or browser has been closed|Execution context was destroyed|browser has been closed|Page closed/i.test(message);
    }

    _evaluateHeapGcNeed(heapObj = process.memoryUsage()) {
        const heapRatio = heapObj.heapTotal > 0 ? (heapObj.heapUsed / heapObj.heapTotal) : 0;
        const usedMB = Math.round(heapObj.heapUsed / 1024 / 1024);
        const totalMB = Math.round(heapObj.heapTotal / 1024 / 1024);
        const shouldCollect = heapRatio > this.heapGcWarnRatio && totalMB >= this.heapGcMinTotalMb;
        return { shouldCollect, heapRatio, usedMB, totalMB };
    }

    async _checkInstanceHealth() {
        if (this.isProcessing || this.queue.length > 0) return; // 不要干擾進行中的對話
        if (this.brain && this.brain.browserStartTime && (Date.now() - this.brain.browserStartTime > this.UPTIME_LIMIT_MS)) {
            console.log(`🔄 [Instance Pooling] 大腦實體已達生命週期 (24小時)，目前系統閒置。開始背景重啟實體池...`);
            this.isProcessing = true; // 鎖住隊列，防止新請求干擾
            try {
                await this.brain._ensureBrowserHealth(true);
                console.log(`✅ [Instance Pooling] 閒置背景重啟完成！`);
            } catch (e) {
                console.warn(`⚠️ [Instance Pooling] 閒置背景重啟失敗:`, e.message);
            } finally {
                this.isProcessing = false;
                this._processQueue(); // 重新觸發可能在鎖定期間累積的隊列
            }
        }
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
            const approvalId = randomUUID();

            // 將對話任務暫存在 Controller 的 pendingTasks
            if (this.controller && typeof this.controller.registerPendingTask === 'function') {
                this.controller.registerPendingTask(approvalId, {
                    type: 'DIALOGUE_QUEUE_APPROVAL',
                    text,
                    attachment,
                    options, // 🎯 [v9.1.13] 攜帶附加選項
                    sourceChannel: ctx && ctx.platform ? ctx.platform : 'unknown',
                    chatId: ctx && ctx.chatId ? String(ctx.chatId) : '',
                    timestamp: Date.now(),
                }, {
                    actor: 'system',
                    ttlMs: 30 * 1000,
                });
            } else {
                this.controller.pendingTasks.set(approvalId, {
                    type: 'DIALOGUE_QUEUE_APPROVAL',
                    text,
                    attachment,
                    options,
                    timestamp: Date.now(),
                });
            }

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
                    const task = this.controller && typeof this.controller.getPendingTask === 'function'
                        ? this.controller.getPendingTask(approvalId)
                        : this.controller.pendingTasks.get(approvalId);
                    if (task && task.type === 'DIALOGUE_QUEUE_APPROVAL') {
                        if (this.controller && typeof this.controller.deletePendingTask === 'function') {
                            this.controller.deletePendingTask(approvalId, { reason: 'timeout', actor: 'system' });
                        } else {
                            this.controller.pendingTasks.delete(approvalId);
                        }
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

        if (this.memoryPressureGuard) {
            try {
                await this.memoryPressureGuard.sample({
                    source: 'conversation.pre',
                    queueLength: this.queue.length,
                });
            } catch {}
        }

        // 🧹 [Extra Arch 3] Memory Guard 記憶體上限監控
        const heapCheck = this._evaluateHeapGcNeed();
        if (heapCheck.shouldCollect) {
            console.warn(`⚠️ [Memory Guard] 堆疊記憶體使用率達 ${(heapCheck.heapRatio * 100).toFixed(1)}% (${heapCheck.usedMB}MB / ${heapCheck.totalMB}MB)，強制觸發系統回收...`);
            if (global.gc) global.gc();
        }

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
            const memories = await this.brain.recall(task.text);
            let finalInput = task.text;
            if (memories.length > 0) {
                finalInput = `【相關記憶】\n${memories.map(m => `• ${m.text}`).join('\n')}\n---\n${finalInput}`;
            }

            if (this.controller && typeof this.controller.getPendingContextSummary === 'function') {
                const pendingSummary = this.controller.getPendingContextSummary(12);
                if (pendingSummary) {
                    finalInput = `${finalInput}\n\n【Pending Tasks Snapshot】\n${pendingSummary}\n\n【Task Governance】\n有 pending snapshot 時優先 task_resume/task_get，延續既有任務；多步任務再更新 task list，維持一個 in_progress，其餘標記 pending/blocked。對使用者回覆請用自然語言，不主動拋出 taskId 或 JSON。`;
                }
            }
            if (this.controller && typeof this.controller.getPendingAgentContextSummary === 'function') {
                const pendingAgentSummary = this.controller.getPendingAgentContextSummary(8);
                if (pendingAgentSummary) {
                    finalInput = `${finalInput}\n\n【Pending Agent Sessions Snapshot】\n${pendingAgentSummary}\n\n【Agent Governance】\n若有 pending agent sessions，先 agent_resume/agent_get 延續既有 session，再決定是否新建 agent_session_create。對使用者回覆維持人話摘要，不展示 session/worker 內部 ID。`;
                }
            }
            const isMentioned = task.ctx.isMentioned ? task.ctx.isMentioned(task.text) : false;

            if (this.silentMode && !isMentioned) {
                console.log(`🤫 [Dialogue Queue:${this.golemId}] 完全靜默模式啟動中，且未被標記，跳過大腦處理。`);
                this.isProcessing = false;
                setTimeout(() => this._processQueue(), 500);
                return;
            }

            const shouldSuppressReply = this.observerMode && !isMentioned;

            if (shouldSuppressReply) {
                console.log(`👁️ [Dialogue Queue:${this.golemId}] 觀察者模式監聽中 (背景同步上下文)...`);
            }

            if (isMentioned && (this.silentMode || this.observerMode)) {
                console.log(`📢 [Dialogue Queue:${this.golemId}] 模式中偵測到標記，強制恢復回應。`);
            }

            const sendOptions = {
                isObserver: this.observerMode,
                interventionLevel: this.interventionLevel,
                attachment: task.attachment,
                ...task.options // 🎯 [v9.1.13] 透傳來自隊列的自定義選項 (如 suppressReply)
            };

            const shouldSuppressFinalReply = shouldSuppressReply || task.options.suppressReply === true;

            if (task.options && task.options.executionMode === 'planning_auto' && this.planningExecutor) {
                await this.planningExecutor.execute({
                    ctx: task.ctx,
                    userInput: finalInput,
                    attachment: task.attachment,
                    actor: task.ctx && task.ctx.senderName ? task.ctx.senderName : 'user',
                    source: 'planning_auto',
                    routeDecision: task.options.planningDecision || {},
                    suppressFinalReply: shouldSuppressFinalReply,
                });
                return;
            }

            let brainResponse = null;
            const maxAttempts = 3;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    brainResponse = await this.brain.sendMessage(finalInput, false, sendOptions);
                    break;
                } catch (error) {
                    const isRecoverable = this._isRecoverableInteractionError(error);
                    if (!isRecoverable || attempt === maxAttempts) {
                        throw error;
                    }

                    console.warn(`⚠️ [Dialogue Queue:${this.golemId}] 互動通道中斷，準備重試 (${attempt}/${maxAttempts})...`);
                    try {
                        if (this.brain && typeof this.brain._ensureBrowserHealth === 'function') {
                            await this.brain._ensureBrowserHealth(true, { allowDuringInteraction: true });
                        }
                    } catch (healError) {
                        console.warn(`⚠️ [Dialogue Queue:${this.golemId}] 重試前自癒失敗: ${healError.message}`);
                    }

                    await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
                }
            }

            let { text: raw, attachments: responseAttachments, status: extractorStatus } = brainResponse;

            // ✨ [Metacognition] AUQ 信心評分與標記
            const evaluation = this.confidenceTracker.evaluate(raw, extractorStatus, task.text);
            
            // O-5 用戶專屬信心狀態追蹤
            const chatId = task.ctx.chatId;
            const state = this.userConfidenceState.get(chatId) || { lowScoreCount: 0 };
            if (evaluation.score < 0.5) {
                state.lowScoreCount++;
                if (state.lowScoreCount >= 3) {
                    await task.ctx.reply(`⚠️ 我最近對這類問題的回答品質偏低，建議您考慮切換模型 (例如使用 \`/model thinking\`) 或重載技能書。`);
                    state.lowScoreCount = 0; // 重置
                }
            } else {
                state.lowScoreCount = Math.max(0, state.lowScoreCount - 1);
            }
            this.userConfidenceState.set(chatId, state);

            // O-1 低信心自動重試
            if (evaluation.score < 0.5 && !task.options._isRetry) {
                console.warn(`🔄 [Metacognition] 低信心回應，自動追問澄清...`);
                // 非同步寫入原本的失敗紀錄 (用於除錯)
                this.confidenceTracker.record({
                    query: task.text,
                    response: raw,
                    score: evaluation.score,
                    label: evaluation.label,
                    flags: evaluation.flags,
                    extractor_status: extractorStatus
                }).catch(e => console.error("[ConfidenceTracker] Record error:", e));

                const retryPrompt = `你剛才的回答信心測值偏低，請重新分析並給出更確定的答案：\n${task.text}`;
                this.queue.unshift({
                    ...task,
                    text: retryPrompt,
                    options: { ...task.options, _isRetry: true } // 標記為已重試過，避免無限迴圈
                });
                
                this.isProcessing = false;
                setTimeout(() => this._processQueue(), 500);
                return;
            }

            if (evaluation.score < 0.5) {
                raw += `\n\n🔶 *(系統提示: AI 信心指數 ${(evaluation.score * 100).toFixed(0)}% · ${evaluation.label})*`;
            }
            // 非同步寫入歷史紀錄
            this.confidenceTracker.record({
                query: task.text,
                response: raw,
                score: evaluation.score,
                label: evaluation.label,
                flags: evaluation.flags,
                extractor_status: extractorStatus
            }).catch(e => console.error("[ConfidenceTracker] Record error:", e));

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
            
            // 🧹 [Memory Optimization] 強制執行 V8 垃圾回收，釋放回合變數
            if (global.gc) {
                global.gc();
            }

            if (this.memoryPressureGuard) {
                try {
                    await this.memoryPressureGuard.sample({
                        source: 'conversation.post',
                        queueLength: this.queue.length,
                    });
                } catch {}
            }
            
            setTimeout(() => this._processQueue(), 500);
        }
    }
}

module.exports = ConversationManager;
