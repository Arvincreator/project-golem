// SecurityManager v10.0 — L0-L3 Four-tier Autonomy Classification
// L0: Safe (auto-execute silently) — read, query, list, check
// L1: Low Risk (auto-execute + notify after) — write files, mkdir, git add/commit
// L2: Medium Risk (Telegram approval required) — systemctl, apt, git push, rm -r
// L3: Critical (detailed Telegram approval) — rm -rf /, mkfs, dd, DROP, curl|sh

class SecurityManager {
    constructor() {
        // L3 CRITICAL — always require explicit approval with full explanation
        this.L3_PATTERNS = [
            /rm\s+-rf\s+\//,                    // recursive root delete
            /rm\s+-rf\s+~\//,                   // recursive home delete
            /rd\s+\/s\s+\/q\s+[c-zC-Z]:\\$/,   // Windows recursive delete
            />\s*\/dev\/sd/,                     // disk overwrite
            />\s*\/dev\/nvme/,                   // NVMe overwrite
            /:()\{:|:&\};:/,                     // fork bomb
            /mkfs/,                              // format filesystem
            /Format-Volume/,                     // PowerShell format
            /dd\s+if=/,                          // raw disk write
            /DROP\s+(DATABASE|TABLE)/i,          // SQL database destruction
            /TRUNCATE\s+TABLE/i,                 // SQL table truncation
            /iptables\s+-F/,                     // flush all firewall rules
            /ufw\s+(disable|reset)/,             // disable firewall
            /passwd\b/,                          // password change
            /useradd\b|userdel\b/,              // user account modification
            /chmod\s+777/,                       // world-writable permission
            /curl\s+.*\|\s*(ba)?sh/,            // pipe remote script to shell
            /wget\s+.*\|\s*(ba)?sh/,            // pipe remote script to shell
            /reboot\b/,                          // system reboot
            /shutdown\b/,                        // system shutdown
            /init\s+[06]/,                       // runlevel change
            /systemctl\s+(poweroff|halt)/,       // system halt
            />\s*\/dev\/null\s+2>&1\s*&/,       // backgrounded redirect (hiding output)
            /eval\s*\(/,                         // eval injection
        ];

        // L2 MEDIUM — notify before executing, require Telegram approval
        this.L2_PATTERNS = [
            /systemctl\s+(restart|stop|disable|enable)\b/,  // service management
            /service\s+\w+\s+(restart|stop)\b/,             // legacy service management
            /apt\s+(install|remove|purge|upgrade)\b/,       // package management
            /apt-get\s+(install|remove|purge|upgrade)\b/,   // package management
            /pip\s+install\b/,                              // Python package install
            /npm\s+(install|uninstall)\s+-g/,               // global npm
            /yarn\s+global\b/,                              // global yarn
            /git\s+(push|reset|rebase|merge)\b/,            // destructive git ops
            /docker\s+(rm|stop|kill|prune)\b/,              // container management
            /crontab\b/,                                    // cron modification
            /scp\s+/,                                       // secure copy
            /rsync\s+/,                                     // rsync transfer
            />\s*\/etc\//,                                  // write to /etc
            /mv\s+.*\/(etc|opt|usr|var)\//,                // move to system dirs
            /rm\s+-r\b/,                                    // recursive delete (non-root)
            /kill\s+-9/,                                    // force kill process
            /pkill\b|killall\b/,                           // process kill by name
            /chown\s+/,                                     // ownership change
            /iptables\s+/,                                  // firewall modification (non-flush)
            /ufw\s+(allow|deny)\b/,                        // firewall rule add
            /nc\s+-l/,                                      // netcat listener
            /nmap\b/,                                       // network scan
        ];

        // L1 LOW — auto-execute, then notify user in batch digest
        this.L1_PATTERNS = [
            /tee\s+/,                           // write via tee
            />\s*[^\/\s]/,                      // file write (non-system path)
            /mkdir\s+/,                         // create directory
            /touch\s+/,                         // create file
            /cp\s+/,                            // copy files
            /npm\s+install\b(?!\s+-g)/,         // local npm install
            /git\s+(add|commit|stash|branch|checkout|switch)\b/,  // safe git ops
            /echo\s+.*>>/,                      // append to file
            /wget\s+(?!.*\|\s*sh)/,            // download file (not piped to sh)
            /curl\s+-[oO]\b/,                  // download file
            /chmod\s+[0-6][0-7][0-7]\b/,       // permission change (non-777)
            /ln\s+/,                            // create symlink
            /tar\s+/,                           // archive operations
            /zip\s+|unzip\s+/,                 // compression
            /sed\s+/,                           // stream edit
        ];

        // L0: Everything else — read-only, informational, safe
    }

    /**
     * Assess command risk level
     * @param {string} cmd - Command to assess
     * @returns {{ level: 'L0'|'L1'|'L2'|'L3', risk: string, reason: string }}
     */
    assess(cmd) {
        const safeCmd = (cmd || '').trim();
        if (!safeCmd) return { level: 'L0', risk: 'safe', reason: 'Empty command' };

        // Check from highest risk to lowest
        for (const pattern of this.L3_PATTERNS) {
            if (pattern.test(safeCmd)) {
                return {
                    level: 'L3',
                    risk: 'critical',
                    reason: `Critical operation detected: ${pattern.toString().slice(1, -1).substring(0, 40)}`
                };
            }
        }

        for (const pattern of this.L2_PATTERNS) {
            if (pattern.test(safeCmd)) {
                return {
                    level: 'L2',
                    risk: 'medium',
                    reason: `System-modifying operation requires approval: ${pattern.toString().slice(1, -1).substring(0, 40)}`
                };
            }
        }

        for (const pattern of this.L1_PATTERNS) {
            if (pattern.test(safeCmd)) {
                return {
                    level: 'L1',
                    risk: 'low',
                    reason: `File-modifying operation`
                };
            }
        }

        return { level: 'L0', risk: 'safe', reason: 'Read-only or informational command' };
    }

    /**
     * Check if level requires approval (L2 or L3)
     * @param {string} level
     * @returns {boolean}
     */
    static requiresApproval(level) {
        return level === 'L2' || level === 'L3';
    }

    /**
     * Get the more restrictive of two levels
     * @param {string} a
     * @param {string} b
     * @returns {string}
     */
    static maxLevel(a, b) {
        const order = { 'L0': 0, 'L1': 1, 'L2': 2, 'L3': 3 };
        return (order[a] || 0) >= (order[b] || 0) ? a : b;
    }
}

module.exports = SecurityManager;
