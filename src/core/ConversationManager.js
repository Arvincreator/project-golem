const { v4: uuidv4 } = require('uuid');
const ContextEngineer = require('./ContextEngineer');
const TreePlanner = require('./TreePlanner');
const GroundingVerifier = require('./GroundingVerifier');
const Planner = require('./Planner');
const MetricsCollector = require('./MetricsCollector');
const WorldModel = require('./WorldModel');
const ExperienceReplay = require('./ExperienceReplay');
const OutputGrader = require('./OutputGrader');
const MetapromptAgent = require('./MetapromptAgent');
const PlanCheckpoint = require('./PlanCheckpoint');
const AdaptivePlanExecutor = require('./AdaptivePlanExecutor');
const CoreMemory = require('./CoreMemory');
const PageStateTracker = require('./PageStateTracker');

// ============================================================
// 🚦 Conversation Manager (隊列與防抖系統 - 多用戶隔離版)
// v9.5: C5 DI + named methods, A1-A5 wiring fixes, B2 background plans
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

        // C5: DI — accept all subsystems via options (unblock testing)
        this.threeLayerMemory = options.threeLayerMemory || null;
        this.treePlanner = options.treePlanner || new TreePlanner(brain, {
            golemId: this.golemId,
            oodaLoop: options.oodaLoop || null,
            threeLayerMemory: this.threeLayerMemory,
        });
        this.groundingVerifier = options.groundingVerifier || new GroundingVerifier({
            mode: process.env.GROUNDING_MODE || 'off',
        });
        this.metricsCollector = options.metricsCollector || new MetricsCollector({ golemId: this.golemId, noAutoFlush: !!process.env.GOLEM_TEST_MODE });
        this.worldModel = options.worldModel || new WorldModel(brain, { golemId: this.golemId, threeLayerMemory: this.threeLayerMemory });
        this.planner = options.planner || new Planner(brain, { golemId: this.golemId, worldModel: this.worldModel, metricsCollector: this.metricsCollector });
        this.coreMemory = options.coreMemory || new CoreMemory({ golemId: this.golemId });
        this.experienceReplay = options.experienceReplay || new ExperienceReplay({
            golemId: this.golemId, brain, threeLayerMemory: this.threeLayerMemory,
            coreMemory: this.coreMemory, // A4: pass coreMemory to ExperienceReplay
        });
        this.outputGrader = options.outputGrader || new OutputGrader({ golemId: this.golemId, brain });
        this.metapromptAgent = options.metapromptAgent || new MetapromptAgent({ golemId: this.golemId, brain });
        this.planCheckpoint = options.planCheckpoint || new PlanCheckpoint({ golemId: this.golemId });
        this.pageStateTracker = options.pageStateTracker || new PageStateTracker({ golemId: this.golemId });
        this.adaptivePlanExecutor = options.adaptivePlanExecutor || new AdaptivePlanExecutor({
            planner: this.planner,
            worldModel: this.worldModel,
            checkpoint: this.planCheckpoint,
            experienceReplay: this.experienceReplay,
            metrics: this.metricsCollector,
        });

        // C3: share rate limiter with AdaptivePlanExecutor
        this.adaptivePlanExecutor._rateLimit = this._checkRateLimit.bind(this);

        this._metapromptCallCount = 0;
        // Rate limiting: brain calls per minute (cross-phase)
        this._brainCallWindow = [];
        this.DEBOUNCE_MS = 1500;

        // B2: active background plans per chat
        this._activePlans = new Map();

        // D3: HeartbeatMonitor (lazy init)
        this._heartbeat = null;

        // Cleanup stale user buffers (memory leak prevention)
        this._bufferCleanupTimer = setInterval(() => {
            const now = Date.now();
            for (const [chatId, state] of this.userBuffers.entries()) {
                if (state._lastActivity && now - state._lastActivity > 10 * 60 * 1000) {
                    if (state.timer) clearTimeout(state.timer);
                    this.userBuffers.delete(chatId);
                }
            }
            // v10.7: Clean up expired rate limit entries
            if (this._rateLimits) {
                for (const [key, data] of this._rateLimits.entries()) {
                    if (data.resetAt && now > data.resetAt + 300000) {
                        this._rateLimits.delete(key);
                    }
                }
            }
        }, 60 * 1000);
    }

    /**
     * D3: Lazy-init HeartbeatMonitor
     */
    _getHeartbeat() {
        if (!this._heartbeat) {
            try {
                const HeartbeatMonitor = require('./HeartbeatMonitor');
                this._heartbeat = new HeartbeatMonitor({
                    experienceReplay: this.experienceReplay,
                    coreMemory: this.coreMemory,
                    threeLayerMemory: this.threeLayerMemory,
                    brain: this.brain,
                });
            } catch (e) { /* HeartbeatMonitor optional */ }
        }
        return this._heartbeat;
    }

    async enqueue(ctx, text, options = { isPriority: false, bypassDebounce: false }) {
        // Input sanitization (sandbox protection)
        if (text && text.length > 10000) {
            text = text.substring(0, 10000) + '\n...(truncated — input too long)';
            console.warn(`[ConvoMgr] Truncated oversized input from ${ctx.chatId}`);
        }

        const chatId = ctx.chatId;

        // Rate limiting: max 10 messages per 30 seconds per chat
        const now = Date.now();
        const rateKey = `rate_${chatId}`;
        if (!this._rateLimits) this._rateLimits = new Map();
        const rateData = this._rateLimits.get(rateKey) || { count: 0, resetAt: now + 30000 };
        if (now > rateData.resetAt) { rateData.count = 0; rateData.resetAt = now + 30000; }
        rateData.count++;
        this._rateLimits.set(rateKey, rateData);
        if (rateData.count > 10) {
            console.warn(`[ConvoMgr] Rate limited chat ${chatId} (${rateData.count} msgs in 30s)`);
            return;
        }

        // 🚨 Highest Privilege: priority tasks bypass user buffers completely and inject straight into queue
        if (options.bypassDebounce) {
            console.log(`⚡ [Dialogue Queue] 高優先級請求繞過防抖機制 (${chatId}): "${text.substring(0, 15)}..."`);
            this._commitDirectly(ctx, text, options.isPriority);
            return;
        }

        let userState = this.userBuffers.get(chatId) || { text: "", timer: null, ctx: ctx };
        userState.text = userState.text ? `${userState.text}\n${text}` : text;
        userState.ctx = ctx;
        userState._lastActivity = Date.now();
        console.log(`⏳ [Dialogue Queue] 收到對話 (${chatId}): "${text.substring(0, 15)}..."`);
        if (userState.timer) clearTimeout(userState.timer);
        userState.timer = setTimeout(() => {
            this._commitToQueue(chatId);
        }, this.DEBOUNCE_MS);
        this.userBuffers.set(chatId, userState);
    }

    _commitDirectly(ctx, text, isPriority) {
        // ✨ [v9.1 插隊系統：大腦層擴充]
        if (!isPriority && this.queue.length >= 1) {
            const approvalId = uuidv4();

            this.controller.pendingTasks.set(approvalId, {
                type: 'DIALOGUE_QUEUE_APPROVAL',
                ctx,
                text,
                timestamp: Date.now()
            });

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
                                ).catch((err) => { console.warn('[ConversationManager] Failed to update timeout message:', err.message); });
                            }
                        } catch (e) { console.warn("無法更新 Dialogue Timeout 訊息:", e.message); }

                        this._actualCommit(ctx, text, false);
                    }
                }, 30000);
            });
            return;
        }

        this._actualCommit(ctx, text, isPriority);
    }

    _actualCommit(ctx, text, isPriority) {
        console.log(`📦 [Dialogue Queue] 加入隊列 (Direct) ${isPriority ? '[💥VIP 插隊中]' : ''} - 準備交由大腦處理`);
        if (isPriority) {
            this.queue.unshift({ ctx, text });
        } else {
            this.queue.push({ ctx, text });
        }
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

    stop() {
        if (this._bufferCleanupTimer) { clearInterval(this._bufferCleanupTimer); this._bufferCleanupTimer = null; }
        for (const [, state] of this.userBuffers.entries()) {
            if (state.timer) clearTimeout(state.timer);
        }
        this.userBuffers.clear();
        console.log(`[ConversationManager:${this.golemId}] All timers stopped.`);
    }

    // ── C5: Named method extractions ──

    /**
     * C5: Prepare input — logging, memory recall, mode checks
     * @returns {{ finalInput, memories, senderName, shouldSkip, shouldSuppressReply }}
     */
    async _prepareInput(task) {
        console.log(`🚀 [Dialogue Queue:${this.golemId}] 從隊列取出，開始處理對話...`);
        console.log(`🗣️ [User->${this.golemId}] 說: ${task.text}`);

        const senderName = task.ctx.senderName || task.ctx.userId || 'User';
        this.brain._appendChatLog({
            timestamp: Date.now(),
            sender: senderName,
            content: task.text,
            type: 'user',
            role: senderName,
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
            console.log(`🤫 [Dialogue Queue:${this.golemId}] 完全靜默模式啟動中，且未被標記，跳過大腦處理。`);
            return { shouldSkip: true };
        }

        const shouldSuppressReply = this.observerMode && !isMentioned;
        if (shouldSuppressReply) {
            console.log(`👁️ [Dialogue Queue:${this.golemId}] 觀察者模式監聽中 (背景同步上下文)...`);
        }
        if (isMentioned && (this.silentMode || this.observerMode)) {
            console.log(`📢 [Dialogue Queue:${this.golemId}] 模式中偵測到標記，強制恢復回應。`);
        }

        // ThreeLayerMemory: record user input
        if (this.threeLayerMemory) {
            this.threeLayerMemory.addToWorking({ content: task.text, sender: senderName, type: 'user' });
        }

        // D3: HeartbeatMonitor tick
        const hb = this._getHeartbeat();
        if (hb) hb.tick();

        return { finalInput, memories, senderName, shouldSkip: false, shouldSuppressReply };
    }

    /**
     * C5: Assemble context via ContextEngineer
     * @returns {{ contextEng, assembledContext, contextStats, contextToSend }}
     */
    _assembleContext(task, memories, senderName) {
        const contextEng = new ContextEngineer();
        if (this.brain.getModelContextWindow) {
            contextEng.setBudgetForModel(this.brain._lastRoute?.model || 'gpt-4o');
        } else if (typeof this.brain.getModelContextWindow === 'function') {
            contextEng._budget = this.brain.getModelContextWindow();
        }
        contextEng.addSection('user_input', task.text, { priority: 10 });

        // CoreMemory: inject agent-editable blocks at priority 9
        const coreMemCtx = this.coreMemory.getContextString();
        if (coreMemCtx) {
            contextEng.addSection('core_memory', coreMemCtx, { priority: 9 });
        }

        // ExperienceReplay: inject reflection context BEFORE assembly (A4 fix)
        const reflectionCtx = this.experienceReplay.getReflectionContext(2);
        if (reflectionCtx) {
            contextEng.addSection('reflections', reflectionCtx, { priority: 7 });
        }

        // v10.8 T2-2: MetapromptAgent — inject optimized prompt guidance
        const metapromptText = this.metapromptAgent.getActivePrompt();
        if (metapromptText) {
            contextEng.addSection('metaprompt_guidance', metapromptText.substring(0, 500), { priority: 6 });
        }

        // v10.8 T2-3: ExperienceReplay — inject successful experience samples
        const samples = this.experienceReplay.sample(2, { success: true });
        if (samples.length > 0) {
            const sampleCtx = samples.map(s => `[Success] ${(s.goal || '').substring(0, 80)}: ${(s.action || '').substring(0, 60)}`).join('\n');
            contextEng.addSection('experience_samples', sampleCtx, { priority: 5 });
        }

        if (this.threeLayerMemory) {
            const wmItems = this.threeLayerMemory.getWorkingContext(10);
            if (wmItems.length > 0) {
                const wmCtx = wmItems.map(w => `[${w.type || 'msg'}] ${w.content}`).join('\n');
                contextEng.addSection('working_memory', wmCtx, { priority: 7, compressible: true });
            }

            const memStats = this.threeLayerMemory.getStats();
            const memStatus = `[Memory Status] Working: ${memStats.working || 0}/${memStats.workingMax || 50} | Episodic: ${memStats.episodic || 0}/${memStats.episodicMax || 500} | Semantic: ${memStats.semantic || 0} nodes`;
            contextEng.addSection('memory_status', memStatus, { priority: 3 });
        }

        // PageStateTracker: inject page state context
        const pageCtx = this.pageStateTracker.getContextString();
        if (pageCtx) {
            contextEng.addSection('page_state', pageCtx, { priority: 5 });
        }

        if (memories.length > 0) {
            const memText = memories.map(m => `• ${m.text}`).join('\n');
            contextEng.addSection('memories', memText, { priority: 4, compressible: true });
        }

        // D4: Skill retrieval — inject relevant skills at priority 6
        if (this.brain.skillIndex && typeof this.brain.skillIndex.search === 'function') {
            try {
                const relevantSkills = this.brain.skillIndex.search(task.text, 3);
                if (relevantSkills && relevantSkills.length > 0) {
                    const skillCtx = relevantSkills.map(s => `[Skill] ${s.name}: ${s.description || ''}`).join('\n');
                    contextEng.addSection('relevant_skills', skillCtx, { priority: 6 });
                }
            } catch (e) { /* skill retrieval optional */ }
        }

        const { context: assembledContext, stats: contextStats } = contextEng.assemble();
        if (contextStats.compressed > 0 || contextStats.pagedOut > 0) {
            console.log(`[ContextEngineer] Assembled: ${contextStats.totalTokens}tk, ${contextStats.sectionsIncluded} sections (${contextStats.compressed} compressed, ${contextStats.pagedOut} paged out)`);
        }

        const contextToSend = assembledContext || task.text;
        return { contextEng, assembledContext, contextStats, contextToSend };
    }

    /**
     * C5: Run planning (TreePlanner / AdaptivePlanExecutor)
     * B2: Background execution for complex plans
     * @returns {{ adaptivePlanResult, backgroundPlan: boolean }}
     */
    async _runPlanning(task, contextEng, assembledContext) {
        let adaptivePlanResult = null;
        const isComplex = this.treePlanner._isComplexQuery(task.text);

        if (!isComplex) return { adaptivePlanResult: null, backgroundPlan: false };

        try {
            console.log(`[TreePlanner] Complex query detected, generating plan tree...`);
            const tree = await this.treePlanner.planTree(task.text, assembledContext);
            if (!tree.isSimple) {
                console.log(`[TreePlanner] Using tree plan (${tree.root.children?.length || 0} branches)`);
            }

            if (!tree.isSimple && tree.root.children && tree.root.children.length >= 3) {
                const enableAdaptive = process.env.ENABLE_ADAPTIVE_PLANNING !== 'false';
                if (enableAdaptive) {
                    // B2: Check if there's already an active plan for this chat
                    if (this._activePlans.has(task.ctx.chatId)) {
                        console.log(`[AdaptivePlanExecutor] Already running a plan for chat ${task.ctx.chatId}, skipping`);
                        return { adaptivePlanResult: null, backgroundPlan: false };
                    }

                    // B2: Background execution — send placeholder, fork to background
                    await task.ctx.reply('🔄 正在處理複雜查詢...');

                    const planPromise = Promise.race([
                        this.adaptivePlanExecutor.run(task.text, { assembledContext }, task.ctx, this.brain),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Plan timeout (60s)')), 60000)),
                    ]);

                    this._activePlans.set(task.ctx.chatId, planPromise);

                    planPromise.then(result => {
                        // A2: Use plan result instead of redundant brain call
                        if (result?.plan?.status === 'completed') {
                            const summary = result.results
                                .filter(r => r.status === 'completed')
                                .map(r => String(r.result).substring(0, 300)).join('\n---\n');
                            return this.NeuroShunter.dispatch(task.ctx, `[GOLEM_REPLY]\n${summary}`, this.brain, this.controller, {
                                suppressReply: false,
                                threeLayerMemory: this.threeLayerMemory,
                                coreMemory: this.coreMemory,
                                golemId: this.golemId,
                            });
                        }
                    }).catch(e => console.warn('[Plan Background]', e.message))
                      .finally(() => this._activePlans.delete(task.ctx.chatId));

                    return { adaptivePlanResult: null, backgroundPlan: true };
                } else {
                    // Phase 1A fallback: Use Planner directly
                    try {
                        const plan = await this.planner.createPlan(task.text, { assembledContext });
                        const roots = plan.steps.filter(s => (s.deps || []).length === 0);
                        const executeStep = async (ctx, step) => this.brain.sendMessage(step.description, true);

                        if (roots.length > 1) {
                            await this.planner.executeParallel(task.ctx, executeStep);
                        } else {
                            await this.planner.executePlan(task.ctx, executeStep);
                        }
                    } catch (e) {
                        console.warn(`[Planner] Fallback to direct: ${e.message}`);
                    }
                }
            }
        } catch (e) {
            console.warn(`[TreePlanner] Fallback to linear: ${e.message}`);
        }

        return { adaptivePlanResult, backgroundPlan: false };
    }

    /**
     * C5: Execute brain call and dispatch response
     */
    async _executeAndDispatch(task, contextToSend, shouldSuppressReply) {
        // Rate limit check
        if (!this._checkRateLimit()) {
            console.warn(`[ConvoMgr] Rate limited: too many brain calls per minute`);
            await task.ctx.reply('⚠️ 系統繁忙，請稍後再試。');
            return;
        }

        // MetricsCollector: benchmark brain call
        const sendStart = Date.now();
        const raw = await this.brain.sendMessage(contextToSend, false, {
            isObserver: this.observerMode,
            interventionLevel: this.interventionLevel
        });
        const sendDuration = Date.now() - sendStart;
        this.metricsCollector.record('brain_response_success', { durationMs: sendDuration });

        // OutputGrader: quick grade (no LLM call, zero overhead)
        const gradeResult = this.outputGrader.quickGrade(String(raw), task.text);
        this.metricsCollector.record('output_grade', { value: gradeResult.overall });

        // Phase 1D: MetapromptAgent feedback loop
        this.metapromptAgent.recordPerformance(gradeResult.overall, sendDuration);
        this._metapromptCallCount++;
        if (this._metapromptCallCount % 50 === 0) {
            try {
                this.outputGrader.calibrate();
                this.metapromptAgent.autoSelect();
                const stats = this.metapromptAgent.getStats();
                if (stats.activeAvgGrade !== null && stats.activeAvgGrade < 2.5) {
                    console.log(`[MetapromptAgent] Low avg grade (${stats.activeAvgGrade}), generating improved version...`);
                    this.metapromptAgent.generateImprovedVersion().catch(e => console.warn('[MetapromptAgent] improved version failed:', e.message));
                }
            } catch (e) {
                console.warn(`[MetapromptAgent] Calibration error: ${e.message}`);
            }
        }

        // ExperienceReplay: record trace
        this.experienceReplay.recordTrace({
            goal: task.text.substring(0, 200),
            action: 'brain_response',
            result: String(raw).substring(0, 200),
            success: gradeResult.overall >= 2.0,
            reward: gradeResult.overall / 4.0,
            duration: sendDuration,
        });

        // v10.8 T2-1: WorldModel EMA — sync values from ExperienceReplay
        this.worldModel.setEmaValues(this.experienceReplay.getEmaValues());

        // GroundingVerifier: verify response if enabled
        let groundingOpts = {};
        if (this.groundingVerifier.mode !== 'off') {
            try {
                const verification = await this.groundingVerifier.verify(raw, task.text, { brain: this.brain });
                if (verification.confidence !== null) {
                    const badge = this.groundingVerifier.formatBadge(verification.confidence);
                    console.log(`[Grounding] Confidence: ${badge} (${verification.confidence}), Sources: ${verification.sources.length}, Flags: ${verification.flags.length}`);
                    groundingOpts.groundingConfidence = verification.confidence;
                }
            } catch (e) {
                console.warn(`[Grounding] Verification failed: ${e.message}`);
            }
        }

        // A1: Pass threeLayerMemory + coreMemory + golemId to NeuroShunter
        await this.NeuroShunter.dispatch(task.ctx, raw, this.brain, this.controller, {
            suppressReply: shouldSuppressReply,
            threeLayerMemory: this.threeLayerMemory,
            coreMemory: this.coreMemory,
            golemId: this.golemId,
            ...groundingOpts,
        });

        // ThreeLayerMemory: record AI response
        if (this.threeLayerMemory) {
            this.threeLayerMemory.addToWorking({ content: String(raw).substring(0, 500), sender: 'Golem', type: 'ai' });
        }

        // MetricsCollector: update gauges
        this.metricsCollector.gauge('queue_depth', this.queue.length);
        if (this.threeLayerMemory) {
            const memStats = this.threeLayerMemory.getStats();
            this.metricsCollector.gauge('working_memory_usage', memStats.working);
            this.metricsCollector.gauge('episodic_memory_count', memStats.episodic);
        }
    }

    /**
     * C5: Main orchestrator — ~30 lines
     */
    async _processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;
        const task = this.queue.shift();
        try {
            // Step 1: Prepare input
            const prepared = await this._prepareInput(task);
            if (prepared.shouldSkip) return;

            // Step 2: Assemble context
            const { contextEng, assembledContext, contextToSend } = this._assembleContext(
                task, prepared.memories, prepared.senderName
            );

            // Step 3: Planning (may go background for complex queries — B2)
            const { backgroundPlan } = await this._runPlanning(task, contextEng, assembledContext);
            if (backgroundPlan) return; // B2: plan running in background, queue released

            // Step 4: Execute and dispatch
            await this._executeAndDispatch(task, contextToSend, prepared.shouldSuppressReply);

        } catch (e) {
            console.error(`❌ [Dialogue Queue:${this.golemId}] 處理失敗:`, e);
            this.metricsCollector.record('brain_response_failure', { error: e.message });
            this.experienceReplay.recordTrace({
                goal: task.text?.substring(0, 200) || 'unknown',
                action: 'brain_response',
                result: `error: ${e.message}`,
                success: false,
                reward: 0,
            });
            // Auto-reflect on consecutive failures
            const rate = this.experienceReplay.getSuccessRate(10);
            if (rate && rate.rate < 0.5) {
                this.experienceReplay.reflect().catch(e => console.warn('[ExperienceReplay] reflect failed:', e.message));
            }
            await task.ctx.reply(`⚠️ 系統暫時無法回應，請稍後再試。`);
        } finally {
            this.isProcessing = false;
            setTimeout(() => this._processQueue(), 500);
        }
    }

    /**
     * Rate limit: sliding window for brain calls per minute
     */
    _checkRateLimit() {
        const MAX_CALLS_PER_MIN = parseInt(process.env.MAX_BRAIN_CALLS_PER_MINUTE || '20');
        const now = Date.now();
        this._brainCallWindow = this._brainCallWindow.filter(t => now - t < 60000);
        if (this._brainCallWindow.length >= MAX_CALLS_PER_MIN) return false;
        this._brainCallWindow.push(now);
        return true;
    }
}

module.exports = ConversationManager;
