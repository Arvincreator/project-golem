const { GolemConfigLoader } = require('../src/config/xml-config-loader');
const path = require('path');

describe('XML Config v2.1 — v12.0 getters', () => {
    let loader;

    beforeAll(() => {
        loader = new GolemConfigLoader(path.join(__dirname, '..', 'golem-config.xml'));
        loader.load();
    });

    test('config version is 2.1', () => {
        expect(loader.config['@_version']).toBe(2.1);
    });

    test('getErrorPatternLearnerConfig returns defaults', () => {
        const cfg = loader.getErrorPatternLearnerConfig();
        expect(cfg.maxPatterns).toBe(200);
        expect(cfg.dedupThreshold).toBe(0.8);
        expect(cfg.retentionDays).toBe(90);
        expect(cfg.autoSuggest).toBe(true);
    });

    test('getScanQualityTrackerConfig returns defaults', () => {
        const cfg = loader.getScanQualityTrackerConfig();
        expect(cfg.maxRecords).toBe(500);
        expect(cfg.worthlessThreshold).toBe(3);
        expect(cfg.autoSkip).toBe(true);
        expect(cfg.minEffectiveness).toBe(0.1);
    });

    test('getWorkerHealthAuditorConfig returns defaults', () => {
        const cfg = loader.getWorkerHealthAuditorConfig();
        expect(cfg.timeoutMs).toBe(5000);
        expect(cfg.maxConsecutiveFailures).toBe(3);
        expect(cfg.checkIntervalMin).toBe(30);
        expect(cfg.maxHistory).toBe(200);
    });

    test('getSecurityAuditorConfig returns defaults', () => {
        const cfg = loader.getSecurityAuditorConfig();
        expect(cfg.aiRiskChecks).toBe(true);
        expect(cfg.traditionalWeight).toBe(0.6);
        expect(cfg.aiRiskWeight).toBe(0.4);
    });

    test('getRAGQualityMonitorConfig returns defaults', () => {
        const cfg = loader.getRAGQualityMonitorConfig();
        expect(cfg.testQueryCount).toBe(10);
        expect(cfg.minRecall).toBe(0.3);
        expect(cfg.latencyWarnMs).toBe(500);
    });

    test('getDebateQualityTrackerConfig returns defaults', () => {
        const cfg = loader.getDebateQualityTrackerConfig();
        expect(cfg.maxHistory).toBe(100);
        expect(cfg.diversityWeight).toBe(0.3);
        expect(cfg.differentiationWeight).toBe(0.4);
        expect(cfg.coverageWeight).toBe(0.3);
    });

    test('getAutonomySchedulerConfig returns defaults', () => {
        const cfg = loader.getAutonomySchedulerConfig();
        expect(cfg.scanIntervalMin).toBe(120);
        expect(cfg.debateIntervalMin).toBe(180);
        expect(cfg.optimizeIntervalMin).toBe(60);
        expect(cfg.rssHealThresholdMb).toBe(350);
        expect(cfg.workerCheckIntervalMin).toBe(30);
        expect(cfg.securityAuditIntervalMin).toBe(360);
        expect(cfg.yerenSyncIntervalMin).toBe(60);
    });

    test('getTokenTrackingConfig returns defaults', () => {
        const cfg = loader.getTokenTrackingConfig();
        expect(cfg.enabled).toBe(true);
        expect(cfg.budgetDaily).toBe(50000);
        expect(cfg.persistIntervalMs).toBe(5000);
        expect(cfg.warnThresholdPct).toBe(80);
    });
});
