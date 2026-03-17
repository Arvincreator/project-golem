const SecurityAuditor = require('../src/core/SecurityAuditor');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('SecurityAuditor — AI Risk Analysis (v12.0)', () => {
    let auditor;
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airis-'));
        auditor = new SecurityAuditor({
            dataDir: tmpDir,
            aiRiskEnabled: true,
            scanHistory: [
                {
                    details: {
                        synthesis: 'OpenAI released GPT-5 with safety alignment claims. Claude and Gemini competing. New agent frameworks AutoGen and CrewAI launched. Benchmark scores jumped unexpectedly on MMLU. Governance discussions ongoing.',
                        findings: [
                            'AI safety reports show alignment progress but lack formal verification',
                            'Agent ecosystem growing rapidly with minimal oversight regulation',
                            'OpenAI dominates market with 60% market share',
                        ]
                    }
                }
            ],
        });
    });

    afterEach(() => {
        if (auditor._writer) auditor._writer.destroy();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('auditAIRisks returns 4 dimensions', () => {
        const result = auditor.auditAIRisks();
        expect(result).toHaveProperty('alignmentMirage');
        expect(result).toHaveProperty('capabilityConcealment');
        expect(result).toHaveProperty('agentAutonomyRisk');
        expect(result).toHaveProperty('concentrationRisk');
        expect(result.totalAIRisk).toBe(
            result.alignmentMirage + result.capabilityConcealment +
            result.agentAutonomyRisk + result.concentrationRisk
        );
    });

    test('each dimension is capped at 25', () => {
        const result = auditor.auditAIRisks();
        expect(result.alignmentMirage).toBeLessThanOrEqual(25);
        expect(result.capabilityConcealment).toBeLessThanOrEqual(25);
        expect(result.agentAutonomyRisk).toBeLessThanOrEqual(25);
        expect(result.concentrationRisk).toBeLessThanOrEqual(25);
    });

    test('empty scan history returns zero risks', () => {
        const emptyAuditor = new SecurityAuditor({ dataDir: tmpDir, scanHistory: [] });
        const result = emptyAuditor.auditAIRisks();
        expect(result.totalAIRisk).toBe(0);
        expect(result.findings).toContain('No scan history available for AI risk assessment');
        if (emptyAuditor._writer) emptyAuditor._writer.destroy();
    });

    test('generateAuditReport integrates AI risk when enabled', async () => {
        const report = await auditor.generateAuditReport();
        expect(report).toHaveProperty('aiRisk');
        expect(report.aiRisk).toHaveProperty('totalAIRisk');
        expect(report).toHaveProperty('traditionalRiskScore');
        expect(report.riskScore).toBeGreaterThanOrEqual(0);
        expect(report.riskScore).toBeLessThanOrEqual(100);
    });

    test('generateAuditReport without AI risk when disabled', async () => {
        const noAI = new SecurityAuditor({
            dataDir: tmpDir,
            aiRiskEnabled: false,
            scanHistory: [{ details: { synthesis: 'test' } }],
        });
        const report = await noAI.generateAuditReport();
        expect(report.aiRisk).toBeUndefined();
        if (noAI._writer) noAI._writer.destroy();
    });

    test('weighted combination formula works correctly', async () => {
        const report = await auditor.generateAuditReport();
        // riskScore should be weighted: traditional*0.6 + aiRisk*0.4
        const expected = Math.min(100, Math.round(
            report.traditionalRiskScore * 0.6 + (report.aiRisk.totalAIRisk / 100) * 100 * 0.4
        ));
        expect(report.riskScore).toBe(expected);
    });

    test('concentration risk detects dominant provider', () => {
        const heavy = new SecurityAuditor({
            dataDir: tmpDir,
            scanHistory: [{ details: { synthesis: 'OpenAI GPT-5 GPT-4o ChatGPT o1 o3 OpenAI OpenAI OpenAI Claude Gemini' } }],
        });
        const result = heavy.auditAIRisks();
        expect(result.concentrationRisk).toBeGreaterThan(0);
        if (heavy._writer) heavy._writer.destroy();
    });

    test('findings array contains descriptive strings', () => {
        const result = auditor.auditAIRisks();
        for (const f of result.findings) {
            expect(typeof f).toBe('string');
            expect(f.length).toBeGreaterThan(10);
        }
    });
});
