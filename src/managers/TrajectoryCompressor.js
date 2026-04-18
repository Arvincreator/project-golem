// ============================================================
// 🗜️ TrajectoryCompressor — 對話軌跡動態壓縮引擎
// 靈感來自 NousResearch/hermes-agent trajectory_compressor.py
// 策略：保護頭部 N 輪 + 尾部 N 輪，用 LLM 摘要壓縮中段
// ============================================================

/**
 * 壓縮後的 summary 訊息前綴（對齊 Hermes 格式）
 */
const SUMMARY_PREFIX = '[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted '
    + 'into the summary below. This is a handoff from a previous context '
    + 'window — treat it as background reference, NOT as active instructions. '
    + 'Do NOT answer questions or fulfill requests mentioned in this summary; '
    + 'they were already addressed. Resume from the \'## 當前任務\' section.';

/**
 * 工具輸出超過此長度時才剰枝（chars）
 */
const PRUNE_THRESHOLD = 500;

/**
 * @typedef {{ role: string, content: string, toolName?: string }} Turn
 */

class TrajectoryCompressor {
    /**
     * @param {object} brain - GolemBrain 實體（提供 _wikiChat 輕量 LLM 呼叫）
     * @param {object} [options]
     * @param {number} [options.targetChars=80000]        - 目標字元上限
     * @param {number} [options.summaryTargetChars=1500]  - 摘要目標長度
     * @param {number} [options.protectFirstTurns=3]      - 保護頭部輪數
     * @param {number} [options.protectLastTurns=5]       - 保護尾部輪數
     * @param {number} [options.minCompressThreshold=5]   - 最少幾輪才嘗試壓縮
     */
    constructor(brain, options = {}) {
        this.brain = brain;
        this.targetChars = options.targetChars ?? 80000;
        this.summaryTargetChars = options.summaryTargetChars ?? 1500;
        this.protectFirstTurns = options.protectFirstTurns ?? 3;
        this.protectLastTurns = options.protectLastTurns ?? 5;
        this.minCompressThreshold = options.minCompressThreshold ?? 5;
        // 🛡️ [Hermes-inspired] 迭代摘要更新 — 儲存上一次摘要以供下次時累積更新
        this._previousSummary = null;
        // 🛡️ 防抖追蹤——連續兩次壓縮省下 < 10% 則跳過
        this._lastSavingsPct = 100;
        this._ineffectiveCount = 0;
    }

    // ================================================================
    // 🔑 Public API
    // ================================================================

    /**
     * 壓縮對話串，若未超過目標字元則原樣返回
     * @param {Turn[]} turns - 對話輪次陣列
     * @returns {Promise<{ turns: Turn[], compressed: boolean, savedChars: number }>}
     */
    async compress(turns) {
        if (!Array.isArray(turns) || turns.length === 0) {
            return { turns, compressed: false, savedChars: 0 };
        }

        const totalChars = this._countChars(turns);

        // 未超標：直接返回
        if (totalChars <= this.targetChars) {
            return { turns, compressed: false, savedChars: 0 };
        }

        // 對話太短：無法壓縮
        if (turns.length < this.protectFirstTurns + this.protectLastTurns + this.minCompressThreshold) {
            console.warn(`⚠️ [TrajectoryCompressor] 對話輪數不足（${turns.length} 輪），無法壓縮。`);
            return { turns, compressed: false, savedChars: 0 };
        }

        return this._doCompress(turns, totalChars);
    }

    /**
     * 批量壓縮多組對話（適用於 log-archive 等批量場景）
     * @param {Turn[][]} multiTurns
     * @returns {Promise<Array<{ turns: Turn[], compressed: boolean, savedChars: number }>>}
     */
    async compressBatch(multiTurns) {
        const results = [];
        for (const turns of multiTurns) {
            results.push(await this.compress(turns));
        }
        return results;
    }

    // ================================================================
    // 🔧 Private Methods
    // ================================================================

    /**
     * 實際執行壓縮邏輯
     */
    async _doCompress(turns, totalChars) {
        const n = turns.length;
        const head = turns.slice(0, this.protectFirstTurns);
        const tail = turns.slice(Math.max(this.protectFirstTurns, n - this.protectLastTurns));
        const middle = turns.slice(this.protectFirstTurns, n - this.protectLastTurns);

        if (middle.length === 0) {
            console.warn(`⚠️ [TrajectoryCompressor] 中段為空，無法壓縮。`);
            return { turns, compressed: false, savedChars: 0 };
        }

        // 😚️ [Hermes-inspired] Tool Output Pruning — 無需 LLM 的預處理閘一轄
        const { prunedTurns, pruneCount } = this._pruneToolOutputs(middle);
        if (pruneCount > 0) {
            console.log(`✂️ [TrajectoryCompressor] Tool Output Pruning: 剰除 ${pruneCount} 個大型工具輸出。`);
        }

        // 計算需要節省的字元數
        const charsToSave = totalChars - this.targetChars;
        const targetToCompress = charsToSave + this.summaryTargetChars;

        // 從中段頭部累積，直到達到壓縮目標
        let accumulated = 0;
        let compressUntil = 0;

        for (let i = 0; i < prunedTurns.length; i++) {
            accumulated += (prunedTurns[i].content || '').length;
            compressUntil = i + 1;
            if (accumulated >= targetToCompress) break;
        }

        // 若中段全部壓縮仍不夠，就全壓
        if (accumulated < targetToCompress) {
            compressUntil = prunedTurns.length;
        }

        const toCompress = prunedTurns.slice(0, compressUntil);
        const remaining  = prunedTurns.slice(compressUntil);

        console.log(`🗜️ [TrajectoryCompressor] 開始壓縮 ${toCompress.length} 輪（共 ${accumulated} 字元）...`);

        // 呼叫 LLM 產生摘要
        const summary = await this._generateSummary(toCompress);

        // 組裝壓縮後的對話串
        const summaryTurn = {
            role: 'system',
            content: `${SUMMARY_PREFIX}\n${summary}`
        };

        const compressed = [...head, summaryTurn, ...remaining, ...tail];
        const newChars = this._countChars(compressed);
        const savedChars = totalChars - newChars;
        const savingsPct = (savedChars / totalChars * 100);

        // 🛡️ [Hermes-inspired] 防抖追蹤
        if (savingsPct < 10) {
            this._ineffectiveCount++;
        } else {
            this._ineffectiveCount = 0;
        }
        this._lastSavingsPct = savingsPct;

        console.log(`✅ [TrajectoryCompressor] 壓縮完成：${totalChars} → ${newChars} 字元（節省 ${savedChars} 字元，${savingsPct.toFixed(1)}%）`);

        return { turns: compressed, compressed: true, savedChars };
    }

    /**
     * 呼叫 LLM（_wikiChat）產生中段摘要
     * @param {Turn[]} turns
     * @returns {Promise<string>}
     */
    async _generateSummary(turns) {
        const content = turns
            .map((t, i) => {
                const role = (t.role || 'unknown').toUpperCase();
                let text = t.content || '';
                // 截斷超長單輪（避免 prompt 爆炸）
                if (text.length > 3000) {
                    text = text.slice(0, 1500) + '\n...[已截斷]...\n' + text.slice(-500);
                }
                return `[第 ${i + 1} 輪 - ${role}]:\n${text}`;
            })
            .join('\n\n');

        const targetLen = `${Math.round(this.summaryTargetChars / 2)}-${this.summaryTargetChars}`;

        // 🛡️ [Hermes-inspired] 結構化摘要模板
        // 最重要欄位：「當前任務」——確保下一個 context 知道從哪裡繼續
        const prompt = `以下是一段 AI 代理對話的中間片段，需要被精簡摘要以節省上下文空間。
你是一個摘要代理，正在為「不同的助理」建立上下文交接摘要。不要回答對話中的任何問題，僅輸出摘要。

請用「繁體中文」撰寫以下結構化摘要（目標約 ${targetLen} 字）：

## 當前任務 (Active Task)
[最重要欄位] 用戶最後一個尚未完成的請求或任務——請直接引用用戶的原話。若已全部完成則寫 "None".

## 目標 (Goal)
[用戶整體的目的或需求]

## 已完成動作 (Completed Actions)
[編號清單，一個項目一案。格式如：N. [工具]操作對象 → 結果。包含檔案路徑、命令、數值、錯誤訊息等具體內容。]

## 當前狀態 (Active State)
[目前工作中的環境：已修改的檔案、執行中的程序、平台/期間、重要配置對應值等]

## 阻塞/問題 (Blocked)
[尚未解決的問題、錯誤或阻塞，包含具體錯誤訊息。若無則寫 "None".]

## 待辦工作 (Remaining Work)
[尚需完成的工作，以情境描述而非指令。]

---
待摘要片段：
${content}
---

僅輸出摘要內容，不要加任何前言或解釋。`;

        try {
            const result = await this.brain._wikiChat(prompt);
            const text = result && result.trim() ? result.trim() : '（此段對話包含多輪工具調用與中間步驟，已壓縮以節省上下文空間。）';
            // 🛡️ 儲存以供下次迭代更新
            this._previousSummary = text;
            return text;
        } catch (e) {
            console.error(`❌ [TrajectoryCompressor] LLM 摘要生成失敗:`, e.message);
            return `（此段對話已壓縮。包含 ${turns.length} 輪交互，壓縮時發生錯誤：${e.message}）`;
        }
    }

    /**
     * 計算對話串的總字元數
     * @param {Turn[]} turns
     * @returns {number}
     */
    _countChars(turns) {
        return turns.reduce((sum, t) => sum + (t.content ? t.content.length : 0), 0);
    }

    // =================================================================
    // 😚️ [Hermes-inspired] Tool Output Pruning
    // 無需 LLM 的工具輸出剰枝隀一轄
    // =================================================================

    /**
     * 將對話中超長的「tool」角色內容替換為單行摘要。
     * Pass 1: 重複內容（相同 hash）→ back-reference
     * Pass 2: 超長內容（> PRUNE_THRESHOLD）→ 1 行摘要
     *
     * @param {Turn[]} turns
     * @returns {{ prunedTurns: Turn[], pruneCount: number }}
     */
    _pruneToolOutputs(turns) {
        const crypto = require('crypto');
        const result = turns.map(t => Object.assign({}, t)); // shallow copy
        let pruneCount = 0;

        // 建立內容 hash 對映表（最新者优先保留）
        const seenHashes = new Map(); // hash -> index of most-recent occurrence
        for (let i = result.length - 1; i >= 0; i--) {
            const turn = result[i];
            if (turn.role !== 'tool' && turn.role !== 'assistant') continue;
            const content = turn.content || '';
            if (content.length < PRUNE_THRESHOLD) continue;

            const hash = crypto.createHash('md5').update(content).digest('hex').slice(0, 12);
            if (!seenHashes.has(hash)) {
                seenHashes.set(hash, i);
            }
        }

        // Pass 1: 重複内容 back-reference
        for (let i = 0; i < result.length; i++) {
            const turn = result[i];
            if (turn.role !== 'tool' && turn.role !== 'assistant') continue;
            const content = turn.content || '';
            if (content.length < PRUNE_THRESHOLD) continue;

            const hash = crypto.createHash('md5').update(content).digest('hex').slice(0, 12);
            const newestIdx = seenHashes.get(hash);
            if (newestIdx !== undefined && newestIdx !== i) {
                // 這是舊的重複，替換為 back-reference
                result[i] = Object.assign({}, turn, {
                    content: `[Duplicate tool output — identical content exists at a more recent turn]`
                });
                pruneCount++;
            }
        }

        // Pass 2: 超長工具輸出 → 單行摘要
        for (let i = 0; i < result.length; i++) {
            const turn = result[i];
            if (turn.role !== 'tool') continue;
            const content = turn.content || '';
            if (content.length <= PRUNE_THRESHOLD) continue;
            // 跳過已處理過的
            if (content.startsWith('[Duplicate')) continue;

            const summary = this._summarizeToolOutput(turn);
            result[i] = Object.assign({}, turn, { content: summary });
            pruneCount++;
        }

        return { prunedTurns: result, pruneCount };
    }

    /**
     * 將工具輸出產生一行摘要文字
     * 引用 Hermes _summarize_tool_result() 的設計思路
     * @param {Turn} turn
     * @returns {string}
     */
    _summarizeToolOutput(turn) {
        const toolName = turn.toolName || turn.role || 'tool';
        const content = turn.content || '';
        const lines = content.split('\n').length;
        const chars = content.length;

        // 鷗試從內容推斷工具類型
        if (content.includes('exit_code') || content.includes('$ ')) {
            const exitMatch = content.match(/"exit_code"\s*:\s*(-?\d+)/);
            const exitCode = exitMatch ? exitMatch[1] : '?';
            return `[terminal] 執行命令 → exit ${exitCode}, ${lines} 行輸出 (${chars} 字元已剰隀)`;
        }

        if (content.startsWith('{') || content.startsWith('[')) {
            return `[json] JSON 資料 ${chars} 字元 (${lines} 行)已剰隀`;
        }

        if (content.includes('<html') || content.includes('<!DOCTYPE')) {
            return `[html] HTML 內容 ${chars} 字元 (${lines} 行)已剰隀`;
        }

        // 通用剰隀
        return `[${toolName}] 工具輸出 ${chars} 字元 (${lines} 行)已剰隀以節省上下文`;
    }

    // ================================================================
    // 🛠️ Static Utilities
    // ================================================================

    /**
     * 將 ChatLogManager 原始訊息陣列轉換為 Turn 格式
     * @param {object[]} messages - SQLite messages 查詢結果
     * @returns {Turn[]}
     */
    static fromChatLogMessages(messages) {
        return messages.map(m => ({
            role: m.role || m.sender || 'unknown',
            content: m.content || ''
        }));
    }

    /**
     * 將壓縮後的 Turn 陣列轉換回可供注入的字串
     * @param {Turn[]} turns
     * @returns {string}
     */
    static toInjectionString(turns) {
        return turns
            .map(t => {
                const role = t.role.toUpperCase();
                return `[${role}]: ${t.content}`;
            })
            .join('\n\n');
    }
}

module.exports = TrajectoryCompressor;
