const WorkerHealthAuditor = require('../src/core/WorkerHealthAuditor');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('WorkerHealthAuditor', () => {
    let auditor;
    let tmpDir;
    let originalFetch;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wha-test-'));
        originalFetch = globalThis.fetch;
        // Mock fetch for testing
        globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
        auditor = new WorkerHealthAuditor({
            dataDir: tmpDir,
            workers: [{ name: 'test-worker', url: 'https://test.workers.dev' }],
            timeoutMs: 1000,
        });
    });

    afterEach(() => {
        if (auditor._writer) auditor._writer.destroy();
        globalThis.fetch = originalFetch;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('constructor initializes empty history', () => {
        expect(auditor.getHistory()).toEqual([]);
        expect(auditor.getStats().totalAudits).toBe(0);
    });

    test('getWorkerList returns known + custom workers', () => {
        const list = auditor.getWorkerList();
        expect(list.length).toBeGreaterThan(0);
        expect(list.some(w => w.name === 'test-worker')).toBe(true);
    });

    test('auditAll checks all workers', async () => {
        const result = await auditor.auditAll();
        expect(result.summary.total).toBeGreaterThan(0);
        expect(result.summary.healthy).toBe(result.summary.total);
        expect(result.workers.length).toBe(result.summary.total);
    });

    test('auditAll tracks unhealthy workers', async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
        const result = await auditor.auditAll();
        expect(result.summary.unhealthy).toBe(result.summary.total);
    });

    test('auditAll handles fetch errors gracefully', async () => {
        globalThis.fetch = jest.fn().mockRejectedValue(new Error('network error'));
        const result = await auditor.auditAll();
        expect(result.workers.every(w => w.status === 'unreachable')).toBe(true);
    });

    test('auditAll records latency', async () => {
        const result = await auditor.auditAll();
        for (const w of result.workers) {
            expect(w.latencyMs).toBeGreaterThanOrEqual(0);
        }
    });

    test('consecutive failures tracked correctly', async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
        await auditor.auditAll();
        await auditor.auditAll();
        await auditor.auditAll();
        const recs = auditor.getRecommendations();
        expect(recs.length).toBeGreaterThan(0);
        expect(recs[0].consecutiveFails).toBeGreaterThanOrEqual(3);
    });

    test('consecutive failures reset on success', async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
        await auditor.auditAll();
        await auditor.auditAll();
        globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
        await auditor.auditAll();
        const recs = auditor.getRecommendations();
        expect(recs.length).toBe(0);
    });

    test('getRecommendations suggests redeploy after threshold', async () => {
        globalThis.fetch = jest.fn().mockRejectedValue(new Error('down'));
        await auditor.auditAll();
        await auditor.auditAll();
        await auditor.auditAll();
        const recs = auditor.getRecommendations();
        expect(recs.length).toBeGreaterThan(0);
        expect(recs[0].recommendation).toContain('redeploying');
    });

    test('history capped at MAX_HISTORY', async () => {
        for (let i = 0; i < 210; i++) {
            auditor._history.push({ timestamp: new Date().toISOString(), total: 1, healthy: 1, unhealthy: 0 });
        }
        auditor._history = auditor._history.slice(-200);
        expect(auditor._history.length).toBeLessThanOrEqual(200);
    });

    test('getStats returns last audit info', async () => {
        await auditor.auditAll();
        const stats = auditor.getStats();
        expect(stats.totalAudits).toBe(1);
        expect(stats.lastAudit).toBeTruthy();
    });

    test('_buildHealthUrl handles various URL formats', () => {
        expect(auditor._buildHealthUrl('https://example.com')).toBe('https://example.com/health');
        expect(auditor._buildHealthUrl('https://example.com/')).toBe('https://example.com/health');
        expect(auditor._buildHealthUrl('example.workers.dev')).toBe('https://example.workers.dev/health');
        expect(auditor._buildHealthUrl('')).toBe('');
    });

    test('persistence: load from file', async () => {
        await auditor.auditAll();
        await auditor._writer.forceFlush();

        const auditor2 = new WorkerHealthAuditor({ dataDir: tmpDir });
        expect(auditor2.getHistory().length).toBe(1);
        auditor2._writer.destroy();
    });
});
