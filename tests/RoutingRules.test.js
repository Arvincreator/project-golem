// tests/RoutingRules.test.js — v9.7 三腦路由規則驗證
const { ROUTING_RULES } = require('../src/core/monica-constants');

function matchRule(text) {
    for (const rule of ROUTING_RULES) {
        if (rule.patterns.test(text)) return rule;
    }
    return null;
}

describe('RoutingRules — 8 維度三腦分工', () => {
    test('has exactly 8 rules', () => {
        expect(ROUTING_RULES).toHaveLength(8);
    });

    test('rule order: realtime, refactor, code, reasoning, creative, fast, analysis, flexible', () => {
        const names = ROUTING_RULES.map(r => r.name);
        expect(names).toEqual(['realtime', 'refactor', 'code', 'reasoning', 'creative', 'fast', 'analysis', 'flexible']);
    });

    // --- Realtime → grok-4 ---
    test.each([
        'realtime data', '即時新聞', 'live streaming', 'trending topics', 'hotfix urgent',
        'websocket connection', '最新消息', '時事分析',
    ])('realtime: "%s" → grok-4', (input) => {
        const rule = matchRule(input);
        expect(rule).not.toBeNull();
        expect(rule.name).toBe('realtime');
        expect(rule.model).toBe('grok-4');
    });

    // --- Code → grok-4 ---
    test.each([
        '寫一段 Python 排序', 'debug this error', 'implement a function',
        'TypeError in module', 'npm install', 'javascript class',
    ])('code: "%s" → grok-4', (input) => {
        const rule = matchRule(input);
        expect(rule).not.toBeNull();
        expect(rule.name).toBe('code');
        expect(rule.model).toBe('grok-4');
    });

    // --- Refactor → claude-4.6-sonnet ---
    test.each([
        'refactor this module', '重構架構', 'redesign the API',
        'clean up code', 'simplify this', 'SOLID principles',
        'code review', 'pull request feedback',
    ])('refactor: "%s" → claude-4.6-sonnet', (input) => {
        const rule = matchRule(input);
        expect(rule).not.toBeNull();
        expect(rule.name).toBe('refactor');
        expect(rule.model).toBe('claude-4.6-sonnet');
    });

    // --- Reasoning → gpt-5.4 ---
    test.each([
        '3x² + 5x - 2 = 0', 'prove this theorem', '計算 ∑ 1/n²',
        '邏輯推理', 'solve algorithm',
    ])('reasoning: "%s" → gpt-5.4', (input) => {
        const rule = matchRule(input);
        expect(rule).not.toBeNull();
        expect(rule.name).toBe('reasoning');
        expect(rule.model).toBe('gpt-5.4');
    });

    // --- Creative → gpt-5.4 ---
    test.each([
        '寫一首關於春天的詩', 'write a story', 'creative writing',
        '文案設計', 'marketing blog',
    ])('creative: "%s" → gpt-5.4', (input) => {
        const rule = matchRule(input);
        expect(rule).not.toBeNull();
        expect(rule.name).toBe('creative');
        expect(rule.model).toBe('gpt-5.4');
    });

    // --- Fast → gpt-4.1-mini ---
    test.each([
        '翻譯: hello world', 'summarize this', '摘要', 'TL;DR', 'explain briefly',
    ])('fast: "%s" → gpt-4.1-mini', (input) => {
        const rule = matchRule(input);
        expect(rule).not.toBeNull();
        expect(rule.name).toBe('fast');
        expect(rule.model).toBe('gpt-4.1-mini');
    });

    // --- Analysis → claude-4.6-sonnet ---
    test.each([
        '分析這份報告的優缺點', 'research comparison', '評估策略', 'audit review',
    ])('analysis: "%s" → claude-4.6-sonnet', (input) => {
        const rule = matchRule(input);
        expect(rule).not.toBeNull();
        expect(rule.name).toBe('analysis');
        expect(rule.model).toBe('claude-4.6-sonnet');
    });

    // --- Flexible → gpt-4o ---
    test.each([
        '日常聊天', 'general chat', 'open source', 'conversation',
    ])('flexible: "%s" → gpt-4o', (input) => {
        const rule = matchRule(input);
        expect(rule).not.toBeNull();
        expect(rule.name).toBe('flexible');
        expect(rule.model).toBe('gpt-4o');
    });

    // --- Priority: refactor is NOT captured by code ---
    test('refactor keyword matches refactor rule, not code rule', () => {
        const rule = matchRule('refactor this module');
        expect(rule.name).toBe('refactor');
        expect(rule.model).toBe('claude-4.6-sonnet');
    });

    // --- Priority: realtime before code ---
    test('realtime keyword matches before code', () => {
        const rule = matchRule('realtime data processing');
        expect(rule.name).toBe('realtime');
    });

    // --- No match returns null ---
    test('unmatched text returns null', () => {
        const rule = matchRule('hello');
        expect(rule).toBeNull();
    });
});
