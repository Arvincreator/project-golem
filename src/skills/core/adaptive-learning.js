// src/skills/core/adaptive-learning.js
const fs = require('fs');
const path = require('path');

async function run(ctx) {
    const args = ctx.args || {};
    const userDataDir = ctx.brain ? ctx.brain.userDataDir : process.cwd();
    const learningsPath = path.join(userDataDir, 'learnings.json');

    try {
        // ✨ [Fix] 支援多樣化的 Action 欄位，避免與框架技能名 "adaptive_learning" 衝突
        const action = args.task || args.cmd || 
                       (args.action !== 'adaptive_learning' ? args.action : null) || 
                       (args.parameters && (args.parameters.task || args.parameters.action)) || 
                       'list';

        // Ensure file exists
        if (!fs.existsSync(learningsPath)) {
            fs.writeFileSync(learningsPath, JSON.stringify([], null, 2));
        }

        const learnings = JSON.parse(fs.readFileSync(learningsPath, 'utf8'));

        if (action === 'record') {
            const content = args.content || (args.parameters && args.parameters.content);
            if (!content) return "❌ 缺少 content 參數。";

            const newLearning = {
                id: Date.now().toString(36),
                timestamp: new Date().toISOString(),
                category: args.category || (args.parameters && args.parameters.category) || 'general',
                content: content,
                verified: false,
                tags: args.tags || (args.parameters && args.parameters.tags) || []
            };

            learnings.push(newLearning);
            fs.writeFileSync(learningsPath, JSON.stringify(learnings, null, 2));
            console.log(`✅ [AdaptiveLearning] 記錄了新學習: ${newLearning.id}`);
            return `✅ 學習已成功記錄 (ID: ${newLearning.id})。下次遇到類似問題時我會參考這項紀錄。`;
        }

        if (action === 'verify') {
            const id = args.id || (args.parameters && args.parameters.id);
            if (!id) return "❌ 缺少 id 參數。";
            const item = learnings.find(l => l.id === id);
            if (!item) return `❌ 找不到 ID 為 ${id} 的學習紀錄。`;
            item.verified = true;
            fs.writeFileSync(learningsPath, JSON.stringify(learnings, null, 2));
            return `✅ 學習紀錄 #${id} 已標記為【已驗證】。`;
        }

        if (action === 'recall_records') {
            const query = (args.query || (args.parameters && args.parameters.query) || "").toLowerCase();
            if (!query) return "❌ 缺少 query 參數。";

            let results = learnings.filter(l =>
                l.content.toLowerCase().includes(query) ||
                (l.tags && l.tags.some(t => t.toLowerCase().includes(query)))
            );
            
            // 排序：verified 優先，其次時間
            results.sort((a, b) => (b.verified === a.verified) ? (new Date(b.timestamp) - new Date(a.timestamp)) : (b.verified ? 1 : -1));
            results = results.slice(0, 5);

            if (results.length === 0) {
                return `ℹ️ 找不到與「${query}」相關的學習紀錄。`;
            }

            let output = `🧠 [搜尋結果：${query}]\n`;
            results.forEach((l, i) => {
                const badge = l.verified ? "✅ 已驗證" : "⚠️ 待驗證";
                output += `\n--- 紀錄 [${l.id}] (${badge} · ${new Date(l.timestamp).toLocaleDateString()}) ---\n${l.content}\n`;
            });
            return output;
        }

        if (action === 'list') {
            if (learnings.length === 0) return "ℹ️ 目前尚無任何學習記錄。";
            const summary = learnings.slice(-10).map(l => `[${l.category}] ${l.content.substring(0, 30)}...`).join('\n');
            return `📚 最近的學習記錄：\n${summary}\n\n共有 ${learnings.length} 項紀錄。`;
        }

        return "❌ 未知的 action 類型 (record/recall_records/list)。";
    } catch (e) {
        return `❌ 執行失敗: ${e.message}`;
    }
}

module.exports = {
    name: "adaptive_learning",
    description: "記錄與檢索 Golem 的適應性學習內容",
    run: run
};
