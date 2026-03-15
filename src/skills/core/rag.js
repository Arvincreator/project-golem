// src/skills/core/rag.js
// Graph RAG Skill — 連接 YEDAN 知識圖譜 + 本地 MAGMA 同步
// 能力: 查詢/寫入/進化/經驗回放/統計/合併 + 本地快取

const { getToken } = require('../../utils/yedan-auth');
const magma = require('../../memory/graph/ma_gma');
const circuitBreaker = require('../../core/circuit_breaker');
const { RAG_URL, AGENT_ID } = require('../../config/endpoints');
const REQUEST_TIMEOUT = 15000;

async function req(endpoint, method = 'GET', body = null) {
    const token = getToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const opts = { method, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT) };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${RAG_URL}${endpoint}`, opts);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.status === 204 ? { success: true } : await res.json();
}

// Circuit Breaker 包裝
async function safeReq(endpoint, method = 'GET', body = null) {
    if (!RAG_URL) return { results: [], relationships: [], experience_replays: [], status: 'not_configured' };
    return circuitBreaker.execute('rag:yedan', () => req(endpoint, method, body));
}

// --- Anti-Hallucination: Confidence Scoring ---
function computeConfidence(localNodes, remoteEntities, query) {
    const queryKeywords = String(query).toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (queryKeywords.length === 0) return { score: 0, level: 'NONE', sources: [] };

    const sources = [];
    let relevance = 0;
    let coverage = 0;

    // Check local
    if (localNodes && localNodes.length > 0) {
        sources.push('local');
        const localText = localNodes.map(n => `${n.id} ${n.name || ''} ${n.type || ''}`).join(' ').toLowerCase();
        const localHits = queryKeywords.filter(kw => localText.includes(kw)).length;
        relevance = Math.max(relevance, localHits / queryKeywords.length);
    }

    // Check remote
    if (remoteEntities && remoteEntities.length > 0) {
        sources.push('remote');
        const remoteText = remoteEntities.map(e => `${e.name || ''} ${e.type || ''} ${e.summary || ''}`).join(' ').toLowerCase();
        const remoteHits = queryKeywords.filter(kw => remoteText.includes(kw)).length;
        relevance = Math.max(relevance, remoteHits / queryKeywords.length);
    }

    // Coverage: dual source = 1.0, single = 0.6, none = 0
    if (sources.length >= 2) coverage = 1.0;
    else if (sources.length === 1) coverage = 0.6;

    // Recency: check timestamps of results (simplified)
    let recency = 0.5; // default mid
    const now = Date.now();
    const allTimestamps = [
        ...(localNodes || []).map(n => new Date(n._lastAccess || n.updated_at || n.created_at || 0).getTime()),
        ...(remoteEntities || []).map(e => new Date(e.updated_at || e.created_at || 0).getTime())
    ].filter(t => t > 0);
    if (allTimestamps.length > 0) {
        const newest = Math.max(...allTimestamps);
        const ageDays = (now - newest) / 86400000;
        if (ageDays <= 7) recency = 1.0;
        else if (ageDays <= 30) recency = 0.7;
        else if (ageDays <= 90) recency = 0.4;
        else recency = 0.2;
    }

    const score = Math.round(relevance * recency * coverage * 100) / 100;
    let level = 'NONE';
    if (score >= 0.5) level = 'HIGH';
    else if (score >= 0.3) level = 'MEDIUM';
    else if (score > 0) level = 'LOW';

    return { score, level, sources };
}

// --- Anti-Hallucination: Quality Filtering ---
function filterLowQuality(entities, minScore = 0.3) {
    if (!Array.isArray(entities)) return [];
    return entities.filter(e => {
        if (e.deprecated) return false;
        if (e.score !== undefined && e.score < minScore) return false;
        return true;
    });
}

async function execute(args) {
    const task = args.task || args.command || 'stats';

    try {
        // --- [1. 查詢知識圖譜] --- (YEDAN + 本地 MAGMA 雙查)
        if (task === 'query' || task === 'q' || task === 'search') {
            const query = args.query || args.parameter || args.content;
            if (!query) return 'RAG 查詢需要 query 參數。';

            // 先查本地 MAGMA
            const localResult = magma.query(query);
            let localInfo = '';
            if (localResult.nodes.length > 0) {
                localInfo = `\n📍 本地圖譜 (${localResult.nodes.length} 節點, ${localResult.edges.length} 邊):\n` +
                    localResult.nodes.slice(0, 5).map(n => `  - ${n.id} [${n.type || '?'}]`).join('\n');
            }

            // 查 YEDAN RAG
            let remoteInfo = '';
            let entities = [];
            try {
                const res = await safeReq('/query', 'POST', {
                    query,
                    max_hops: args.max_hops || 2,
                    limit: args.limit || 10
                });

                entities = Array.isArray(res.results) ? res.results : (Array.isArray(res.entities) ? res.entities : []);
                const rels = Array.isArray(res.relationships) ? res.relationships : [];
                const replays = Array.isArray(res.experience_replays) ? res.experience_replays : [];

                remoteInfo = `\n🌐 YEDAN RAG (${res.seed_entities || 0} seeds, ${res.neighbor_entities || 0} neighbors):\n` +
                    `實體 (${entities.length}):\n` +
                    entities.slice(0, 10).map(e => `  - ${e.name} [${e.type}] ${e.summary?.substring(0, 80) || ''}`).join('\n') +
                    (rels.length > 0 ? `\n關係 (${rels.length}):\n` +
                        rels.slice(0, 10).map(r => `  - ${r.source_name || r.source} --[${r.type}]--> ${r.target_name || r.target}`).join('\n') : '') +
                    (replays.length > 0 ? `\n經驗回放 (${replays.length}):\n` +
                        replays.slice(0, 5).map(r => `  - [${r.success ? 'OK' : 'FAIL'}] ${(r.context || '').substring(0, 80)}`).join('\n') : '');

                // NOTE: 不自動同步 YEDAN→本地, 保持 Rensin 自主學習
                // 手動同步請用 /rag sync 或 task: 'pull'
            } catch (e) {
                remoteInfo = `\n🌐 YEDAN RAG: 離線 (${e.message})`;
            }

            // Anti-Hallucination: Confidence scoring
            const confidence = computeConfidence(localResult.nodes, entities, query);
            const confEmoji = confidence.level === 'HIGH' ? '📊' : confidence.level === 'MEDIUM' ? '📊' : '⚠️';
            let confLine = `\n${confEmoji} 信心: ${confidence.level} (score=${confidence.score}, sources=${confidence.sources.join('+')})`;

            // Cross-validation: 本地和遠端結果交叉比對
            const crossValidated = [];
            for (const local of localResult.nodes.slice(0, 5)) {
                const remoteMatch = entities.find(e =>
                    e.name?.toLowerCase().includes(local.id.toLowerCase()) ||
                    local.id.toLowerCase().includes(e.name?.toLowerCase() || '')
                );
                if (remoteMatch) {
                    crossValidated.push({ local: local.id, remote: remoteMatch.name, verified: true });
                }
            }
            if (crossValidated.length > 0) {
                confLine += ` | 交叉驗證: ${crossValidated.length} 筆`;
            }

            if (confidence.level === 'NONE') {
                return `[RAG 查詢: "${query}"]${localInfo}${remoteInfo}\n⚠️ 信心: NONE — 查無可靠資料，不建議依賴此回覆`;
            }
            return `[RAG 查詢: "${query}"]${localInfo}${remoteInfo}${confLine}`;
        }

        // --- [2. 寫入實體/關係] --- (同時寫 YEDAN + 本地)
        if (task === 'ingest' || task === 'write') {
            const entities = args.entities || [];
            const relationships = args.relationships || [];

            if (entities.length === 0 && relationships.length === 0) {
                return 'ingest 需要 entities 或 relationships 陣列。\n格式: { entities: [{id, type, name, properties}], relationships: [{source, target, type}] }';
            }

            // 寫入本地 MAGMA
            const localResult = magma.importFromRAG(entities, relationships);

            // 寫入 YEDAN RAG
            let remoteResult = '';
            try {
                const res = await safeReq('/ingest', 'POST', { entities, relationships });
                remoteResult = `YEDAN: 實體 ${res.entities_stored || 0}, 關係 ${res.relationships_stored || 0}`;
            } catch (e) {
                remoteResult = `YEDAN: 離線 (已寫入本地)`;
            }

            return `寫入成功！本地: 節點 ${localResult.nodesAdded}, 邊 ${localResult.edgesAdded} | ${remoteResult}`;
        }

        // --- [3. 經驗進化 (記錄教訓)] --- (寫 YEDAN + 本地 edge)
        if (task === 'evolve' || task === 'learn') {
            const situation = args.situation;
            const action = args.action_taken || args.action;
            const outcome = args.outcome;
            const score = args.score !== undefined ? args.score : 1;
            const verified = score >= 4;

            if (!situation || !action || !outcome) {
                return 'evolve 需要: situation, action_taken, outcome, score(0-5)';
            }

            // 寫入本地 MAGMA (因果邊)
            const situationId = `exp_${Date.now()}`;
            magma.addNode(situationId, { type: 'experience', name: situation.substring(0, 50), outcome, score, verified });
            magma.addRelation(AGENT_ID, 'learned', situationId, { layer: 'causal' });

            // 寫入 YEDAN RAG
            let remoteResult = '';
            try {
                const res = await safeReq('/evolve', 'POST', {
                    agent_id: AGENT_ID,
                    situation,
                    action_taken: action,
                    outcome,
                    score,
                    verified
                });
                remoteResult = `YEDAN: 教訓 ID ${res.lesson_id || 'ok'}`;
            } catch (e) {
                remoteResult = `YEDAN: 離線 (已存本地)`;
            }

            return `經驗已記錄！${remoteResult} | 本地: ${situationId}`;
        }

        // --- [4. 統計] ---
        if (task === 'stats' || task === 's') {
            // 本地
            const local = magma.stats();
            let output = `[本地 MAGMA] 節點: ${local.nodes} | 邊: ${local.edges}\n` +
                `  類型: ${Object.entries(local.nodeTypes).map(([k, v]) => `${k}(${v})`).join(', ')}\n`;

            // YEDAN RAG
            try {
                const res = await safeReq('/stats');
                const g = res.graph || res;
                const layers = (res.relationship_layers || []).map(l => `${l.layer}(${l.count})`).join(', ');
                output += `\n[YEDAN Graph RAG v${res.version || '?'}]\n` +
                    `實體: ${g.entities || '?'} | 關係: ${g.relationships || '?'} | 社群: ${g.communities || '?'}\n` +
                    `因果邊: ${g.causal_edges || '?'} | 經驗回放: ${g.experience_replays || '?'}\n` +
                    `MAGMA 層: ${layers || '?'}\n` +
                    `類型分佈: ${(res.entity_types || []).slice(0, 5).map(t => `${t.type}(${t.count})`).join(', ')}`;
            } catch (e) {
                output += `\n[YEDAN RAG] 離線: ${e.message}`;
            }

            return output;
        }

        // --- [5. 查看教訓] ---
        if (task === 'lessons' || task === 'l') {
            const res = await safeReq('/lessons');
            const agents = res.by_agent || {};
            const recent = res.recent || [];

            return `[Agent 教訓]\n` +
                Object.entries(agents).map(([a, s]) =>
                    `${a}: ${s.count} 筆 (平均 ${s.avg_score?.toFixed(1)}, 成功 ${s.successes}, 失敗 ${s.failures})`
                ).join('\n') +
                `\n\n最近教訓:\n` +
                recent.slice(0, 5).map(l =>
                    `  [${l.agent_id}] ${l.situation?.substring(0, 60)} → ${l.outcome?.substring(0, 40)}`
                ).join('\n');
        }

        // --- [6. 最近活動] ---
        if (task === 'recent' || task === 'r') {
            const res = await safeReq('/recent');
            const items = res.recent || res.data || [];
            return `[最近活動 (${items.length})]\n` +
                items.slice(0, 10).map(e =>
                    `  [${e.type}] ${e.name} (${e.updated_at || e.created_at || ''})`
                ).join('\n');
        }

        // --- [7. 查詢特定實體] --- (YEDAN + 本地)
        if (task === 'entity' || task === 'e') {
            const id = args.id || args.entity_id || args.parameter;
            if (!id) return 'entity 需要 id 參數。';

            // 本地查詢
            const localNode = magma.getNode(id);
            const localNeighbors = localNode ? magma.getNeighbors(id) : { edges: [], neighbors: [] };
            let output = '';

            if (localNode) {
                output += `[本地] ${localNode.id} [${localNode.type || '?'}]\n` +
                    `  鄰居: ${localNeighbors.neighbors.map(n => n.id).join(', ') || '(無)'}\n`;
            }

            // YEDAN 查詢
            try {
                const res = await safeReq(`/entity/${encodeURIComponent(id)}`);
                const e = res.entity || {};
                const neighbors = res.neighbors || [];
                output += `[YEDAN] ${e.name || id}\n` +
                    `  類型: ${e.type}\n` +
                    `  屬性: ${JSON.stringify(e.properties || {})}\n` +
                    `  鄰居 (${neighbors.length}):\n` +
                    neighbors.map(n => `    - ${n.name} [${n.relationship_type}]`).join('\n');
            } catch (e) {
                if (!localNode) output += `查無此實體 (本地+YEDAN): ${id}`;
            }

            return output || `查無此實體: ${id}`;
        }

        // --- [8. 合併整理] ---
        if (task === 'consolidate' || task === 'c') {
            const res = await safeReq('/consolidate', 'POST');
            return `合併完成！${JSON.stringify(res)}`;
        }

        // --- [9. 健康檢查] ---
        if (task === 'health' || task === 'h') {
            const local = magma.stats();
            let output = `本地 MAGMA: OK (${local.nodes} 節點, ${local.edges} 邊)`;
            try {
                const res = await safeReq('/health');
                output += `\nYEDAN RAG: ${res.status || 'ok'} | ${JSON.stringify(res)}`;
            } catch (e) {
                output += `\nYEDAN RAG: 離線 (${e.message})`;
            }
            return output;
        }

        // --- [10. 本地圖譜操作] ---
        if (task === 'local' || task === 'local_stats') {
            const stats = magma.stats();
            return `[本地 MAGMA 圖譜]\n` +
                `節點: ${stats.nodes} | 邊: ${stats.edges}\n` +
                `節點類型: ${Object.entries(stats.nodeTypes).map(([k, v]) => `${k}(${v})`).join(', ')}\n` +
                `邊類型: ${Object.entries(stats.edgeTypes).map(([k, v]) => `${k}(${v})`).join(', ')}`;
        }

        // --- [11. 同步本地→YEDAN] ---
        if (task === 'sync' || task === 'push') {
            const data = magma.data;
            if (data.nodes.length === 0) return '本地圖譜為空，無需同步。';

            const entities = data.nodes.map(n => ({
                id: n.id,
                type: n.type || 'local_node',
                name: n.name || n.id,
                properties: { synced_from: `${AGENT_ID}_local`, ...(n.properties || {}) }
            }));
            const relationships = data.edges.map(e => ({
                source: e.source,
                target: e.target,
                type: e.type
            }));

            try {
                const res = await safeReq('/ingest', 'POST', { entities, relationships });
                return `同步完成！YEDAN 已接收: 實體 ${res.entities_stored || 0}, 關係 ${res.relationships_stored || 0}`;
            } catch (e) {
                return `同步失敗: ${e.message}`;
            }
        }

        // --- [12. 手動拉取 YEDAN→本地 (需明確操作)] ---
        if (task === 'pull') {
            const query = args.query || args.parameter || AGENT_ID;
            try {
                const res = await safeReq('/query', 'POST', { query, max_hops: 1, limit: 30 });
                const entities = Array.isArray(res.results) ? res.results : (Array.isArray(res.entities) ? res.entities : []);
                const rels = Array.isArray(res.relationships) ? res.relationships : [];
                if (entities.length === 0) return `YEDAN 查詢 "${query}" 無結果，無法拉取。`;
                const result = magma.importFromRAG(entities, rels);
                return `手動拉取完成！從 YEDAN 匯入: 節點 ${result.nodesAdded}, 邊 ${result.edgesAdded}`;
            } catch (e) {
                return `拉取失敗: ${e.message}`;
            }
        }

        // --- [13. 經驗回放 — 找最相關歷史經驗] ---
        if (task === 'replay') {
            const situation = args.situation || args.query || args.parameter;
            if (!situation) return 'replay 需要 situation 參數 (描述當前情境)';

            // Local MAGMA experiences
            const localExp = magma.query(situation).nodes.filter(n => n.type === 'experience');
            let output = '';
            if (localExp.length > 0) {
                output += `[本地經驗 (${localExp.length})]:\n` +
                    localExp.slice(0, 5).map(e => `  - [${e.score || '?'}] ${e.name || e.id}`).join('\n');
            }

            // YEDAN RAG experience replays
            try {
                const res = await safeReq('/query', 'POST', { query: situation, max_hops: 1, limit: 5 });
                const replays = Array.isArray(res.experience_replays) ? res.experience_replays : [];
                if (replays.length > 0) {
                    output += `\n[YEDAN 經驗回放 (${replays.length})]:\n` +
                        replays.map(r => `  - [${r.success ? 'OK' : 'FAIL'}] ${(r.context || '').substring(0, 100)}`).join('\n');
                }
            } catch (e) {
                output += `\n[YEDAN] 離線: ${e.message}`;
            }

            return output || `無相關經驗: "${situation}"`;
        }

        return '未知 RAG 指令。可用: query, ingest, evolve, stats, lessons, recent, entity, consolidate, health, local, sync, pull, replay';

    } catch (e) {
        return `RAG 錯誤: ${e.message}`;
    }
}

module.exports = {
    execute,
    computeConfidence,
    filterLowQuality,
    name: 'rag',
    description: 'YEDAN Graph RAG 知識圖譜 — 查詢/寫入/進化/教訓/統計 + 本地 MAGMA 同步',
    PROMPT: `## rag (知識圖譜技能)
你可以連接 YEDAN 的 Graph RAG v3.0 知識圖譜 + 本地 MAGMA 圖譜。這是你的「外部大腦」。
所有操作同時作用於 YEDAN 雲端 + 本地存儲，確保離線也能查詢。

### 使用方式:
1. **查詢**: \`{ "action": "rag", "task": "query", "query": "搜尋關鍵字" }\` — 雙查 (YEDAN + 本地)
2. **寫入**: \`{ "action": "rag", "task": "ingest", "entities": [...], "relationships": [...] }\` — 雙寫
3. **進化**: \`{ "action": "rag", "task": "evolve", "situation": "情境", "action_taken": "行動", "outcome": "結果", "score": 3 }\` — 記錄經驗 (雙寫)
4. **統計**: \`{ "action": "rag", "task": "stats" }\` — 本地 + YEDAN 雙統計
5. **教訓**: \`{ "action": "rag", "task": "lessons" }\` — 查看所有 agent 教訓
6. **最近**: \`{ "action": "rag", "task": "recent" }\` — 最近活動
7. **實體**: \`{ "action": "rag", "task": "entity", "id": "entity-id" }\` — 雙查特定實體
8. **合併**: \`{ "action": "rag", "task": "consolidate" }\` — 觸發去重+合併
9. **健康**: \`{ "action": "rag", "task": "health" }\` — 雙健康檢查
10. **本地**: \`{ "action": "rag", "task": "local" }\` — 純本地圖譜統計
11. **同步**: \`{ "action": "rag", "task": "sync" }\` — 推送本地圖譜到 YEDAN
12. **拉取**: \`{ "action": "rag", "task": "pull", "query": "關鍵字" }\` — 手動從 YEDAN 拉取到本地
13. **經驗回放**: \`{ "action": "rag", "task": "replay", "situation": "當前情境描述" }\` — 找最相關歷史經驗

### 核心規則:
- **每次重要決策前**，先 query 知識圖譜確認是否有相關經驗
- **每次完成任務後**，用 evolve 記錄經驗教訓 (score 0-5)
- **發現新知識時**，用 ingest 寫入實體和關係
- 所有操作自動雙寫 (YEDAN + 本地 MAGMA)，離線時仍可查詢本地`
};

if (require.main === module) {
    const rawArgs = process.argv[2];
    if (!rawArgs) { console.log('Usage: node rag.js \'{"task":"stats"}\''); process.exit(1); }
    try {
        execute(JSON.parse(rawArgs)).then(console.log).catch(e => console.error(e.message));
    } catch (e) { console.error(`Parse Error: ${e.message}`); }
}
