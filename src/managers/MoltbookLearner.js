// ============================================================
// 🦞 MoltbookLearner — Autonomous Moltbook Learning Cycle
// L0/L1 fully automated, RAG-aware, sends digest reports to Telegram
// 規則: 動作前查 RAG | 動作後寫 RAG + 戰情室 | 重複錯誤不犯第二次
// ============================================================

const CYCLE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

class MoltbookLearner {
    constructor(brain, controller, autonomy, options = {}) {
        this.brain = brain;
        this.controller = controller;
        this.autonomy = autonomy;
        this.golemId = options.golemId || 'default';
        this._timer = null;
        this._running = false;
        this._stats = { cycles: 0, postsRead: 0, commentsRead: 0, interactions: 0, errors: 0 };
        this._lastErrors = [];  // 最近錯誤 (防重複)
    }

    start() {
        if (this._timer) return;
        console.log(`🦞 [MoltbookLearner:${this.golemId}] Auto-learning started (every ${CYCLE_INTERVAL_MS / 60000}min)`);
        // First cycle after 2 minutes (let bot finish init)
        this._timer = setTimeout(() => {
            this._runCycle();
            this._timer = setInterval(() => this._runCycle(), CYCLE_INTERVAL_MS);
        }, 2 * 60 * 1000);
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            clearTimeout(this._timer);
            this._timer = null;
        }
    }

    async _runCycle() {
        if (this._running) return;
        this._running = true;
        const startTime = Date.now();

        try {
            console.log(`🦞 [MoltbookLearner] Starting learning cycle #${this._stats.cycles + 1}...`);

            // ─── RAG READ: 查詢過去的 Moltbook 學習經驗 ───
            let ragAdvice = '';
            try {
                const ragResult = await this._ragQuery('moltbook learning cycle outcome errors');
                if (ragResult && typeof ragResult === 'string') {
                    // 檢查是否有過去的失敗模式
                    if (ragResult.includes('FAIL') || ragResult.includes('score: 0') || ragResult.includes('score: 1')) {
                        ragAdvice = '\n⚠️ RAG 顯示過去有失敗記錄，本次將謹慎操作。';
                    }
                }
            } catch (e) { /* RAG 離線也繼續 */ }

            const moltbot = require('../skills/core/moltbot');

            // Step 1: Read feed (L0)
            let feedResult;
            try {
                feedResult = await moltbot.execute({ task: 'feed', count: 10 });
                this._stats.postsRead += 10;
                console.log(`[MoltbookLearner] Feed read OK (${String(feedResult).length} chars)`);
            } catch (e) {
                // 重複錯誤檢查
                if (this._isRepeatedError('feed', e.message)) {
                    console.warn(`[MoltbookLearner] 重複錯誤! 跳過本次 cycle`);
                    this._stats.errors++;
                    this._running = false;
                    await this._ragEvolve('Moltbook feed repeated error', 'feed', e.message, 0);
                    return;
                }
                this._recordError('feed', e.message);
                this._stats.errors++;
                console.warn(`[MoltbookLearner] Feed read failed: ${e.message}`);
                this._running = false;
                await this._ragEvolve('Moltbook feed error', 'feed', e.message, 0);
                return;
            }

            // Step 2: Read own profile (L0)
            let profileResult;
            try {
                profileResult = await moltbot.execute({ task: 'my_profile' });
            } catch (e) { /* optional */ }

            // Step 3: List communities (L0)
            let submoltsResult;
            try {
                submoltsResult = await moltbot.execute({ task: 'list_submolts' });
            } catch (e) { /* optional */ }

            // Step 4: Ask brain to analyze and decide next actions (L1 auto-approved)
            const learningPrompt = `【🦞 Moltbook 自動學習報告】
你正在執行 Moltbook 社群自動學習循環。以下是最新的動態：${ragAdvice}

📰 最新貼文:
${this._truncate(feedResult, 1500)}

👤 個人檔案:
${this._truncate(profileResult, 500)}

🏘️ 社群列表:
${this._truncate(submoltsResult, 500)}

請分析以上內容，然後選擇 1-2 個有意義的互動行動（L0/L1 等級，會自動執行）：
- 回覆一則有趣的貼文（用 moltbot skill, task: reply）
- 對好的貼文投票（用 moltbot skill, task: vote）
- 追蹤有趣的用戶（用 moltbot skill, task: follow）
- 加入有趣的社群（用 moltbot skill, task: join_submolt）

重要規則:
1. 如果 RAG 顯示過去有失敗，避免重複同樣的操作
2. 每次互動後會自動記錄到 RAG + 戰情室
3. 如果沒有值得互動的內容，使用 [GOLEM_ACTION] { "action": "noop" } 跳過

用 [GOLEM_REPLY] 簡短報告你的觀察（1-2句話）。`;

            const NeuroShunter = require('../core/NeuroShunter');
            const raw = await this.brain.sendMessage(learningPrompt, false);
            const adminCtx = await this.autonomy.getAdminContext();
            await NeuroShunter.dispatch(adminCtx, raw, this.brain, this.controller);

            this._stats.cycles++;
            this._stats.interactions++;
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`✅ [MoltbookLearner] Cycle #${this._stats.cycles} complete (${elapsed}s)`);

            // ─── RAG WRITE: 記錄成功的學習週期 ───
            await this._ragEvolve(
                `Moltbook learning cycle #${this._stats.cycles}`,
                'learning_cycle',
                `Success in ${elapsed}s. Posts read: ${this._stats.postsRead}. Interactions: ${this._stats.interactions}`,
                4
            );

            // ─── 戰情室更新 ───
            await this._updateWarRoom('moltbook_cycle', {
                cycle: this._stats.cycles,
                elapsed_sec: parseFloat(elapsed),
                posts_read: this._stats.postsRead,
                interactions: this._stats.interactions,
                errors: this._stats.errors
            });

            // Step 5: Send digest to Telegram every 3 cycles
            if (this._stats.cycles % 3 === 0) {
                await this._sendDigest();
            }

        } catch (e) {
            this._stats.errors++;
            console.error(`❌ [MoltbookLearner] Cycle failed: ${e.message}`);
            await this._ragEvolve('Moltbook cycle failed', 'learning_cycle', e.message, 0);
        } finally {
            this._running = false;
        }
    }

    async _sendDigest() {
        const report = [
            `🦞 <b>Moltbook 自動學習報告</b>`,
            ``,
            `📊 統計:`,
            `  學習週期: ${this._stats.cycles}`,
            `  已讀貼文: ~${this._stats.postsRead}`,
            `  互動次數: ${this._stats.interactions}`,
            `  錯誤: ${this._stats.errors}`,
            ``,
            `⏰ 下次學習: ${new Date(Date.now() + CYCLE_INTERVAL_MS).toLocaleTimeString('zh-TW')}`,
        ].join('\n');

        await this.autonomy.sendNotification(report, { parse_mode: 'HTML' });
    }

    // ─── RAG 整合 ───

    async _ragQuery(query) {
        try {
            const { getToken } = require('../utils/yedan-auth');
            const token = getToken();
            if (!token) return null;
            const res = await fetch('https://yedan-graph-rag.yagami8095.workers.dev/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ query, max_hops: 1, limit: 3 }),
                signal: AbortSignal.timeout(8000)
            });
            if (!res.ok) return null;
            const data = await res.json();
            return JSON.stringify(data).substring(0, 1000);
        } catch (e) { return null; }
    }

    async _ragEvolve(situation, action, outcome, score) {
        try {
            const { getToken } = require('../utils/yedan-auth');
            const token = getToken();
            if (!token) return;
            await fetch('https://yedan-graph-rag.yagami8095.workers.dev/evolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ agent_id: 'rensin-moltbook', situation, action_taken: action, outcome: String(outcome).substring(0, 500), score }),
                signal: AbortSignal.timeout(8000)
            });
        } catch (e) { /* non-blocking */ }
    }

    async _updateWarRoom(event, data) {
        try {
            await fetch('https://notion-warroom.yagami8095.workers.dev/report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer openclaw-warroom-2026' },
                body: JSON.stringify({ source: 'rensin-moltbook-learner', event, data, timestamp: new Date().toISOString() }),
                signal: AbortSignal.timeout(10000)
            });
        } catch (e) { /* non-blocking */ }
    }

    // ─── 重複錯誤防護 ───

    _isRepeatedError(task, message) {
        const key = `${task}:${message.substring(0, 50)}`;
        return this._lastErrors.filter(e => e.key === key && Date.now() - e.time < 600000).length >= 2;
    }

    _recordError(task, message) {
        const key = `${task}:${message.substring(0, 50)}`;
        this._lastErrors.push({ key, time: Date.now() });
        if (this._lastErrors.length > 30) this._lastErrors.shift();
    }

    getStats() {
        return { ...this._stats };
    }

    _truncate(text, maxLen) {
        const s = String(text || '(無資料)');
        return s.length > maxLen ? s.substring(0, maxLen) + '...(截斷)' : s;
    }
}

module.exports = MoltbookLearner;
