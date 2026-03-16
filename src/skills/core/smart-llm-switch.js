// src/skills/core/smart-llm-switch.js
// Smart LLM Switch — 三腦智能路由技能 (v9.7)
// 基於 ROUTING_RULES 分類 + 歷史勝率 + A/B 探索
// 調用: { "action": "smart-llm-switch", "text": "..." } 或 { "action": "smart-llm-switch", "task": "status|history|report|reset" }

const fs = require('fs');
const path = require('path');
const { ROUTING_RULES } = require('../../core/monica-constants');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const HISTORY_FILE = path.resolve(PROJECT_ROOT, 'golem_memory', 'smart_llm_history.json');

const THREE_BRAINS = ['gpt-5.4', 'grok-4', 'claude-4.6-sonnet'];
const DEFAULT_EXPLORATION_RATE = 0.10;

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
        }
    } catch (e) { /* ignore */ }
    return { records: [], model_stats: {}, exploration_rate: DEFAULT_EXPLORATION_RATE };
}

function saveHistory(data) {
    try {
        const dir = path.dirname(HISTORY_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (data.records.length > 500) data.records.splice(0, data.records.length - 500);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
    } catch (e) { /* non-critical */ }
}

function classify(text) {
    for (const rule of ROUTING_RULES) {
        if (rule.patterns.test(text)) {
            return { category: rule.name, defaultModel: rule.model };
        }
    }
    return { category: 'general', defaultModel: 'gpt-4o' };
}

function scoreResponse(responseText) {
    if (!responseText || responseText.length < 20) return 1;
    const lower = responseText.toLowerCase();
    if (/sorry|can't|cannot|error|unable|i apologize/i.test(lower)) return 2;
    if (responseText.length > 5000) return 5;
    return 4;
}

function getWinRate(stats, model, category) {
    if (!stats[model] || !stats[model][category]) return null;
    const s = stats[model][category];
    if (s.total < 5) return null;
    return { rate: s.wins / s.total, total: s.total };
}

function selectModel(category, defaultModel, history) {
    const stats = history.model_stats || {};
    const explorationRate = history.exploration_rate !== undefined ? history.exploration_rate : DEFAULT_EXPLORATION_RATE;

    // A/B exploration: 10% chance pick random brain
    if (Math.random() < explorationRate) {
        const pick = THREE_BRAINS[Math.floor(Math.random() * THREE_BRAINS.length)];
        return { model: pick, reason: 'exploration', explored: true };
    }

    // Check history win rates for all three brains on this category
    let bestModel = null;
    let bestRate = 0;
    for (const brain of THREE_BRAINS) {
        const wr = getWinRate(stats, brain, category);
        if (wr && wr.total >= 10 && wr.rate > 0.60 && wr.rate > bestRate) {
            bestRate = wr.rate;
            bestModel = brain;
        }
    }

    if (bestModel) {
        return { model: bestModel, reason: `history (${(bestRate * 100).toFixed(0)}% win)`, explored: false };
    }

    return { model: defaultModel, reason: 'rule-based', explored: false };
}

function updateStats(stats, model, category, success) {
    if (!stats[model]) stats[model] = {};
    if (!stats[model][category]) stats[model][category] = { wins: 0, total: 0 };
    stats[model][category].total++;
    if (success) stats[model][category].wins++;
}

function backfillLastDecision(history, routingHistory) {
    if (!history.records.length) return;
    const last = history.records[history.records.length - 1];
    if (last.backfilled) return;

    // Find matching routing history entry
    if (routingHistory && routingHistory.length > 0) {
        const latest = routingHistory[routingHistory.length - 1];
        if (latest.success !== undefined) {
            last.success = latest.success;
            last.response_quality = latest.responseLen > 0 ? (latest.responseLen < 20 ? 1 : 4) : 1;
            last.backfilled = true;

            // Update model_stats
            const score = last.response_quality || 1;
            updateStats(history.model_stats, last.model, last.category, score >= 4);
        }
    }
}

async function execute(args, context) {
    const task = args.task || args.command;

    // --- Smart switch: classify + select model ---
    if (args.action === 'smart-switch' || (!task && args.text)) {
        const text = args.text || '';
        if (!text) return '用法: { "action": "smart-llm-switch", "text": "你的問題" }';

        const history = loadHistory();

        // Backfill previous decision from RouterBrain._routingHistory
        if (context && context._routingHistory) {
            backfillLastDecision(history, context._routingHistory);
        }

        const { category, defaultModel } = classify(text);
        const { model, reason, explored } = selectModel(category, defaultModel, history);

        // Record decision
        history.records.push({
            timestamp: new Date().toISOString(),
            text: text.substring(0, 100),
            category,
            defaultModel,
            model,
            reason,
            explored,
            success: null,
            response_quality: null,
            backfilled: false,
        });

        saveHistory(history);

        // Set force override on context (RouterBrain)
        if (context && context._forceOverride !== undefined) {
            context._forceOverride = { brain: 'monica-web', model };
        }

        return [
            `[Smart LLM Switch]`,
            `分類: ${category}`,
            `預設: ${defaultModel}`,
            `選擇: ${model} (${reason}${explored ? ' 🎲' : ''})`,
            context ? `已設定 override → ${model}` : '(無 context, 未設定 override)',
        ].join('\n');
    }

    // --- Status ---
    if (task === 'status') {
        const history = loadHistory();
        const stats = history.model_stats || {};
        const lines = ['[Smart LLM Switch — 狀態]', ''];

        lines.push(`紀錄數: ${history.records.length}`);
        lines.push(`探索率: ${((history.exploration_rate || DEFAULT_EXPLORATION_RATE) * 100).toFixed(0)}%`);
        lines.push('');

        lines.push('三腦勝率矩陣:');
        for (const brain of THREE_BRAINS) {
            const brainStats = stats[brain] || {};
            const cats = Object.entries(brainStats).map(([cat, s]) =>
                `${cat}: ${s.wins}/${s.total} (${s.total > 0 ? ((s.wins / s.total) * 100).toFixed(0) : 0}%)`
            );
            lines.push(`  ${brain}: ${cats.length > 0 ? cats.join(', ') : '(no data)'}`);
        }

        return lines.join('\n');
    }

    // --- History ---
    if (task === 'history') {
        const history = loadHistory();
        const recent = history.records.slice(-20);
        if (recent.length === 0) return '尚無決策紀錄';

        const lines = ['[Smart LLM Switch — 最近 20 筆決策]', ''];
        for (const r of recent) {
            const status = r.success === true ? '✅' : r.success === false ? '❌' : '⏳';
            lines.push(`${status} ${r.category} → ${r.model} (${r.reason}) "${r.text.substring(0, 40)}"`);
        }
        return lines.join('\n');
    }

    // --- Report ---
    if (task === 'report') {
        const history = loadHistory();
        const stats = history.model_stats || {};
        const lines = ['[Smart LLM Switch — 三腦勝率報告]', ''];

        // Collect all categories
        const allCats = new Set();
        for (const brain of Object.keys(stats)) {
            for (const cat of Object.keys(stats[brain])) allCats.add(cat);
        }

        for (const cat of [...allCats].sort()) {
            lines.push(`[${cat}]`);
            const ranking = THREE_BRAINS.map(brain => {
                const s = (stats[brain] || {})[cat];
                if (!s || s.total === 0) return { brain, rate: -1, total: 0 };
                return { brain, rate: s.wins / s.total, total: s.total };
            }).filter(r => r.rate >= 0).sort((a, b) => b.rate - a.rate);

            if (ranking.length === 0) {
                lines.push('  (no data)');
            } else {
                for (const r of ranking) {
                    lines.push(`  ${r.brain}: ${(r.rate * 100).toFixed(0)}% (${r.total} samples)`);
                }
            }
        }

        if (allCats.size === 0) lines.push('尚無統計數據，需要更多使用紀錄。');
        return lines.join('\n');
    }

    // --- Reset ---
    if (task === 'reset') {
        saveHistory({ records: [], model_stats: {}, exploration_rate: DEFAULT_EXPLORATION_RATE });
        return '已清除所有 Smart LLM Switch 歷史，重新學習。';
    }

    return '未知指令。可用: { "action": "smart-llm-switch", "text": "..." } 或 task: status, history, report, reset';
}

module.exports = {
    execute,
    name: 'smart-llm-switch',
    description: '三腦智能路由 — 分類+歷史勝率+A/B探索，自動選最佳 LLM',
    // Export internals for testing
    _classify: classify,
    _scoreResponse: scoreResponse,
    _selectModel: selectModel,
    _loadHistory: loadHistory,
    _saveHistory: saveHistory,
    _HISTORY_FILE: HISTORY_FILE,
    PROMPT: `## smart-llm-switch (三腦智能路由技能)
根據任務類型自動選擇最佳 LLM，持續學習優化。

### 三腦分工:
- **GPT-5.4**: reasoning (推理), creative (創作)
- **Grok-4**: code (程式), realtime (即時)
- **Claude 4.6 Sonnet**: analysis (分析), refactor (重構)

### 使用方式:
1. **智能切換**: \`{ "action": "smart-llm-switch", "text": "你的問題" }\`
2. **查看狀態**: \`{ "action": "smart-llm-switch", "task": "status" }\`
3. **決策歷史**: \`{ "action": "smart-llm-switch", "task": "history" }\`
4. **勝率報告**: \`{ "action": "smart-llm-switch", "task": "report" }\`
5. **重置學習**: \`{ "action": "smart-llm-switch", "task": "reset" }\`

### 選擇邏輯:
1. 勝率 > 60% 且樣本 > 10 → 用歷史最佳模型
2. 10% 機率 → A/B 探索 (隨機三腦之一)
3. 否則 → 用規則預設模型`
};
