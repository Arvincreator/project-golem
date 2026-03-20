// src/skills/core/codex-agent.js
// 🤖 Codex CLI Sub-Agent — 本地程式開發協作模組
// 透過 child_process.spawn 調用本地安裝的 codex CLI，
// 讓 Golem 可以委派程式開發任務給 Codex 作為 sub-agent。

'use strict';

const { spawn }  = require('child_process');
const path       = require('path');
const fs         = require('fs');

const MAX_OUTPUT = 3800; // Telegram 訊息上限安全值

/**
 * 偵測 codex 可執行檔路徑
 * 支援全域安裝 (npm -g) 和 npx 臨時調用兩種方式
 */
function resolveCodexBin() {
    // 1. 嘗試 PATH 中的 codex
    try {
        const { execSync } = require('child_process');
        const which = execSync('which codex 2>/dev/null || where codex 2>nul', { encoding: 'utf-8' }).trim();
        if (which) return which.split('\n')[0].trim();
    } catch (_) { /* ignore */ }

    // 2. nvm / nodenv 常見路徑
    const candidates = [
        path.join(process.env.HOME || '', '.nvm', 'versions', 'node', `v${process.version.slice(1)}`, 'bin', 'codex'),
        '/usr/local/bin/codex',
        '/usr/bin/codex',
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }

    // 3. Fallback: npx（不需全域安裝，但較慢）
    return null;
}

/**
 * 執行 Codex CLI 作為 sub-agent
 *
 * @param {string} prompt        - 給 Codex 的任務描述（自然語言）
 * @param {object} options
 * @param {string} [options.dir='.']              - 工作目錄 (絕對或相對路徑)
 * @param {string} [options.approvalMode='suggest'] - 'suggest' | 'full-auto'
 * @param {number} [options.timeout=120000]       - 超時毫秒數
 * @param {string} [options.model]                - 覆蓋預設模型（如 'o4-mini'）
 * @param {string} [options.provider]             - 'openai' | 'azure' | ...
 * @returns {Promise<string>} Codex 的輸出結果
 */
async function execute(prompt, options = {}) {
    const {
        dir          = process.cwd(),
        approvalMode = process.env.CODEX_APPROVAL_MODE || 'suggest',
        timeout      = 120000,
        model        = process.env.CODEX_MODEL || undefined,
        provider     = process.env.CODEX_PROVIDER || undefined,
    } = options;

    // 解析工作目錄
    const workDir = path.isAbsolute(dir)
        ? dir
        : path.resolve(process.cwd(), dir);

    if (!fs.existsSync(workDir)) {
        throw new Error(`工作目錄不存在: ${workDir}`);
    }

    // 建立 args
    const args = [
        '--approval-mode', approvalMode,
        '--quiet',   // 不開互動介面，輸出純文字
        prompt,
    ];
    if (model)    args.unshift('--model', model);
    if (provider) args.unshift('--provider', provider);

    // 解析執行檔
    const codexBin = resolveCodexBin();
    let cmd, cmdArgs;

    if (codexBin) {
        cmd     = codexBin;
        cmdArgs = args;
    } else {
        // Fallback: npx -y @openai/codex
        cmd     = 'npx';
        cmdArgs = ['-y', '@openai/codex', ...args];
    }

    return new Promise((resolve, reject) => {
        const env = {
            ...process.env,
            // 確保 non-interactive / CI 模式
            CI:        'true',
            TERM:      'dumb',
            NO_COLOR:  '1',
        };

        // Codex CLI 使用 ChatGPT 帳號 OAuth 認證（codex login），不需要 OPENAI_API_KEY
        // 若使用者設有 OPENAI_API_KEY，仍會透過 process.env 繼承

        const child = spawn(cmd, cmdArgs, {
            cwd:   workDir,
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });

        // 超時保護
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`⏱️ Codex 執行超時（${timeout / 1000}s），任務已中斷`));
        }, timeout);

        child.on('close', code => {
            clearTimeout(timer);
            const combined = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim();

            if (code !== 0 && !combined) {
                return reject(new Error(`Codex 退出碼 ${code}，無輸出`));
            }

            // 截斷
            const output = combined.length > MAX_OUTPUT
                ? combined.slice(0, MAX_OUTPUT) + '\n...(輸出已截斷)'
                : combined;

            resolve(output);
        });

        child.on('error', err => {
            clearTimeout(timer);
            reject(new Error(`無法啟動 Codex: ${err.message}（請確認已全域安裝 @openai/codex）`));
        });
    });
}

// ── Skill PROMPT（供 Golem System Prompt 自動載入）────────────────────
const PROMPT = `
【已載入技能：CODEX_AGENT — 本地程式開發 Sub-Agent】
你可以委派需要寫程式、重構、解釋程式碼、生成測試的任務給本地 Codex CLI。
使用格式：
[ACTION]
{"action":"codex_task","prompt":"<任務描述>","dir":"<相對路徑>","approvalMode":"suggest"}
[/ACTION]
- prompt：用英文或中文描述要完成的程式任務（越具體越好）
- dir：Codex 執行的工作目錄（預設 "."，即 Golem 根目錄）
- approvalMode："suggest"（安全，只給建議）| "full-auto"（自動寫入，謹慎使用）
- 適用場景：撰寫新函數、重構既有模組、解釋複雜程式碼、生成單元測試
`;

module.exports = { execute, PROMPT };
