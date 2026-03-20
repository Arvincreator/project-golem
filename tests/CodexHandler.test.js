// tests/CodexHandler.test.js
// 🤖 Codex Sub-Agent Handler — 單元測試

'use strict';

// Mock codex-agent 模組
jest.mock('../src/skills/core/codex-agent', () => ({
    execute: jest.fn(),
}));

const CodexHandler  = require('../src/core/action_handlers/CodexHandler');
const codexAgent    = require('../src/skills/core/codex-agent');

describe('CodexHandler', () => {
    let mockCtx;

    beforeEach(() => {
        jest.clearAllMocks();
        mockCtx = {
            reply: jest.fn().mockResolvedValue(undefined),
        };
    });

    // ── 輸入驗證 ────────────────────────────────────────────
    test('缺少 prompt 時應回報錯誤並 return true', async () => {
        const act = { action: 'codex_task' };
        const result = await CodexHandler.execute(mockCtx, act);

        expect(result).toBe(true);
        expect(mockCtx.reply).toHaveBeenCalledWith(
            expect.stringContaining('缺少必要欄位 `prompt`')
        );
        expect(codexAgent.execute).not.toHaveBeenCalled();
    });

    test('prompt 為空字串時應回報錯誤', async () => {
        const act = { action: 'codex_task', prompt: '   ' };
        const result = await CodexHandler.execute(mockCtx, act);

        expect(result).toBe(true);
        expect(mockCtx.reply).toHaveBeenCalledWith(
            expect.stringContaining('缺少必要欄位 `prompt`')
        );
    });

    // ── 正常執行 ────────────────────────────────────────────
    test('正常執行應顯示進度訊息並回報結果', async () => {
        codexAgent.execute.mockResolvedValue('function debounce() { /* ... */ }');

        const act = {
            action: 'codex_task',
            prompt: '新增 debounce 函數',
            dir:    'src/utils',
        };
        const result = await CodexHandler.execute(mockCtx, act);

        expect(result).toBe(true);

        // 1. 應先發送進度訊息
        expect(mockCtx.reply).toHaveBeenNthCalledWith(1,
            expect.stringContaining('[Codex Sub-Agent]')
        );
        expect(mockCtx.reply).toHaveBeenNthCalledWith(1,
            expect.stringContaining('src/utils')
        );

        // 2. 應傳遞正確參數給 codex-agent
        expect(codexAgent.execute).toHaveBeenCalledWith(
            '新增 debounce 函數',
            expect.objectContaining({ dir: 'src/utils' })
        );

        // 3. 應回報 Codex 結果
        expect(mockCtx.reply).toHaveBeenNthCalledWith(2,
            expect.stringContaining('debounce')
        );
    });

    test('使用預設 dir "." 時應顯示「Golem 根目錄」', async () => {
        codexAgent.execute.mockResolvedValue('done');
        const act = { action: 'codex_task', prompt: '列出所有函數' };

        await CodexHandler.execute(mockCtx, act);

        expect(mockCtx.reply).toHaveBeenNthCalledWith(1,
            expect.stringContaining('Golem 根目錄')
        );
    });

    // ── 長 prompt 截斷 ──────────────────────────────────────
    test('超長 prompt 應在預覽訊息中截斷顯示', async () => {
        codexAgent.execute.mockResolvedValue('ok');
        const longPrompt = 'A'.repeat(300);
        const act = { action: 'codex_task', prompt: longPrompt };

        await CodexHandler.execute(mockCtx, act);

        const firstCall = mockCtx.reply.mock.calls[0][0];
        expect(firstCall).toContain('...');
        expect(firstCall.length).toBeLessThan(longPrompt.length + 200);
    });

    // ── 錯誤處理 ────────────────────────────────────────────
    test('codexAgent 拋出錯誤時應回報錯誤訊息並 return true', async () => {
        codexAgent.execute.mockRejectedValue(new Error('缺少 OPENAI_API_KEY'));

        const act = { action: 'codex_task', prompt: '測試任務' };
        const result = await CodexHandler.execute(mockCtx, act);

        expect(result).toBe(true);
        expect(mockCtx.reply).toHaveBeenLastCalledWith(
            expect.stringContaining('缺少 OPENAI_API_KEY')
        );
    });

    test('codexAgent 超時時應顯示超時錯誤訊息', async () => {
        codexAgent.execute.mockRejectedValue(new Error('⏱️ Codex 執行超時（120s），任務已中斷'));

        const act = { action: 'codex_task', prompt: '超時測試' };
        await CodexHandler.execute(mockCtx, act);

        expect(mockCtx.reply).toHaveBeenLastCalledWith(
            expect.stringContaining('超時')
        );
    });

    // ── 可選參數透傳 ────────────────────────────────────────
    test('approvalMode 和 model 應正確透傳給 codex-agent', async () => {
        codexAgent.execute.mockResolvedValue('ok');

        const act = {
            action:       'codex_task',
            prompt:       '重構任務',
            approvalMode: 'full-auto',
            model:        'o4-mini',
            timeout:      60000,
        };

        await CodexHandler.execute(mockCtx, act);

        expect(codexAgent.execute).toHaveBeenCalledWith(
            '重構任務',
            expect.objectContaining({
                approvalMode: 'full-auto',
                model:        'o4-mini',
                timeout:      60000,
            })
        );
    });
});
