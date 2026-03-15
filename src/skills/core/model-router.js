// src/skills/core/model-router.js
// Model Router 技能 — 模型管理、路由診斷、成本追蹤
// 調用: { "action": "model-router", "task": "status|models|cost|switch|test|benchmark" }

const { MODEL_SPECS, MODEL_REGISTRY, CROSS_BRAIN_FALLBACKS, resolveForBrain, getModelSpec, estimateTokens, ROUTING_RULES } = require('../../core/monica-constants');

// RAG 整合
let _ragSkill = null;
function getRag() {
    if (!_ragSkill) {
        try { _ragSkill = require('./rag'); } catch (e) { _ragSkill = null; }
    }
    return _ragSkill;
}

async function ragEvolve(situation, action_taken, outcome, score) {
    const rag = getRag();
    if (!rag) return;
    try { await rag.execute({ task: 'evolve', situation, action_taken, outcome, score }); } catch (e) { console.warn('[model-router] RAG evolve failed:', e.message); }
}

async function execute(args) {
    const task = args.task || args.command || 'status';

    // --- [1. 模型目錄] ---
    if (task === 'models' || task === 'catalog') {
        const lines = ['[Model Catalog — 16 指定模型]', ''];

        lines.push('🔥 Advanced (Web only):');
        for (const [name, entry] of Object.entries(MODEL_REGISTRY)) {
            if (entry.tier !== 'advanced') continue;
            const apiFallback = CROSS_BRAIN_FALLBACKS[name];
            const apiNote = entry.api ? `API: ${entry.api.id}` : (apiFallback ? `fallback→${apiFallback}` : 'Web only');
            lines.push(`  ${name.padEnd(18)} | web: ${(entry.web.keywords[0] || '').padEnd(20)} | ${apiNote}`);
        }
        lines.push('');

        lines.push('⚡ Basic (Web + API):');
        for (const [name, entry] of Object.entries(MODEL_REGISTRY)) {
            if (entry.tier !== 'basic') continue;
            const apiNote = entry.api ? `API: ${entry.api.id}` : (CROSS_BRAIN_FALLBACKS[name] ? `fallback→${CROSS_BRAIN_FALLBACKS[name]}` : 'Web only');
            const ctx = entry.context ? `ctx:${entry.context >= 1000000 ? entry.context / 1000000 + 'M' : entry.context / 1000 + 'K'}` : '';
            const cost = entry.costIn ? `$${entry.costIn}→$${entry.costOut}/1M` : '';
            lines.push(`  ${name.padEnd(18)} | web: ${(entry.web.keywords[0] || '').padEnd(20)} | ${apiNote} ${ctx} ${cost}`);
        }
        lines.push('');

        lines.push('路由規則 (Web-first):');
        lines.push('  code → claude-4.6-sonnet (Web, fallback: gpt-4.1)');
        lines.push('  reasoning → gpt-5.4 (Web, fallback: gpt-4.1)');
        lines.push('  creative → gpt-5.4 (Web, fallback: gpt-4.1)');
        lines.push('  fast → gpt-4.1-mini (Web+API)');
        lines.push('  analysis → gemini-3.1-pro (Web, fallback: gemini-2.5-pro)');
        lines.push('  flexible → gpt-4o (Web+API)');
        lines.push('  <50字 → gpt-4.1-nano | >1000字 → gpt-4o');

        return lines.join('\n');
    }

    // --- [2. 成本估算] ---
    if (task === 'cost' || task === 'estimate') {
        const text = args.text || args.input || '';
        const model = args.model || 'gpt-4o';
        const spec = getModelSpec(model);
        const inputTokens = text ? estimateTokens(text) : (args.tokens || 1000);
        const outputTokens = args.outputTokens || Math.min(inputTokens * 2, spec.maxOutput);

        const costIn = (inputTokens * spec.costIn) / 1000000;
        const costOut = (outputTokens * spec.costOut) / 1000000;
        const total = costIn + costOut;

        const lines = [
            `[成本估算: ${model}]`,
            `  Input:  ~${inputTokens} tokens → $${costIn.toFixed(6)}`,
            `  Output: ~${outputTokens} tokens → $${costOut.toFixed(6)}`,
            `  Total:  $${total.toFixed(6)}`,
            '',
            `[同任務不同模型比較]`,
        ];

        // Compare all models with API support
        const comparisons = Object.entries(MODEL_SPECS).map(([name, s]) => {
            const ci = (inputTokens * s.costIn) / 1000000;
            const co = (Math.min(outputTokens, s.maxOutput) * s.costOut) / 1000000;
            return { name, total: ci + co, maxOut: s.maxOutput };
        }).sort((a, b) => a.total - b.total);

        for (const c of comparisons) {
            const marker = c.name === model ? ' ◀' : '';
            lines.push(`  ${c.name.padEnd(18)} $${c.total.toFixed(6)}${marker}`);
        }

        return lines.join('\n');
    }

    // --- [3. Token 計算] ---
    if (task === 'tokens' || task === 'count') {
        const text = args.text || args.input || '';
        if (!text) return '用法: { "task": "tokens", "text": "..." }';

        const tokens = estimateTokens(text);
        const chars = text.length;
        const lines = [
            `[Token 估算]`,
            `  字元: ${chars}`,
            `  Token: ~${tokens}`,
            `  比率: ${(chars / tokens).toFixed(1)} chars/token`,
            '',
            '[模型容量檢查]',
        ];

        for (const [name, spec] of Object.entries(MODEL_SPECS)) {
            const pct = ((tokens / spec.context) * 100).toFixed(1);
            const icon = parseFloat(pct) > 80 ? '⚠️' : parseFloat(pct) > 50 ? '🟡' : '🟢';
            lines.push(`  ${icon} ${name.padEnd(18)} ${pct}% (${spec.context} ctx)`);
        }

        return lines.join('\n');
    }

    // --- [4. 路由測試] ---
    if (task === 'test' || task === 'route-test') {
        const testCases = [
            { input: '寫一段 Python 排序', expect: 'claude-4.6-sonnet' },
            { input: '3x² + 5x - 2 = 0', expect: 'gpt-5.4' },
            { input: '寫一首關於春天的詩', expect: 'gpt-5.4' },
            { input: '翻譯: hello world', expect: 'gpt-4.1-mini' },
            { input: '分析這份報告的優缺點', expect: 'gemini-3.1-pro' },
            { input: 'hi', expect: 'gpt-4.1-nano' },
            { input: '日常聊天', expect: 'gpt-4o' },
        ];

        let pass = 0;
        const results = [];
        for (const tc of testCases) {
            let routed = null;
            for (const rule of ROUTING_RULES) {
                if (rule.patterns.test(tc.input)) { routed = rule.model; break; }
            }
            if (!routed && tc.input.length < 50) routed = 'gpt-4.1-nano';
            if (!routed) routed = 'gpt-4o';

            const ok = routed === tc.expect;
            if (ok) pass++;
            results.push(`${ok ? '✅' : '❌'} "${tc.input}" → ${routed}${ok ? '' : ` (expected: ${tc.expect})`}`);
        }

        const output = `[路由測試: ${pass}/${testCases.length} 通過]\n` + results.join('\n');
        await ragEvolve('Model router test', 'route-test', `${pass}/${testCases.length} passed`, pass === testCases.length ? 5 : 2);
        return output;
    }

    // --- [5. resolveForBrain 測試] ---
    if (task === 'resolve-test') {
        const lines = ['[resolveForBrain 測試 — 16 模型]', ''];
        let pass = 0;
        let total = 0;
        for (const name of Object.keys(MODEL_REGISTRY)) {
            total += 2;
            const web = resolveForBrain(name, 'web');
            const api = resolveForBrain(name, 'api');
            const webOk = web !== null;
            const apiOk = api !== null;
            if (webOk) pass++;
            if (apiOk) pass++;
            lines.push(`${webOk ? '✅' : '❌'} ${name.padEnd(18)} web: ${web ? web.keywords.join(', ') : 'null'}`);
            lines.push(`${apiOk ? '✅' : '❌'} ${' '.repeat(18)} api: ${api ? `${api.apiId}${api.fallbackFrom ? ` (from ${api.fallbackFrom})` : ''}` : 'null'}`);
        }
        lines.push('');
        lines.push(`結果: ${pass}/${total} 通過`);
        return lines.join('\n');
    }

    // --- [6. 平台規則] ---
    if (task === 'rules' || task === 'platform') {
        return [
            '[Monica.im 平台規則摘要]',
            '',
            '訂閱 (Web/Extension):',
            '  - MAX 方案: 動態限制, 不公開具體數字',
            '  - 禁止自動化/批量操作 (ToS)',
            '  - 限制: 頻率/存儲量由系統動態控制',
            '',
            'API (pay-per-token):',
            '  - 端點: https://openapi.monica.im/v1',
            '  - 認證: Bearer token',
            '  - 相容: OpenAI SDK 直接使用',
            '  - Rate Limit: 50~500 RPM (依模型)',
            '',
            '模型分離:',
            '  - Advanced (8): Web only, API fallback via CROSS_BRAIN_FALLBACKS',
            '  - Basic (8): Web + API 都可用',
            '  - resolveForBrain(model, "api"|"web") 自動解析',
        ].join('\n');
    }

    // --- [7. 狀態] ---
    if (task === 'status') {
        const lines = ['[Model Router 狀態]'];
        lines.push(`模型數: ${Object.keys(MODEL_REGISTRY).length} (${Object.values(MODEL_REGISTRY).filter(e => e.tier === 'advanced').length} advanced + ${Object.values(MODEL_REGISTRY).filter(e => e.tier === 'basic').length} basic)`);
        lines.push(`路由規則: 6 維度 + 長度分流 + sticky + 熔斷`);
        lines.push(`引擎: Web-first (monica-web → monica → sdk → ollama)`);
        lines.push('');
        lines.push('可用指令:');
        lines.push('  models       — 完整模型目錄 (16 模型)');
        lines.push('  cost         — 成本估算/比較');
        lines.push('  tokens       — Token 計算');
        lines.push('  test         — 路由規則測試');
        lines.push('  resolve-test — resolveForBrain 解析測試');
        lines.push('  rules        — 平台規則');
        return lines.join('\n');
    }

    return '未知指令。可用: status, models, cost, tokens, test, resolve-test, rules';
}

module.exports = {
    execute,
    name: 'model-router',
    description: '模型路由管理 — 16 模型目錄/Web+API 分離/成本/Token/測試',
    PROMPT: `## model-router (模型路由管理技能)
管理 16 個指定 AI 模型，Web 和 API 完全分離，自動 fallback。

### 使用方式:
1. **模型目錄**: \`{ "action": "model-router", "task": "models" }\` — 16 模型規格
2. **成本估算**: \`{ "action": "model-router", "task": "cost", "model": "gpt-4o", "tokens": 1000 }\`
3. **Token 計算**: \`{ "action": "model-router", "task": "tokens", "text": "..." }\`
4. **路由測試**: \`{ "action": "model-router", "task": "test" }\` — 7 測試用例驗證
5. **解析測試**: \`{ "action": "model-router", "task": "resolve-test" }\` — 16 模型 Web/API 解析
6. **平台規則**: \`{ "action": "model-router", "task": "rules" }\` — Monica 限制/價格

### 路由規則 (Web-first):
- code → claude-4.6-sonnet | reasoning → gpt-5.4 | creative → gpt-5.4
- fast → gpt-4.1-mini | analysis → gemini-3.1-pro | flexible → gpt-4o
- 短訊息(<50字) → gpt-4.1-nano | 長文(>1000字) → gpt-4o | 超大 → gemini-2.5-pro
- Advanced 模型 Web 失敗 → 自動 fallback 到 API 相容模型
- Sticky routing + Per-model 熔斷`
};

if (require.main === module) {
    const rawArgs = process.argv[2];
    if (!rawArgs) { console.log('Usage: node model-router.js \'{"task":"models"}\''); process.exit(1); }
    try { execute(JSON.parse(rawArgs)).then(console.log).catch(e => console.error(e.message)); }
    catch (e) { console.error(`Parse Error: ${e.message}`); }
}
