/**
 * CommandSafeguard - Project Golem 安全防線
 * ---------------------------------------------------------
 * 職責：過濾、驗證並轉義所有即將執行的 Shell 指令，防止指令注入。
 */
class CommandSafeguard {
    constructor() {
        // 基礎白名單指令格式 (Regex)
        this.whitelist = [
            /^node src\/skills\/core\/[a-zA-Z0-9_-]+\.js\s+".*"$/,
            /^node src\/skills\/lib\/[a-zA-Z0-9_-]+\.js\s+".*"$/,
            /^node scripts\/doctor\.js$/,
            /^ls(\s+.*)?$/,
            /^cat(\s+.*)?$/
        ];

        // 結構性敏感符號 (在未核准前攔截)
        this.sensitiveSymbols = [';', '&&', '||', '>', '`', '$(', '|'];

        // 絕對禁止的破壞性操作 (即便核准也高機率攔截)
        this.dangerousOps = [
            'rm -rf', 'sudo', 'chmod', 'chown',
            '/etc/passwd', '/etc/shadow', '.env'
        ];

        // 絕對阻擋清單：無論 skipWhitelist/allowDangerousOps 設定，一律拒絕
        this.absoluteBlockPatterns = [
            /rm\s+-rf\s+\//,
            /rd\s+\/s\s+\/q\s+[c-zC-Z]:\$/,
            />\s*\/dev\/sd/,
            /:\(\)\{:\|:&\};:/,
            /mkfs/,
            /Format-Volume/,
            /dd\s+if=/,
            /chmod\s+[-]x\s+/
        ];

        this.whitelistEntryPattern = /^[a-zA-Z0-9_.\/:@* -]+$/;
    }

    _normalizeOptions(options) {
        if (typeof options === 'boolean') {
            return {
                skipWhitelist: options,
                allowSensitiveSyntax: options,
                allowDangerousOps: options
            };
        }
        const opts = options && typeof options === 'object' ? options : {};
        return {
            skipWhitelist: !!opts.skipWhitelist,
            allowSensitiveSyntax: !!opts.allowSensitiveSyntax,
            allowDangerousOps: !!opts.allowDangerousOps
        };
    }

    _normalizeCommand(cmd) {
        return String(cmd || '').trim();
    }

    _parseWhitelistEntries() {
        return String(process.env.COMMAND_WHITELIST || '')
            .split(',')
            .map((entry) => entry.trim().replace(/\s+/g, ' '))
            .filter((entry) => entry.length > 0)
            .filter((entry) => this.whitelistEntryPattern.test(entry))
            .filter((entry) => !/[;&|`$()<>]/.test(entry))
            .map((entry) => entry.toLowerCase());
    }

    _matchesWhitelist(command, whitelistEntries = []) {
        const normalizedCommand = this._normalizeCommand(command).toLowerCase();
        if (!normalizedCommand) return false;
        const baseCommand = normalizedCommand.split(/\s+/)[0];

        for (const rawEntry of whitelistEntries) {
            const entry = String(rawEntry || '').trim().toLowerCase();
            if (!entry) continue;

            if (entry.endsWith('*')) {
                const prefix = entry.slice(0, -1).trim();
                if (prefix && normalizedCommand.startsWith(prefix)) return true;
                continue;
            }

            if (entry.includes(' ')) {
                if (normalizedCommand === entry) return true;
                continue;
            }

            if (baseCommand === entry) return true;
        }

        return false;
    }

    validate(cmd, options = {}) {
        if (!cmd || typeof cmd !== 'string') {
            return { safe: false, reason: '指令格式無效' };
        }

        const trimmedCmd = this._normalizeCommand(cmd);
        const normalizedOptions = this._normalizeOptions(options);

        // 0. 絕對阻擋清單（無法被 skipWhitelist 繞過）
        if (this.absoluteBlockPatterns.some((pattern) => pattern.test(trimmedCmd))) {
            return { safe: false, reason: '偵測到絕對阻擋操作' };
        }

        // 1. 檢查絕對禁止的破壞性操作
        const isStrict = process.env.GOLEM_STRICT_SAFEGUARD !== 'false';

        if (isStrict && !normalizedOptions.allowDangerousOps) {
            for (const op of this.dangerousOps) {
                if (trimmedCmd.includes(op)) {
                    return { safe: false, reason: `偵測到高度危險操作: ${op}` };
                }
            }
        }

        // 2. 檢查結構性符號
        if (!normalizedOptions.allowSensitiveSyntax) {
            for (const symbol of this.sensitiveSymbols) {
                if (trimmedCmd.includes(symbol)) {
                    return { safe: false, reason: `偵測到敏感關鍵字: ${symbol}` };
                }
            }
        }

        if (normalizedOptions.skipWhitelist) {
            return { safe: true, sanitizedCmd: trimmedCmd };
        }

        // 3. 檢查白名單模式
        const isMatched = this.whitelist.some(regex => regex.test(trimmedCmd));
        if (isMatched) {
            return { safe: true, sanitizedCmd: trimmedCmd };
        }

        // 4. L0-L3 分級
        const SecurityManager = require('./SecurityManager');
        const sm = new SecurityManager();
        const evaluatedLevel = sm.evaluateCommandLevel(trimmedCmd);
        if (evaluatedLevel > SecurityManager.currentLevel) {
            return { safe: false, reason: `指令風險等級 (L${evaluatedLevel}) 大於當前安全設定 (L${SecurityManager.currentLevel})` };
        }

        // 5. 動態白名單
        const userWhitelistEntries = this._parseWhitelistEntries();
        if (this._matchesWhitelist(trimmedCmd, userWhitelistEntries)) {
            return { safe: true, sanitizedCmd: trimmedCmd };
        }

        return { safe: false, reason: '指令未列於白名單中' };
    }
}

module.exports = new CommandSafeguard();
