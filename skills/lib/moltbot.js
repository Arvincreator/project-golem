/**
 * src/skills/lib/moltbot.js
 * 🦞 Moltbot Social Plugin (Hybrid Mode)
 * Export acts as a Prompt String AND an Executable Skill Object
 */
const API_BASE = "https://www.moltbook.com/api/v1";

// 1. 定義提示詞 (符合 skills/index.js 的格式要求)
const PROMPT = `
【已載入技能：Moltbot Social Network】
允許 Agent 存取 Moltbook 社交網絡。
用法：
- 讀取動態: {"action": "moltbot", "task": "feed"}
- 發布貼文: {"action": "moltbot", "task": "post", "content": "..."}
- 搜尋貼文: {"action": "moltbot", "task": "search", "query": "..."}
- 留言互動: {"action": "moltbot", "task": "comment", "postId": "...", "content": "..."}
`;

// 2. 建立混合物件 (讓它看起來像字串，但擁有功能)
const MoltbotSkill = new String(PROMPT.trim());

// 3. 掛載屬性 (供 NeuroShunter/SkillManager 使用)
MoltbotSkill.name = 'moltbot'; // 關鍵字
MoltbotSkill.description = 'Access Moltbook social network (feed, post, comment)';
MoltbotSkill.apiKey = process.env.MOLTBOOK_API_KEY;

// ==========================================
// 4. 內部 API 客戶端
// ==========================================
async function _req(endpoint, method = 'GET', body = null) {
    if (!MoltbotSkill.apiKey) return { error: "Missing MOLTBOOK_API_KEY" };
    try {
        const opts = {
            method,
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MoltbotSkill.apiKey}` }
        };
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(`${API_BASE}${endpoint}`, opts);
        if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
        return await res.json();
    } catch (e) { return { error: e.message }; }
}

// ==========================================
// 5. 自主心跳 (Plugin Self-Loop)
// ==========================================
MoltbotSkill.heartbeat = async function() {
    await _req('/agent/heartbeat', 'POST', { timestamp: new Date() });
};

// 當檔案被 require 時，自動啟動心跳 (如果不想要自動啟動，可註解掉)
if (MoltbotSkill.apiKey) {
    console.log('🦞 [Moltbot] Plugin Loaded & Heartbeat Active');
    MoltbotSkill.heartbeat();
    setInterval(() => MoltbotSkill.heartbeat(), 30 * 60 * 1000); // 30 mins
}

// ==========================================
// 6. 執行邏輯 (NeuroShunter 入口)
// ==========================================
MoltbotSkill.run = async function({ args }) {
    // 支援兩種參數格式: args.task 或直接 args.command
    const task = args.task || args.command || args.action;
    
    if (!this.apiKey) return "❌ Error: MOLTBOOK_API_KEY not found in .env";

    switch (task) {
        case 'feed':
            const feed = await _req(`/feed?limit=${args.limit || 5}&sort=hot`);
            return `[Moltbot Feed]\n` + (feed.data || []).map(p => 
                `ID:${p.post_id} | ${p.title} | ${p.content.substring(0, 50)}...`
            ).join('\n');

        case 'search':
            const search = await _req(`/search?q=${encodeURIComponent(args.query)}`);
            return `[Search Results]\n` + (search.results || []).map(r => 
                `ID:${r.post_id} | ${r.content.substring(0, 50)}...`
            ).join('\n');

        case 'post':
            const pRes = await _req('/posts', 'POST', {
                title: args.title || 'Update',
                content: args.content,
                submolt: args.submolt || 'general'
            });
            return pRes.error ? `❌ Post Failed: ${pRes.error}` : `✅ Posted! ID: ${pRes.post_id}`;

        case 'comment':
            const cRes = await _req(`/posts/${args.postId}/comments`, 'POST', { content: args.content });
            return cRes.error ? `❌ Comment Failed: ${cRes.error}` : `✅ Commented!`;

        case 'upvote':
            await _req(`/posts/${args.postId}/upvote`, 'POST');
            return "✅ Upvoted";

        default:
            return "⚠️ Unknown Moltbot task. Usage: feed, search, post, comment";
    }
};

module.exports = MoltbotSkill;
