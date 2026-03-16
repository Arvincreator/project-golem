// tests/SmartLLMSwitch.test.js — v9.7 Smart LLM Switch 測試
const fs = require('fs');
const path = require('path');

const smartSwitch = require('../src/skills/core/smart-llm-switch');
const { _classify, _scoreResponse, _selectModel, _loadHistory, _saveHistory, _HISTORY_FILE } = smartSwitch;

// Clean up test file
afterEach(() => {
    try { if (fs.existsSync(_HISTORY_FILE)) fs.unlinkSync(_HISTORY_FILE); } catch (e) {}
});

describe('SmartLLMSwitch — classify', () => {
    test('code → grok-4', () => {
        const r = _classify('寫一段 Python 排序');
        expect(r.category).toBe('code');
        expect(r.defaultModel).toBe('grok-4');
    });

    test('reasoning → gpt-5.4', () => {
        const r = _classify('3x² + 5x - 2 = 0');
        expect(r.category).toBe('reasoning');
        expect(r.defaultModel).toBe('gpt-5.4');
    });

    test('analysis → claude-4.6-sonnet', () => {
        const r = _classify('分析這份報告');
        expect(r.category).toBe('analysis');
        expect(r.defaultModel).toBe('claude-4.6-sonnet');
    });

    test('realtime → grok-4', () => {
        const r = _classify('即時新聞');
        expect(r.category).toBe('realtime');
        expect(r.defaultModel).toBe('grok-4');
    });

    test('refactor → claude-4.6-sonnet', () => {
        const r = _classify('refactor 重構');
        expect(r.category).toBe('refactor');
        expect(r.defaultModel).toBe('claude-4.6-sonnet');
    });

    test('unmatched → general/gpt-4o', () => {
        const r = _classify('hello there');
        expect(r.category).toBe('general');
        expect(r.defaultModel).toBe('gpt-4o');
    });
});

describe('SmartLLMSwitch — scoreResponse', () => {
    test('empty/short response → score 1', () => {
        expect(_scoreResponse('')).toBe(1);
        expect(_scoreResponse('ok')).toBe(1);
    });

    test('error response → score 2', () => {
        expect(_scoreResponse("I'm sorry, I can't help with that request.")).toBe(2);
    });

    test('normal response → score 4', () => {
        expect(_scoreResponse('Here is a detailed explanation of the topic that covers multiple aspects.')).toBe(4);
    });

    test('long response → score 5', () => {
        const long = 'x'.repeat(6000);
        expect(_scoreResponse(long)).toBe(5);
    });
});

describe('SmartLLMSwitch — selectModel', () => {
    test('rule-based when no history', () => {
        const history = { records: [], model_stats: {}, exploration_rate: 0 };
        const result = _selectModel('code', 'grok-4', history);
        expect(result.model).toBe('grok-4');
        expect(result.reason).toBe('rule-based');
    });

    test('uses history winner when sufficient samples', () => {
        const history = {
            records: [],
            model_stats: {
                'gpt-5.4': { code: { wins: 9, total: 12 } },
            },
            exploration_rate: 0,
        };
        const result = _selectModel('code', 'grok-4', history);
        expect(result.model).toBe('gpt-5.4');
        expect(result.reason).toContain('history');
    });

    test('ignores history with insufficient samples', () => {
        const history = {
            records: [],
            model_stats: {
                'gpt-5.4': { code: { wins: 3, total: 5 } },
            },
            exploration_rate: 0,
        };
        const result = _selectModel('code', 'grok-4', history);
        expect(result.model).toBe('grok-4');
    });

    test('A/B exploration at 100% rate always explores', () => {
        const history = { records: [], model_stats: {}, exploration_rate: 1.0 };
        const result = _selectModel('code', 'grok-4', history);
        expect(result.reason).toBe('exploration');
        expect(result.explored).toBe(true);
        expect(['gpt-5.4', 'grok-4', 'claude-4.6-sonnet']).toContain(result.model);
    });

    test('exploration rate ~10% over 1000 trials', () => {
        const history = { records: [], model_stats: {}, exploration_rate: 0.10 };
        let explorations = 0;
        for (let i = 0; i < 1000; i++) {
            const r = _selectModel('code', 'grok-4', history);
            if (r.explored) explorations++;
        }
        // Should be roughly 100 ± 50
        expect(explorations).toBeGreaterThan(50);
        expect(explorations).toBeLessThan(180);
    });
});

describe('SmartLLMSwitch — history persistence', () => {
    test('save and load history', () => {
        const data = {
            records: [{ timestamp: '2026-03-16T00:00:00Z', category: 'code', model: 'grok-4' }],
            model_stats: { 'grok-4': { code: { wins: 1, total: 1 } } },
            exploration_rate: 0.10,
        };
        _saveHistory(data);
        const loaded = _loadHistory();
        expect(loaded.records).toHaveLength(1);
        expect(loaded.model_stats['grok-4'].code.wins).toBe(1);
    });

    test('trims records to 500', () => {
        const data = {
            records: Array.from({ length: 600 }, (_, i) => ({ i })),
            model_stats: {},
            exploration_rate: 0.10,
        };
        _saveHistory(data);
        const loaded = _loadHistory();
        expect(loaded.records).toHaveLength(500);
    });
});

describe('SmartLLMSwitch — execute', () => {
    test('smart-switch sets override on context', async () => {
        const context = { _forceOverride: null, _routingHistory: [] };
        const result = await smartSwitch.execute(
            { action: 'smart-switch', text: '寫一段 Python code' },
            context
        );
        expect(result).toContain('Smart LLM Switch');
        expect(result).toContain('code');
        expect(context._forceOverride).not.toBeNull();
        expect(context._forceOverride.model).toBeDefined();
    });

    test('status returns matrix', async () => {
        const result = await smartSwitch.execute({ task: 'status' });
        expect(result).toContain('三腦勝率矩陣');
    });

    test('history returns records', async () => {
        const result = await smartSwitch.execute({ task: 'history' });
        expect(result).toContain('尚無決策紀錄');
    });

    test('report returns brain analysis', async () => {
        const result = await smartSwitch.execute({ task: 'report' });
        expect(result).toContain('三腦勝率報告');
    });

    test('reset clears history', async () => {
        _saveHistory({ records: [{ test: true }], model_stats: { x: 1 }, exploration_rate: 0.10 });
        const result = await smartSwitch.execute({ task: 'reset' });
        expect(result).toContain('已清除');
        const loaded = _loadHistory();
        expect(loaded.records).toHaveLength(0);
    });
});
