// src/skills/core/prompt-forge.js
// PromptForge Skill — 自動提示詞工程系統
// 能力: 生成 → 評分 → 演化優化 → 跨 session 學習 (RAG 持久化)

const fs = require('fs');
const path = require('path');
const PromptScorer = require('../../core/PromptScorer');
const PromptEvolver = require('../../core/PromptEvolver');

const DNA_FILE = path.join(process.cwd(), 'promptforge_dna.json');
const MAX_PROMPTS = 200;

// RAG lazy load (same pattern as selfheal.js)
let _ragSkill = null;
function getRag() {
    if (!_ragSkill) {
        try { _ragSkill = require('./rag'); } catch (e) { console.warn('[prompt-forge]', e.message); _ragSkill = null; }
    }
    return _ragSkill;
}

async function ragQuery(query) {
    const rag = getRag();
    if (!rag) return null;
    try { return await rag.execute({ task: 'query', query, limit: 5 }); } catch (e) { return null; }
}

async function ragIngest(entities, relationships) {
    const rag = getRag();
    if (!rag) return;
    try { await rag.execute({ task: 'ingest', entities, relationships }); } catch (e) { /* silent */ }
}

async function ragEvolve(situation, action_taken, outcome, score) {
    const rag = getRag();
    if (!rag) return;
    try { await rag.execute({ task: 'evolve', situation, action_taken, outcome, score }); } catch (e) { /* silent */ }
}

// ─── DNA Persistence ───

function loadDNA() {
    try {
        if (fs.existsSync(DNA_FILE)) return JSON.parse(fs.readFileSync(DNA_FILE, 'utf-8'));
    } catch (e) { console.warn('[prompt-forge]', e.message); }
    return { prompts: [], templates: {}, stats: { total_generated: 0, total_evolved: 0, avg_improvement: 0, best_score: 0 } };
}

function saveDNA(data) {
    if (data.prompts.length > MAX_PROMPTS) data.prompts = data.prompts.slice(-MAX_PROMPTS);
    fs.writeFileSync(DNA_FILE, JSON.stringify(data, null, 2));
}

// ─── Pattern Detection ───

const PATTERN_KEYWORDS = {
    CoT: /分析|推理|計算|步驟|邏輯|為什麼|數學|比較|explain|reason|step|calculate|logic|why|math/i,
    ToT: /探索|搜尋方案|列舉|可能性|創意|brainstorm|explore|enumerate|possibilities|creative/i,
    ReAct: /搜尋|查詢|API|工具|上網|資料庫|即時|search|query|tool|database|realtime|fetch/i,
    'Self-Consistency': /確認|驗證|可靠|多角度|共識|verify|validate|reliable|consensus|multiple/i,
    Reflexion: /改進|迭代|修正|學習|反思|improve|iterate|refine|learn|reflect/i,
};

function detectPattern(intent) {
    if (!intent) return 'CoT';
    const lower = intent.toLowerCase();

    // Score each pattern by keyword match count
    let best = 'CoT';
    let bestCount = 0;

    for (const [pattern, regex] of Object.entries(PATTERN_KEYWORDS)) {
        const matches = lower.match(regex);
        if (matches && matches.length > bestCount) {
            bestCount = matches.length;
            best = pattern;
        }
    }

    return best;
}

// ─── Scorer/Evolver singletons (lazy) ───

let _scorer = null;
let _evolver = null;
let _brain = null;

function getScorer(brain) {
    if (!_scorer || brain !== _brain) {
        _brain = brain;
        _scorer = new PromptScorer({ brain });
        _evolver = new PromptEvolver({ brain, scorer: _scorer });
    }
    return _scorer;
}

function getEvolver(brain) {
    getScorer(brain);
    return _evolver;
}

// ─── Main execute ───

async function execute(args) {
    const task = args.task || args.command || 'generate';
    const brain = args.brain || null;

    try {
        // ═══ generate: 自然語言 → 結構化提示詞 ═══
        if (task === 'generate') {
            const intent = args.intent || args.parameter || args.query;
            if (!intent) return '請提供意圖描述。例如: { task: "generate", intent: "分析股票走勢" }';

            // RAG: check history
            const ragResult = await ragQuery(`promptforge ${intent}`);
            if (ragResult && typeof ragResult === 'string' && ragResult.length > 100) {
                // Found cached — offer optimization option
            }

            const pattern = detectPattern(intent);

            let prompt;
            if (brain) {
                const metaPrompt = `你是提示詞工程專家。根據以下意圖生成一個高品質的結構化提示詞。

意圖: ${intent}
推理模式: ${pattern}

要求:
1. 包含角色定義 (Role)
2. 包含背景描述 (Context)
3. 包含明確任務 (Task)
4. 包含輸出格式 (Format)
5. 包含約束條件 (Constraints)
6. 融入 ${pattern} 推理模式

直接輸出提示詞，不要加額外說明。`;
                try {
                    prompt = await brain.sendMessage(metaPrompt, true);
                    prompt = (prompt || '').trim();
                } catch (e) {
                    prompt = null;
                }
            }

            if (!prompt) {
                // Heuristic fallback
                prompt = _generateFallback(intent, pattern);
            }

            const scorer = getScorer(brain);
            const scoreResult = scorer.quickScore(prompt, intent);

            // Save DNA
            const dna = loadDNA();
            const entry = {
                id: `pf_${Date.now()}`,
                intent,
                prompt,
                pattern,
                scores: scoreResult.scores,
                overall: scoreResult.overall,
                generation: 0,
                parent_ids: [],
                mutation_type: 'seed',
                created_at: new Date().toISOString(),
                used_count: 0,
            };
            dna.prompts.push(entry);
            dna.stats.total_generated++;
            if (scoreResult.overall > dna.stats.best_score) dna.stats.best_score = scoreResult.overall;
            saveDNA(dna);

            // RAG ingest
            await ragIngest([{
                id: entry.id,
                type: 'prompt_dna',
                name: `PromptForge: ${intent.substring(0, 50)}`,
                properties: { intent, pattern, overall: scoreResult.overall }
            }], []);

            return `🔧 PromptForge — 生成完成\n\n` +
                `📋 意圖: ${intent}\n` +
                `🧠 推理模式: ${pattern}\n` +
                `📊 評分: ${scoreResult.overall}/4.0\n` +
                `${_formatScores(scoreResult.scores)}\n\n` +
                `📝 生成的提示詞:\n${'─'.repeat(40)}\n${prompt}\n${'─'.repeat(40)}\n\n` +
                `💡 使用 prompt-forge optimize 可進行演化優化`;
        }

        // ═══ optimize: 族群演化最佳化 ═══
        if (task === 'optimize') {
            const intent = args.intent || args.parameter || '';
            let seedPrompt = args.prompt || '';

            if (!seedPrompt && args.id) {
                const dna = loadDNA();
                const found = dna.prompts.find(p => p.id === args.id);
                if (found) { seedPrompt = found.prompt; }
            }

            if (!seedPrompt) return '請提供要優化的提示詞。例如: { task: "optimize", prompt: "...", intent: "..." }';

            const evolver = getEvolver(brain);
            const pattern = detectPattern(intent);
            const result = await evolver.optimize(seedPrompt, intent, {
                generations: args.generations || 3,
                pattern,
            });

            // Save best DNA
            const dna = loadDNA();
            const entry = {
                id: `pf_${Date.now()}`,
                intent,
                prompt: result.best.prompt,
                pattern,
                scores: result.best.scores,
                overall: result.best.overall,
                generation: result.trajectory.length,
                parent_ids: [],
                mutation_type: 'evolved',
                created_at: new Date().toISOString(),
                used_count: 0,
            };
            dna.prompts.push(entry);
            dna.stats.total_evolved++;
            const seedScore = getScorer(brain).quickScore(seedPrompt, intent).overall;
            const improvement = result.best.overall - seedScore;
            if (dna.stats.total_evolved > 1) {
                dna.stats.avg_improvement = ((dna.stats.avg_improvement * (dna.stats.total_evolved - 1)) + improvement) / dna.stats.total_evolved;
            } else {
                dna.stats.avg_improvement = improvement;
            }
            if (result.best.overall > dna.stats.best_score) dna.stats.best_score = result.best.overall;
            saveDNA(dna);

            await ragEvolve(
                `PromptForge optimize: ${intent.substring(0, 50)}`,
                'evolve',
                `${seedScore} → ${result.best.overall} (+${improvement.toFixed(2)})`,
                improvement > 0.3 ? 4 : improvement > 0 ? 3 : 2
            );

            const trajectoryStr = result.trajectory.map(t => `  Gen ${t.gen}: ${t.bestScore}/4.0`).join('\n');

            return `🧬 PromptForge — 演化優化完成\n\n` +
                `📊 原始分數: ${seedScore}/4.0 → 最佳分數: ${result.best.overall}/4.0 (${improvement >= 0 ? '+' : ''}${improvement.toFixed(2)})\n` +
                `📈 演化軌跡:\n${trajectoryStr}\n\n` +
                `📝 最佳提示詞:\n${'─'.repeat(40)}\n${result.best.prompt}\n${'─'.repeat(40)}`;
        }

        // ═══ evaluate: 9 軸評分 ═══
        if (task === 'evaluate') {
            const prompt = args.prompt || args.parameter;
            if (!prompt) return '請提供要評分的提示詞。';

            const scorer = getScorer(brain);
            const result = brain ? await scorer.score(prompt, args.intent || '') : scorer.quickScore(prompt, args.intent || '');

            return `📊 PromptForge — 9 軸評分\n\n` +
                `總分: ${result.overall}/4.0\n` +
                `${_formatScores(result.scores)}\n` +
                (result.explanation ? `\n💡 ${result.explanation}` : '');
        }

        // ═══ evolve: 單代演化 ═══
        if (task === 'evolve') {
            const prompt = args.prompt || args.parameter;
            if (!prompt) return '請提供要演化的提示詞。';

            const evolver = getEvolver(brain);
            const result = await evolver.optimize(prompt, args.intent || '', { generations: 1 });

            return `🧬 單代演化結果\n\n` +
                `原始: ${getScorer(brain).quickScore(prompt, args.intent || '').overall}/4.0\n` +
                `演化: ${result.best.overall}/4.0\n\n` +
                `📝 結果:\n${result.best.prompt.substring(0, 500)}`;
        }

        // ═══ detect-pattern: 偵測推理模式 ═══
        if (task === 'detect-pattern') {
            const intent = args.intent || args.parameter;
            if (!intent) return '請提供意圖描述。';

            const pattern = detectPattern(intent);
            const allMatches = {};
            for (const [p, regex] of Object.entries(PATTERN_KEYWORDS)) {
                allMatches[p] = regex.test(intent);
            }

            return `🧠 推理模式偵測\n\n` +
                `意圖: ${intent}\n` +
                `偵測結果: **${pattern}**\n\n` +
                `模式匹配:\n` +
                Object.entries(allMatches).map(([p, match]) => `  ${match ? '✅' : '⬜'} ${p}`).join('\n');
        }

        // ═══ history: 演化歷史 ═══
        if (task === 'history') {
            const dna = loadDNA();
            if (dna.prompts.length === 0) return '尚無提示詞記錄。';

            const recent = dna.prompts.slice(-10);
            return `📜 PromptForge 歷史 (最近 ${recent.length}/${dna.prompts.length} 筆)\n\n` +
                recent.map(p =>
                    `[${p.id}] ${p.intent?.substring(0, 40) || 'N/A'} | ${p.pattern} | ${p.overall}/4.0 | ${p.mutation_type} | ${p.created_at?.substring(0, 16) || ''}`
                ).join('\n');
        }

        // ═══ stats: 統計 ═══
        if (task === 'stats') {
            const dna = loadDNA();
            return `📊 PromptForge 統計\n\n` +
                `生成: ${dna.stats.total_generated}\n` +
                `演化: ${dna.stats.total_evolved}\n` +
                `平均改善: ${(dna.stats.avg_improvement || 0).toFixed(2)}\n` +
                `最高分: ${dna.stats.best_score}/4.0\n` +
                `DNA 庫: ${dna.prompts.length}/${MAX_PROMPTS} 筆`;
        }

        // ═══ compare: 兩個提示詞對比 ═══
        if (task === 'compare') {
            const promptA = args.prompt_a || args.a;
            const promptB = args.prompt_b || args.b;
            if (!promptA || !promptB) return '請提供兩個提示詞。例如: { task: "compare", a: "...", b: "..." }';

            const scorer = getScorer(brain);
            const result = await scorer.compare(promptA, promptB, args.intent || '');

            return `⚖️ PromptForge — 提示詞對比\n\n` +
                `提示詞 A: ${result.scores_a.overall}/4.0\n` +
                `提示詞 B: ${result.scores_b.overall}/4.0\n\n` +
                `🏆 勝者: ${result.winner === 'a' ? 'A' : 'B'}`;
        }

        // ═══ templates: 模板管理 ═══
        if (task === 'templates') {
            const sub = args.sub || args.action || 'list';
            const dna = loadDNA();

            if (sub === 'add' && args.name && args.template) {
                dna.templates[args.name] = {
                    template: args.template,
                    intent: args.intent || '',
                    created_at: new Date().toISOString(),
                };
                saveDNA(dna);
                return `模板 "${args.name}" 已新增。`;
            }

            const names = Object.keys(dna.templates);
            if (names.length === 0) return '尚無模板。使用 { task: "templates", sub: "add", name: "...", template: "..." } 新增。';
            return `📋 模板列表:\n` + names.map(n => `  - ${n}`).join('\n');
        }

        // ═══ export: 匯出 DNA ═══
        if (task === 'export') {
            const dna = loadDNA();
            return JSON.stringify(dna, null, 2);
        }

        // ═══ import: 匯入 DNA ═══
        if (task === 'import') {
            const data = args.data || args.json;
            if (!data) return '請提供 DNA JSON。';

            try {
                const parsed = typeof data === 'string' ? JSON.parse(data) : data;
                if (!parsed.prompts || !Array.isArray(parsed.prompts)) return '無效的 DNA 格式。需要 { prompts: [...] }';

                const dna = loadDNA();
                const before = dna.prompts.length;
                for (const p of parsed.prompts) {
                    if (p.id && p.prompt) dna.prompts.push(p);
                }
                if (parsed.templates) Object.assign(dna.templates, parsed.templates);
                saveDNA(dna);

                return `匯入完成。新增 ${dna.prompts.length - before} 筆提示詞。`;
            } catch (e) {
                return `匯入失敗: ${e.message}`;
            }
        }

        // ═══ nl-optimize: 自然語言→結構化 + 演化優化 ═══
        if (task === 'nl-optimize') {
            const prompt = args.prompt || args.parameter;
            if (!prompt) return '請提供自然語言提示詞。例如: { task: "nl-optimize", prompt: "幫我分析這個數據", intent: "..." }';

            const scorer = getScorer(brain);
            const nlResult = scorer.nlToStructured(prompt, args.intent || '');

            // Chain: nlToStructured → optimize
            const evolver = getEvolver(brain);
            const optimized = await evolver.optimize(nlResult.structured, args.intent || '', {
                generations: args.generations || 2,
                pattern: detectPattern(args.intent || prompt),
            });

            const dna = loadDNA();
            const entry = {
                id: `pf_${Date.now()}`,
                intent: args.intent || '',
                prompt: optimized.best.prompt,
                pattern: detectPattern(args.intent || prompt),
                scores: optimized.best.scores,
                overall: optimized.best.overall,
                generation: optimized.trajectory.length,
                parent_ids: [],
                mutation_type: 'nl-optimized',
                created_at: new Date().toISOString(),
                used_count: 0,
            };
            dna.prompts.push(entry);
            dna.stats.total_evolved++;
            saveDNA(dna);

            return `🔄 PromptForge — NL→結構化→優化\n\n` +
                `📝 原始 (NL): ${prompt.substring(0, 100)}...\n` +
                `🔧 改善項目: ${nlResult.improvements.join(', ') || 'none'}\n` +
                `📊 分數提升: ${nlResult.beforeScore}/4.0 → ${nlResult.afterScore}/4.0 (結構化) → ${optimized.best.overall}/4.0 (演化)\n\n` +
                `📝 最佳結果:\n${'─'.repeat(40)}\n${optimized.best.prompt.substring(0, 800)}\n${'─'.repeat(40)}`;
        }

        return '未知 prompt-forge 指令。可用: generate, optimize, evaluate, evolve, detect-pattern, compare, history, stats, templates, export, import, nl-optimize';

    } catch (e) {
        await ragEvolve(`PromptForge error: ${task}`, task, e.message, 0);
        return `prompt-forge 錯誤: ${e.message}`;
    }
}

// ─── Helpers ───

function _generateFallback(intent, pattern) {
    const template = PromptEvolver.PATTERN_TEMPLATES[pattern] || '';
    return `## 角色\n你是一個專業的 AI 助手，擅長${intent}。\n\n` +
        `## 背景\n使用者需要: ${intent}\n\n` +
        `## 任務\n請根據以下要求完成分析:\n1. 深入理解使用者的需求\n2. 提供專業且全面的回答\n3. 附上具體範例或數據支持\n\n` +
        `## 輸出格式\n請使用結構化的 Markdown 格式回答，包含標題、重點和結論。\n\n` +
        `## 約束條件\n- 回答須準確且有依據\n- 使用清晰易懂的語言\n- 控制在合理篇幅內\n\n` +
        (template ? `## 推理模式 (${pattern})\n${template}` : '');
}

function _formatScores(scores) {
    if (!scores) return '';
    return Object.entries(scores)
        .map(([dim, val]) => `  ${dim}: ${'█'.repeat(Math.round(val))}${'░'.repeat(4 - Math.round(val))} ${(val || 0).toFixed(1)}/4.0`)
        .join('\n');
}

module.exports = {
    execute,
    name: 'prompt-forge',
    description: '自動提示詞工程系統 — 生成/評分/演化優化/推理模式偵測 + RAG 學習迴路',
    detectPattern,
    PROMPT: `## prompt-forge (自動提示詞工程 + RAG 學習)
你擁有自動生成和優化提示詞的能力。每次操作都會記錄到 RAG 知識圖譜供未來學習。

### 使用方式:
1. **生成**: \`{ "action": "prompt-forge", "task": "generate", "intent": "分析股票走勢" }\` — 自然語言→結構化提示詞
2. **優化**: \`{ "action": "prompt-forge", "task": "optimize", "prompt": "...", "intent": "..." }\` — 族群演化最佳化 (~30 brain calls)
3. **評分**: \`{ "action": "prompt-forge", "task": "evaluate", "prompt": "..." }\` — 9 軸 PEEM 評分
4. **單代演化**: \`{ "action": "prompt-forge", "task": "evolve", "prompt": "..." }\`
5. **偵測推理模式**: \`{ "action": "prompt-forge", "task": "detect-pattern", "intent": "..." }\`
6. **對比**: \`{ "action": "prompt-forge", "task": "compare", "a": "...", "b": "..." }\`
7. **歷史**: \`{ "action": "prompt-forge", "task": "history" }\`
8. **統計**: \`{ "action": "prompt-forge", "task": "stats" }\`
9. **模板**: \`{ "action": "prompt-forge", "task": "templates" }\`
10. **匯出**: \`{ "action": "prompt-forge", "task": "export" }\`
11. **匯入**: \`{ "action": "prompt-forge", "task": "import", "data": "{...}" }\`

### 推理模式:
- **CoT**: 分析/推理/計算 → 逐步思考
- **ToT**: 探索/方案/創意 → 樹狀搜尋
- **ReAct**: 搜尋/API/工具 → 思考-行動-觀察
- **Reflexion**: 改進/迭代/反思 → 自我改進迴圈
- **Self-Consistency**: 驗證/多角度 → 多路共識

### 9 軸 PEEM 評分:
clarity | accuracy | coherence | relevance | completeness | conciseness | safety | creativity | actionability

### 安全等級:
- L0: generate, evaluate, detect-pattern, compare, history, stats, export
- L1: optimize, evolve, templates, import`
};

if (require.main === module) {
    const rawArgs = process.argv[2];
    if (!rawArgs) { console.log('Usage: node prompt-forge.js \'{"task":"generate","intent":"分析股票"}\''); process.exit(1); }
    try {
        execute(JSON.parse(rawArgs)).then(console.log).catch(e => console.error(e.message));
    } catch (e) { console.error(`Parse Error: ${e.message}`); }
}
