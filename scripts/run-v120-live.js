#!/usr/bin/env node
// ============================================================
// run-v120-live.js — v12.0 全自動自主運行 + AI 風險 + Token 追蹤 + 技能生成
// 模式: test | full | autonomy | ai-risk | skill-gen | token-report
// 新增: TokenTracker, AI risk analysis, SkillGenerator, XML config v2.1
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

process.env.ENABLE_V114_AUTONOMY = 'true';

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

// --- Module loading ---
const { getConfig } = require('../src/config/xml-config-loader');
const TokenTracker = require('../src/core/TokenTracker');
const SecurityAuditor = require('../src/core/SecurityAuditor');
const SkillGenerator = require('../src/skills/core/skill-generator');
const PromptScorer = require('../src/core/PromptScorer');
const WebResearcher = require('../src/core/WebResearcher');
const ErrorPatternLearner = require('../src/core/ErrorPatternLearner');

const GOLEM_ID = 'rensin';
const DATA_DIR = path.join(ROOT, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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

// --- Initialize v12.0 modules ---
function initV120Modules() {
    const xmlConfig = getConfig();
    const tokenConfig = xmlConfig.getTokenTrackingConfig();
    const secConfig = xmlConfig.getSecurityAuditorConfig();

    const tokenTracker = new TokenTracker({
        budget: tokenConfig.budgetDaily,
        persistIntervalMs: tokenConfig.persistIntervalMs,
        warnThresholdPct: tokenConfig.warnThresholdPct,
    });

    const errorPatternLearner = new ErrorPatternLearner({ dataDir: DATA_DIR });

    // Load scan history for AI risk analysis
    let scanHistory = [];
    try {
        const histFile = path.join(DATA_DIR, `v114_scan_history_${GOLEM_ID}.json`);
        if (fs.existsSync(histFile)) {
            scanHistory = JSON.parse(fs.readFileSync(histFile, 'utf-8'));
        }
    } catch (e) { /* ok */ }

    const securityAuditor = new SecurityAuditor({
        dataDir: DATA_DIR,
        aiRiskEnabled: secConfig.aiRiskChecks,
        traditionalWeight: secConfig.traditionalWeight,
        aiRiskWeight: secConfig.aiRiskWeight,
        scanHistory,
    });

    const promptScorer = new PromptScorer();
    const skillGenerator = new SkillGenerator({
        promptScorer,
        previewMode: true,
    });

    const webResearcher = new WebResearcher({
        errorPatternLearner,
    });

    return { xmlConfig, tokenTracker, securityAuditor, skillGenerator, promptScorer, webResearcher, errorPatternLearner };
}

// --- Modes ---

async function modeTest(modules) {
    log('TEST', `v12.0 module init OK | RSS: ${getRSSMB()}MB`);
    log('TEST', `Token budget: ${modules.tokenTracker.getReport().budget}`);
    log('TEST', `XML config version: ${modules.xmlConfig.config?.['@_version']}`);

    // Quick Gemini API test
    try {
        const result = await modules.webResearcher.search('AI news 2026');
        log('TEST', `Gemini search: ${result.results?.length || 0} results, synthesis: ${(result.synthesis || '').substring(0, 80)}...`);
        modules.tokenTracker.record('WebResearcher', 500, 'input');
    } catch (e) {
        log('TEST', `Gemini search failed: ${e.message}`);
    }

    log('TEST', `Token report: ${JSON.stringify(modules.tokenTracker.getReport())}`);
}

async function modeAIRisk(modules) {
    log('AI-RISK', 'Running AI risk analysis...');
    const report = await modules.securityAuditor.generateAuditReport();
    log('AI-RISK', `Risk score: ${report.riskScore}/100 (traditional: ${report.traditionalRiskScore})`);

    if (report.aiRisk) {
        log('AI-RISK', `AI Risk breakdown:`);
        log('AI-RISK', `  Alignment mirage: ${report.aiRisk.alignmentMirage}/25`);
        log('AI-RISK', `  Capability concealment: ${report.aiRisk.capabilityConcealment}/25`);
        log('AI-RISK', `  Agent autonomy risk: ${report.aiRisk.agentAutonomyRisk}/25`);
        log('AI-RISK', `  Concentration risk: ${report.aiRisk.concentrationRisk}/25`);
        log('AI-RISK', `  Total AI risk: ${report.aiRisk.totalAIRisk}/100`);
    }

    for (const risk of report.risks) {
        log('AI-RISK', `  ⚠ ${risk}`);
    }

    saveJSON(`v120_ai_risk_${Date.now()}.json`, report);
    return report;
}

async function modeSkillGen(modules) {
    log('SKILL-GEN', 'Identifying skill candidates from scan data...');
    const { candidates } = modules.skillGenerator.identifyCandidates();
    log('SKILL-GEN', `Found ${candidates.length} candidates`);

    const result = modules.skillGenerator.generateAll();
    log('SKILL-GEN', `Generated ${result.total} skill templates (preview mode)`);

    for (const t of result.templates) {
        log('SKILL-GEN', `  📦 ${t.name} (${t.candidate.type}) — safety: ${t.safetyCheck.passed ? '✅' : '❌'}`);
    }

    saveJSON(`v120_skill_gen_${Date.now()}.json`, result);
    return result;
}

async function modeTokenReport(modules) {
    log('TOKEN', 'Token usage report:');
    const report = modules.tokenTracker.getReport();
    log('TOKEN', `  Total used: ${report.totalUsed}/${report.budget} (${report.budgetPct}%)`);
    log('TOKEN', `  Remaining: ${report.budgetRemaining}`);
    log('TOKEN', `  Session: ${report.sessionDurationMs}ms`);
    log('TOKEN', `  By module:`);
    for (const [mod, usage] of Object.entries(report.byModule)) {
        log('TOKEN', `    ${mod}: in=${usage.input} out=${usage.output} total=${usage.total}`);
    }
    return report;
}

async function modeFull(modules) {
    log('FULL', '=== v12.0 Full Pipeline ===');
    log('FULL', `RSS: ${getRSSMB()}MB`);

    // Step 1: AI Risk Analysis
    const riskReport = await modeAIRisk(modules);

    // Step 2: Skill Generation
    const skillResult = await modeSkillGen(modules);

    // Step 3: Token Report
    const tokenReport = await modeTokenReport(modules);

    const summary = {
        timestamp: new Date().toISOString(),
        riskScore: riskReport.riskScore,
        skillsGenerated: skillResult.total,
        tokenUsed: tokenReport.totalUsed,
        rss: getRSSMB(),
    };
    saveJSON(`v120_full_${Date.now()}.json`, summary);
    log('FULL', `Pipeline complete. Risk=${summary.riskScore} Skills=${summary.skillsGenerated} Tokens=${summary.tokenUsed}`);
}

// --- Main ---
async function main() {
    const mode = process.argv[2] || 'test';
    log('v12.0', `Starting mode: ${mode}`);

    const modules = initV120Modules();

    try {
        switch (mode) {
            case 'test': await modeTest(modules); break;
            case 'ai-risk': await modeAIRisk(modules); break;
            case 'skill-gen': await modeSkillGen(modules); break;
            case 'token-report': await modeTokenReport(modules); break;
            case 'full': await modeFull(modules); break;
            default:
                console.log('Usage: node run-v120-live.js [test|full|ai-risk|skill-gen|token-report]');
        }
    } finally {
        // Cleanup
        if (modules.tokenTracker._writer) modules.tokenTracker._writer.destroy();
        if (modules.securityAuditor._writer) modules.securityAuditor._writer.destroy();
        if (modules.errorPatternLearner._writer) modules.errorPatternLearner._writer.destroy();
    }

    log('v12.0', `Done. RSS: ${getRSSMB()}MB`);
}

main().catch(e => {
    console.error('[v12.0] Fatal:', e);
    process.exit(1);
});
