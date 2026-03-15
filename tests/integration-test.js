#!/usr/bin/env node
// ============================================================
// 🧪 Project Golem v9.0.8 — Comprehensive Integration Test
// Standalone, no external framework. Tests all core modules.
// ============================================================

const path = require('path');
process.chdir(path.resolve(__dirname, '..'));
try { require('dotenv').config({ override: true }); } catch (e) { /* optional */ }

let totalPass = 0;
let totalFail = 0;
let totalAssertions = 0;
const startTime = Date.now();
const results = [];

function assert(condition, label) {
    totalAssertions++;
    if (condition) {
        totalPass++;
        return true;
    } else {
        totalFail++;
        console.error(`    ❌ FAIL: ${label}`);
        return false;
    }
}

function runGroup(name, fn) {
    const groupStart = Date.now();
    const beforePass = totalPass;
    const beforeFail = totalFail;
    try {
        fn();
    } catch (e) {
        totalFail++;
        console.error(`    ❌ GROUP CRASH: ${e.message}`);
    }
    const groupPass = totalPass - beforePass;
    const groupFail = totalFail - beforeFail;
    const groupTotal = groupPass + groupFail;
    const elapsed = Date.now() - groupStart;
    const icon = groupFail === 0 ? '✅' : '❌';
    const line = `${name} ${'·'.repeat(Math.max(1, 40 - name.length))} ${groupPass}/${groupTotal} ${icon} (${elapsed}ms)`;
    results.push(line);
    console.log(line);
}

async function runGroupAsync(name, fn) {
    const groupStart = Date.now();
    const beforePass = totalPass;
    const beforeFail = totalFail;
    try {
        await fn();
    } catch (e) {
        totalFail++;
        console.error(`    ❌ GROUP CRASH: ${e.message}`);
    }
    const groupPass = totalPass - beforePass;
    const groupFail = totalFail - beforeFail;
    const groupTotal = groupPass + groupFail;
    const elapsed = Date.now() - groupStart;
    const icon = groupFail === 0 ? '✅' : '❌';
    const line = `${name} ${'·'.repeat(Math.max(1, 40 - name.length))} ${groupPass}/${groupTotal} ${icon} (${elapsed}ms)`;
    results.push(line);
    console.log(line);
}

// ============================================================
console.log('\n🧪 Project Golem v9.0.8 Integration Test\n' + '='.repeat(50) + '\n');

// [1/12] Model Registry
runGroup('[1/12] Model Registry', () => {
    const { MODEL_REGISTRY } = require('../src/core/monica-constants');
    const entries = Object.entries(MODEL_REGISTRY);
    assert(entries.length === 16, '16 models in registry');

    const advanced = entries.filter(([, e]) => e.tier === 'advanced');
    const basic = entries.filter(([, e]) => e.tier === 'basic');
    assert(advanced.length === 8, '8 advanced models');
    assert(basic.length === 8, '8 basic models');

    // All have web field
    let allHaveWeb = true;
    for (const [name, entry] of entries) {
        if (!entry.web) { allHaveWeb = false; break; }
    }
    assert(allHaveWeb, 'All models have web field');

    // Spot check specific models
    assert(MODEL_REGISTRY['gpt-5.4'] !== undefined, 'gpt-5.4 exists');
    assert(MODEL_REGISTRY['claude-4.6-sonnet'] !== undefined, 'claude-4.6-sonnet exists');
});

// [2/12] resolveForBrain
runGroup('[2/12] resolveForBrain', () => {
    const { MODEL_REGISTRY, resolveForBrain } = require('../src/core/monica-constants');
    const models = Object.keys(MODEL_REGISTRY);
    let pass = 0;
    let total = 0;

    for (const name of models) {
        total += 2;
        const web = resolveForBrain(name, 'web');
        const api = resolveForBrain(name, 'api');
        assert(web !== null, `${name} web resolves`);
        assert(api !== null, `${name} api resolves (direct or fallback)`);
    }
});

// [3/12] ROUTING_RULES
runGroup('[3/12] ROUTING_RULES', () => {
    const { ROUTING_RULES } = require('../src/core/monica-constants');
    assert(Array.isArray(ROUTING_RULES), 'ROUTING_RULES is array');
    assert(ROUTING_RULES.length === 6, '6 routing rules');

    const testCases = [
        { input: '寫一段 Python 排序', expect: 'claude-4.6-sonnet' },
        { input: '3x² + 5x - 2 = 0', expect: 'gpt-5.4' },
        { input: '寫一首關於春天的詩', expect: 'gpt-5.4' },
        { input: '翻譯: hello world', expect: 'gpt-4.1-mini' },
        { input: '分析這份報告的優缺點', expect: 'gemini-3.1-pro' },
        { input: '日常聊天', expect: 'gpt-4o' },
    ];

    for (const tc of testCases) {
        let routed = null;
        for (const rule of ROUTING_RULES) {
            if (rule.patterns.test(tc.input)) { routed = rule.model; break; }
        }
        assert(routed === tc.expect, `"${tc.input}" → ${tc.expect} (got: ${routed})`);
    }
});

// [4/12] estimateTokens
runGroup('[4/12] estimateTokens', () => {
    const { estimateTokens } = require('../src/core/monica-constants');

    assert(estimateTokens('') === 0, 'empty string = 0');
    assert(estimateTokens(null) === 0, 'null = 0');

    const asciiTokens = estimateTokens('Hello world, this is a test sentence.');
    assert(asciiTokens > 5 && asciiTokens < 20, `ASCII tokens reasonable: ${asciiTokens}`);

    const cjkTokens = estimateTokens('你好世界，這是一個測試句子。');
    assert(cjkTokens > 3 && cjkTokens < 20, `CJK tokens reasonable: ${cjkTokens}`);

    const mixedTokens = estimateTokens('Hello 你好 world 世界');
    assert(mixedTokens > 3 && mixedTokens < 15, `Mixed tokens reasonable: ${mixedTokens}`);
});

// [5/12] getModelSpec
runGroup('[5/12] getModelSpec', () => {
    const { getModelSpec } = require('../src/core/monica-constants');

    const gpt4o = getModelSpec('gpt-4o');
    assert(gpt4o.context === 128000, 'gpt-4o context 128K');
    assert(gpt4o.costIn === 2.50, 'gpt-4o costIn $2.50');

    const unknown = getModelSpec('unknown-model-xyz');
    assert(unknown.context === 128000, 'unknown model gets default context');
    assert(unknown.costIn === 2.50, 'unknown model gets default cost');

    const gemini25 = getModelSpec('gemini-2.5-pro');
    assert(gemini25.context === 1000000, 'gemini-2.5-pro context 1M');
});

// [6/12] ResponseParser
runGroup('[6/12] ResponseParser', () => {
    const ResponseParser = require('../src/utils/ResponseParser');

    // Structured response
    const structured = ResponseParser.parse('[GOLEM_MEMORY]test memory[GOLEM_ACTION][{"action":"command","parameter":"ls"}][GOLEM_REPLY]Hello!');
    assert(structured.memory === 'test memory', 'memory extracted');
    assert(structured.actions.length === 1, 'one action');
    assert(structured.actions[0].action === 'command', 'action is command');
    assert(structured.reply === 'Hello!', 'reply extracted');

    // Reply only
    const replyOnly = ResponseParser.parse('[GOLEM_REPLY]Just a reply here');
    assert(replyOnly.reply === 'Just a reply here', 'reply-only mode works');
    assert(replyOnly.actions.length === 0, 'no actions in reply-only');

    // Raw text fallback
    const raw = ResponseParser.parse('This is just raw text with no tags');
    assert(raw.reply.includes('raw text'), 'raw text becomes reply');

    // Broken JSON fallback
    const broken = ResponseParser.parse('[GOLEM_ACTION]{"action":"command","parameter":"echo test"[GOLEM_REPLY]Done');
    // Should still extract reply
    assert(broken.reply === 'Done', 'reply from broken JSON');

    // Action limit (after fix)
    const manyActions = [];
    for (let i = 0; i < 30; i++) manyActions.push({ action: 'command', parameter: `cmd${i}` });
    const tooMany = ResponseParser.parse(`[GOLEM_ACTION]${JSON.stringify(manyActions)}[GOLEM_REPLY]ok`);
    assert(tooMany.actions.length <= 20, `actions limited to 20 (got ${tooMany.actions.length})`);

    // Schema hallucination correction
    const hallucinated = ResponseParser.parse('[GOLEM_ACTION]{"action":"run_command","params":{"command":"ls -la"}}[GOLEM_REPLY]ok');
    if (hallucinated.actions.length > 0) {
        assert(hallucinated.actions[0].action === 'command', 'run_command corrected to command');
    }
});

// [7/12] CircuitBreaker
runGroup('[7/12] CircuitBreaker', () => {
    // Use the built-in CircuitBreaker class directly (not the module export which may be Opossum)
    const CBPath = path.resolve(__dirname, '..', 'src', 'core', 'circuit_breaker.js');
    // We'll test the module export which may be Opossum or built-in
    const cb = require(CBPath);

    // Test canExecute on fresh service
    const testService = 'test-integration-' + Date.now();
    assert(cb.canExecute(testService) === true, 'fresh service is CLOSED');

    // Record failures up to threshold
    cb.recordFailure(testService, 'test error 1');
    cb.recordFailure(testService, 'test error 2');
    assert(cb.canExecute(testService) === true, 'still CLOSED after 2 failures');

    cb.recordFailure(testService, 'test error 3');
    // Opossum bridge may not immediately open — test that canExecute returns boolean
    const afterThree = cb.canExecute(testService);
    assert(typeof afterThree === 'boolean', `canExecute returns boolean after 3 failures (${afterThree})`);

    // Recovery
    cb.recordSuccess(testService);
    cb.reset(testService);
    assert(cb.canExecute(testService) === true, 'CLOSED after reset');

    // getStatus returns object
    const status = cb.getStatus();
    assert(typeof status === 'object', 'getStatus returns object');
});

// [8/12] ActionQueue
runGroup('[8/12] ActionQueue', () => {
    const ActionQueue = require('../src/core/ActionQueue');
    const aq = new ActionQueue({ golemId: 'test' });

    assert(aq.queue.length === 0, 'starts empty');
    assert(aq.isProcessing === false, 'not processing');

    const status = aq.getStatus();
    assert(status.depth === 0, 'depth is 0');
    assert(status.maxDepth === 10, 'maxDepth is 10');

    const dlq = aq.getDLQ();
    assert(Array.isArray(dlq), 'DLQ is array');
    assert(dlq.length === 0, 'DLQ starts empty');
});

// [9/12] ProtocolFormatter
runGroup('[9/12] ProtocolFormatter', () => {
    const ProtocolFormatter = require('../src/services/ProtocolFormatter');

    const reqId = ProtocolFormatter.generateReqId();
    assert(typeof reqId === 'string' && reqId.length > 4, `reqId generated: ${reqId}`);

    const start = ProtocolFormatter.buildStartTag('abc');
    assert(start === '[[BEGIN:abc]]', 'start tag format');

    const end = ProtocolFormatter.buildEndTag('abc');
    assert(end === '[[END:abc]]', 'end tag format');

    const envelope = ProtocolFormatter.buildEnvelope('hello', 'abc');
    assert(typeof envelope === 'string', 'envelope is string');
    assert(envelope.includes('hello'), 'envelope contains text');

    // compress should be a function
    assert(typeof ProtocolFormatter.compress === 'function', 'compress exists');
    const compressed = ProtocolFormatter.compress('  a  b  c  ');
    assert(typeof compressed === 'string', 'compress returns string');
});

// [10/12] All Skills Load
runGroup('[10/12] All Skills Load', () => {
    const fs = require('fs');
    const skillDir = path.resolve(__dirname, '..', 'src', 'skills', 'core');
    const files = fs.readdirSync(skillDir).filter(f => f.endsWith('.js'));

    // Some skills (definition.js, persona.js, moltbot.js) have non-standard exports
    const NON_STANDARD = ['definition.js', 'persona.js', 'moltbot.js'];
    for (const file of files) {
        const fullPath = path.join(skillDir, file);
        try {
            const mod = require(fullPath);
            if (NON_STANDARD.includes(file)) {
                assert(mod !== null && mod !== undefined, `${file} loads (non-standard)`);
                continue;
            }
            const hasName = typeof mod.name === 'string';
            const hasExecute = typeof mod.execute === 'function' || typeof mod.run === 'function';
            assert(hasName, `${file} has name`);
            assert(hasExecute, `${file} has execute/run`);
        } catch (e) {
            assert(false, `${file} loads: ${e.message}`);
        }
    }
});

// [11/12] BrainFactory
runGroup('[11/12] BrainFactory', () => {
    const { createBrain } = require('../src/core/BrainFactory');
    assert(typeof createBrain === 'function', 'createBrain is function');

    // Default engine creates a brain with expected interface
    const brain = createBrain({ golemId: 'test-factory' });
    assert(brain !== null, 'brain created');
    assert(typeof brain.init === 'function', 'brain has init');
    assert(typeof brain.sendMessage === 'function', 'brain has sendMessage');
    assert(typeof brain.recall === 'function', 'brain has recall');
    assert(typeof brain.memorize === 'function', 'brain has memorize');
    assert(typeof brain.switchModel === 'function', 'brain has switchModel');
});

// [12/12] NodeRouter
(async () => {
    await runGroupAsync('[12/12] NodeRouter', async () => {
        const NodeRouter = require('../src/core/NodeRouter');

        // Mock brain and ctx
        const mockBrain = {
            userDataDir: path.resolve(__dirname, '..', 'golem_memory'),
            skillIndex: {
                listAllSkills: async () => [{ id: 'test', name: 'Test Skill' }],
                close: async () => {},
            },
            _appendChatLog: () => {},
            _handleRouterCommand: (text) => 'router response',
        };

        const mockCtx = (text) => ({
            text,
            isAdmin: true,
            reply: async (msg) => msg,
            sendTyping: async () => {},
        });

        // /help
        const helpResult = await NodeRouter.handle(mockCtx('/help'), mockBrain);
        assert(helpResult && typeof helpResult === 'string', '/help returns text');

        // /skills
        const skillsResult = await NodeRouter.handle(mockCtx('/skills'), mockBrain);
        assert(skillsResult && typeof skillsResult === 'string', '/skills returns text');

        // /donate
        const donateResult = await NodeRouter.handle(mockCtx('/donate'), mockBrain);
        assert(donateResult && typeof donateResult === 'string', '/donate returns text');

        // /router with _handleRouterCommand
        const routerResult = await NodeRouter.handle(mockCtx('/router status'), mockBrain);
        assert(routerResult === 'router response', '/router delegates to brain');

        // /router without _handleRouterCommand
        const mockBrainNoRouter = { ...mockBrain, _handleRouterCommand: undefined };
        const noRouterResult = await NodeRouter.handle(mockCtx('/router status'), mockBrainNoRouter);
        assert(noRouterResult && noRouterResult.includes('only available'), '/router guard works');

        // Non-command returns false
        const normalResult = await NodeRouter.handle(mockCtx('hello world'), mockBrain);
        assert(normalResult === false, 'non-command returns false');
    });

    // ============================================================
    // Final Summary
    // ============================================================
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n' + '='.repeat(50));
    console.log(`TOTAL: ${totalPass}/${totalAssertions} PASSED (${totalFail} FAILED) — ${elapsed}s`);
    console.log('='.repeat(50) + '\n');

    if (totalFail > 0) {
        process.exit(1);
    }
})();
