// ============================================================
// SecurityAuditor — 全面安全 + Token + 風險審計 + AI 風險分析
// v11.5: 沙盒域名, 安全規則, 熔斷器, Token 預算
// v12.0: AI 風險分析 (alignment mirage, capability concealment, agent autonomy, concentration)
// ============================================================

const path = require('path');
const fs = require('fs');
const DebouncedWriter = require('../utils/DebouncedWriter');

const DATA_FILE = 'security_audit_report.json';

class SecurityAuditor {
    constructor(options = {}) {
        this._dataDir = options.dataDir || path.resolve(process.cwd(), 'data');
        this._filePath = path.join(this._dataDir, DATA_FILE);
        this._securityManager = options.securityManager || null;
        this._sandboxGuard = options.sandboxGuard || null;
        this._scanHistory = options.scanHistory || null; // v12.0: scan history for AI risk analysis
        this._aiRiskEnabled = options.aiRiskEnabled !== false; // v12.0: XML gate
        this._traditionalWeight = options.traditionalWeight || 0.6;
        this._aiRiskWeight = options.aiRiskWeight || 0.4;
        this._writer = new DebouncedWriter(this._filePath, 3000);
    }

    /**
     * Audit sandbox domain whitelist
     * @returns {Object} { domains, suspicious, coverage }
     */
    auditSandboxDomains() {
        const result = {
            domains: [],
            suspicious: [],
            wildcards: 0,
            totalDomains: 0,
        };

        try {
            const guard = this._sandboxGuard || require('./SandboxGuard');
            result.domains = [...(guard.ALLOWED_DOMAINS || [])];
            result.totalDomains = result.domains.length;
            result.wildcards = result.domains.filter(d => d.startsWith('.')).length;
            result.suspicious = guard.getSuspicious ? guard.getSuspicious() : [];
        } catch (e) {
            result.error = e.message;
        }

        return result;
    }

    /**
     * Audit security rules coverage (L0-L3)
     * @returns {Object} { levelStats, totalRules, coverage }
     */
    auditSecurityRules() {
        const result = {
            levelStats: { L0: 0, L1: 0, L2: 0, L3: 0 },
            totalRules: 0,
            coverage: {},
        };

        try {
            if (this._securityManager) {
                result.levelStats = this._securityManager.getLevelStats();
                result.totalRules = Object.values(result.levelStats).reduce((a, b) => a + b, 0);
                if (this._securityManager.getRulesCoverage) {
                    result.coverage = this._securityManager.getRulesCoverage();
                }
            } else {
                const SecurityManager = require('../managers/SecurityManager');
                const sm = new SecurityManager();
                result.levelStats = sm.getLevelStats();
                result.totalRules = Object.values(result.levelStats).reduce((a, b) => a + b, 0);
            }
        } catch (e) {
            result.error = e.message;
        }

        return result;
    }

    /**
     * Audit circuit breaker states
     * @returns {Object} { breakers }
     */
    auditCircuitBreakers() {
        const result = { breakers: [], totalBreakers: 0 };

        try {
            // Check if OpossumBridge is available
            const OpossumBridge = require('../bridges/OpossumBridge');
            if (OpossumBridge.getAll) {
                const all = OpossumBridge.getAll();
                result.breakers = all.map(cb => ({
                    name: cb.name || 'unnamed',
                    state: cb.state || 'unknown',
                    stats: cb.stats || {},
                }));
            }
            result.totalBreakers = result.breakers.length;
        } catch (e) {
            // OpossumBridge might not expose getAll
            result.note = 'Circuit breaker introspection not available';
        }

        return result;
    }

    /**
     * Audit token budgets for SubAgents
     * @returns {Object} { agents }
     */
    auditTokenBudgets() {
        const result = { agents: [], totalBudget: 0, totalUsed: 0 };

        try {
            const AgentRegistry = require('../core/AgentRegistry');
            if (AgentRegistry.instance) {
                const agents = AgentRegistry.instance.listAgents ? AgentRegistry.instance.listAgents() : [];
                for (const agent of agents) {
                    result.agents.push({
                        id: agent.id,
                        type: agent.type || 'unknown',
                        tokenBudget: agent.tokenBudget || 0,
                        tokensUsed: agent.tokensUsed || 0,
                    });
                    result.totalBudget += agent.tokenBudget || 0;
                    result.totalUsed += agent.tokensUsed || 0;
                }
            }
        } catch (e) {
            result.note = 'Agent registry not available';
        }

        return result;
    }

    /**
     * v12.0: Audit AI-specific risks from scan history
     * Evaluates 4 dimensions, each 0-25 points
     * @returns {Object} { alignmentMirage, capabilityConcealment, agentAutonomyRisk, concentrationRisk, totalAIRisk, findings }
     */
    auditAIRisks() {
        const result = {
            alignmentMirage: 0,
            capabilityConcealment: 0,
            agentAutonomyRisk: 0,
            concentrationRisk: 0,
            totalAIRisk: 0,
            findings: [],
        };

        const history = this._scanHistory || [];
        if (history.length === 0) {
            result.findings.push('No scan history available for AI risk assessment');
            return result;
        }

        // Flatten all findings from scan history
        const allFindings = [];
        for (const scan of history) {
            const details = scan.details || scan;
            if (details.findings) {
                allFindings.push(...(Array.isArray(details.findings) ? details.findings : [details.findings]));
            }
            if (details.synthesis) allFindings.push(details.synthesis);
        }
        const corpus = allFindings.join(' ').toLowerCase();

        // Dimension 1: Alignment mirage (0-25)
        // Are there surface-level safety claims without substance?
        const safetyBuzzwords = (corpus.match(/\b(safe|safety|aligned|alignment|responsible|guardrail|harmless|helpful)\b/gi) || []).length;
        const safetyEvidence = (corpus.match(/\b(red.?team|eval|audit|interpretab|mechanistic|formal.?verif|proof)\b/gi) || []).length;
        const mirageRatio = safetyBuzzwords > 0 ? safetyEvidence / safetyBuzzwords : 1;
        result.alignmentMirage = Math.min(25, Math.round((1 - Math.min(1, mirageRatio)) * 25));
        if (result.alignmentMirage > 15) {
            result.findings.push(`Alignment mirage: ${safetyBuzzwords} safety claims vs ${safetyEvidence} evidence mentions`);
        }

        // Dimension 2: Capability concealment (0-25)
        // Sudden benchmark jumps or hidden capabilities
        const benchmarkMentions = (corpus.match(/\b(benchmark|mmlu|gpqa|swe.?bench|humaneval|arena|elo|score|sota)\b/gi) || []).length;
        const surpriseMentions = (corpus.match(/\b(surpris|unexpect|sudden|leap|jump|breakthrough|emergent)\b/gi) || []).length;
        result.capabilityConcealment = Math.min(25, Math.round(Math.min(1, surpriseMentions / Math.max(1, benchmarkMentions)) * 20 + (surpriseMentions > 5 ? 5 : 0)));
        if (result.capabilityConcealment > 12) {
            result.findings.push(`Capability concealment risk: ${surpriseMentions} surprise indicators in ${benchmarkMentions} benchmark discussions`);
        }

        // Dimension 3: Agent autonomy risk (0-25)
        // Agent ecosystem growth rate vs governance
        const agentMentions = (corpus.match(/\b(agent|autonom|auto.?gpt|crew.?ai|autogen|langchain|swarm|orchestrat|self.?play)\b/gi) || []).length;
        const governanceMentions = (corpus.match(/\b(govern|regulat|oversigh|control|supervis|monitor|audit|sandbox|guardrail)\b/gi) || []).length;
        const agentGovRatio = agentMentions > 0 ? governanceMentions / agentMentions : 1;
        result.agentAutonomyRisk = Math.min(25, Math.round((1 - Math.min(1, agentGovRatio * 2)) * 25));
        if (result.agentAutonomyRisk > 12) {
            result.findings.push(`Agent autonomy risk: ${agentMentions} agent mentions vs ${governanceMentions} governance mentions`);
        }

        // Dimension 4: Concentration risk (0-25)
        // Over-reliance on single provider/model
        const providers = {};
        const providerPatterns = {
            openai: /\b(openai|gpt.?4|gpt.?5|chatgpt|o[13])\b/gi,
            anthropic: /\b(anthropic|claude|sonnet|opus|haiku)\b/gi,
            google: /\b(google|gemini|deepmind|bard)\b/gi,
            meta: /\b(meta|llama|llama.?[234])\b/gi,
            deepseek: /\b(deepseek)\b/gi,
        };
        for (const [provider, pattern] of Object.entries(providerPatterns)) {
            providers[provider] = (corpus.match(pattern) || []).length;
        }
        const totalMentions = Object.values(providers).reduce((a, b) => a + b, 0);
        const maxProvider = Math.max(...Object.values(providers));
        const concentrationPct = totalMentions > 0 ? maxProvider / totalMentions : 0;
        result.concentrationRisk = Math.min(25, Math.round(concentrationPct * 25));
        if (result.concentrationRisk > 15) {
            const dominant = Object.entries(providers).sort((a, b) => b[1] - a[1])[0];
            result.findings.push(`Concentration risk: ${dominant[0]} dominates with ${(concentrationPct * 100).toFixed(0)}% of provider mentions`);
        }

        result.totalAIRisk = result.alignmentMirage + result.capabilityConcealment + result.agentAutonomyRisk + result.concentrationRisk;

        return result;
    }

    /**
     * Generate comprehensive audit report with risk score
     * v12.0: Integrates AI risk analysis (traditional*0.6 + aiRisk*0.4)
     * @returns {Object} Full audit report with risk score 0-100
     */
    async generateAuditReport() {
        const report = {
            timestamp: new Date().toISOString(),
            sandbox: this.auditSandboxDomains(),
            securityRules: this.auditSecurityRules(),
            circuitBreakers: this.auditCircuitBreakers(),
            tokenBudgets: this.auditTokenBudgets(),
            riskScore: 0,
            risks: [],
        };

        // Calculate traditional risk score (0-100)
        let traditionalRisk = 0;

        if (report.sandbox.wildcards > 3) {
            traditionalRisk += 10;
            report.risks.push('Too many wildcard domains in sandbox whitelist');
        }
        if (report.sandbox.suspicious.length > 5) {
            traditionalRisk += 15;
            report.risks.push(`${report.sandbox.suspicious.length} suspicious blocked requests detected`);
        }
        if (report.securityRules.levelStats.L3 < 3) {
            traditionalRisk += 20;
            report.risks.push('Insufficient L3 (high-risk) security rules');
        }
        if (report.securityRules.totalRules < 15) {
            traditionalRisk += 15;
            report.risks.push('Low security rule coverage');
        }
        const openBreakers = report.circuitBreakers.breakers.filter(b => b.state === 'open');
        if (openBreakers.length > 0) {
            traditionalRisk += 10 * openBreakers.length;
            report.risks.push(`${openBreakers.length} circuit breaker(s) in OPEN state`);
        }
        if (report.tokenBudgets.totalUsed > report.tokenBudgets.totalBudget * 0.9 && report.tokenBudgets.totalBudget > 0) {
            traditionalRisk += 15;
            report.risks.push('Token budget utilization > 90%');
        }
        traditionalRisk = Math.min(100, traditionalRisk);

        // v12.0: AI risk analysis
        if (this._aiRiskEnabled) {
            report.aiRisk = this.auditAIRisks();
            report.risks.push(...report.aiRisk.findings);
            // Weighted combination
            const aiRiskNormalized = (report.aiRisk.totalAIRisk / 100) * 100; // Scale 0-100 from 0-100
            report.riskScore = Math.min(100, Math.round(
                traditionalRisk * this._traditionalWeight + aiRiskNormalized * this._aiRiskWeight
            ));
        } else {
            report.riskScore = traditionalRisk;
        }

        report.traditionalRiskScore = traditionalRisk;

        this._saveReport(report);
        return report;
    }

    // --- Internal ---

    _saveReport(report) {
        try {
            this._writer.markDirty(JSON.stringify(report, null, 2));
        } catch (e) {
            console.warn('[SecurityAuditor] Save failed:', e.message);
        }
    }
}

module.exports = SecurityAuditor;
