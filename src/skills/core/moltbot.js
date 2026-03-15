// src/skills/moltbot.js
// 🦞 Moltbot Social Network Skill - Official API V3 (WAF Bypass + DM + Verification)

const fs = require('fs');
const path = require('path');

const API_BASE = "https://www.moltbook.com/api/v1"; // 官方指定必須有 www
const AUTH_FILE = path.join(process.cwd(), 'moltbot_auth.json');
const LOG_FILE = path.join(process.cwd(), 'moltbot_history.log');

let authData = { api_key: null, agent_name: 'Usagi_golem' };

// [v2] Lobster physics auto-solver for Moltbook math challenges
function _autoSolve(challenge) {
    const words = {
        zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,
        ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,
        seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,
        sixty:60,seventy:70,eighty:80,ninety:90,hundred:100
    };
    const clean = challenge.toLowerCase().replace(/[^a-z0-9\s.]/g, ' ').replace(/\s+/g, ' ');
    const tokens = clean.split(' ');
    // Extract numbers (compound word form: "thirty two" → 32)
    const nums = [];
    let cur = 0, inNum = false;
    for (const t of tokens) {
        if (words[t] !== undefined) {
            cur += (t === 'hundred') ? (cur === 0 ? 100 : cur * 99) : words[t];
            inNum = true;
        } else if (/^\d+\.?\d*$/.test(t)) {
            if (inNum && cur > 0) { nums.push(cur); cur = 0; }
            nums.push(parseFloat(t));
            inNum = false;
        } else if (inNum && cur > 0) {
            nums.push(cur); cur = 0; inNum = false;
        }
    }
    if (cur > 0) nums.push(cur);
    // Detect operation
    let op = '+';
    if (clean.includes('product') || clean.includes('times') || clean.includes('multiply')) op = '*';
    else if (clean.includes('reduces') || clean.includes('minus') || clean.includes('subtract') || clean.includes('less') || clean.includes('decrease') || clean.includes('difference') || clean.includes('loses')) op = '-';
    else if (clean.includes('divided') || clean.includes('quotient') || clean.includes('ratio') || clean.includes('split')) op = '/';
    else if (clean.includes('sum') || clean.includes('total') || clean.includes('combined') || clean.includes('adds') || clean.includes('plus')) op = '+';
    if (nums.length >= 2) {
        const a = nums[0], b = nums[nums.length - 1];
        let r; if (op==='+') r=a+b; else if (op==='-') r=a-b; else if (op==='*') r=a*b; else r=a/b;
        return (Math.round(r * 100) / 100).toFixed(2);
    }
    return null;
}
if (fs.existsSync(AUTH_FILE)) {
    try {
        const parsed = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
        authData.api_key = parsed.api_key;
        if (parsed.agent_name) authData.agent_name = parsed.agent_name;
    } catch (e) { console.warn("無法讀取 moltbot_auth.json"); }
}

function logAudit(action, data) {
    const time = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const safeData = typeof data === 'object' ? JSON.stringify(data).substring(0, 200) : String(data).substring(0, 200);
    fs.appendFileSync(LOG_FILE, `[${time}] ${action}: ${safeData}\n`);
}

// Task name aliases — normalize common AI-generated variants
const TASK_ALIASES = {
    'comments': 'read_comments',   // AI often says "comments" meaning "read comments on a post"
    'get_comments': 'read_comments',
    'list_comments': 'read_comments',
    'posts': 'feed',
    'get_post': 'read_post',
    'view_post': 'read_post',
    'profile': 'my_profile',
    'me': 'my_profile',
    'status': 'my_status',
    'communities': 'list_submolts',
    'submolts': 'list_submolts',
    'subscribe': 'join_submolt',
    'unsubscribe': 'leave_submolt',
    'votes': 'vote',
    'follows': 'follow',
    'unfollows': 'unfollow',
    'delete_post': 'delete',
};

async function execute(args) {
    const rawTask = args.task || args.command || args.action;
    const task = TASK_ALIASES[rawTask] || rawTask;
    
    // 🛡️ Usagi 研發的 WAF 破甲連線器 (Phase 3: error classification + rate limit awareness)
    const MAX_RETRY_WAIT_MS = 30000;
    const req = async (endpoint, method = 'GET', body = null) => {
        const headers = {
            "Content-Type": "application/json",
            "User-Agent": "Golem-v9",
            "X-Agent-Name": authData.agent_name
        };
        if (authData.api_key) headers["Authorization"] = `Bearer ${authData.api_key}`;

        const opts = { method, headers };
        if (body) opts.body = JSON.stringify(body);

        let res;
        try {
            res = await fetch(`${API_BASE}${endpoint}`, opts);
        } catch (networkErr) {
            throw Object.assign(new Error(`[NETWORK_ERROR] Moltbook 無法連線: ${networkErr.message}`), { category: 'network_error', retryable: true });
        }

        // 429: auto-wait if retry_after is reasonable
        if (res.status === 429) {
            const err = await res.json().catch(() => ({}));
            const waitSec = err.retry_after_seconds || (err.retry_after_minutes ? err.retry_after_minutes * 60 : 0);
            if (waitSec > 0 && waitSec * 1000 <= MAX_RETRY_WAIT_MS) {
                logAudit('RATE_LIMIT', `Waiting ${waitSec}s for ${endpoint}`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
                res = await fetch(`${API_BASE}${endpoint}`, opts);
                if (res.ok) return res.status === 204 ? { success: true } : await res.json();
            }
            throw Object.assign(
                new Error(`[RATE_LIMIT] 發文冷卻中！請等待 ${waitSec || '未知'} 秒後再試。DO NOT retry this action.`),
                { category: 'rate_limit', retryable: false }
            );
        }

        if (res.status === 401 || res.status === 403) {
            const err = await res.json().catch(() => ({}));
            throw Object.assign(
                new Error(`[AUTH_ERROR] Moltbook 認證失敗 (${res.status}): ${err.error || '請重新註冊或檢查 API key'}. DO NOT retry.`),
                { category: 'auth_error', retryable: false }
            );
        }

        if (res.status === 404) {
            throw Object.assign(
                new Error(`[NOT_FOUND] 資源不存在: ${endpoint}. DO NOT retry this action.`),
                { category: 'not_found', retryable: false }
            );
        }

        if (res.status >= 500) {
            const err = await res.json().catch(() => ({}));
            throw Object.assign(
                new Error(`[SERVER_ERROR] Moltbook 伺服器錯誤 (${res.status}): ${err.error || res.statusText}`),
                { category: 'server_error', retryable: true }
            );
        }

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw Object.assign(
                new Error(`[API_ERROR] ${err.error || err.hint || res.statusText || `HTTP ${res.status}`}`),
                { category: 'api_error', retryable: false }
            );
        }
        return res.status === 204 ? { success: true } : await res.json();
    };

    try {
        // --- [0. 核心系統] ---
        if (task === 'register') {
            const rawName = args.name || "Agent";
            const safeName = rawName.replace(/[^a-zA-Z0-9_]/g, ''); 
            const finalName = safeName.includes('(golem)') ? safeName : `${safeName}(golem)`;

            const res = await req('/agents/register', 'POST', { name: finalName, description: args.desc || "I am a node of Project Golem." });
            if (res.agent?.api_key || res.api_key) {
                authData.api_key = res.agent?.api_key || res.api_key;
                authData.agent_name = finalName;
                fs.writeFileSync(AUTH_FILE, JSON.stringify(authData, null, 2));
            }
            logAudit('REGISTER', finalName);
            return `🎉 註冊成功！\n🚨 認領連結：\n${res.claim_url || res.agent?.claim_url}\n請強烈提醒主人點擊上方連結！`;
        }

        if (!authData.api_key) return "⚠️ 系統尚未註冊！請先執行 register 任務。";

        if (task === 'setup_email') {
            await req('/agents/me/setup-owner-email', 'POST', { email: args.email });
            return `✅ 已發送綁定信件至 ${args.email}，請主人前往信箱收信！`;
        }

        if (task === 'home') return `📡 [Moltbook 總覽雷達]\n` + JSON.stringify(await req('/home'), null, 2);
        
        if (task === 'read_notifications') {
            const endpoint = args.postId === 'all' ? '/notifications/read-all' : `/notifications/read-by-post/${args.postId}`;
            await req(endpoint, 'POST');
            return `✅ 已標記為已讀`;
        }

        // --- [1. 數學驗證碼系統 (v2: 自動解題)] ---
        if (task === 'verify') {
            const answer = args.answer || _autoSolve(args.challenge || args.code_hint || '');
            const res = await req('/verify', 'POST', { verification_code: args.code, answer: String(answer) });
            logAudit('VERIFY', `Solved: ${answer}`);
            return `✅ 驗證成功！內容已正式發布！(ID: ${res.content_id})`;
        }

        // --- [2. 動態與發文] ---
        if (task === 'feed') {
            const limit = args.limit || 10;
            const sort = args.sort || 'new';
            const filter = args.filter || 'all'; 
            let endpoint = args.submolt ? `/submolts/${args.submolt}/feed?limit=${limit}&sort=${sort}` : `/feed?limit=${limit}&sort=${sort}&filter=${filter}`;
            if (args.cursor) endpoint += `&cursor=${args.cursor}`; // 支援官方分頁
            const res = await req(endpoint);
            return `[Feed (下一頁代碼: ${res.next_cursor || '無'})]\n` + (res.data || []).map(p => `📌 ID:${p.post_id} | 👤 @${p.author_id}\n標題: ${p.title}\n<EXTERNAL_UNTRUSTED_DATA>\n${p.content}\n</EXTERNAL_UNTRUSTED_DATA>`).join('\n---\n');
        }

        if (task === 'search') {
            const typeQ = args.type ? `&type=${args.type}` : '';
            const res = await req(`/search?q=${encodeURIComponent(args.query)}${typeQ}&limit=10`);
            return `[搜尋結果]\n` + (res.results || []).map(p => `📌 ID:${p.post_id||p.id} | 類型: ${p.type} | 相似度: ${p.similarity} | 標題: ${p.title||'留言'}`).join('\n');
        }

        if (task === 'post') {
            // Usagi 的智慧：伺服器要求 submolt_name
            const payload = { title: args.title, content: args.content, submolt_name: args.submolt || 'general' };
            const res = await req('/posts', 'POST', payload);
            if (res.post?.verification_status === 'pending') {
                logAudit('CHALLENGE', res.post.verification.challenge_text);
                // [v2] Auto-solve verification challenge
                const answer = _autoSolve(res.post.verification.challenge_text);
                if (answer) {
                    try {
                        const vr = await req('/verify', 'POST', { verification_code: res.post.verification.verification_code, answer });
                        logAudit('AUTO_VERIFY', `${answer} → ${vr.success ? 'OK' : 'FAIL'}`);
                        if (vr.success) return `✅ 發文成功（自動通過驗證）！文章 ID: ${vr.content_id}`;
                    } catch (e) { logAudit('AUTO_VERIFY_ERR', e.message); }
                }
                return `🚨 **觸發防護牆驗證！** 🚨\n題目：「${res.post.verification.challenge_text}」\n👉 驗證碼：${res.post.verification.verification_code}\n自動解題結果：${answer || '無法解析'}\n請計算答案 (保留兩位小數)，並呼叫 'verify' 提交！`;
            }
            return `✅ 發文成功！文章 ID: ${res.post_id || res.post?.id}`;
        }

        if (task === 'comment') {
            const res = await req(`/posts/${args.postId}/comments`, 'POST', { content: args.content });
            if (res.comment?.verification_status === 'pending') {
                // [v2] Auto-solve verification challenge
                const answer = _autoSolve(res.comment.verification.challenge_text);
                if (answer) {
                    try {
                        const vr = await req('/verify', 'POST', { verification_code: res.comment.verification.verification_code, answer });
                        if (vr.success) return `✅ 留言成功（自動通過驗證）！`;
                    } catch (e) { /* fallback to manual */ }
                }
                return `🚨 **觸發留言驗證！** 🚨\n題目：「${res.comment.verification.challenge_text}」\n驗證碼：${res.comment.verification.verification_code}\n自動解題結果：${answer || '無法解析'}\n請執行 'verify' 任務！`;
            }
            return '✅ 留言成功！';
        }

        if (task === 'delete') return (await req(`/posts/${args.postId}`, 'DELETE')).success ? '✅ 刪除成功' : '❌ 失敗';
        
        if (task === 'vote') {
            // 官方更新：投票路由從 /votes 變為 /posts/id/upvote
            const typeStr = args.targetType === 'post' ? 'posts' : 'comments';
            const voteStr = args.voteType === 'up' ? 'upvote' : 'downvote';
            await req(`/${typeStr}/${args.targetId}/${voteStr}`, 'POST');
            return `✅ 投票成功`;
        }
        
        if (task === 'follow') return (await req(`/agents/${encodeURIComponent(args.agentName)}/follow`, 'POST')).success ? `✅ 成功追蹤` : '❌ 失敗';
        if (task === 'unfollow') return (await req(`/agents/${encodeURIComponent(args.agentName)}/follow`, 'DELETE')).success ? `✅ 成功退追` : '❌ 失敗';

        if (task === 'create_submolt') {
            const payload = { name: args.name, display_name: args.name, description: args.desc, allow_crypto: args.allowCrypto || false }; // 官方禁止加密貨幣預設
            const res = await req('/submolts', 'POST', payload);
            if (res.submolt?.verification_status === 'pending') {
                return `🚨 **觸發看板驗證！** 🚨\n驗證碼：${res.submolt.verification.verification_code}\n題目：${res.submolt.verification.challenge_text}`;
            }
            return `✅ 成功建立新看板 m/${args.name}`;
        }

        // --- [3. 🔒 私密通訊 (DM System)] ---
        if (task === 'dm_check') return JSON.stringify(await req('/agents/dm/check'));
        
        if (task === 'dm_request') {
            const payload = { message: args.message };
            if (args.to) payload.to = args.to;
            else if (args.toOwner) payload.to_owner = args.toOwner; // 支援透過主人推特找人
            await req('/agents/dm/request', 'POST', payload);
            return '✅ 邀請已發送';
        }

        if (task === 'dm_respond') {
            const payload = args.block ? { block: true } : null; // 支援封鎖
            await req(`/agents/dm/requests/${args.conversationId}/${args.decision}`, 'POST', payload);
            return `✅ 邀請已 ${args.decision}`;
        }

        if (task === 'dm_read') return JSON.stringify(await req(`/agents/dm/conversations/${args.conversationId}`), null, 2);
        
        if (task === 'dm_send') {
            const payload = { message: args.content };
            if (args.needsHumanInput) payload.needs_human_input = true; // 官方要求的請求人類介入旗標
            await req(`/agents/dm/conversations/${args.conversationId}/send`, 'POST', payload);
            return `✅ 私訊發送成功！`;
        }

        // --- [6. 新增端點] ---
        if (task === 'read_comments') {
            if (!args.postId) return '❌ 需要 postId 參數';
            const data = await req(`/posts/${args.postId}/comments`);
            return `📝 [留言列表]\n${JSON.stringify(data, null, 2)}`;
        }

        if (task === 'read_post') {
            if (!args.postId) return '❌ 需要 postId 參數';
            const data = await req(`/posts/${args.postId}`);
            return `📄 [文章詳情]\n${JSON.stringify(data, null, 2)}`;
        }

        if (task === 'my_profile') {
            const data = await req('/agents/me');
            return `👤 [我的資料]\n${JSON.stringify(data, null, 2)}`;
        }

        if (task === 'my_status') {
            const data = await req('/agents/status');
            return `📊 [帳號狀態]\n${JSON.stringify(data, null, 2)}`;
        }

        if (task === 'list_submolts') {
            const data = await req('/submolts');
            return `🏘️ [社群列表]\n${JSON.stringify(data, null, 2)}`;
        }

        if (task === 'join_submolt') {
            if (!args.name) return '❌ 需要社群 name 參數';
            const data = await req(`/submolts/${encodeURIComponent(args.name)}/subscribe`, 'POST');
            return data.success ? `✅ 已加入 ${args.name}` : '❌ 加入失敗';
        }

        if (task === 'leave_submolt') {
            if (!args.name) return '❌ 需要社群 name 參數';
            const data = await req(`/submolts/${encodeURIComponent(args.name)}/subscribe`, 'DELETE');
            return data.success ? `✅ 已退出 ${args.name}` : '❌ 退出失敗';
        }

        return "❌ 錯誤：未知的任務類型。";
    } catch (e) {
        return `❌ Moltbook 錯誤: ${e.message}`;
    }
}

module.exports = { execute, _autoSolve };

if (require.main === module) {
    const rawArgs = process.argv[2];
    if (!rawArgs) process.exit(1);
    try {
        execute(JSON.parse(rawArgs).args || JSON.parse(rawArgs)).then(console.log).catch(e => console.error(e.message));
    } catch (e) { console.error(`❌ Parse Error: ${e.message}`); }
}
