// ============================================================
// 🛡️ Security Manager (安全審計 — 強化版)
// ============================================================
// ==================== [KERNEL PROTECTED START] ====================
class SecurityManager {
    constructor() {
        this.SAFE_COMMANDS = ['ls', 'dir', 'pwd', 'date', 'echo', 'cat', 'grep', 'find', 'whoami', 'tail', 'head', 'df', 'free', 'Get-ChildItem', 'Select-String', 'golem-check', 'uname', 'hostname', 'uptime', 'wc', 'sort', 'uniq', 'which', 'env', 'printenv'];
        this.BLOCK_PATTERNS = [
            /rm\s+-rf\s+\//, /rd\s+\/s\s+\/q\s+[c-zC-Z]:\$/, />\s*\/dev\/sd/,
            /:(){:|:&};:/, /mkfs/, /Format-Volume/, /dd\s+if=/, /chmod\s+[-]x\s+/,
            /curl\s+.*\|\s*(ba)?sh/, /wget\s+.*\|\s*(ba)?sh/,  // pipe to shell
            /python\s+-c\s+['"].*import\s+os/, // python os injection
            /node\s+-e\s+['"].*child_process/, // node injection
            />\s*\/etc\//, />\s*\/root\//, // write to system dirs
            /\beval\b/, /\bexec\b.*\(/, // eval/exec calls
            /base64\s+(-d|--decode)\s*\|/, // encoded payload execution
        ];
        this.DANGEROUS_COMMANDS = ['rm', 'mv', 'chmod', 'chown', 'sudo', 'su', 'reboot', 'shutdown', 'npm uninstall', 'Remove-Item', 'Stop-Computer', 'kill', 'killall', 'pkill', 'apt', 'yum', 'dnf', 'pip', 'npm', 'yarn', 'docker', 'systemctl', 'service', 'iptables', 'useradd', 'userdel', 'passwd', 'crontab'];
        // 指令長度限制 — 防止超長 payload
        this.MAX_COMMAND_LENGTH = 2000;
        // 審計日誌
        this.auditLog = [];
    }

    assess(cmd) {
        const safeCmd = (cmd || "").trim();

        // 空指令 = WARNING
        if (!safeCmd) return { level: 'WARNING', reason: '空指令' };

        // 長度檢查
        if (safeCmd.length > this.MAX_COMMAND_LENGTH) {
            return { level: 'BLOCKED', reason: `指令過長 (${safeCmd.length} > ${this.MAX_COMMAND_LENGTH})` };
        }

        // 毀滅性模式匹配
        if (this.BLOCK_PATTERNS.some(regex => regex.test(safeCmd))) {
            this._audit('BLOCKED', safeCmd);
            return { level: 'BLOCKED', reason: '毀滅性指令' };
        }

        // 多指令串接檢測 (;, &&, ||)
        if (/[;]|&&|\|\|/.test(safeCmd)) {
            this._audit('DANGER', safeCmd);
            return { level: 'DANGER', reason: '多指令串接 — 需人工審核' };
        }

        const baseCmd = safeCmd.split(/\s+/)[0];

        // 安全名單
        if (this.SAFE_COMMANDS.includes(baseCmd)) return { level: 'SAFE' };

        // 危險指令
        if (this.DANGEROUS_COMMANDS.includes(baseCmd)) {
            this._audit('DANGER', safeCmd);
            return { level: 'DANGER', reason: '高風險操作' };
        }

        return { level: 'WARNING', reason: '需確認' };
    }

    _audit(level, cmd) {
        this.auditLog.push({
            level,
            command: cmd.substring(0, 200),
            timestamp: new Date().toISOString()
        });
        // 保留最近 100 條審計記錄
        if (this.auditLog.length > 100) this.auditLog.shift();
    }

    getAuditLog() {
        return [...this.auditLog];
    }
}
// ==================== [KERNEL PROTECTED END] ====================

module.exports = SecurityManager;
