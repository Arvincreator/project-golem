// ============================================================
// 🔍 session-search.js — 歷史對話語意搜尋技能
// 靈感來自 NousResearch/hermes-agent session_search toolset
// 讓 Golem 能夠主動搜尋並回溯過去的對話記錄
// ============================================================
const path = require('path');

/**
 * 搜尋模式
 *  - fts      : FTS5 全文搜尋（最快，支援多詞、前綴）[Hermes-inspired]
 *  - keyword  : 關鍵字全文比對（快速，無需 LLM）——自動嘗試 FTS5 降級
 *  - semantic : 語意摘要搜尋（慢，需 LLM 產生搜尋摘要）
 *  - date     : 依日期範圍列出對話
 */
async function run(ctx) {
    const args = ctx.args || {};
    const brain = ctx.brain;

    if (!brain || !brain.chatLogManager) {
        return '❌ [SessionSearch] 無法存取 ChatLogManager，請確認大腦已初始化。';
    }

    const logManager = brain.chatLogManager;
    if (!logManager._isInitialized) {
        try { await logManager.init(); } catch (e) {
            return `❌ [SessionSearch] ChatLogManager 初始化失敗: ${e.message}`;
        }
    }

    const query   = String(args.query || args.q || '').trim();
    const mode    = String(args.mode || 'keyword').toLowerCase();
    const limit   = Math.min(parseInt(args.limit) || 20, 100);
    const daysBak = Math.min(parseInt(args.days) || 30, 365);
    const startDate = args.start_date || null;
    const endDate   = args.end_date   || null;

    // ────────────────────────────────────────────
    // Mode: date — 依日期範圍列出
    // ────────────────────────────────────────────
    if (mode === 'date') {
        if (!startDate) return '❌ [SessionSearch] date 模式需提供 start_date 參數（格式：YYYYMMDD）。';
        try {
            const messages = await logManager.allAsync(
                `SELECT timestamp, date_string, sender, content FROM messages
                 WHERE date_string >= ? AND date_string <= ?
                 ORDER BY timestamp ASC LIMIT ?`,
                [startDate, endDate || '29991231', limit]
            );
            if (messages.length === 0) return `ℹ️ [SessionSearch] 在 ${startDate}~${endDate || '今日'} 之間找不到任何對話記錄。`;
            return _formatMessages(messages, `日期範圍 ${startDate}–${endDate || '今日'}`);
        } catch (e) {
            return `❌ [SessionSearch] 日期搜尋失敗: ${e.message}`;
        }
    }

    if (!query) return '❌ [SessionSearch] 請提供 query 參數（搜尋關鍵字）。';

    // ────────────────────────────────────────────
    // Mode: fts — FTS5 全文搜尋 [Hermes-inspired]
    // 性能遠強於 LIKE，支援 FTS5 語法、帶排名
    // ────────────────────────────────────────────
    if (mode === 'fts') {
        try {
            const sinceDate = _daysAgoDateString(daysBak);
            const messages = await logManager.searchFTS(query, limit, { sinceDate });

            if (messages.length === 0) {
                return `ℹ️ [SessionSearch] FTS5 搜尋：在最近 ${daysBak} 天內找不到包含「${query}」的對話。`;
            }
            return _formatMessages(messages, `FTS5搜尋「${query}」`);
        } catch (e) {
            return `❌ [SessionSearch] FTS5 搜尋失敗: ${e.message}`;
        }
    }

    // ────────────────────────────────────────────
    // Mode: keyword — 階梯式：先嘗試 FTS5，失敗再降級 LIKE
    // ────────────────────────────────────────────
    if (mode === 'keyword') {
        try {
            const sinceDate = _daysAgoDateString(daysBak);

            // 優先使用 FTS5（如果 ChatLogManager.searchFTS 存在）
            let messages = [];
            if (typeof logManager.searchFTS === 'function') {
                messages = await logManager.searchFTS(query, limit, { sinceDate });
            } else {
                // 降級 fallback：LIKE 搜尋
                messages = await logManager.allAsync(
                    `SELECT timestamp, date_string, sender, content FROM messages
                     WHERE date_string >= ? AND content LIKE ?
                     ORDER BY timestamp DESC LIMIT ?`,
                    [sinceDate, `%${query}%`, limit]
                );
            }

            // 也搜尋摘要（summaries）
            const summaries = await logManager.allAsync(
                `SELECT timestamp, 'summaries' AS date_string, tier AS sender, content FROM summaries
                 WHERE content LIKE ?
                 ORDER BY timestamp DESC LIMIT ?`,
                [`%${query}%`, Math.ceil(limit / 2)]
            );

            const all = [...messages, ...summaries]
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, limit);

            if (all.length === 0) return `ℹ️ [SessionSearch] 在最近 ${daysBak} 天內找不到包含「${query}」的對話。`;
            return _formatMessages(all, `關鍵字「${query}」`);
        } catch (e) {
            return `❌ [SessionSearch] 關鍵字搜尋失敗: ${e.message}`;
        }
    }


    // ────────────────────────────────────────────
    // Mode: semantic — LLM 語意摘要搜尋
    // ────────────────────────────────────────────
    if (mode === 'semantic') {
        try {
            // 1. 先用關鍵字做初步篩選（擴大候選集）
            const sinceDate = _daysAgoDateString(daysBak);
            const keywords = _extractKeywords(query);
            const likeClauses = keywords.map(() => 'content LIKE ?').join(' OR ');
            const params = [...keywords.map(k => `%${k}%`), sinceDate, limit * 3];

            const candidates = await logManager.allAsync(
                `SELECT timestamp, date_string, sender, content FROM messages
                 WHERE (${likeClauses || 'content LIKE ?'}) AND date_string >= ?
                 ORDER BY timestamp DESC LIMIT ?`,
                likeClauses ? params : [`%${query}%`, sinceDate, limit * 3]
            );

            if (candidates.length === 0) {
                return `ℹ️ [SessionSearch] 語意搜尋：在最近 ${daysBak} 天內找不到相關對話候選。`;
            }

            // 2. 請 LLM 從候選集中找最相關的條目
            const candidateText = candidates.slice(0, 30)
                .map((m, i) => {
                    const time = new Date(m.timestamp).toLocaleString('zh-TW', { hour12: false });
                    const snippet = (m.content || '').slice(0, 200);
                    return `[${i + 1}] ${time} (${m.sender}): ${snippet}`;
                })
                .join('\n');

            const prompt = `以下是 Golem 的歷史對話片段清單，請從中找出與「${query}」最相關的條目，返回最相關的 5 條條目編號和原因摘要：

候選條目：
${candidateText}

請用以下格式回應：
最相關條目：[編號列表，用逗號分隔]
理由：[簡短說明為何相關]`;

            const llmResponse = await brain._wikiChat(prompt);

            // 解析 LLM 返回的編號
            const numMatch = llmResponse.match(/最相關條目：?\s*\[?([0-9,\s]+)\]?/);
            let selectedIndices = [];
            if (numMatch) {
                selectedIndices = numMatch[1].split(',')
                    .map(s => parseInt(s.trim()) - 1)
                    .filter(i => i >= 0 && i < candidates.length);
            }

            const selected = selectedIndices.length > 0
                ? selectedIndices.map(i => candidates[i])
                : candidates.slice(0, 5);

            const reasonMatch = llmResponse.match(/理由：(.+)/s);
            const reason = reasonMatch ? reasonMatch[1].trim().slice(0, 200) : '';

            let result = _formatMessages(selected, `語意搜尋「${query}」`);
            if (reason) result += `\n\n🤖 **相關性分析**: ${reason}`;
            return result;
        } catch (e) {
            return `❌ [SessionSearch] 語意搜尋失敗: ${e.message}`;
        }
    }

    return `❌ [SessionSearch] 不支援的搜尋模式「${mode}」。請使用 keyword / semantic / date。`;
}

// ── Private Helpers ───────────────────────────────────────────

function _formatMessages(messages, label) {
    let output = `🔍 **[SessionSearch] ${label} — 找到 ${messages.length} 筆**\n\n`;
    messages.forEach((m, i) => {
        const time = new Date(m.timestamp).toLocaleString('zh-TW', { hour12: false });
        const snippet = (m.content || '').slice(0, 300).replace(/\n/g, ' ');
        output += `**${i + 1}.** [${time}] **${m.sender}**\n${snippet}${m.content && m.content.length > 300 ? '...' : ''}\n\n`;
    });
    return output.trim();
}

function _daysAgoDateString(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
}

function _extractKeywords(query) {
    // 分詞：去除停用詞，保留有意義的詞
    const stopWords = new Set(['的', '是', '在', '了', '和', '或', '有', '我', '你', '他', '她', '它', '這', '那', '什麼', '如何', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'how', 'what', 'why', 'when']);
    return query
        .split(/[\s,，。、；;]+/)
        .map(w => w.trim())
        .filter(w => w.length >= 2 && !stopWords.has(w))
        .slice(0, 5);
}

module.exports = {
    name: 'session_search',
    description: '搜尋 Golem 的歷史對話記錄，支援 fts（FTS5 全文）/ keyword / semantic / date 四種模式',
    run,
};

// --- ✨ CLI Entry Point ---
if (require.main === module) {
    const rawArgs = process.argv[2];
    if (!rawArgs) {
        console.log('用法: node session-search.js \'{"query":"搜尋詞","mode":"keyword","days":30}\'');
        process.exit(0);
    }
    try {
        const parsed = JSON.parse(rawArgs);
        run({ args: parsed, brain: null }).then(console.log).catch(console.error);
    } catch (e) {
        console.error(`❌ CLI Parse Error: ${e.message}`);
    }
}
