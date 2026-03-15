/**
 * CommandSafeguard - Project Golem 安全防線
 * ---------------------------------------------------------
 * 職責：過濾、驗證並轉義所有即將執行的 Shell 指令，防止指令注入。
 *
 * 狀態說明：
 * - allow   => 白名單通過，可直接執行
 * - confirm => 命中黑名單或未列於白名單，需人工再次確認
 * - deny    => 指令格式無效，直接拒絕
 */
class CommandSafeguard {
    constructor() {
        this.whitelist = [
            /^node src\/skills\/core\/[a-zA-Z0-9_-]+\.js\s+".*"$/,
            /^node src\/skills\/lib\/[a-zA-Z0-9_-]+\.js\s+".*"$/,
            /^node scripts\/doctor\.js$/,
            /^ls\s+.*$/,
            /^cat\s+.*$/
        ];

        // 敏感關鍵字黑名單（改為高風險警告，不再直接攔截）
        this.blacklistedKeywords = [
            ';', '&&', '||', '>', '`', '$(', '|',
            'rm -rf', 'sudo', 'chmod', 'chown',
            '/etc/passwd', '/etc/shadow', '.env'
        ];
    }

    validate(cmd) {
        if (!cmd || typeof cmd !== 'string') {
            return {
                status: 'deny',
                severity: 'danger',
                reason: '指令格式無效',
                reasonCode: 'INVALID_COMMAND'
            };
        }

        const trimmedCmd = cmd.trim();

        if (!trimmedCmd) {
            return {
                status: 'deny',
                severity: 'danger',
                reason: '指令內容為空',
                reasonCode: 'EMPTY_COMMAND'
            };
        }

        for (const keyword of this.blacklistedKeywords) {
            if (trimmedCmd.includes(keyword)) {
                return {
                    status: 'confirm',
                    severity: 'danger',
                    reasonCode: 'BLACKLIST_WARNING',
                    matchedKeyword: keyword,
                    reason: `偵測到高風險關鍵字「${keyword}」，該指令可能影響系統穩定度或檔案安全，請再次確認是否執行。`,
                    sanitizedCmd: trimmedCmd
                };
            }
        }

        const isMatched = this.whitelist.some(regex => regex.test(trimmedCmd));
        if (!isMatched) {
            return {
                status: 'confirm',
                severity: 'warning',
                reasonCode: 'NOT_WHITELISTED',
                reason: '指令未列於白名單中，請確認內容與目的後再決定是否執行。',
                sanitizedCmd: trimmedCmd
            };
        }

        return {
            status: 'allow',
            severity: 'info',
            reasonCode: 'WHITELIST_OK',
            sanitizedCmd: trimmedCmd
        };
    }
}

module.exports = new CommandSafeguard();
