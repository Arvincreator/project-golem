// src/skills/core/community.js
// Rensin Community Engagement — Moltbook 社群自動經營 + RAG 學習
// L1 技能: 自動互動，每次動作前查 RAG，動作後記錄

const endpoints = require('../../config/endpoints');
const warroom = require('../../utils/warroom-client');

let _ragSkill = null;
function getRag() {
    if (!_ragSkill) {
        try { _ragSkill = require('./rag'); } catch (e) { _ragSkill = null; }
    }
    return _ragSkill;
}

async function ragQuery(query) {
    const rag = getRag();
    if (!rag) return null;
    try { return await rag.execute({ task: 'query', query, limit: 5 }); } catch (e) { return null; }
}

async function ragEvolve(situation, action_taken, outcome, score) {
    const rag = getRag();
    if (!rag) return;
    try { await rag.execute({ task: 'evolve', situation, action_taken, outcome, score }); } catch (e) { console.warn('[community]', e.message); }
}

async function ragIngest(entities, relationships) {
    const rag = getRag();
    if (!rag) return;
    try { await rag.execute({ task: 'ingest', entities, relationships }); } catch (e) { console.warn('[community]', e.message); }
}

// 戰情室
async function updateWarRoom(event, data) {
    return warroom.report(event, data, `${endpoints.AGENT_ID}-community`);
}

async function execute(args) {
    const task = args.task || args.command || 'engage';

    try {
        const moltbot = require('./moltbot');

        // --- [1. 智慧互動] --- 讀 Feed → 分析 → 選擇互動
        if (task === 'engage' || task === 'interact') {
            // RAG READ: 查詢過去的互動經驗
            const ragContext = await ragQuery('moltbook community engage outcome');
            const pastLessons = typeof ragContext === 'string' && ragContext.includes('經驗回放')
                ? '(有過往經驗可參考)'
                : '';

            // Step 1: 讀 Feed
            let feedResult;
            try {
                feedResult = await moltbot.execute({ task: 'feed', count: 15 });
            } catch (e) {
                await ragEvolve('Community engage: feed read failed', 'engage', e.message, 0);
                return `社群互動失敗: 無法讀取 Feed — ${e.message}`;
            }

            // Step 2: 找到值得互動的貼文 (有 > 5 votes 或含關鍵字)
            const feedStr = String(feedResult);
            const hasContent = feedStr.length > 100;

            if (!hasContent) {
                await ragEvolve('Community engage: empty feed', 'engage', 'Feed is empty', 2);
                return '社群 Feed 為空，等待下次嘗試。';
            }

            // Step 3: 執行互動 (vote 最安全)
            try {
                // 投票給最新的貼文
                const result = await moltbot.execute({ task: 'vote', direction: 'up', count: 3 });
                const output = `社群互動完成: 已投票 ${pastLessons}\n${String(result).substring(0, 300)}`;

                // RAG WRITE
                await ragEvolve('Community engagement: voted on posts', 'engage', output.substring(0, 200), 4);

                // 寫入社群互動實體
                await ragIngest([{
                    id: `community_${Date.now()}`,
                    type: 'community_interaction',
                    name: 'moltbook_engage',
                    properties: { action: 'vote', platform: 'moltbook', by: endpoints.AGENT_ID }
                }], []);

                // 戰情室
                await updateWarRoom('community_engage', { action: 'vote', success: true });

                return output;
            } catch (e) {
                await ragEvolve('Community engage: vote failed', 'engage', e.message, 1);
                return `社群互動部分失敗: ${e.message}`;
            }
        }

        // --- [2. 發文] ---
        if (task === 'post') {
            const content = args.content || args.text;
            if (!content) return '需要 content 參數來發文。';

            // RAG READ: 查過去發文效果
            await ragQuery('moltbook post performance');

            try {
                const result = await moltbot.execute({ task: 'post', content, submolt: args.submolt });
                const output = `發文成功:\n${String(result).substring(0, 500)}`;
                await ragEvolve(`Moltbook post: ${content.substring(0, 60)}`, 'post', output.substring(0, 200), 4);
                await updateWarRoom('community_post', { content: content.substring(0, 100), success: true });
                return output;
            } catch (e) {
                await ragEvolve(`Moltbook post failed`, 'post', e.message, 0);
                return `發文失敗: ${e.message}`;
            }
        }

        // --- [3. 社群探索] ---
        if (task === 'explore') {
            try {
                const submolts = await moltbot.execute({ task: 'list_submolts' });
                const output = `[社群探索]\n${String(submolts).substring(0, 2000)}`;
                await ragEvolve('Community explore: listed submolts', 'explore', output.substring(0, 200), 3);
                return output;
            } catch (e) {
                return `探索失敗: ${e.message}`;
            }
        }

        // --- [4. 社群狀態] ---
        if (task === 'status' || task === 'stats') {
            try {
                const profile = await moltbot.execute({ task: 'my_profile' });
                const output = `[社群狀態]\n${String(profile).substring(0, 1000)}`;
                return output;
            } catch (e) {
                return `狀態查詢失敗: ${e.message}`;
            }
        }

        // --- [5. DM 管理] ---
        if (task === 'dm' || task === 'messages') {
            try {
                const dms = await moltbot.execute({ task: 'dm_list' });
                return `[私訊列表]\n${String(dms).substring(0, 1500)}`;
            } catch (e) {
                return `私訊查詢失敗: ${e.message}`;
            }
        }

        return '未知 community 指令。可用: engage, post, explore, status, dm';

    } catch (e) {
        await ragEvolve(`Community error: ${task}`, task, e.message, 0);
        return `Community 錯誤: ${e.message}`;
    }
}

module.exports = {
    execute,
    name: 'community',
    description: 'Moltbook 社群自動經營 — 智慧互動/發文/探索/狀態 + RAG 學習',
    PROMPT: `## community (社群經營技能)
你可以自動經營 Moltbook 社群。每次操作前查 RAG 歷史，操作後記錄經驗。

### 使用方式:
1. **智慧互動**: \`{ "action": "community", "task": "engage" }\` — 自動讀 Feed + 投票/互動
2. **發文**: \`{ "action": "community", "task": "post", "content": "文章內容" }\`
3. **探索**: \`{ "action": "community", "task": "explore" }\` — 列出所有社群
4. **狀態**: \`{ "action": "community", "task": "status" }\` — 我的社群檔案
5. **私訊**: \`{ "action": "community", "task": "dm" }\` — 私訊管理

### 自動化:
- L1 等級: 自動執行，Telegram 報告
- 每次操作前查 RAG 歷史經驗
- 每次操作後寫 RAG + 戰情室`
};

if (require.main === module) {
    const rawArgs = process.argv[2];
    if (!rawArgs) { console.log('Usage: node community.js \'{"task":"engage"}\''); process.exit(1); }
    try { execute(JSON.parse(rawArgs)).then(console.log).catch(e => console.error(e.message)); }
    catch (e) { console.error(`Parse Error: ${e.message}`); }
}
