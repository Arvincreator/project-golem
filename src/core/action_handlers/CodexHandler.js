// src/core/action_handlers/CodexHandler.js
// 🤖 Codex Sub-Agent Action Handler
// 處理 {"action":"codex_task",...} GOLEM_PROTOCOL 指令，委派給本地 codex CLI

'use strict';

const codexAgent = require('../../skills/core/codex-agent');

class CodexHandler {
    /**
     * 執行 codex_task action
     * @param {object} ctx   - Golem context（含 ctx.reply 方法）
     * @param {object} act   - 解析後的 action 物件
     *   act.prompt        {string}  任務描述（必填）
     *   act.dir           {string}  工作目錄（預設 "."）
     *   act.approvalMode  {string}  'suggest' | 'full-auto'（預設 'suggest'）
     *   act.timeout       {number}  超時毫秒（預設 120000）
     *   act.model         {string}  覆蓋模型（選填）
     * @returns {Promise<boolean>} 是否已處理
     */
    static async execute(ctx, act) {
        const { prompt, dir = '.', approvalMode, timeout, model } = act;

        if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
            await ctx.reply('❌ `codex_task` 缺少必要欄位 `prompt`（任務描述）');
            return true;
        }

        const displayDir = dir === '.' ? '（Golem 根目錄）' : dir;
        const displayMode = approvalMode || process.env.CODEX_APPROVAL_MODE || 'suggest';

        await ctx.reply(
            `🤖 **[Codex Sub-Agent]** 任務接收中...\n` +
            `📁 工作目錄: \`${displayDir}\`\n` +
            `🔧 模式: \`${displayMode}\`\n` +
            `📝 任務: ${prompt.slice(0, 200)}${prompt.length > 200 ? '...' : ''}`
        );

        try {
            const result = await codexAgent.execute(prompt, {
                dir,
                ...(approvalMode && { approvalMode }),
                ...(timeout    && { timeout }),
                ...(model      && { model }),
            });

            await ctx.reply(`✅ **[Codex]** 任務回報:\n\`\`\`\n${result}\n\`\`\``);
        } catch (e) {
            await ctx.reply(`❌ **[Codex]** 執行錯誤: ${e.message}`);
        }

        return true;
    }
}

module.exports = CodexHandler;
