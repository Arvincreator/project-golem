// ============================================================
// SecurityAuditor — 全面安全 + Token + 風險審計
// v11.5: 沙盒域名, 安全規則, 熔斷器, Token 預算
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
     * Generate comprehensive audit report with risk score
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

        // Calculate risk score (0 = safe, 100 = critical)
        let riskPoints = 0;

        // Risk: Too many wildcards in sandbox
        if (report.sandbox.wildcards > 3) {
            riskPoints += 10;
            report.risks.push('Too many wildcard domains in sandbox whitelist');
        }

        // Risk: Suspicious blocked requests
        if (report.sandbox.suspicious.length > 5) {
            riskPoints += 15;
            report.risks.push(`${report.sandbox.suspicious.length} suspicious blocked requests detected`);
        }

        // Risk: Missing L3 rules
        if (report.securityRules.levelStats.L3 < 3) {
            riskPoints += 20;
            report.risks.push('Insufficient L3 (high-risk) security rules');
        }

        // Risk: Low total rule count
        if (report.securityRules.totalRules < 15) {
            riskPoints += 15;
            report.risks.push('Low security rule coverage');
        }

        // Risk: Open circuit breakers
        const openBreakers = report.circuitBreakers.breakers.filter(b => b.state === 'open');
        if (openBreakers.length > 0) {
            riskPoints += 10 * openBreakers.length;
            report.risks.push(`${openBreakers.length} circuit breaker(s) in OPEN state`);
        }

        // Risk: Token budget overuse
        if (report.tokenBudgets.totalUsed > report.tokenBudgets.totalBudget * 0.9 && report.tokenBudgets.totalBudget > 0) {
            riskPoints += 15;
            report.risks.push('Token budget utilization > 90%');
        }

        report.riskScore = Math.min(100, riskPoints);

        // Save report
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
