// src/skills/core/fleet.js
// YEDAN Fleet Integration — 連接 YEDAN 所有 fleet worker
// 能力: 健康監控/情報收集/任務分派/內容生成/收入監控
// 特性: Circuit Breaker 保護 + RAG 讀寫整合

const { getToken } = require('../../utils/yedan-auth');
const circuitBreaker = require('../../core/circuit_breaker');
const endpoints = require('../../config/endpoints');

const WORKERS = endpoints.WORKERS;
const AGENT_ID = endpoints.AGENT_ID;

const REQUEST_TIMEOUT = 15000;

async function req(url, method = 'GET', body = null) {
    const headers = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const opts = { method, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT) };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.json();
}

// Circuit Breaker 包裝的 worker 請求
async function safeReq(workerName, url, method = 'GET', body = null) {
    return circuitBreaker.execute(`fleet:${workerName}`, () => req(url, method, body));
}

// RAG 讀取 — 查詢相關經驗再決策
async function ragQuery(query) {
    if (!WORKERS.rag) return null;
    try {
        const token = getToken();
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${WORKERS.rag}/query`, {
            method: 'POST', headers,
            body: JSON.stringify({ query, max_hops: 1, limit: 5 }),
            signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) return null;
        return res.json();
    } catch (e) { console.warn('[fleet]', e.message); return null; }
}

// RAG 寫入 — 記錄操作結果
async function ragEvolve(situation, action_taken, outcome, score) {
    if (!WORKERS.rag) return;
    try {
        const token = getToken();
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        await fetch(`${WORKERS.rag}/evolve`, {
            method: 'POST', headers,
            body: JSON.stringify({ agent_id: `${AGENT_ID}-fleet`, situation, action_taken, outcome, score }),
            signal: AbortSignal.timeout(10000)
        });
    } catch (e) { console.warn('[fleet]', e.message); }
}

// RAG 寫入實體
async function ragIngest(entities, relationships) {
    if (!WORKERS.rag) return;
    try {
        const token = getToken();
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        await fetch(`${WORKERS.rag}/ingest`, {
            method: 'POST', headers,
            body: JSON.stringify({ entities, relationships }),
            signal: AbortSignal.timeout(10000)
        });
    } catch (e) { console.warn('[fleet]', e.message); }
}

async function execute(args) {
    const task = args.task || args.command || 'status';

    try {
        // --- Fleet 總覽 (先讀 RAG 查詢歷史問題) ---
        if (task === 'status' || task === 'dashboard') {
            // RAG READ: 查看最近 fleet 問題
            const ragContext = await ragQuery('fleet health status issues');
            const pastIssues = ragContext?.experience_replays?.filter(r => !r.success).slice(0, 3) || [];

            const workerChecks = [
                { name: 'Health Commander', key: 'health', endpoint: '/health' },
                { name: 'Orchestrator', key: 'orchestrator', endpoint: '/status' },
                { name: 'Revenue Sentinel', key: 'revenue', endpoint: '/health' },
                { name: 'Intel Ops', key: 'intel', endpoint: '/health' },
                { name: 'Content Engine', key: 'content', endpoint: '/health' },
            ];
            const configured = workerChecks.filter(w => WORKERS[w.key]);
            const notConfigured = workerChecks.filter(w => !WORKERS[w.key]);

            const results = await Promise.allSettled(
                configured.map(w => safeReq(w.key, `${WORKERS[w.key]}${w.endpoint}`))
            );
            const names = configured.map(w => w.name);
            const healthy = results.filter(r => r.status === 'fulfilled').length;
            const total = results.length;

            let output = `[YEDAN Fleet 狀態] (${healthy}/${total} 在線)\n` +
                results.map((r, i) => {
                    if (r.status === 'fulfilled') return `  ✅ ${names[i]}`;
                    return `  ❌ ${names[i]}: ${r.reason?.message?.substring(0, 80) || 'unreachable'}`;
                }).join('\n');

            if (notConfigured.length > 0) {
                output += '\n' + notConfigured.map(w => `  ⚪ ${w.name}: not configured`).join('\n');
            }

            // 附加 Circuit Breaker 狀態
            const cbStatus = circuitBreaker.getStatus();
            const openCircuits = Object.entries(cbStatus).filter(([, v]) => v.state !== 'CLOSED');
            if (openCircuits.length > 0) {
                output += '\n\n⚡ 熔斷器:\n' + openCircuits.map(([k, v]) =>
                    `  🔴 ${k}: ${v.state} (失敗 ${v.failures}x, 累計 ${v.totalTrips} trips)`
                ).join('\n');
            }

            // 附加 RAG 歷史問題
            if (pastIssues.length > 0) {
                output += '\n\n📚 過往問題 (RAG):\n' + pastIssues.map(r =>
                    `  - ${(r.context || r.situation || '').substring(0, 60)}`
                ).join('\n');
            }

            // RAG WRITE: 記錄本次巡檢結果
            await ragEvolve(
                `Fleet status check: ${healthy}/${total} online`,
                'fleet status',
                healthy === total ? 'All workers healthy' : `${total - healthy} workers down`,
                healthy === total ? 4 : 1
            );

            return output;
        }

        // --- 健康掃描 ---
        if (task === 'health' || task === 'sweep') {
            const res = await safeReq('health', `${WORKERS.health}/status`);
            const output = `[Fleet 健康]\n${JSON.stringify(res, null, 2).substring(0, 2000)}`;
            await ragEvolve('Fleet health sweep', 'health sweep', JSON.stringify(res).substring(0, 200), 3);
            return output;
        }

        // --- 情報收集 ---
        if (task === 'intel' || task === 'intel_feed') {
            const res = await safeReq('intel', `${WORKERS.intel}/feed`);
            const items = res.feed || res.items || res.data || [];
            const output = `[情報 Feed (${items.length})]\n` +
                items.slice(0, 8).map(i => `  [${i.source}] ${i.title} (分數: ${i.score || '?'})`).join('\n');

            // RAG WRITE: 將情報實體寫入知識圖譜
            if (items.length > 0) {
                const entities = items.slice(0, 5).map(i => ({
                    id: `intel_${i.title?.replace(/\s+/g, '_').substring(0, 40) || Date.now()}`,
                    type: 'intel_item',
                    name: i.title || 'unknown',
                    properties: { source: i.source, score: i.score, fetched_by: AGENT_ID }
                }));
                await ragIngest(entities, []);
            }

            return output;
        }

        if (task === 'intel_sweep') {
            // RAG READ: 查詢上次 sweep 結果
            const ragContext = await ragQuery('intel sweep result');
            const res = await safeReq('intel', `${WORKERS.intel}/sweep`, 'POST');
            const output = `情報掃描完成: ${JSON.stringify(res).substring(0, 500)}`;
            await ragEvolve('Triggered intel sweep', 'intel_sweep', JSON.stringify(res).substring(0, 200), 3);
            return output;
        }

        // --- 任務分派 (先查 RAG 類似任務成功率) ---
        if (task === 'dispatch') {
            const taskType = args.type || 'general';

            // RAG READ: 查詢此類任務的歷史成功率
            const ragContext = await ragQuery(`dispatch ${taskType} outcome`);
            const pastResults = ragContext?.experience_replays || [];
            const avgScore = pastResults.length > 0
                ? pastResults.reduce((s, r) => s + (r.reward || r.score || 0), 0) / pastResults.length
                : 3;

            let warningMsg = '';
            if (avgScore < 2 && pastResults.length >= 3) {
                warningMsg = `\n⚠️ RAG 歷史顯示此類任務 (${taskType}) 平均分數 ${avgScore.toFixed(1)}/5，建議謹慎。`;
            }

            const payload = { type: taskType, priority: args.priority || 'medium', payload: args.payload || {} };
            const res = await safeReq('orchestrator', `${WORKERS.orchestrator}/dispatch`, 'POST', payload);
            const output = `任務已分派: ${JSON.stringify(res).substring(0, 500)}${warningMsg}`;

            await ragEvolve(
                `Dispatched task: ${taskType} (priority: ${payload.priority})`,
                'dispatch',
                JSON.stringify(res).substring(0, 200),
                3
            );

            return output;
        }

        if (task === 'fleet_status') {
            const res = await safeReq('orchestrator', `${WORKERS.orchestrator}/fleet`);
            return `[Fleet Workers]\n${JSON.stringify(res, null, 2).substring(0, 2000)}`;
        }

        // --- 內容生成 ---
        if (task === 'generate_content') {
            const contentType = args.content_type || 'tip_thread';
            const res = await safeReq('content', `${WORKERS.content}/generate`, 'POST', { type: contentType });
            const output = `內容已生成:\n${JSON.stringify(res, null, 2).substring(0, 1500)}`;

            // RAG WRITE: 記錄內容生成
            await ragIngest([{
                id: `content_${Date.now()}`,
                type: 'generated_content',
                name: contentType,
                properties: { generated_by: AGENT_ID, timestamp: new Date().toISOString() }
            }], []);

            return output;
        }

        if (task === 'content_history') {
            const res = await safeReq('content', `${WORKERS.content}/history`);
            return `[內容歷史]\n${JSON.stringify(res, null, 2).substring(0, 1500)}`;
        }

        // --- 收入監控 ---
        if (task === 'revenue' || task === 'revenue_report') {
            const res = await safeReq('revenue', `${WORKERS.revenue}/report`);
            const output = `[收入報告]\n${JSON.stringify(res, null, 2).substring(0, 2000)}`;
            await ragEvolve('Revenue report check', 'revenue', JSON.stringify(res).substring(0, 200), 3);
            return output;
        }

        if (task === 'revenue_dashboard') {
            const res = await safeReq('revenue', `${WORKERS.revenue}/dashboard`);
            return `[收入儀表板]\n${JSON.stringify(res, null, 2).substring(0, 2000)}`;
        }

        if (task === 'revenue_trends') {
            const res = await safeReq('revenue', `${WORKERS.revenue}/trends`);
            return `[收入趨勢]\n${JSON.stringify(res, null, 2).substring(0, 2000)}`;
        }

        // --- Orchestrator Dashboard ---
        if (task === 'system_dashboard') {
            const res = await safeReq('orchestrator', `${WORKERS.orchestrator}/dashboard`);
            return `[系統儀表板]\n${JSON.stringify(res, null, 2).substring(0, 3000)}`;
        }

        // --- 熔斷器狀態 ---
        if (task === 'circuit' || task === 'breaker') {
            const status = circuitBreaker.getStatus();
            if (Object.keys(status).length === 0) return '所有熔斷器正常 (無記錄)';
            return '[熔斷器狀態]\n' + Object.entries(status).map(([k, v]) =>
                `  ${v.state === 'CLOSED' ? '🟢' : v.state === 'OPEN' ? '🔴' : '🟡'} ${k}: ${v.state} (失敗 ${v.failures}x, trips ${v.totalTrips})`
            ).join('\n');
        }

        // --- 重置熔斷器 ---
        if (task === 'reset_circuit') {
            const target = args.worker || args.parameter;
            if (!target) return '請指定 worker 名稱。可用: health, intel, orchestrator, content, revenue';
            circuitBreaker.reset(`fleet:${target}`);
            return `✅ 已重置 ${target} 的熔斷器`;
        }

        return '未知 fleet 指令。可用: status, health, sweep, intel, intel_sweep, dispatch, fleet_status, generate_content, content_history, revenue, revenue_dashboard, revenue_trends, system_dashboard, circuit, reset_circuit';
    } catch (e) {
        // RAG WRITE: 記錄錯誤
        await ragEvolve(`Fleet error on task: ${task}`, task, e.message, 0);
        return `Fleet 錯誤: ${e.message}`;
    }
}

module.exports = {
    execute,
    name: 'fleet',
    description: 'YEDAN Fleet 整合 — 健康監控/情報/任務分派/內容/收入 + 熔斷器 + RAG 學習',
    PROMPT: `## fleet (YEDAN Fleet 整合技能)
你可以連接 YEDAN 的 6 個 fleet worker，掌握整個分散式系統的狀態。
每次操作都會自動查詢 RAG 歷史經驗，並將結果寫回 RAG 供未來學習。

### 使用方式:
1. **總覽**: \`{ "action": "fleet", "task": "status" }\` — 所有 worker 狀態 (含 RAG 歷史問題)
2. **健康掃描**: \`{ "action": "fleet", "task": "health" }\` — 詳細健康報告
3. **情報 Feed**: \`{ "action": "fleet", "task": "intel" }\` — 最新情報 (自動寫入 RAG)
4. **觸發情報掃描**: \`{ "action": "fleet", "task": "intel_sweep" }\`
5. **分派任務**: \`{ "action": "fleet", "task": "dispatch", "type": "任務類型", "payload": {...} }\` — (RAG 預查成功率)
6. **Fleet Workers**: \`{ "action": "fleet", "task": "fleet_status" }\`
7. **生成內容**: \`{ "action": "fleet", "task": "generate_content", "content_type": "tip_thread|product_promo|technical_blog" }\`
8. **收入報告**: \`{ "action": "fleet", "task": "revenue" }\`
9. **收入趨勢**: \`{ "action": "fleet", "task": "revenue_trends" }\`
10. **系統儀表板**: \`{ "action": "fleet", "task": "system_dashboard" }\` — 全局視圖
11. **熔斷器狀態**: \`{ "action": "fleet", "task": "circuit" }\`
12. **重置熔斷器**: \`{ "action": "fleet", "task": "reset_circuit", "worker": "health" }\`

### 重要:
- 每次操作自動查 RAG → 決策 → 寫回 RAG (讀寫迴路)
- Circuit Breaker 保護: worker 連續 3 次失敗自動熔斷，60 秒後自動恢復嘗試
- 發現異常時，用 rag evolve 記錄經驗`
};

if (require.main === module) {
    const rawArgs = process.argv[2];
    if (!rawArgs) { console.log('Usage: node fleet.js \'{"task":"status"}\''); process.exit(1); }
    try { execute(JSON.parse(rawArgs)).then(console.log).catch(e => console.error(e.message)); }
    catch (e) { console.error(`Parse Error: ${e.message}`); }
}
