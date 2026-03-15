// ============================================================
// Security Manager (安全審計) — Hardened v9.2
// ============================================================
// ==================== [KERNEL PROTECTED START] ====================
class SecurityManager {
    constructor() {
        this.SAFE_COMMANDS = ['ls', 'dir', 'pwd', 'date', 'echo', 'cat', 'grep', 'find', 'whoami', 'tail', 'head', 'df', 'free', 'Get-ChildItem', 'Select-String', 'golem-check'];

        // 毀滅性指令 — 無條件攔截
        this.BLOCK_PATTERNS = [
            /rm\s+-rf\s+\//, /rm\s+-rf\s+~/, /rm\s+-rf\s+\./,
            /rd\s+\/s\s+\/q\s+[a-zA-Z]:\\/,
            />\s*\/dev\/sd/, /:\(\)\{.*\};:/, /mkfs/, /Format-Volume/,
            /dd\s+if=/, /chmod\s+[-]x\s+/,
            /del\s+\/[fqs]\s+/i, /format\s+[a-zA-Z]:/i
        ];

        // 高危操作清單 (擴充版)
        this.DANGEROUS_OPS = [
            'rm', 'mv', 'chmod', 'chown', 'sudo', 'su',
            'reboot', 'shutdown', 'poweroff', 'halt',
            'npm uninstall', 'Remove-Item', 'Stop-Computer',
            'dd', 'wget', 'curl', 'nc', 'ncat', 'netcat',
            'kill', 'killall', 'pkill', 'taskkill',
            'reg', 'regedit', 'net', 'sc', 'wmic',
            'npm install', 'pip install', 'git clone'
        ];

        // 注入偵測模式 (subshell, 反引號, 重導向, 換行)
        this.INJECTION_PATTERNS = [
            /\$\(/, /`/, /[><]/, /\n/, /\r/,
            /\$\{/, /\0/
        ];
    }

    assess(cmd) {
        const safeCmd = (cmd || "").trim();
        if (!safeCmd) return { level: 'BLOCKED', reason: '空指令' };

        // 0. 換行符 = 多指令注入，無條件攔截
        if (/[\n\r\0]/.test(safeCmd)) {
            return { level: 'BLOCKED', reason: '偵測到換行符注入' };
        }

        // 1. 毀滅性指令模式
        if (this.BLOCK_PATTERNS.some(regex => regex.test(safeCmd))) {
            return { level: 'BLOCKED', reason: '毀滅性指令' };
        }

        // 2. subshell / 反引號 / 重導向偵測 — 一律需審批
        if (this.INJECTION_PATTERNS.some(regex => regex.test(safeCmd))) {
            return { level: 'WARNING', reason: '包含子殼層、重導向或特殊符號，需確認' };
        }

        // 3. 讀取使用者白名單
        const userWhitelist = (process.env.COMMAND_WHITELIST || "")
            .split(',')
            .map(c => c.trim())
            .filter(c => c.length > 0);

        // 4. 複合指令 (&&, ||, ;, |) — 每段都需通過檢查
        if (/[;&|]/.test(safeCmd)) {
            const subCmds = safeCmd.split(/\s*(?:&&|\|\||[;&|])\s*/).map(c => c.trim()).filter(c => c.length > 0);

            for (const sub of subCmds) {
                const subBaseCmd = sub.split(/\s+/)[0];
                if (this._isDangerousOp(sub, subBaseCmd)) {
                    return { level: 'DANGER', reason: `高風險操作: ${subBaseCmd}` };
                }
                if (!userWhitelist.includes(subBaseCmd)) {
                    return { level: 'WARNING', reason: `複合指令中 "${subBaseCmd}" 未在白名單` };
                }
            }
            return { level: 'SAFE' };
        }

        // 5. 單一指令
        const baseCmd = safeCmd.split(/\s+/)[0];
        if (userWhitelist.includes(baseCmd)) return { level: 'SAFE' };
        if (this._isDangerousOp(safeCmd, baseCmd)) return { level: 'DANGER', reason: `高風險操作: ${baseCmd}` };

        return { level: 'WARNING', reason: '指令未在白名單中，需確認' };
    }

    // 檢查是否為高危操作 — 單詞匹配 baseCmd，多詞匹配 startsWith
    _isDangerousOp(fullCmd, baseCmd) {
        for (const op of this.DANGEROUS_OPS) {
            if (op.includes(' ')) {
                if (fullCmd.startsWith(op)) return true;
            } else {
                if (baseCmd === op) return true;
            }
        }
        return false;
    }
}
// ==================== [KERNEL PROTECTED END] ====================

module.exports = SecurityManager;
