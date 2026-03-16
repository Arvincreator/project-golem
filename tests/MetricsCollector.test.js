const MetricsCollector = require('../src/core/MetricsCollector');
const fs = require('fs');

describe('MetricsCollector', () => {
    let mc;

    beforeEach(() => {
        mc = new MetricsCollector({ golemId: 'test', noAutoFlush: true });
    });

    afterAll(() => {
        try { fs.unlinkSync('golem_metrics.json'); } catch (_) {}
    });

    test('record increments counters', () => {
        mc.record('test_event', { value: 42 });
        mc.record('test_event', { value: 43 });
        const report = mc.generateReport();
        expect(report.counters.test_event).toBe(2);
    });

    test('record tracks histogram values', () => {
        mc.record('latency', { value: 100 });
        mc.record('latency', { value: 200 });
        mc.record('latency', { value: 150 });
        const stats = mc.getHistogramStats('latency');
        expect(stats.count).toBe(3);
        expect(stats.min).toBe(100);
        expect(stats.max).toBe(200);
        expect(stats.mean).toBe(150);
    });

    test('record tracks durationMs as histogram', () => {
        mc.record('step_success', { durationMs: 500 });
        mc.record('step_success', { durationMs: 600 });
        const stats = mc.getHistogramStats('step_success_latency');
        expect(stats).not.toBeNull();
        expect(stats.count).toBe(2);
    });

    test('gauge sets point-in-time value', () => {
        mc.gauge('memory_mb', 256);
        const report = mc.generateReport();
        expect(report.gauges.memory_mb.value).toBe(256);
    });

    test('increment adds to counter', () => {
        mc.increment('requests', 5);
        mc.increment('requests', 3);
        const report = mc.generateReport();
        expect(report.counters.requests).toBe(8);
    });

    test('getSuccessRate computes correctly', () => {
        mc.record('op_success');
        mc.record('op_success');
        mc.record('op_failure');
        const rate = mc.getSuccessRate('op_success', 'op_failure');
        expect(rate.rate).toBeCloseTo(0.667, 2);
        expect(rate.total).toBe(3);
    });

    test('generateReport includes all sections', () => {
        mc.record('test', { value: 1 });
        mc.gauge('g', 10);
        const report = mc.generateReport();
        expect(report.golemId).toBe('test');
        expect(report.counters).toBeDefined();
        expect(report.gauges).toBeDefined();
        expect(report.histograms).toBeDefined();
    });

    test('benchmark records success metrics', async () => {
        const result = await mc.benchmark('fetch', async () => 'data');
        expect(result).toBe('data');
        expect(mc.generateReport().counters.fetch_success).toBe(1);
    });

    test('benchmark records failure metrics', async () => {
        await expect(mc.benchmark('fetch', async () => { throw new Error('fail'); })).rejects.toThrow('fail');
        expect(mc.generateReport().counters.fetch_failure).toBe(1);
    });

    test('flush writes to disk', () => {
        mc.record('test', { value: 1 });
        mc.flush();
        expect(fs.existsSync('golem_metrics.json')).toBe(true);
    });

    test('reset clears all data', () => {
        mc.record('test');
        mc.gauge('g', 1);
        mc.reset();
        const report = mc.generateReport();
        expect(report.counters).toEqual({});
    });

    test('getRecentEvents returns limited events', () => {
        for (let i = 0; i < 30; i++) mc.record('bulk');
        expect(mc.getRecentEvents(5).length).toBe(5);
    });
});
