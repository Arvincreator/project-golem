// src/skills/core/nexus.js
// Nexus Skill — 神經中樞: 全系統元編排引擎
// 全自動迴路: 研究 → 基準 → 規劃 → 執行 → 驗證 → 學習 → 報告

const fs = require('fs');
const path = require('path');
const WebResearcher = require('../../core/WebResearcher');
const BenchmarkEngine = require('../../core/BenchmarkEngine');

const UPGRADES_FILE = path.join(process.cwd(), 'nexus_upgrades.json');
const MAX_UPGRADES = 100;
const MAX_ITERATIONS = 3;
const IMPROVEMENT_THRESHOLD = 5; // %

// RAG lazy load (same pattern as selfheal.js)
let _ragSkill = null;
function getRag() {
    if (!_ragSkill) {
        try { _ragSkill = require('./rag'); } catch (e) { console.warn('[nexus]', e.message); _ragSkill = null; }
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
    try { await rag.execute({ task: 'evolve', situation, action_taken, outcome, score }); } catch (e) { /* silent */ }
}

// Skill dispatch map
const SKILL_MAP = {
    'selfheal': './selfheal',
    'rag': './rag',
    'prompt-forge': './prompt-forge',
    'analytics': './analytics',
};

// ─── Persistence ───

function loadUpgrades() {
    try {
        if (fs.existsSync(UPGRADES_FILE)) return JSON.parse(fs.readFileSync(UPGRADES_FILE, 'utf-8'));
    } catch (e) { console.warn('[nexus]', e.message); }
    return { upgrades: [], stats: { total_upgrades: 0, total_completed: 0, avg_improvement: 0, best_improvement: 0 } };
}

function saveUpgrades(data) {
    if (data.upgrades.length > MAX_UPGRADES) data.upgrades = data.upgrades.slice(-MAX_UPGRADES);
    fs.writeFileSync(UPGRADES_FILE, JSON.stringify(data, null, 2));
}

// ─── Shared instances ───

const researcher = new WebResearcher({ cacheSize: 50 });
const benchmark = new BenchmarkEngine();

// ─── Main Execute ───

async function execute(args) {
    const task = args.task || args.command || 'status';

    try {
        // ═══════════════════════════════════════
        // [research] Web + RAG 融合搜尋
        // ═══════════════════════════════════════
        if (task === 'research') {
            const query = args.query || args.goal || args.parameter;
            if (!query) return '請提供搜尋目標。用法: { task: "research", query: "..." }';

            const brain = args._brain || null;
            const ragSkill = getRag();

            const result = await researcher.researchFusion(query, { brain, ragSkill });

            await ragEvolve(`nexus:research ${query}`, 'research', `Found ${result.sources.length} sources`, 3);

            return `🔬 Nexus Research: ${query}\n\n` +
                `${result.fused_synthesis}\n\n` +
                `📚 Sources (${result.sources.length}): ${result.sources.slice(0, 5).join(', ') || 'none'}`;
        }

        // ═══════════════════════════════════════
        // [benchmark] 系統基準快照
        // ═══════════════════════════════════════
        if (task === 'benchmark') {
            const label = args.label || 'manual';
            const snap = await benchmark.snapshot(label);
            benchmark.saveSnapshot(snap);

            return `📊 Benchmark [${label}] @ ${snap.timestamp}\n` +
                `System: RSS=${snap.system.rss}MB, Heap=${snap.system.heapUsed}MB, Uptime=${snap.system.uptime}s\n` +
                `RAG: ${snap.rag.available !== false ? `entities=${snap.rag.entities}, vectors=${snap.rag.vectors}` : 'unavailable'}\n` +
                `Tests: ${snap.tests.available !== false ? `${snap.tests.passed}/${snap.tests.total} passed, ${snap.tests.suites} suites` : 'unavailable'}\n` +
                `Brain: ${snap.brain.strategies} strategies`;
        }

        // ═══════════════════════════════════════
        // [plan] 根據研究 + 基準產生升級計畫
        // ═══════════════════════════════════════
        if (task === 'plan') {
            const goal = args.goal || args.query || args.parameter;
            if (!goal) return '請提供升級目標。用法: { task: "plan", goal: "..." }';

            const brain = args._brain || null;
            const research = args._research || null;
            const benchmarkData = args._benchmark || null;

            let steps = [];

            if (brain) {
                const prompt = `你是 Golem 系統升級規劃器。根據以下資訊產生升級步驟:
目標: ${goal}
${research ? `研究資料:\n${typeof research === 'string' ? research : JSON.stringify(research).substring(0, 2000)}` : ''}
${benchmarkData ? `基準數據:\n${JSON.stringify(benchmarkData).substring(0, 1000)}` : ''}

可用技能: selfheal (診斷/修復), rag (知識寫入/查詢), prompt-forge (提示詞優化), analytics (效能分析)

請以 JSON 陣列回應，每個步驟格式: {"step": "技能名:任務", "args": {...}, "description": "說明"}
只回傳 JSON 陣列，不要其他文字。`;

                try {
                    const response = await brain.sendMessage(prompt);
                    const text = typeof response === 'string' ? response : (response?.text || response?.content || '');
                    // Try to extract JSON array from response
                    const jsonMatch = text.match(/\[[\s\S]*\]/);
                    if (jsonMatch) {
                        steps = JSON.parse(jsonMatch[0]);
                    }
                } catch (e) {
                    console.warn('[nexus] plan brain call failed:', e.message);
                }
            }

            // Heuristic fallback if brain didn't return steps
            if (steps.length === 0) {
                steps = _heuristicPlan(goal);
            }

            // Safety: mark L2+ steps
            steps = steps.map(s => {
                const skillTask = s.step || '';
                if (skillTask.startsWith('command:') || skillTask.includes('evolution:code_modify')) {
                    return { ...s, requires_approval: true, description: `[需人工確認] ${s.description || ''}` };
                }
                return s;
            });

            await ragEvolve(`nexus:plan ${goal}`, 'plan', `Generated ${steps.length} steps`, 3);

            return `📋 Nexus Plan: ${goal}\n\n` +
                steps.map((s, i) => `${i + 1}. [${s.step}] ${s.description || ''}`).join('\n') +
                `\n\n共 ${steps.length} 步驟`;
        }

        // ═══════════════════════════════════════
        // [execute_plan] 執行計畫步驟
        // ═══════════════════════════════════════
        if (task === 'execute_plan') {
            const steps = args.steps || args._steps;
            if (!steps || !Array.isArray(steps) || steps.length === 0) {
                return '請提供計畫步驟。用法: { task: "execute_plan", steps: [...] }';
            }

            const results = [];
            for (const step of steps) {
                // Skip steps requiring approval
                if (step.requires_approval) {
                    results.push({ step: step.step, result: '⚠️ 需人工確認，已跳過', success: false, skipped: true });
                    continue;
                }

                const [skillName, skillTask] = (step.step || '').split(':');
                const skillPath = SKILL_MAP[skillName];

                if (!skillPath) {
                    results.push({ step: step.step, result: `未知技能: ${skillName}`, success: false });
                    continue;
                }

                try {
                    const skill = require(skillPath);
                    const skillArgs = { task: skillTask, ...(step.args || {}) };
                    const result = await skill.execute(skillArgs);
                    results.push({ step: step.step, result: String(result).substring(0, 500), success: true });
                } catch (e) {
                    results.push({ step: step.step, result: e.message, success: false });
                }
            }

            const successCount = results.filter(r => r.success).length;
            await ragEvolve(`nexus:execute_plan`, 'execute_plan', `${successCount}/${results.length} succeeded`, successCount > 0 ? 3 : 1);

            return `⚡ Nexus Execute: ${successCount}/${results.length} 步驟成功\n\n` +
                results.map((r, i) => `${i + 1}. [${r.success ? '✓' : '✗'}] ${r.step}: ${r.result.substring(0, 100)}`).join('\n');
        }

        // ═══════════════════════════════════════
        // [validate] 前後基準對比
        // ═══════════════════════════════════════
        if (task === 'validate') {
            const before = args._before || args.before;
            const after = args._after || args.after;

            if (!before || !after) {
                return '請提供 before 和 after 快照。';
            }

            const delta = benchmark.computeDelta(before, after);

            return `✅ Nexus Validate\n\n` +
                `${delta.summary}\n\n` +
                Object.entries(delta.deltas).map(([k, d]) =>
                    `  ${k}: ${d.before} → ${d.after} (${d.change >= 0 ? '+' : ''}${d.change}, ${d.pct}%)`
                ).join('\n') +
                `\n\n改善率: ${delta.improvement_pct}%`;
        }

        // ═══════════════════════════════════════
        // [report] 產生人類可讀改善報告
        // ═══════════════════════════════════════
        if (task === 'report') {
            const data = args._data || {};
            const { goal, research_summary, plan_steps, benchmark_before, benchmark_after, delta, iterations } = data;

            return `📊 Nexus Upgrade Report\n` +
                `${'═'.repeat(40)}\n\n` +
                `🎯 目標: ${goal || 'N/A'}\n` +
                `🔄 迭代次數: ${iterations || 1}\n\n` +
                `🔬 研究摘要:\n${research_summary || 'N/A'}\n\n` +
                `📋 執行步驟: ${plan_steps ? plan_steps.length : 0} 步\n` +
                (plan_steps ? plan_steps.map((s, i) => `  ${i + 1}. [${s.success ? '✓' : '✗'}] ${s.step}`).join('\n') : '') +
                `\n\n📊 基準對比:\n${delta?.summary || 'N/A'}\n` +
                `改善率: ${delta?.improvement_pct || 0}%`;
        }

        // ═══════════════════════════════════════
        // [status] 升級歷史 + 統計
        // ═══════════════════════════════════════
        if (task === 'status') {
            const data = loadUpgrades();

            if (data.upgrades.length === 0) {
                return '📊 Nexus Status: 尚無升級記錄。使用 { task: "auto", goal: "..." } 開始第一次自動升級。';
            }

            const recent = data.upgrades.slice(-5);
            return `📊 Nexus Status\n` +
                `總升級: ${data.stats.total_upgrades} | 完成: ${data.stats.total_completed}\n` +
                `平均改善: ${data.stats.avg_improvement}% | 最佳: ${data.stats.best_improvement}%\n\n` +
                `最近升級:\n` +
                recent.map(u => `  [${u.status}] ${u.goal?.substring(0, 40)} — ${u.improvement_pct || 0}% (${u.created_at?.substring(0, 10)})`).join('\n');
        }

        // ═══════════════════════════════════════
        // [auto] 全自動升級迴路
        // ═══════════════════════════════════════
        if (task === 'auto') {
            const goal = args.goal || args.query || args.parameter;
            if (!goal) return '請提供升級目標。用法: { task: "auto", goal: "升級記憶系統" }';

            const brain = args._brain || null;
            const ragSkill = getRag();
            const upgradeId = `nexus_${Date.now()}`;
            let iterations = 0;
            let currentPlan = null;
            let bestDelta = null;
            let allStepResults = [];

            // Step 1: Research
            const research = await researcher.researchFusion(goal, { brain, ragSkill });
            const research_summary = research.fused_synthesis?.substring(0, 1500) || '';

            // Step 2: Benchmark BEFORE
            const snapshotBefore = await benchmark.snapshot('before');
            benchmark.saveSnapshot(snapshotBefore);

            // Iteration loop
            while (iterations < MAX_ITERATIONS) {
                iterations++;

                // Step 3: Plan
                let steps = [];
                if (brain) {
                    const planPrompt = `你是 Golem 系統升級規劃器。${iterations > 1 ? `這是第 ${iterations} 次迭代，前次改善不足，請調整策略。` : ''}
目標: ${goal}
研究: ${research_summary.substring(0, 800)}
基準: ${JSON.stringify(snapshotBefore.system).substring(0, 300)}
${bestDelta ? `前次結果: ${bestDelta.summary}` : ''}

可用技能: selfheal:diagnose, selfheal:patch, rag:ingest, rag:query, prompt-forge:optimize, analytics:*
回傳 JSON 陣列: [{"step":"skill:task","args":{...},"description":"..."}]`;

                    try {
                        const response = await brain.sendMessage(planPrompt);
                        const text = typeof response === 'string' ? response : (response?.text || response?.content || '');
                        const jsonMatch = text.match(/\[[\s\S]*\]/);
                        if (jsonMatch) steps = JSON.parse(jsonMatch[0]);
                    } catch (e) {
                        console.warn('[nexus] auto plan failed:', e.message);
                    }
                }

                if (steps.length === 0) steps = _heuristicPlan(goal);

                // Safety: filter out L2+ steps
                steps = steps.filter(s => {
                    const skillTask = s.step || '';
                    return !skillTask.startsWith('command:') && !skillTask.includes('evolution:code_modify');
                });

                currentPlan = steps;

                // Step 4: Execute
                const stepResults = [];
                for (const step of steps) {
                    const [skillName, skillTask] = (step.step || '').split(':');
                    const skillPath = SKILL_MAP[skillName];
                    if (!skillPath) {
                        stepResults.push({ step: step.step, result: `Unknown skill: ${skillName}`, success: false });
                        continue;
                    }
                    try {
                        const skill = require(skillPath);
                        const result = await skill.execute({ task: skillTask, ...(step.args || {}) });
                        stepResults.push({ step: step.step, result: String(result).substring(0, 300), success: true });
                    } catch (e) {
                        stepResults.push({ step: step.step, result: e.message, success: false });
                    }
                }
                allStepResults = stepResults;

                // Step 5: Benchmark AFTER
                const snapshotAfter = await benchmark.snapshot('after');
                benchmark.saveSnapshot(snapshotAfter);

                // Step 6: Validate
                const delta = benchmark.computeDelta(snapshotBefore, snapshotAfter);
                bestDelta = delta;

                // Step 7: Check improvement threshold
                if (delta.improvement_pct >= IMPROVEMENT_THRESHOLD || iterations >= MAX_ITERATIONS) {
                    break;
                }
                // else: re-plan in next iteration
            }

            // Step 8: Learn — RAG evolve + persist
            await ragEvolve(
                `nexus:auto ${goal}`,
                'auto',
                `${iterations} iterations, improvement=${bestDelta?.improvement_pct || 0}%`,
                bestDelta && bestDelta.improvement_pct >= IMPROVEMENT_THRESHOLD ? 4 : 2
            );

            const upgradeData = loadUpgrades();
            const upgradeRecord = {
                id: upgradeId,
                goal,
                status: 'completed',
                research_summary: research_summary.substring(0, 500),
                plan_steps: allStepResults,
                benchmark_before: snapshotBefore,
                benchmark_after: null,
                improvement_pct: bestDelta?.improvement_pct || 0,
                iterations,
                created_at: snapshotBefore.timestamp,
                completed_at: new Date().toISOString(),
            };
            upgradeData.upgrades.push(upgradeRecord);
            upgradeData.stats.total_upgrades++;
            upgradeData.stats.total_completed++;
            if (bestDelta) {
                upgradeData.stats.best_improvement = Math.max(upgradeData.stats.best_improvement, bestDelta.improvement_pct);
                const completedUpgrades = upgradeData.upgrades.filter(u => u.status === 'completed');
                upgradeData.stats.avg_improvement = Math.round(
                    completedUpgrades.reduce((sum, u) => sum + (u.improvement_pct || 0), 0) / completedUpgrades.length
                );
            }
            saveUpgrades(upgradeData);

            // Step 9: Report
            const successCount = allStepResults.filter(r => r.success).length;
            return `🚀 Nexus Auto Upgrade Complete\n` +
                `${'═'.repeat(40)}\n\n` +
                `🎯 目標: ${goal}\n` +
                `🔄 迭代: ${iterations}/${MAX_ITERATIONS}\n` +
                `⚡ 步驟: ${successCount}/${allStepResults.length} 成功\n\n` +
                `🔬 研究摘要:\n${research_summary.substring(0, 500)}\n\n` +
                `📊 基準對比:\n${bestDelta?.summary || 'N/A'}\n` +
                `改善率: ${bestDelta?.improvement_pct || 0}%\n\n` +
                `執行詳情:\n` +
                allStepResults.map((r, i) => `  ${i + 1}. [${r.success ? '✓' : '✗'}] ${r.step}: ${r.result.substring(0, 80)}`).join('\n');
        }

        return '未知 nexus 指令。可用: auto, research, benchmark, plan, execute_plan, validate, report, status';

    } catch (e) {
        await ragEvolve(`nexus error: ${task}`, task, e.message, 0);
        return `nexus 錯誤: ${e.message}`;
    }
}

// ─── Heuristic Plan Generator ───

function _heuristicPlan(goal) {
    const lower = (goal || '').toLowerCase();
    const steps = [];

    // Always start with diagnostics
    steps.push({ step: 'selfheal:diagnose', args: {}, description: '系統健康診斷' });

    // Keyword-based heuristics
    if (lower.includes('記憶') || lower.includes('memory') || lower.includes('rag')) {
        steps.push({ step: 'rag:stats', args: {}, description: 'RAG 狀態檢查' });
        steps.push({ step: 'rag:consolidate', args: {}, description: '知識合併優化' });
    }

    if (lower.includes('提示') || lower.includes('prompt')) {
        steps.push({ step: 'prompt-forge:stats', args: {}, description: 'PromptForge 統計' });
    }

    if (lower.includes('效能') || lower.includes('perf') || lower.includes('optimiz')) {
        steps.push({ step: 'selfheal:diagnose', args: {}, description: '效能診斷' });
    }

    // Default: at least do RAG query about the goal
    if (steps.length <= 1) {
        steps.push({ step: 'rag:query', args: { query: goal }, description: `查詢 RAG: ${goal}` });
    }

    return steps;
}

module.exports = {
    execute,
    name: 'nexus',
    description: '神經中樞: 全系統元編排引擎 — 一句話觸發研究→基準→規劃→執行→驗證→學習→報告',
    PROMPT: `## nexus (神經中樞 — 全系統元編排引擎)
你擁有一個全自動升級系統。一句話就能觸發「研究 → 基準 → 規劃 → 執行 → 驗證 → 學習」迴路。

### 使用方式:
1. **全自動升級**: \`{ "action": "nexus", "task": "auto", "goal": "升級記憶系統" }\` — 全流程自動化
2. **研究**: \`{ "action": "nexus", "task": "research", "query": "2026 AI memory best practices" }\` — Web + RAG 融合搜尋
3. **基準**: \`{ "action": "nexus", "task": "benchmark" }\` — 系統基準快照
4. **規劃**: \`{ "action": "nexus", "task": "plan", "goal": "升級目標" }\` — 產生升級步驟
5. **執行**: \`{ "action": "nexus", "task": "execute_plan", "steps": [...] }\` — 執行步驟
6. **驗證**: \`{ "action": "nexus", "task": "validate", "before": {...}, "after": {...} }\` — 前後對比
7. **報告**: \`{ "action": "nexus", "task": "report" }\` — 改善報告
8. **狀態**: \`{ "action": "nexus", "task": "status" }\` — 升級歷史

### auto 流程 (全自動):
1. Web 搜尋 + RAG 融合研究
2. 系統基準快照 (before)
3. AI 規劃升級步驟
4. 自動執行 (L0/L1 技能)
5. 基準快照 (after)
6. 改善對比驗證
7. 改善 < 5% → 重新規劃 (最多 3 次迭代)
8. RAG 學習 + 歷史持久化
9. 產生人類可讀報告

### 安全機制:
- auto 內部只 dispatch L0/L1 技能
- L2+ 步驟標記為「需人工確認」不自動執行
- 最多 3 次迭代防止無限迴圈
- 所有操作記錄到 RAG 經驗回放`
};

if (require.main === module) {
    const rawArgs = process.argv[2];
    if (!rawArgs) { console.log('Usage: node nexus.js \'{"task":"status"}\''); process.exit(1); }
    try {
        execute(JSON.parse(rawArgs)).then(console.log).catch(e => console.error(e.message));
    } catch (e) { console.error(`Parse Error: ${e.message}`); }
}
