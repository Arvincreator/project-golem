// src/skills/core/adaptive-learning.js
const fs = require('fs');
const path = require('path');

async function run(ctx) {
    const args = ctx.args || {};
    const userDataDir = ctx.brain ? ctx.brain.userDataDir : process.cwd();
    const learningsPath = path.join(userDataDir, 'learnings.json');

    try {
        const action = args.action || 'list';

        // Ensure file exists
        if (!fs.existsSync(learningsPath)) {
            fs.writeFileSync(learningsPath, JSON.stringify([], null, 2));
        }

        const learnings = JSON.parse(fs.readFileSync(learningsPath, 'utf8'));

        if (action === 'record') {
            if (!args.content) return "❌ 缺少 content 參數。";

            const newLearning = {
                id: Date.now().toString(36),
                timestamp: new Date().toISOString(),
                category: args.category || 'general',
                content: args.content,
                tags: args.tags || []
            };

            learnings.push(newLearning);
            fs.writeFileSync(learningsPath, JSON.stringify(learnings, null, 2));
            console.log(`✅ [AdaptiveLearning] 記錄了新學習: ${newLearning.id}`);
            return `✅ 學習已成功記錄 (ID: ${newLearning.id})。下次遇到類似問題時我會參考這項紀錄。`;
        }

        if (action === 'search') {
            const query = (args.query || "").toLowerCase();
            if (!query) return "❌ 缺少 query 參數。";

            const results = learnings.filter(l =>
                l.content.toLowerCase().includes(query) ||
                (l.tags && l.tags.some(t => t.toLowerCase().includes(query)))
            ).slice(-5); // Return last 5 matches

            if (results.length === 0) {
                return `ℹ️ 找不到與「${query}」相關的學習紀錄。`;
            }

            let output = `🧠 [搜尋結果：${query}]\n`;
            results.forEach((l, i) => {
                output += `\n--- 紀錄 #${i + 1} (${new Date(l.timestamp).toLocaleDateString()}) ---\n${l.content}\n`;
            });
            return output;
        }

        if (action === 'list') {
            if (learnings.length === 0) return "ℹ️ 目前尚無任何學習記錄。";
            const summary = learnings.slice(-10).map(l => `[${l.category}] ${l.content.substring(0, 30)}...`).join('\n');
            return `📚 最近的學習記錄：\n${summary}\n\n共有 ${learnings.length} 項紀錄。`;
        }

        return "❌ 未知的 action 類型 (record/search/list)。";
    } catch (e) {
        return `❌ 執行失敗: ${e.message}`;
    }
}

module.exports = {
    name: "adaptive_learning",
    description: "記錄與檢索 Golem 的適應性學習內容",
    run: run
};
