/**
 * CommandSafeguard - Project Golem 安全防線 (Hardened v9.2)
 * ---------------------------------------------------------
 * 職責：過濾、驗證並轉義所有即將執行的 Shell 指令，防止指令注入。
 */
class CommandSafeguard {
    constructor() {
        // 基礎白名單指令格式 (Regex) — 嚴格限制
        this.whitelist = [
            /^node src[/\\]skills[/\\]core[/\\][a-zA-Z0-9_-]+\.js\s+--base64\s+[A-Za-z0-9+/=]+$/,
            /^node src[/\\]skills[/\\]lib[/\\][a-zA-Z0-9_-]+\.js\s+--base64\s+[A-Za-z0-9+/=]+$/,
            /^node scripts[/\\]doctor\.js$/,
            /^ls(\s+-[alh]+)?(\s+[a-zA-Z0-9_./-]+)?$/,
            /^dir(\s+[a-zA-Z0-9_.\\/-]+)?$/,
            /^cat\s+[a-zA-Z0-9_./-]+$/
        ];

        // 絕對禁止的破壞性操作 — 即便手動核准也攔截
        this.ABSOLUTE_BLOCK = [
            'rm -rf /', 'rm -rf ~', 'rm -rf .',
            'rd /s /q c:\\', 'format c:',
            '/etc/passwd', '/etc/shadow',
            'dd if=', 'mkfs', ':(){:|:&};:'
        ];

        // 注入偵測模式 — skipWhitelist 也必須檢查
        this.INJECTION_PATTERNS = [
            /[\n\r\0]/,         // 換行符注入
            /\$\(/,             // subshell
            /`/,                // 反引號
            /\$\{/,             // 變數展開
        ];

        // 結構性敏感符號 (未核准前攔截)
        this.sensitiveSymbols = [';', '&&', '||', '>', '<', '|'];

        // 高危操作清單
        this.dangerousOps = [
            'rm -rf', 'sudo', 'chmod', 'chown', 'kill', 'killall',
            'reboot', 'shutdown', 'poweroff',
            'wget', 'curl', 'nc', 'netcat',
            'npm install', 'pip install', 'git clone',
            'Remove-Item', 'Stop-Computer', 'Stop-Process'
        ];
    }

    /**
     * 驗證指令是否安全
     * @param {string} cmd 原始指令字串
     * @param {boolean} skipWhitelist 是否跳過正則白名單 (手動核准後)
     * @returns {Object} { safe: boolean, reason?: string, sanitizedCmd?: string }
     */
    validate(cmd, skipWhitelist = false) {
        if (!cmd || typeof cmd !== 'string') {
            return { safe: false, reason: '指令格式無效' };
        }

        const trimmedCmd = cmd.trim();
        if (!trimmedCmd) return { safe: false, reason: '空指令' };

        // 1. 絕對禁止 — 永遠攔截，不論是否核准
        for (const op of this.ABSOLUTE_BLOCK) {
            if (trimmedCmd.toLowerCase().includes(op.toLowerCase())) {
                return { safe: false, reason: `絕對禁止操作: ${op}` };
            }
        }

        // 2. 注入偵測 — 即便 skipWhitelist 也必須攔截
        for (const pattern of this.INJECTION_PATTERNS) {
            if (pattern.test(trimmedCmd)) {
                return { safe: false, reason: `偵測到注入模式: ${pattern.source}` };
            }
        }

        // 3. 高危操作檢查 — 即便 skipWhitelist 也需攔截
        const cmdBase = trimmedCmd.split(/\s+/)[0];
        for (const op of this.dangerousOps) {
            // 多詞操作 (如 "rm -rf") 用 includes，單詞操作用完整匹配
            if (op.includes(' ')) {
                if (trimmedCmd.includes(op)) {
                    return { safe: false, reason: `偵測到高危操作: ${op}` };
                }
            } else {
                if (cmdBase === op) {
                    return { safe: false, reason: `偵測到高危操作: ${op}` };
                }
            }
        }

        // 4. 結構性符號檢查 (未核准前攔截)
        if (!skipWhitelist) {
            for (const symbol of this.sensitiveSymbols) {
                if (trimmedCmd.includes(symbol)) {
                    return { safe: false, reason: `敏感符號: ${symbol}` };
                }
            }
        }

        // 5. 核准後 — 已通過上面所有安全檢查
        if (skipWhitelist) {
            return { safe: true, sanitizedCmd: trimmedCmd };
        }

        // 6. 白名單模式匹配
        if (this.whitelist.some(regex => regex.test(trimmedCmd))) {
            return { safe: true, sanitizedCmd: trimmedCmd };
        }

        // 7. 使用者自訂白名單
        const userWhitelist = (process.env.COMMAND_WHITELIST || "")
            .split(',')
            .map(c => c.trim())
            .filter(c => c.length > 0);

        const baseCmd = trimmedCmd.split(/\s+/)[0];
        if (userWhitelist.includes(baseCmd)) {
            return { safe: true, sanitizedCmd: trimmedCmd };
        }

        return { safe: false, reason: '指令未列於白名單中' };
    }
}

module.exports = new CommandSafeguard();
