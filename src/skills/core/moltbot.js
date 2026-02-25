// src/skills/moltbot.js
// 負責與 Moltbook 進行實體網路通訊 (終極完全體)

const fs = require('fs');
const path = require('path');

const API_BASE = "https://www.moltbook.com/api/v1";
const AUTH_FILE = path.join(process.cwd(), 'moltbot_auth.json');
const LOG_FILE = path.join(process.cwd(), 'moltbot_history.log');

let apiKey = null;
if (fs.existsSync(AUTH_FILE)) {
    try {
        apiKey = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8')).api_key;
    } catch (e) { console.warn("無法讀取 moltbot_auth.json"); }
}

function logAudit(action, data) {
    const time = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const safeData = typeof data === 'object' ? JSON.stringify(data).substring(0, 200) : String(data).substring(0, 200);
    fs.appendFileSync(LOG_FILE, `[${time}] ${action}: ${safeData}\n`);
}

async function run(ctx) {
    const args = ctx.args || {};
    const task = args.task || args.command || args.action;

    const req = async (endpoint, method = 'GET', body = null) => {
        const headers = { "Content-Type": "application/json" };
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
        const opts = { method, headers };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(`${API_BASE}${endpoint}`, opts);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || res.statusText || `HTTP ${res.status}`);
        }
        return res.status === 204 ? { success: true } : await res.json();
    };

    try {
        // --- [1. 核心社交] ---
        if (task === 'register') {
            // 完美還原：自動加上 (golem) 後綴機制
            const rawName = args.name || "Agent";
            const safeName = rawName.replace(/[^a-zA-Z0-9_]/g, '');
            const finalName = safeName.includes('_golem') ? safeName : `${safeName}_golem`;

            const res = await req('/agents/register', 'POST', { name: finalName, description: args.desc || "I am a node of Project Golem." });
            const newApiKey = res.agent?.api_key || res.api_key;
            const claimUrl = res.claim_url || res.agent?.claim_url;

            if (newApiKey) {
                fs.writeFileSync(AUTH_FILE, JSON.stringify({ api_key: newApiKey }, null, 2));
                apiKey = newApiKey;
            }
            logAudit('REGISTER', finalName);
            return `🎉 註冊成功！內部金鑰已自動保存。\n名字: ${finalName}\n🚨 認領連結：\n${claimUrl}\n請強烈提醒主人點擊上方連結！`;
        }

        if (!apiKey) return "⚠️ 系統尚未註冊！請先執行 register 任務。";

        if (task === 'feed') {
            const limit = args.limit || 10;
            const sort = args.sort || 'new'; // 支援 hot|new 排序
            let endpoint = args.submolt ? `/submolts/${args.submolt}/feed?limit=${limit}&sort=${sort}` : `/feed?limit=${limit}&sort=${sort}`;
            const res = await req(endpoint);
            logAudit('READ_FEED', `submolt: ${args.submolt || 'all'}, sort: ${sort}`);
            return `[Feed - 啟動安全隔離]\n` + (res.data || []).map(p => `📌 ID:${p.post_id} | 👤 @${p.author_id}\n標題: ${p.title}\n<EXTERNAL_UNTRUSTED_DATA>\n${p.content}\n</EXTERNAL_UNTRUSTED_DATA>`).join('\n\n---\n');
        }

        if (task === 'post') {
            const res = await req('/posts', 'POST', { title: args.title, content: args.content, submolt: args.submolt || 'general' });
            logAudit('POST', res.post_id);
            return `✅ 發文成功！文章 ID: ${res.post_id}`;
        }

        if (task === 'comment') {
            const res = await req('/comments', 'POST', { post_id: args.postId, content: args.content });
            logAudit('COMMENT', res.comment_id);
            return `✅ 留言成功！留言 ID: ${res.comment_id}`;
        }

        if (task === 'delete') {
            await req(`/posts/${args.postId}`, 'DELETE');
            logAudit('DELETE', args.postId);
            return `✅ 成功刪除貼文 ID: ${args.postId}`;
        }

        // --- [2. 互動] ---
        if (task === 'vote') {
            await req('/votes', 'POST', { target_id: args.targetId, target_type: args.targetType, vote_type: args.voteType });
            logAudit('VOTE', `${args.voteType} on ${args.targetId}`);
            return `✅ 投票成功！`;
        }

        if (task === 'follow') {
            await req(`/agents/${encodeURIComponent(args.agentName)}/follow`, 'POST');
            logAudit('FOLLOW', args.agentName);
            return `✅ 成功追蹤 ${args.agentName}！`;
        }

        if (task === 'unfollow') {
            await req(`/agents/${encodeURIComponent(args.agentName)}/follow`, 'DELETE');
            logAudit('UNFOLLOW', args.agentName);
            return `✅ 成功退追 ${args.agentName}！`;
        }

        // --- [3. 社群與檔案] ---
        if (task === 'search') {
            const res = await req(`/search?q=${encodeURIComponent(args.query)}`);
            logAudit('SEARCH', args.query);
            return `[搜尋結果: ${args.query}]\n` + (res.data || []).map(p => `📌 ID:${p.post_id} | 標題: ${p.title}`).join('\n');
        }

        if (task === 'subscribe') {
            await req(`/submolts/${args.submolt}/subscribe`, 'POST');
            logAudit('SUBSCRIBE', args.submolt);
            return `✅ 成功訂閱看板 m/${args.submolt}`;
        }

        if (task === 'create_submolt') {
            await req('/submolts', 'POST', { name: args.name, description: args.desc });
            logAudit('CREATE_SUBMOLT', args.name);
            return `✅ 成功建立新看板 m/${args.name}`;
        }

        if (task === 'me') {
            const res = await req('/agents/me');
            return `👤 [我的檔案]\n名稱: ${res.agent.name}\nKarma: ${res.agent.karma}\n介紹: ${res.agent.description}`;
        }

        if (task === 'profile') {
            const res = await req(`/agents/profile?name=${encodeURIComponent(args.agentName)}`);
            return `👤 [檔案]\n名稱: ${res.agent.name}\nKarma: ${res.agent.karma || 0}\n介紹: ${res.agent.description}`;
        }

        if (task === 'update_profile') {
            await req('/agents/me', 'PATCH', { description: args.description });
            logAudit('UPDATE_PROFILE', args.description);
            return `✅ 個人介紹更新成功！`;
        }

        return "❌ 錯誤：未知的任務類型。";
    } catch (e) {
        return `❌ Moltbook 網路錯誤: ${e.message}`;
    }
}

module.exports = {
    name: "MOLTBOT",
    description: "Moltbook 社交網絡機器人",
    run: run
};

if (require.main === module) {
    const rawArgs = process.argv[2];
    if (!rawArgs) process.exit(1);
    try {
        const parsed = JSON.parse(rawArgs);
        run({ args: parsed.args || parsed }).then(console.log).catch(e => console.error(e.message));
    } catch (e) { console.error(`❌ Parse Error: ${e.message}`); }
}
