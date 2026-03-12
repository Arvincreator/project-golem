const MAX_QUEUE_DEPTH = 10;
const MAX_DLQ_SIZE = 20;
const DUPLICATE_WINDOW_MS = 5000;
const TASK_MAX_AGE_MS = 60000;

class ActionQueue {
    constructor(options = {}) {
        this.golemId = options.golemId || 'default';
        this.queue = [];
        this.isProcessing = false;
        this._dlq = [];           // Dead-letter queue for failed tasks
        this._recentKeys = [];    // [{key, ts}] for duplicate detection
    }

    /**
     * 加入新任務到行動產線 (Action Queue)
     * @param {Object} ctx - 上下文物件
     * @param {Function} taskFn - 回傳 Promise 的執行函式 (例如 child_process.exec)
     * @param {Object} options - 選項, priority 等
     */
    async enqueue(ctx, taskFn, options = { isPriority: false }) {
        // Queue depth limit
        if (this.queue.length >= MAX_QUEUE_DEPTH) {
            console.warn(`[ActionQueue:${this.golemId}] 🛑 Queue full (${this.queue.length}/${MAX_QUEUE_DEPTH}), rejecting task.`);
            if (ctx && typeof ctx.reply === 'function') {
                await ctx.reply('⚠️ 行動佇列已滿，請稍後再試。').catch(() => {});
            }
            return;
        }

        // Duplicate detection: hash the taskFn source to detect identical actions
        const taskKey = options.dedupKey || null;
        if (taskKey) {
            const now = Date.now();
            this._recentKeys = this._recentKeys.filter(r => now - r.ts < DUPLICATE_WINDOW_MS);
            if (this._recentKeys.some(r => r.key === taskKey)) {
                console.warn(`[ActionQueue:${this.golemId}] ⏭️ Duplicate task skipped: ${taskKey}`);
                return;
            }
            this._recentKeys.push({ key: taskKey, ts: now });
        }

        console.log(`📥 [Action Queue:${this.golemId}] 收到新行動任務、加入隊列 (Priority: ${options.isPriority}, Depth: ${this.queue.length + 1})`);

        const taskItem = {
            ctx,
            taskFn,
            timestamp: Date.now(),
            isPriority: options.isPriority,
            dedupKey: taskKey,
        };

        if (options.isPriority) {
            this.queue.unshift(taskItem);
        } else {
            this.queue.push(taskItem);
        }

        this._processQueue();
    }

    /**
     * 內部佇列處理器 (Sequential Execution)
     */
    async _processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;
        const task = this.queue.shift();

        // Task age expiry — skip stale tasks
        const age = Date.now() - task.timestamp;
        if (age > TASK_MAX_AGE_MS) {
            console.warn(`[ActionQueue:${this.golemId}] ⏰ Task expired (age: ${Math.round(age / 1000)}s), skipping.`);
            this.isProcessing = false;
            setTimeout(() => this._processQueue(), 100);
            return;
        }

        try {
            console.log(`⚙️ [Action Queue:${this.golemId}] 從隊列取出，開始非同步執行行動任務...`);

            // 如果上層有指定發送 Typing 可以先發
            if (task.ctx && typeof task.ctx.sendTyping === 'function') {
                task.ctx.sendTyping().catch(() => { });
            }

            // 執行被封裝的物理操作
            await task.taskFn();

            console.log(`✅ [Action Queue:${this.golemId}] 行動任務非同步執行完畢。`);
        } catch (error) {
            console.error(`❌ [Action Queue:${this.golemId}] 行動任務執行失敗:`, error);

            // Dead-letter queue: store failed tasks for debugging
            this._dlq.push({
                error: error.message,
                dedupKey: task.dedupKey,
                timestamp: task.timestamp,
                failedAt: Date.now(),
            });
            if (this._dlq.length > MAX_DLQ_SIZE) this._dlq.shift();

            if (task.ctx && typeof task.ctx.reply === 'function') {
                task.ctx.reply(`❌ **系統層任務執行崩潰:**\n\`\`\`\n${error.message}\n\`\`\``, { parse_mode: 'Markdown' }).catch(() => { });
            }
        } finally {
            this.isProcessing = false;

            // 稍作延遲再提取下一個任務，避免過度頻繁刷新
            setTimeout(() => this._processQueue(), 200);
        }
    }

    /**
     * Get dead-letter queue contents (for diagnostics/dashboard)
     */
    getDLQ() {
        return [...this._dlq];
    }

    /**
     * Get queue status (for /health endpoint)
     */
    getStatus() {
        return {
            depth: this.queue.length,
            maxDepth: MAX_QUEUE_DEPTH,
            isProcessing: this.isProcessing,
            dlqSize: this._dlq.length,
        };
    }
}

module.exports = ActionQueue;
