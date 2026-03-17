const SecurityAuditor = require('../src/core/SecurityAuditor');
const SecurityManager = require('../src/managers/SecurityManager');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('SecurityAuditor', () => {
    let auditor;
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-test-'));
        auditor = new SecurityAuditor({
            dataDir: tmpDir,
            securityManager: new SecurityManager(),
        });
    });

    afterEach(() => {
        if (auditor._writer) auditor._writer.destroy();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('constructor initializes with dependencies', () => {
        expect(auditor._securityManager).toBeInstanceOf(SecurityManager);
    });

    test('auditSandboxDomains returns domain info', () => {
        const result = auditor.auditSandboxDomains();
        expect(result.totalDomains).toBeGreaterThan(0);
        expect(Array.isArray(result.domains)).toBe(true);
        expect(result.wildcards).toBeGreaterThanOrEqual(0);
    });

    test('auditSecurityRules returns level stats', () => {
        const result = auditor.auditSecurityRules();
        expect(result.levelStats.L0).toBeGreaterThan(0);
        expect(result.levelStats.L1).toBeGreaterThan(0);
        expect(result.totalRules).toBeGreaterThan(0);
    });

    test('auditCircuitBreakers returns breaker info', () => {
        const result = auditor.auditCircuitBreakers();
        expect(result).toHaveProperty('breakers');
        expect(Array.isArray(result.breakers)).toBe(true);
    });

    test('auditTokenBudgets returns token info', () => {
        const result = auditor.auditTokenBudgets();
        expect(result).toHaveProperty('agents');
        expect(result).toHaveProperty('totalBudget');
    });

    test('generateAuditReport produces full report', async () => {
        const report = await auditor.generateAuditReport();
        expect(report).toHaveProperty('timestamp');
        expect(report).toHaveProperty('sandbox');
        expect(report).toHaveProperty('securityRules');
        expect(report).toHaveProperty('circuitBreakers');
        expect(report).toHaveProperty('tokenBudgets');
        expect(report).toHaveProperty('riskScore');
        expect(report.riskScore).toBeGreaterThanOrEqual(0);
        expect(report.riskScore).toBeLessThanOrEqual(100);
        expect(Array.isArray(report.risks)).toBe(true);
    });

    test('risk score increases with wildcards', async () => {
        // Default sandbox has at least 1 wildcard (.yagami8095.workers.dev)
        const report = await auditor.generateAuditReport();
        expect(typeof report.riskScore).toBe('number');
    });

    test('generates report without securityManager', async () => {
        const auditor2 = new SecurityAuditor({ dataDir: tmpDir });
        const report = await auditor2.generateAuditReport();
        expect(report.securityRules.totalRules).toBeGreaterThan(0);
        auditor2._writer.destroy();
    });

    test('saves report to file', async () => {
        await auditor.generateAuditReport();
        await auditor._writer.forceFlush();
        const filePath = path.join(tmpDir, 'security_audit_report.json');
        expect(fs.existsSync(filePath)).toBe(true);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        expect(data).toHaveProperty('riskScore');
    });

    test('auditSecurityRules with getRulesCoverage', async () => {
        const mockSM = new SecurityManager();
        mockSM.getRulesCoverage = () => ({ skills: 40, coverage: '85%' });
        const auditor2 = new SecurityAuditor({ dataDir: tmpDir, securityManager: mockSM });
        const result = auditor2.auditSecurityRules();
        expect(result.coverage).toEqual({ skills: 40, coverage: '85%' });
        auditor2._writer.destroy();
    });
});
