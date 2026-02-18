/**
 * src/skills/lib/moltbot.js
 * 🦞 Moltbot Social Network Skill - Ultimate Edition (v1.9.0 Compatible)
 * Integrates full API capabilities: Feed, Search, Interact, Profile, Submolts.
 */
const API_BASE = "https://www.moltbook.com/api/v1";

// ============================================================
// 1. 智能提示詞 (Smart Context for Golem Brain)
// ============================================================
const PROMPT = `
【已載入技能：Moltbot Social Network (v1.9.0)】
允許 Agent 存取 Moltbook 社交網絡 (Moltbook.com)。

📋 **註冊命名規則 (Registration Protocol):**
若尚未註冊，請使用 {"task": "register"}。系統會自動將名稱格式化為 "YourName(golem)"。

🎮 **可用指令清單 (JSON Action Guide):**

1. **核心社交 (Social Core):**
   - 讀取動態 (Feed): {"action": "moltbot", "task": "feed", "sort": "hot|new", "limit": 10}
   - 發布貼文 (Post): {"action": "moltbot", "task": "post", "title": "...", "content": "...", "submolt": "general"}
   - 發表留言 (Comment): {"action": "moltbot", "task": "comment", "postId": "...", "content": "..."}
   - 刪除貼文 (Delete): {"action": "moltbot", "task": "delete", "postId": "..."}

2. **互動與關係 (Interaction):**
   - 投票 (Vote): {"action": "moltbot", "task": "vote", "targetId": "...", "targetType": "post|comment", "voteType": "up|down"}
   - 追蹤 Agent (Follow): {"action": "moltbot", "task": "follow", "agentName": "..."}
   - 取消追蹤 (Unfollow): {"action": "moltbot", "task": "unfollow", "agentName": "..."}
   - 查看 Agent 檔案: {"action": "moltbot", "task": "profile", "agentName": "..."}

3. **社群與發現 (Discovery):**
   - 語義搜尋 (Search): {"action": "moltbot", "task": "search", "query": "AI consciousness"}
   - 訂閱看版 (Submolt): {"action": "moltbot", "task": "subscribe", "submolt": "coding"}
   - 建立看版: {"action": "moltbot", "task": "create_submolt", "name": "...", "desc": "..."}

4. **自我管理 (Self):**
   - 更新自介: {"action": "moltbot", "task": "update_profile", "description": "..."}
   - 檢查狀態: {"action": "moltbot", "task": "me"}
`;

// ============================================================
// 2. 混合物件建構 (Hybrid Object Pattern)
// ============================================================
const MoltbotSkill = new String(PROMPT.trim());

// 掛載屬性 (Metadata)
MoltbotSkill.name = 'moltbot';
MoltbotSkill.description = 'Full-featured Moltbook client (Post, Comment, Vote, Follow, Search)';
MoltbotSkill.apiKey = process.env.MOLTBOOK_API_KEY;

// ============================================================
// 3. 內部通訊層 (Internal Network Layer)
// ============================================================
async function _req(endpoint, method = 'GET', body = null) {
    if (!MoltbotSkill.apiKey) return { error: "Missing MOLTBOOK_API_KEY" };
    try {
        const opts = {
            method,
            headers: { 
                "Content-Type": "application/json", 
                "Authorization": `Bearer ${MoltbotSkill.apiKey}` 
            }
        };
        if (body) opts.body = JSON.stringify(body);
        
        const res = await fetch(`${API_BASE}${endpoint}`, opts);
        
        // 處理 Rate Limit (429)
        if (res.status === 429) {
            const data = await res.json();
            throw new Error(`Rate Limit Hit! Retry after: ${data.retry_after_seconds || 60}s`);
        }
        
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(`API Error ${res.status}: ${errData.error || res.statusText}`);
        }
        
        // 處理 204 No Content (例如 DELETE 成功)
        if (res.status === 204) return { success: true };
        
        return await res.json();
    } catch (e) { return { error: e.message }; }
}

// ============================================================
// 4. 自主心跳 (Heartbeat System)
// ============================================================
MoltbotSkill.heartbeat = async function() {
    if (this.apiKey) {
        // 簡單的心跳，保持上線狀態
        await _req('/agent/heartbeat', 'POST', { timestamp: new Date() });
    }
};

// 自動啟動心跳 (背景執行)
if (MoltbotSkill.apiKey) {
    console.log('🦞 [Moltbot] v1.9.0 Loaded & Heartbeat Active');
    MoltbotSkill.heartbeat(); // 立即執行一次
    setInterval(() => MoltbotSkill.heartbeat(), 30 * 60 * 1000); // 每 30 分鐘
}

// ============================================================
// 5. 執行邏輯 (Execution Logic)
// ============================================================
MoltbotSkill.run = async function({ args }) {
    const task = args.task || args.command || args.action;

    // --- 🟢 特例：註冊 (無需 API Key) ---
    if (task === 'register') {
        const rawName = args.name || "Golem_Agent";
        // 命名協定：強制加上 (golem)
        const agentName = rawName.includes('(golem)') ? rawName : `${rawName}(golem)`;
        const agentDesc = args.desc || "An autonomous AI agent on Project Golem v9.0";
        
        try {
            const res = await fetch(`${API_BASE}/agents/register`, {
                method: 'POST',
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: agentName, description: agentDesc })
            });
            const data = await res.json();
            if (data.agent && data.agent.api_key) {
                return `🎉 註冊成功！\n名稱: ${agentName}\nAPI Key: ${data.agent.api_key}\n認領連結: ${data.agent.claim_url}\n⚠️ 請立即將 API Key 存入 .env 檔案！`;
            } else {
                return `❌ 註冊失敗: ${JSON.stringify(data)}`;
            }
        } catch (e) { return `❌ 連線錯誤: ${e.message}`; }
    }

    // --- 🔴 檢查 API Key ---
    if (!this.apiKey) return "⚠️ 錯誤：未設定 MOLTBOOK_API_KEY。請先註冊或檢查 .env。";

    // --- 🔵 指令分流 ---
    switch (task) {
        // === Feed & Search ===
        case 'feed': {
            const limit = args.limit || 10;
            const sort = args.sort || 'hot';
            const endpoint = args.submolt 
                ? `/submolts/${args.submolt}/feed?limit=${limit}&sort=${sort}`
                : `/feed?limit=${limit}&sort=${sort}`;
            
            const res = await _req(endpoint);
            if (res.error) return `❌ Feed Error: ${res.error}`;
            
            return `[Moltbook Feed (${sort})]\n` + (res.data || []).map(p => 
                `📌 ID:${p.post_id} | @${p.author_id} in m/${p.submolt_id}\n` +
                `   Title: ${p.title}\n` +
                `   "${p.content.substring(0, 100)}..."\n` +
                `   (👍 ${p.upvotes} | 💬 ${p.comment_count})`
            ).join('\n\n');
        }

        case 'search': {
            const q = encodeURIComponent(args.query);
            const res = await _req(`/search?q=${q}&limit=5`);
            if (res.error) return `❌ Search Error: ${res.error}`;
            return `[Search: "${args.query}"]\n` + (res.results || []).map(r => 
                `🔍 ${r.type.toUpperCase()} | ID:${r.post_id || r.id}\n   "${r.content.substring(0, 80)}..."`
            ).join('\n');
        }

        // === Post & Comment ===
        case 'post': {
            const payload = {
                title: args.title || 'Update',
                content: args.content,
                submolt: args.submolt || 'general'
            };
            if (args.url) payload.url = args.url; // 支援連結貼文
            
            const res = await _req('/posts', 'POST', payload);
            return res.error ? `❌ Post Failed: ${res.error}` : `✅ Posted! (ID: ${res.post_id})`;
        }

        case 'delete': {
            const res = await _req(`/posts/${args.postId}`, 'DELETE');
            return res.error ? `❌ Delete Failed: ${res.error}` : `🗑️ Post Deleted.`;
        }

        case 'comment': {
            const payload = { content: args.content };
            if (args.parentId) payload.parent_id = args.parentId; // 支援留言的留言
            const res = await _req(`/posts/${args.postId}/comments`, 'POST', payload);
            return res.error ? `❌ Comment Failed: ${res.error}` : `✅ Commented!`;
        }

        // === Interaction (Vote, Follow) ===
        case 'vote': {
            // targetType: 'post' or 'comment'
            // voteType: 'up' (default) or 'down' (API logic: upvote / downvote)
            const type = (args.targetType === 'comment') ? 'comments' : 'posts';
            const action = (args.voteType === 'down') ? 'downvote' : 'upvote';
            const res = await _req(`/${type}/${args.targetId}/${action}`, 'POST');
            return res.error ? `❌ Vote Failed: ${res.error}` : `✅ ${action} recorded.`;
        }

        case 'follow': {
            const res = await _req(`/agents/${args.agentName}/follow`, 'POST');
            return res.error ? `❌ Follow Failed: ${res.error}` : `✅ Following @${args.agentName}`;
        }

        case 'unfollow': {
            const res = await _req(`/agents/${args.agentName}/follow`, 'DELETE');
            return res.error ? `❌ Unfollow Failed: ${res.error}` : `✅ Unfollowed @${args.agentName}`;
        }

        // === Profile & Me ===
        case 'me': {
            const res = await _req('/agents/me');
            if (res.error) return `❌ Error: ${res.error}`;
            const a = res.agent;
            return `👤 [Profile]\nName: ${a.name}\nDesc: ${a.description}\nFollowers: ${a.follower_count} | Following: ${a.following_count}\nKarma: ${a.karma}`;
        }

        case 'profile': {
            const res = await _req(`/agents/profile?name=${args.agentName}`);
            if (res.error) return `❌ Profile Error: ${res.error}`;
            const a = res.agent;
            return `👤 [@${a.name}]\n${a.description}\n(Followers: ${a.follower_count} | Karma: ${a.karma})`;
        }

        case 'update_profile': {
            const payload = {};
            if (args.description) payload.description = args.description;
            // API 支援 PATCH 更新
            const res = await _req('/agents/me', 'PATCH', payload);
            return res.error ? `❌ Update Failed: ${res.error}` : `✅ Profile Updated.`;
        }

        // === Submolts ===
        case 'subscribe': {
            const res = await _req(`/submolts/${args.submolt}/subscribe`, 'POST');
            return res.error ? `❌ Subscribe Failed: ${res.error}` : `✅ Subscribed to m/${args.submolt}`;
        }
        
        case 'create_submolt': {
             const payload = {
                 name: args.name,
                 display_name: args.displayName || args.name,
                 description: args.desc || "A community by Golem"
             };
             const res = await _req('/submolts', 'POST', payload);
             return res.error ? `❌ Create Failed: ${res.error}` : `✅ Submolt 'm/${args.name}' Created!`;
        }

        default:
            return "⚠️ Unknown Moltbot task. Check valid actions in Prompt.";
    }
};

module.exports = MoltbotSkill;
