const PlanningIntentRouter = require('../src/core/PlanningIntentRouter');

describe('PlanningIntentRouter', () => {
    test('classifies short simple request as non-planning', () => {
        const router = new PlanningIntentRouter({ threshold: 5 });
        const result = router.evaluate({
            text: '幫我查一下今天台北天氣',
            hasAttachment: false,
        });

        expect(result.usePlanning).toBe(false);
        expect(result.score).toBeLessThan(5);
    });

    test('classifies complex multi-step request as planning', () => {
        const router = new PlanningIntentRouter({ threshold: 5 });
        const result = router.evaluate({
            text: [
                '請幫我規劃 project-golem 的多代理架構升級',
                '1. 先盤點現況與缺口',
                '2. 再提出 phase / milestone 落地計畫',
                '3. 最後補測試與回歸驗證',
            ].join('\n'),
            hasAttachment: false,
        });

        expect(result.usePlanning).toBe(true);
        expect(result.score).toBeGreaterThanOrEqual(5);
        expect(result.reason).toContain('explicit_planning_request');
    });

    test('attachment can tip borderline request into planning mode', () => {
        const router = new PlanningIntentRouter({ threshold: 3 });
        const result = router.evaluate({
            text: '請整合附件內容，做成可執行的 implementation 與 verification 計畫',
            hasAttachment: true,
        });

        expect(result.usePlanning).toBe(true);
        expect(result.signals.hasAttachment).toBe(true);
    });
});
