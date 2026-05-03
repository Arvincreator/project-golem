/**
 * CommandSafeguard - Project Golem 安全防線
 * ---------------------------------------------------------
 * 職責：過濾、驗證並轉義所有即將執行的 Shell 指令，防止指令注入。
 */
class CommandSafeguard {
    constructor() {
        // 基礎白名單指令格式 (Regex)
        this.whitelist = [
            /^node src\/skills\/core\/[a-zA-Z0-9_-]+\.js\s+(['"]).*\1$/,
            /^node src\/skills\/modules\/[a-zA-Z0-9_-]+\/index\.js\s+(['"]).*\1$/,
            /^node golem_memory\/skills\/[a-zA-Z0-9_-]+\/index\.js\s+(['"]).*\1$/,
            /^node scripts\/doctor\.js$/,
            /^ls\s+.*$/,
            /^cat\s+.*$/
        ];

        // 結構性敏感符號 (在未核准前攔截)
        this.sensitiveSymbols = [';', '&&', '||', '>', '`', '$(', '|'];

        // 絕對禁止的破壞性操作 (即便核准也高機率攔截)
        this.dangerousOps = [
            'rm -rf', 'sudo', 'chmod', 'chown',
            '/etc/passwd', '/etc/shadow', '.env'
        ];
    }

    /**
     * 驗證指令是否安全
     * @param {string} cmd 原始指令字串
     * @param {boolean} skipWhitelist 是否跳過嚴格正則白名單 (用於手動核准後)
     * @returns {Object} { safe: boolean, reason?: string, sanitizedCmd?: string }
     */
    validate(cmd, skipWhitelist = false) {
        if (!cmd || typeof cmd !== 'string') {
            return { safe: false, reason: '指令格式無效' };
        }

        const trimmedCmd = cmd.trim();

        // 1. 檢查絕對禁止的破壞性操作 (可經由環境變數或核准跳過)
        const isStrict = process.env.GOLEM_STRICT_SAFEGUARD !== 'false';

        if (!skipWhitelist && isStrict) {
            for (const op of this.dangerousOps) {
                if (trimmedCmd.includes(op)) {
                    return { safe: false, reason: `偵測到高度危險操作: ${op}` };
                }
            }
        }

        // 2. 檢查結構性符號
        if (!skipWhitelist) {
            for (const symbol of this.sensitiveSymbols) {
                if (trimmedCmd.includes(symbol)) {
                    return { safe: false, reason: `偵測到敏感關鍵字: ${symbol}` };
                }
            }
        }

        // 如果是核准過的，且沒觸發破壞性操作，則放行
        if (skipWhitelist) {
            return { safe: true, sanitizedCmd: trimmedCmd };
        }

        // 3. 檢查白名單模式
        const isMatched = this.whitelist.some(regex => regex.test(trimmedCmd));

        if (isMatched) {
            return { safe: true, sanitizedCmd: trimmedCmd };
        }

        // 4. ✨ [v9.1] 整合 L0-L3 分級與自適應白名單
        const SecurityManager = require('./SecurityManager');
        const sm = new SecurityManager();
        const evaluatedLevel = sm.evaluateCommandLevel(trimmedCmd);
        if (evaluatedLevel > SecurityManager.currentLevel) {
            return { safe: false, reason: `指令風險等級 (L${evaluatedLevel}) 大於當前安全設定 (L${SecurityManager.currentLevel})` };
        }

        const userWhitelist = (process.env.COMMAND_WHITELIST || '')
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
