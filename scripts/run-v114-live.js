#!/usr/bin/env node
// ============================================================
// run-v114-live.js — v11.4 獨立運行腳本
// 模式: test | full | autonomy
// 不經 index.js — 直接初始化核心模組
// ============================================================

const path = require('path');
const fs = require('fs');

// Load environment
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

// Bridge GEMINI_API_KEYS → GEMINI_API_KEY (WebResearcher 需要單數)
if (!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEYS) {
    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEYS.split(',')[0].trim();
}

// Use gemini-2.5-flash for search (2.0-flash free tier exhausted)
if (!process.env.GEMINI_SEARCH_MODEL) {
    process.env.GEMINI_SEARCH_MODEL = 'gemini-2.5-flash';
}

// For autonomy mode: shorter intervals (testing)
process.env.V114_SCAN_INTERVAL_MIN = process.env.V114_SCAN_INTERVAL_MIN || '10';
process.env.V114_DEBATE_INTERVAL_MIN = process.env.V114_DEBATE_INTERVAL_MIN || '15';
process.env.V114_OPTIMIZE_INTERVAL_MIN = process.env.V114_OPTIMIZE_INTERVAL_MIN || '5';
process.env.ENABLE_V114_AUTONOMY = 'true';

// Resolve project root
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

// --- Module loading ---
const EmbeddingProvider = require('../src/memory/EmbeddingProvider');
const VectorStore = require('../src/memory/VectorStore');
const RAGProvider = require('../src/memory/RAGProvider');
const ThreeLayerMemory = require('../src/memory/ThreeLayerMemory');
const TipMemory = require('../src/core/TipMemory');
const MemoryOptimizer = require('../src/memory/MemoryOptimizer');
const WebResearcher = require('../src/core/WebResearcher');
const AGIScanner = require('../src/core/AGIScanner');
const CouncilDebate = require('../src/core/CouncilDebate');
const AutonomyScheduler = require('../src/core/AutonomyScheduler');

const GOLEM_ID = 'rensin';
const DATA_DIR = path.join(ROOT, 'data');

// Ensure data directory
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// --- Helpers ---
function log(tag, msg) {
    const ts = new Date().toISOString().substring(11, 19);
    console.log(`[${ts}] [${tag}] ${msg}`);
}

function getRSSMB() {
    return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

function saveJSON(filename, data) {
    const fp = path.join(DATA_DIR, filename);
    fs.writeFileSync(fp, JSON.stringify(data, null, 2));
    log('IO', `Saved ${fp}`);
}

// --- Initialize modules ---
async function initModules() {
    log('INIT', 'Initializing modules...');

    const apiKeys = (process.env.GEMINI_API_KEYS || '').split(',').filter(Boolean);
    log('INIT', `Gemini API keys: ${apiKeys.length}`);

    // 1. EmbeddingProvider
    const embedding = new EmbeddingProvider({ apiKeys });
    await embedding.init();
    log('INIT', 'EmbeddingProvider ready');

    // 2. VectorStore
    const vectorStore = new VectorStore(
        path.join(ROOT, 'golem_memory', 'vectors.db'),
        embedding
    );
    await vectorStore.init();
    log('INIT', 'VectorStore ready');

    // 3. RAGProvider (local vector only)
    const ragProvider = new RAGProvider({ vectorStore });
    await ragProvider.init();
    log('INIT', 'RAGProvider ready (local vector only)');

    // 4. WebResearcher
    const webResearcher = new WebResearcher();
    log('INIT', `WebResearcher ready (GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'set' : 'MISSING'})`);

    // 5. AGIScanner
    const scanner = new AGIScanner({ webResearcher, ragProvider });
    log('INIT', 'AGIScanner ready');

    // 6. CouncilDebate (heuristic mode — no brain)
    const council = new CouncilDebate({ brain: null, ragProvider });
    log('INIT', 'CouncilDebate ready (heuristic mode)');

    // 7. ThreeLayerMemory
    const threeLayerMemory = new ThreeLayerMemory({ golemId: GOLEM_ID });
    log('INIT', 'ThreeLayerMemory ready');

    // 8. TipMemory
    const tipMemory = new TipMemory({ golemId: GOLEM_ID });
    log('INIT', 'TipMemory ready');

    // 9. MemoryOptimizer
    const optimizer = new MemoryOptimizer({
        golemId: GOLEM_ID,
        threeLayerMemory,
        tipMemory,
        ragProvider,
    });
    log('INIT', 'MemoryOptimizer ready');

    // 10. AutonomyScheduler
    const scheduler = new AutonomyScheduler({
        golemId: GOLEM_ID,
        scanner,
        council,
        optimizer,
        ragProvider,
    });
    log('INIT', 'AutonomyScheduler ready');

    log('INIT', `All modules initialized. RSS: ${getRSSMB()}MB`);
    return { embedding, vectorStore, ragProvider, webResearcher, scanner, council, threeLayerMemory, tipMemory, optimizer, scheduler };
}

// ============================================================
// MODE: test — single WebResearcher.search() to verify API
// ============================================================
async function runTest(modules) {
    log('TEST', '--- Gemini API connectivity test ---');
    const { webResearcher } = modules;

    try {
        const result = await webResearcher.search('latest AI news today 2026');
        log('TEST', `Synthesis: ${(result.synthesis || '').substring(0, 300)}`);
        log('TEST', `Results: ${(result.results || []).length} sources`);
        log('TEST', `Web queries: ${(result.webSearchQueries || []).join(', ')}`);
        log('TEST', `Error: ${result.error || 'none'}`);
        log('TEST', result.synthesis ? 'SUCCESS — Gemini API is working' : 'WARNING — empty synthesis');
        return result;
    } catch (e) {
        log('TEST', `FAILED: ${e.message}`);
        return null;
    }
}

// ============================================================
// MODE: full — complete scan → debate → optimize → RAG ingest
// ============================================================
async function runFull(modules) {
    const { scanner, council, optimizer, ragProvider } = modules;
    const startRSS = getRSSMB();
    const startTime = Date.now();

    log('FULL', '=== Starting full pipeline ===');
    log('FULL', `RSS: ${startRSS}MB`);

    // Step 1: AGI Scan (maxQueriesPerCategory=2 → ~16 queries)
    log('FULL', 'Step 1/6: AGIScanner.fullScan (maxQueriesPerCategory=2)...');
    const scanReport = await scanner.fullScan({ maxQueriesPerCategory: 2 });
    log('FULL', `Scan complete: ${scanReport.totalQueries} queries, ${scanReport.totalResults} results, ${scanReport.errors.length} errors`);
    if (scanReport.errors.length > 0) {
        log('FULL', `Scan errors: ${scanReport.errors.slice(0, 5).join(' | ')}`);
    }

    // Step 2: Ingest findings into VectorStore
    log('FULL', 'Step 2/6: Ingesting findings into RAG...');
    const ingestResult = await scanner.ingestFindings(scanReport);
    log('FULL', `Ingested: ${ingestResult.ingested}, failed: ${ingestResult.failed}`);

    // Step 3: Council debate (heuristic)
    log('FULL', 'Step 3/6: CouncilDebate (heuristic mode)...');
    const debateResult = await council.debate(scanReport);
    log('FULL', `Debate: ${debateResult.perspectives.length} perspectives, mode=${debateResult.mode}`);

    // Step 4: Publish debate results to RAG
    log('FULL', 'Step 4/6: Publishing debate results...');
    await council.publishResults(debateResult);
    log('FULL', 'Debate results published');

    // Step 5: Memory optimization
    log('FULL', 'Step 5/6: MemoryOptimizer.optimize()...');
    const optimizeReport = await optimizer.optimize();
    log('FULL', `Optimize: heal=${optimizeReport.selfHeal.repaired}, dedup=${optimizeReport.dedup.merged}, decay=${optimizeReport.decay.decayed}`);

    // Step 6: Save results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const results = {
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        rss: { start: startRSS, end: getRSSMB() },
        scan: {
            totalQueries: scanReport.totalQueries,
            totalResults: scanReport.totalResults,
            errors: scanReport.errors,
            categories: Object.fromEntries(
                Object.entries(scanReport.categories).map(([k, v]) => [k, {
                    label: v.label,
                    queriesRun: v.queriesRun,
                    resultCount: v.results.length,
                    results: v.results.map(r => ({
                        query: r.query,
                        synthesis: (r.synthesis || '').substring(0, 500),
                        resultCount: r.resultCount,
                    })),
                    errors: v.errors,
                }])
            ),
        },
        debate: {
            mode: debateResult.mode,
            perspectives: debateResult.perspectives.map(p => ({
                name: p.name,
                analysis: (p.analysis || '').substring(0, 300),
            })),
            synthesis: debateResult.synthesis,
        },
        optimize: optimizeReport,
        ingest: ingestResult,
    };

    saveJSON(`v114_live_results_${timestamp}.json`, results);

    // Print human-readable summary
    log('FULL', '');
    log('FULL', '=== FULL PIPELINE SUMMARY ===');
    log('FULL', scanner.formatReport(scanReport));
    log('FULL', `Duration: ${Math.round((Date.now() - startTime) / 1000)}s`);
    log('FULL', `RSS: ${startRSS}MB → ${getRSSMB()}MB`);
    log('FULL', '=== END ===');

    return results;
}

// ============================================================
// MODE: autonomy — tick loop with 1hr monitoring
// ============================================================
async function runAutonomy(modules) {
    const { scheduler } = modules;
    const TICK_INTERVAL_MS = 60 * 1000; // 60s
    const TOTAL_DURATION_MS = 60 * 60 * 1000; // 1hr
    const startTime = Date.now();

    log('AUTO', '=== Starting autonomy tick loop (1hr) ===');
    log('AUTO', `Tick interval: ${TICK_INTERVAL_MS / 1000}s`);
    log('AUTO', `Scan every: ${process.env.V114_SCAN_INTERVAL_MIN}min`);
    log('AUTO', `Debate every: ${process.env.V114_DEBATE_INTERVAL_MIN}min`);
    log('AUTO', `Optimize every: ${process.env.V114_OPTIMIZE_INTERVAL_MIN}min`);
    log('AUTO', `RSS: ${getRSSMB()}MB`);

    const stats = {
        ticks: 0,
        actions: {},
        errors: [],
        rssHistory: [],
        startTime: new Date().toISOString(),
    };

    // Unhandled rejection catcher
    process.on('unhandledRejection', (reason) => {
        log('AUTO', `UNHANDLED REJECTION: ${reason}`);
        stats.errors.push({ time: new Date().toISOString(), error: String(reason) });
    });

    const tick = async () => {
        const rss = getRSSMB();
        const elapsed = Date.now() - startTime;
        const systemState = {
            rss,
            uptime: Math.round(elapsed / 1000),
            episodeCount: 0,
            tipCount: 0,
        };

        try {
            const result = await scheduler.tick(systemState);
            stats.ticks++;
            stats.actions[result.action] = (stats.actions[result.action] || 0) + 1;
            stats.rssHistory.push(rss);

            log('AUTO', `Tick #${stats.ticks}: action=${result.action} | ${result.summary} | RSS=${rss}MB`);

            if (rss > 300) {
                log('AUTO', `WARNING: RSS ${rss}MB > 300MB threshold`);
            }
        } catch (e) {
            log('AUTO', `Tick error: ${e.message}`);
            stats.errors.push({ time: new Date().toISOString(), error: e.message });
        }
    };

    // Run ticks until 1hr elapsed
    while (Date.now() - startTime < TOTAL_DURATION_MS) {
        await tick();

        const remaining = TOTAL_DURATION_MS - (Date.now() - startTime);
        if (remaining <= 0) break;

        // Wait for next tick (or remaining time if less than interval)
        const wait = Math.min(TICK_INTERVAL_MS, remaining);
        await new Promise(r => setTimeout(r, wait));
    }

    // Final summary
    stats.endTime = new Date().toISOString();
    stats.totalDurationMin = Math.round((Date.now() - startTime) / 60000);
    stats.peakRSS = Math.max(...stats.rssHistory, 0);
    stats.avgRSS = stats.rssHistory.length > 0
        ? Math.round(stats.rssHistory.reduce((a, b) => a + b, 0) / stats.rssHistory.length)
        : 0;

    log('AUTO', '');
    log('AUTO', '=== AUTONOMY SESSION SUMMARY ===');
    log('AUTO', `Duration: ${stats.totalDurationMin} minutes`);
    log('AUTO', `Ticks: ${stats.ticks}`);
    log('AUTO', `Actions: ${JSON.stringify(stats.actions)}`);
    log('AUTO', `Errors: ${stats.errors.length}`);
    log('AUTO', `RSS: avg=${stats.avgRSS}MB, peak=${stats.peakRSS}MB`);
    log('AUTO', '================================');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    saveJSON(`v114_autonomy_session_${timestamp}.json`, stats);

    return stats;
}

// ============================================================
// Main entry
// ============================================================
async function main() {
    const mode = process.argv[2] || 'test';
    log('MAIN', `v11.4 Live Runner — mode: ${mode}`);
    log('MAIN', `CWD: ${process.cwd()}`);
    log('MAIN', `RSS: ${getRSSMB()}MB`);

    let modules;
    try {
        modules = await initModules();
    } catch (e) {
        log('MAIN', `Init failed: ${e.message}`);
        console.error(e);
        process.exit(1);
    }

    try {
        switch (mode) {
            case 'test':
                await runTest(modules);
                break;
            case 'full':
                await runFull(modules);
                break;
            case 'autonomy':
                await runAutonomy(modules);
                break;
            default:
                log('MAIN', `Unknown mode: ${mode}. Use: test | full | autonomy`);
                process.exit(1);
        }
    } catch (e) {
        log('MAIN', `Fatal error: ${e.message}`);
        console.error(e);
        process.exit(1);
    }

    log('MAIN', 'Done.');
    process.exit(0);
}

main();
