// Security Manager v2 (streamlined)
class SecurityManager {
    constructor() {
        this.BLOCK_PATTERNS = [
            /rm\s+-rf\s+\//,
            /rd\s+\/s\s+\/q\s+[c-zC-Z]:\\$/,
            />\s*\/dev\/sd/,
            /:()\{:|:&\};:/,
            /mkfs/,
            /Format-Volume/,
            /dd\s+if=/
        ];
    }

    assess(cmd) {
        const safeCmd = (cmd || '').trim();
        if (this.BLOCK_PATTERNS.some(regex => regex.test(safeCmd))) {
            return { level: 'BLOCKED', reason: 'Destructive operation' };
        }
        return { level: 'SAFE' };
    }
}

module.exports = SecurityManager;
