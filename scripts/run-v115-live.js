#!/usr/bin/env node
// ============================================================
// run-v115-live.js — v11.5 全自動自主運行
// 模式: test | full | autonomy | worker-audit | security-audit | ab-debate
// 整合: ErrorPatternLearner, ScanQualityTracker, WorkerHealthAuditor,
//       SecurityAuditor, RAGQualityMonitor, DebateQualityTracker, YerenBridge
// ============================================================

const path = require('path');
const fs = require('fs');

// Load environment
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

// Bridge GEMINI_API_KEYS → GEMINI_API_KEY
if (!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEYS) {
    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEYS.split(',')[0].trim();
}
if (!process.env.GEMINI_SEARCH_MODEL) {
    process.env.GEMINI_SEARCH_MODEL = 'gemini-2.5-flash';
}

// Testing intervals
process.env.V114_SCAN_INTERVAL_MIN = process.env.V114_SCAN_INTERVAL_MIN || '10';
process.env.V114_DEBATE_INTERVAL_MIN = process.env.V114_DEBATE_INTERVAL_MIN || '15';
process.env.V114_OPTIMIZE_INTERVAL_MIN = process.env.V114_OPTIMIZE_INTERVAL_MIN || '5';
process.env.V115_WORKER_CHECK_INTERVAL_MIN = process.env.V115_WORKER_CHECK_INTERVAL_MIN || '30';
process.env.V115_SECURITY_AUDIT_INTERVAL_MIN = process.env.V115_SECURITY_AUDIT_INTERVAL_MIN || '360';
process.env.V115_YEREN_SYNC_INTERVAL_MIN = process.env.V115_YEREN_SYNC_INTERVAL_MIN || '60';
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

// v11.5 modules
const ErrorPatternLearner = require('../src/core/ErrorPatternLearner');
const ScanQualityTracker = require('../src/core/ScanQualityTracker');
const WorkerHealthAuditor = require('../src/core/WorkerHealthAuditor');
const SecurityAuditor = require('../src/core/SecurityAuditor');
const RAGQualityMonitor = require('../src/core/RAGQualityMonitor');
const DebateQualityTracker = require('../src/core/DebateQualityTracker');
const YerenBridge = require('../src/bridges/YerenBridge');
const SecurityManager = require('../src/managers/SecurityManager');

const GOLEM_ID = 'rensin';
const DATA_DIR = path.join(ROOT, 'data');

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

// --- Initialize all modules ---
async function initModules() {
    log('INIT', 'Initializing v11.5 modules...');

    const apiKeys = (process.env.GEMINI_API_KEYS || '').split(',').filter(Boolean);
    log('INIT', `Gemini API keys: ${apiKeys.length}`);

    // v11.5 modules (no async init needed)
    const errorPatternLearner = new ErrorPatternLearner();
    const scanQualityTracker = new ScanQualityTracker();
    const workerAuditor = new WorkerHealthAuditor();
    const securityAuditor = new SecurityAuditor({ securityManager: new SecurityManager() });
    const debateQualityTracker = new DebateQualityTracker();
    const yerenBridge = new YerenBridge();
    log('INIT', 'v11.5 modules ready (ErrorPatternLearner, ScanQualityTracker, WorkerHealthAuditor, SecurityAuditor, DebateQualityTracker, YerenBridge)');

    // Core modules
    const embedding = new EmbeddingProvider({ apiKeys });
    await embedding.init();
    log('INIT', 'EmbeddingProvider ready');

    const vectorStore = new VectorStore(
        path.join(ROOT, 'golem_memory', 'vectors.db'),
        embedding
    );
    await vectorStore.init();
    log('INIT', 'VectorStore ready');

    const ragProvider = new RAGProvider({ vectorStore });
    await ragProvider.init();
    log('INIT', 'RAGProvider ready');

    const webResearcher = new WebResearcher({ errorPatternLearner });
    log('INIT', `WebResearcher ready (GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'set' : 'MISSING'})`);

    const scanner = new AGIScanner({ webResearcher, ragProvider, scanQualityTracker });
    log('INIT', 'AGIScanner ready (with ScanQualityTracker)');

    const council = new CouncilDebate({ brain: null, ragProvider });
    log('INIT', 'CouncilDebate ready (heuristic mode)');

    const threeLayerMemory = new ThreeLayerMemory({ golemId: GOLEM_ID });
    const tipMemory = new TipMemory({ golemId: GOLEM_ID });
    const optimizer = new MemoryOptimizer({ golemId: GOLEM_ID, threeLayerMemory, tipMemory, ragProvider });
    log('INIT', 'Memory stack ready');

    const ragQualityMonitor = new RAGQualityMonitor({ vectorStore, tipMemory, ragProvider });
    log('INIT', 'RAGQualityMonitor ready');

    const scheduler = new AutonomyScheduler({
        golemId: GOLEM_ID,
        scanner,
        council,
        optimizer,
        ragProvider,
        workerAuditor,
        securityAuditor,
        yerenBridge,
    });
    log('INIT', 'AutonomyScheduler ready (v11.5: 8-priority)');

    log('INIT', `All modules initialized. RSS: ${getRSSMB()}MB`);
    return {
        embedding, vectorStore, ragProvider, webResearcher, scanner, council,
        threeLayerMemory, tipMemory, optimizer, scheduler,
        errorPatternLearner, scanQualityTracker, workerAuditor,
        securityAuditor, ragQualityMonitor, debateQualityTracker, yerenBridge,
    };
}

// ============================================================
// MODE: test
// ============================================================
async function runTest(modules) {
    log('TEST', '--- Gemini API connectivity test ---');
    const { webResearcher } = modules;
    try {
        const result = await webResearcher.search('latest AI news today 2026');
        log('TEST', `Synthesis: ${(result.synthesis || '').substring(0, 300)}`);
        log('TEST', `Results: ${(result.results || []).length} sources`);
        log('TEST', result.synthesis ? 'SUCCESS' : 'WARNING — empty synthesis');
        return result;
    } catch (e) {
        log('TEST', `FAILED: ${e.message}`);
        return null;
    }
}

// ============================================================
// MODE: worker-audit
// ============================================================
async function runWorkerAudit(modules) {
    log('WORKER', '=== CF Worker Health Audit ===');
    const { workerAuditor } = modules;

    const result = await workerAuditor.auditAll();
    log('WORKER', `Total: ${result.summary.total}, Healthy: ${result.summary.healthy}, Unhealthy: ${result.summary.unhealthy}`);
    log('WORKER', `Avg Latency: ${result.summary.avgLatencyMs}ms`);

    for (const w of result.workers) {
        const icon = w.status === 'ok' ? '✅' : '❌';
        log('WORKER', `  ${icon} ${w.name}: ${w.status} (${w.latencyMs}ms) ${w.error || ''}`);
    }

    const recs = workerAuditor.getRecommendations();
    if (recs.length > 0) {
        log('WORKER', '--- Recommendations ---');
        for (const r of recs) {
            log('WORKER', `  ⚠️  ${r.recommendation}`);
        }
    }

    return result;
}

// ============================================================
// MODE: security-audit
// ============================================================
async function runSecurityAudit(modules) {
    log('SECURITY', '=== Security Audit ===');
    const { securityAuditor } = modules;

    const report = await securityAuditor.generateAuditReport();
    log('SECURITY', `Risk Score: ${report.riskScore}/100`);
    log('SECURITY', `Sandbox: ${report.sandbox.totalDomains} domains (${report.sandbox.wildcards} wildcards)`);
    log('SECURITY', `Security Rules: ${report.securityRules.totalRules} (L0:${report.securityRules.levelStats.L0} L1:${report.securityRules.levelStats.L1} L2:${report.securityRules.levelStats.L2} L3:${report.securityRules.levelStats.L3})`);
    log('SECURITY', `Circuit Breakers: ${report.circuitBreakers.totalBreakers}`);

    if (report.risks.length > 0) {
        log('SECURITY', '--- Risks Identified ---');
        for (const risk of report.risks) {
            log('SECURITY', `  ⚠️  ${risk}`);
        }
    } else {
        log('SECURITY', 'No significant risks identified');
    }

    return report;
}

// ============================================================
// MODE: ab-debate
// ============================================================
async function runABDebate(modules) {
    log('AB', '=== A/B Debate Quality Test ===');
    const { scanner, council, ragProvider, debateQualityTracker } = modules;

    // Quick scan for debate material
    log('AB', 'Running quick scan (1 query per category)...');
    const scanReport = await scanner.fullScan({ maxQueriesPerCategory: 1 });
    log('AB', `Scan: ${scanReport.totalQueries} queries, ${scanReport.totalResults} results`);

    // Debate A: Standard heuristic
    log('AB', 'Debate A: Standard heuristic...');
    const debateA = await council.debate(scanReport, { topic: 'A/B test - standard' });

    // Debate B: RAG-augmented
    log('AB', 'Debate B: RAG-augmented...');
    const debateB = await council.debateWithRAGContext(scanReport, ragProvider, { topic: 'A/B test - RAG-augmented' });

    // Compare
    const comparison = debateQualityTracker.compare(debateA, debateB);
    log('AB', `Winner: ${comparison.winner}`);
    log('AB', `Score A: ${comparison.scoreA.overall} (diversity=${comparison.scoreA.keywordDiversity}, diff=${comparison.scoreA.perspectiveDifferentiation}, coverage=${comparison.scoreA.synthesisCoverage})`);
    log('AB', `Score B: ${comparison.scoreB.overall} (diversity=${comparison.scoreB.keywordDiversity}, diff=${comparison.scoreB.perspectiveDifferentiation}, coverage=${comparison.scoreB.synthesisCoverage})`);
    log('AB', `Delta: overall=${comparison.delta.overall}`);

    return comparison;
}

// ============================================================
// MODE: full
// ============================================================
async function runFull(modules) {
    const { scanner, council, optimizer, ragProvider, workerAuditor, securityAuditor, ragQualityMonitor, debateQualityTracker, yerenBridge, scanQualityTracker } = modules;
    const startRSS = getRSSMB();
    const startTime = Date.now();

    log('FULL', '=== v11.5 Full Pipeline ===');
    log('FULL', `RSS: ${startRSS}MB`);

    // Step 1: Multi-source AGI Scan
    log('FULL', 'Step 1/8: AGIScanner.fullScan (maxQueriesPerCategory=2)...');
    const scanReport = await scanner.fullScan({ maxQueriesPerCategory: 2 });
    log('FULL', `Scan: ${scanReport.totalQueries} queries, ${scanReport.totalResults} results, ${scanReport.errors.length} errors`);

    // Step 2: Ingest
    log('FULL', 'Step 2/8: Ingesting into RAG...');
    const ingestResult = await scanner.ingestFindings(scanReport);
    log('FULL', `Ingested: ${ingestResult.ingested}, failed: ${ingestResult.failed}`);

    // Step 3: Council debate
    log('FULL', 'Step 3/8: CouncilDebate (heuristic)...');
    const debateResult = await council.debate(scanReport);
    const debateScore = debateQualityTracker.scoreDebate(debateResult);
    log('FULL', `Debate: ${debateResult.perspectives.length} perspectives, quality=${debateScore.overall}`);
    await council.publishResults(debateResult);

    // Step 4: Worker audit
    log('FULL', 'Step 4/8: Worker health audit...');
    const workerResult = await workerAuditor.auditAll();
    log('FULL', `Workers: ${workerResult.summary.healthy}/${workerResult.summary.total} healthy`);

    // Step 5: Security audit
    log('FULL', 'Step 5/8: Security audit...');
    const secReport = await securityAuditor.generateAuditReport();
    log('FULL', `Security: risk=${secReport.riskScore}, ${secReport.risks.length} risks`);

    // Step 6: RAG quality
    log('FULL', 'Step 6/8: RAG quality check...');
    const ragReport = await ragQualityMonitor.generateReport();
    log('FULL', `RAG: ${ragReport.vectorGrowth.totalVectors} vectors, tip effectiveness=${ragReport.tipEffectiveness.successRate || 'N/A'}`);

    // Step 7: Optimize
    log('FULL', 'Step 7/8: MemoryOptimizer...');
    const optimizeReport = await optimizer.optimize();
    log('FULL', `Optimize: heal=${optimizeReport.selfHeal.repaired}, dedup=${optimizeReport.dedup.merged}, decay=${optimizeReport.decay.decayed}`);

    // Step 8: Yeren sync
    log('FULL', 'Step 8/8: Yeren sync...');
    const yerenStatus = yerenBridge.getStatus();
    let yerenSync = null;
    if (yerenStatus.available) {
        yerenSync = {
            memory: yerenBridge.syncMemory(),
            scan: yerenBridge.syncScanResults(),
        };
        log('FULL', `Yeren: memory=${yerenSync.memory.synced.length} files, scan=${yerenSync.scan.synced} files`);
    } else {
        log('FULL', 'Yeren: not available (expected in non-WSL2 environment)');
    }

    // Save results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const results = {
        version: 'v11.5',
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        rss: { start: startRSS, end: getRSSMB() },
        scan: {
            totalQueries: scanReport.totalQueries,
            totalResults: scanReport.totalResults,
            errors: scanReport.errors,
            scanQuality: scanQualityTracker.getStats(),
        },
        debate: { mode: debateResult.mode, quality: debateScore },
        workerAudit: workerResult.summary,
        securityAudit: { riskScore: secReport.riskScore, risks: secReport.risks },
        ragQuality: {
            vectors: ragReport.vectorGrowth.totalVectors,
            tipEffectiveness: ragReport.tipEffectiveness,
        },
        optimize: optimizeReport,
        ingest: ingestResult,
        yerenSync: yerenSync ? { available: true, memory: yerenSync.memory.synced.length, scan: yerenSync.scan.synced } : { available: false },
    };

    saveJSON(`v115_live_results_${timestamp}.json`, results);

    log('FULL', '');
    log('FULL', '=== v11.5 FULL PIPELINE SUMMARY ===');
    log('FULL', `Duration: ${Math.round((Date.now() - startTime) / 1000)}s`);
    log('FULL', `RSS: ${startRSS}MB → ${getRSSMB()}MB`);
    log('FULL', `Scan: ${scanReport.totalQueries} queries, ${scanReport.totalResults} results`);
    log('FULL', `Debate quality: ${debateScore.overall}`);
    log('FULL', `Workers: ${workerResult.summary.healthy}/${workerResult.summary.total} healthy`);
    log('FULL', `Security risk: ${secReport.riskScore}/100`);
    log('FULL', `RAG vectors: ${ragReport.vectorGrowth.totalVectors}`);
    log('FULL', '=== END ===');

    return results;
}

// ============================================================
// MODE: autonomy
// ============================================================
async function runAutonomy(modules) {
    const { scheduler } = modules;
    const TICK_INTERVAL_MS = 60 * 1000;
    const TOTAL_DURATION_MS = 60 * 60 * 1000; // 1hr
    const startTime = Date.now();

    log('AUTO', '=== v11.5 Autonomy Tick Loop (1hr) ===');
    log('AUTO', `Tick interval: ${TICK_INTERVAL_MS / 1000}s`);
    log('AUTO', `Priorities: RSS > dedup > scan > debate > optimize > worker > security > yeren`);
    log('AUTO', `RSS: ${getRSSMB()}MB`);

    const stats = {
        version: 'v11.5',
        ticks: 0,
        actions: {},
        errors: [],
        rssHistory: [],
        startTime: new Date().toISOString(),
    };

    process.on('unhandledRejection', (reason) => {
        log('AUTO', `UNHANDLED REJECTION: ${reason}`);
        stats.errors.push({ time: new Date().toISOString(), error: String(reason) });
    });

    const tick = async () => {
        const rss = getRSSMB();
        const systemState = {
            rss,
            uptime: Math.round((Date.now() - startTime) / 1000),
            episodeCount: 0,
            tipCount: 0,
        };

        try {
            const result = await scheduler.tick(systemState);
            stats.ticks++;
            stats.actions[result.action] = (stats.actions[result.action] || 0) + 1;
            stats.rssHistory.push(rss);
            log('AUTO', `Tick #${stats.ticks}: action=${result.action} | ${result.summary} | RSS=${rss}MB`);

            if (rss > 300) log('AUTO', `WARNING: RSS ${rss}MB > 300MB`);
        } catch (e) {
            log('AUTO', `Tick error: ${e.message}`);
            stats.errors.push({ time: new Date().toISOString(), error: e.message });
        }
    };

    while (Date.now() - startTime < TOTAL_DURATION_MS) {
        await tick();
        const remaining = TOTAL_DURATION_MS - (Date.now() - startTime);
        if (remaining <= 0) break;
        await new Promise(r => setTimeout(r, Math.min(TICK_INTERVAL_MS, remaining)));
    }

    stats.endTime = new Date().toISOString();
    stats.totalDurationMin = Math.round((Date.now() - startTime) / 60000);
    stats.peakRSS = Math.max(...stats.rssHistory, 0);
    stats.avgRSS = stats.rssHistory.length > 0
        ? Math.round(stats.rssHistory.reduce((a, b) => a + b, 0) / stats.rssHistory.length)
        : 0;
    stats.schedulerStatus = scheduler.getStatus();

    log('AUTO', '');
    log('AUTO', '=== v11.5 AUTONOMY SESSION SUMMARY ===');
    log('AUTO', `Duration: ${stats.totalDurationMin} minutes`);
    log('AUTO', `Ticks: ${stats.ticks}`);
    log('AUTO', `Actions: ${JSON.stringify(stats.actions)}`);
    log('AUTO', `Errors: ${stats.errors.length}`);
    log('AUTO', `RSS: avg=${stats.avgRSS}MB, peak=${stats.peakRSS}MB`);
    log('AUTO', '======================================');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    saveJSON(`v115_autonomy_session_${timestamp}.json`, stats);

    return stats;
}

// ============================================================
// Main entry
// ============================================================
async function main() {
    const mode = process.argv[2] || 'test';
    log('MAIN', `v11.5 Live Runner — mode: ${mode}`);
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
            case 'worker-audit':
                await runWorkerAudit(modules);
                break;
            case 'security-audit':
                await runSecurityAudit(modules);
                break;
            case 'ab-debate':
                await runABDebate(modules);
                break;
            default:
                log('MAIN', `Unknown mode: ${mode}. Use: test | full | autonomy | worker-audit | security-audit | ab-debate`);
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
