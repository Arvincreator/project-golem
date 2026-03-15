// ============================================================
// 🛡️ CommandSafeguard — Pre-execution command validation
// Whitelist + sensitive symbol detection + dangerous operation blocking
// ============================================================

class CommandSafeguard {
    // Whitelisted safe commands
    static WHITELIST = new Set([
        'ls', 'dir', 'pwd', 'date', 'echo', 'cat', 'grep', 'find',
        'whoami', 'tail', 'head', 'df', 'free', 'uptime', 'uname',
        'wc', 'sort', 'uniq', 'which', 'type', 'file', 'stat',
        'node', 'npm', 'npx', 'git', 'curl', 'wget',
        'Get-ChildItem', 'Select-String', 'golem-check',
        'python', 'python3', 'pip', 'pip3'
    ]);

    // Dangerous patterns that should always be blocked
    static DANGEROUS_PATTERNS = [
        /rm\s+-rf\s+\/(?!\w)/,           // rm -rf / (root)
        /rm\s+-rf\s+~\//,                 // rm -rf ~/ (home)
        />\s*\/dev\/sd/,                   // write to raw disk
        /:\(\)\s*\{.*\}.*;.*:/,               // fork bomb
        /mkfs\b/,                          // format filesystem
        /dd\s+if=.*of=\/dev/,              // dd to device
        /chmod\s+[-]x\s+/,                // remove execute
        /Format-Volume/i,                  // Windows format
        /rd\s+\/s\s+\/q\s+[c-zC-Z]:\\$/,  // Windows recursive delete root
        /curl.*\|\s*(?:ba)?sh/,            // curl pipe to shell
        /wget.*\|\s*(?:ba)?sh/,            // wget pipe to shell
        /eval\s*\(/,                       // eval execution
        /\bsudo\s+rm\b/,                  // sudo rm
        /\bkill\s+-9\s+1\b/,             // kill init
        />\s*\/etc\/passwd/,              // overwrite passwd
        />\s*\/etc\/shadow/,              // overwrite shadow
    ];

    // Sensitive symbols that warrant extra caution
    static SENSITIVE_SYMBOLS = /[`$(){}\\|;]/;

    /**
     * Validate a command before execution
     * @param {string} cmd - The command to validate
     * @returns {{ safe: boolean, reason?: string, level?: string }}
     */
    static validate(cmd) {
        if (!cmd || typeof cmd !== 'string') {
            return { safe: false, reason: 'Empty or invalid command' };
        }

        const trimmed = cmd.trim();
        if (trimmed.length === 0) {
            return { safe: false, reason: 'Empty command' };
        }

        // Check dangerous patterns first
        for (const pattern of this.DANGEROUS_PATTERNS) {
            if (pattern.test(trimmed)) {
                return { safe: false, reason: `Blocked by dangerous pattern: ${pattern}`, level: 'BLOCKED' };
            }
        }

        // Extract base command (first token)
        const baseCmd = trimmed.split(/\s+/)[0];

        // Check compound commands — validate each sub-command
        if (/[;&|]/.test(trimmed)) {
            const subCmds = trimmed.split(/[;&|]+/).map(c => c.trim()).filter(c => c.length > 0);
            for (const sub of subCmds) {
                const subResult = this.validate(sub);
                if (!subResult.safe) return subResult;
            }
        }

        // Check for sensitive symbols (not blocking, just flag)
        if (this.SENSITIVE_SYMBOLS.test(trimmed) && !this.WHITELIST.has(baseCmd)) {
            return { safe: true, reason: 'Contains sensitive symbols', level: 'WARNING' };
        }

        return { safe: true, level: 'SAFE' };
    }
}

module.exports = CommandSafeguard;
