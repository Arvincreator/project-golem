const path = require('path');

/**
 * SecurityManager - 管理指令執行的安全性
 * ---------------------------------------------------------
 * 職責：評估指令風險等級：SAFE, WARNING, DANGER, BLOCKED
 */
class SecurityManager {
    constructor() {
        // ✨ [v9.5] 分類定義：危險指令 vs 敏感符號
        this.DEFAULT_DANGER_PATTERNS = [
            /rm\s+-rf\s+\/($|\s)/,      // 遞迴刪除根目錄
            /rd\s+\/s\s+\/q\s+[a-zA-Z]:\\/, // Windows 靜默刪除磁碟
            />\s*\/dev\/sd/,           // 磁碟覆寫
            /:\(\)\{\s*:\|\:&\s*\};:/, // Fork bomb
            /\bmkfs\b/,                // 格式化
            /\bFormat-Volume\b/,       // PowerShell 格式化
            /\bdd\s+if=/,              // 底層寫入
            /chmod\s+-x/,              // 移除執行權限
            // ✨ [v10.1] 使用者新增敏感指令
            /\brm\b/, /\bmv\b/, /\bchmod\b/, /\bchown\b/,
            /\bsudo\b/, /\bsu\b/, /\breboot\b/, /\bshutdown\b/,
            /\bnpm\s+uninstall\b/,
            /\bRemove-Item\b/i,        // PowerShell (不區分大小寫)
            /\bStop-Computer\b/i       // PowerShell
        ];

        this.DEFAULT_SENSITIVE_SYMBOLS = [
            /[><`]/,                   // 重新導向與反引號
            /\$\(/,                    // 子殼層呼叫
            /[;&|]/                    // 指令連接符
        ];

        // 系統預設安全指令 (如果不含危險模式且在白名單中，則為 SAFE)
        this.DEFAULT_SAFE_COMMANDS = ['ls', 'dir', 'pwd', 'date', 'echo', 'cat', 'grep', 'find', 'whoami', 'tail', 'head', 'df', 'free', 'Get-ChildItem', 'Select-String', 'golem-check'];
    }

    /**
     * 評估指令風險
     * @param {string} cmd 
     * @returns {{level: string, reason?: string}}
     */
    assess(cmd, isRecursive = false) {
        const safeCmd = (cmd || "").trim();
        if (!safeCmd) return { level: 'SAFE' };

        // 1. ✨ [v9.2] 檢查關鍵字免審批 (Keyword Exemption) - 最高優先權 (除了毀滅性指令)
        const exemptKeywords = (process.env.COMMAND_EXEMPT_KEYWORDS || "")
            .split(',')
            .map(k => k.trim())
            .filter(k => k.length > 0);

        const hasExemptKeyword = exemptKeywords.some(keyword => safeCmd.includes(keyword));

        // 2. ✨ [v9.5] 檢查毀滅性指令 (Dangerous Commands)
        const customDangerStr = (process.env.CUSTOM_DANGEROUS_COMMANDS || "");
        const customDanger = customDangerStr.split(',').map(s => s.trim()).filter(Boolean);
        const authorizedDangerStr = (process.env.AUTHORIZED_DANGEROUS_COMMANDS || "");
        const authorizedDanger = authorizedDangerStr.split(',').map(s => s.trim()).filter(Boolean);

        const isDangerPattern = this.DEFAULT_DANGER_PATTERNS.some(regex => regex.test(safeCmd)) || 
                                customDanger.some(pattern => safeCmd.includes(pattern));
        
        if (isDangerPattern) {
            const isWaived = authorizedDanger.some(auth => safeCmd === auth);
            if (!isWaived) {
                return { level: 'BLOCKED', reason: '偵測到毀滅性指令模式，系統已強制阻擋' };
            }
            return { level: 'WARNING', reason: '此指令匹配已豁免的危險模式，仍建議謹謹執行' };
        }

        // 3. 檢查關鍵字免審批 (如果不是危險指令且有免審批關鍵字，直接放行)
        if (hasExemptKeyword) {
            return { level: 'SAFE' };
        }

        // ✨ [v9.9] 遞迴驗證 (Recursive Assessment)
        // 只有非遞迴調用時才進行拆解，避免無限循環
        if (!isRecursive) {
            const authorizedSensitive = (process.env.AUTHORIZED_SENSITIVE_KEYWORDS || "").split(',').map(s => s.trim()).filter(Boolean);
            
            // 找出出現在指令中的已授權「連接符」 (;, &&, ||, |)
            const connectors = [';', '&&', '||', '|'].filter(conn => authorizedSensitive.includes(conn));
            
            if (connectors.length > 0) {
                // 建立正則表達式來拆分指令
                // 需要特別處理特殊字元，並確保不會被引號內的字串干擾 (簡化處理：直接 split)
                const regexPattern = connectors.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
                const parts = safeCmd.split(new RegExp(`\\s*(?:${regexPattern})\\s*`)).filter(Boolean);

                if (parts.length > 1) {
                    const results = parts.map(part => this.assess(part, true));
                    
                    // 彙總結果優先級：BLOCKED > WARNING > SAFE
                    const blocked = results.find(r => r.level === 'BLOCKED');
                    if (blocked) return blocked;

                    const warning = results.find(r => r.level === 'WARNING');
                    if (warning) return warning;

                    return { level: 'SAFE' };
                }
            }
        }

        // 4. ✨ [v9.5] 檢查敏感符號與關鍵字 (Sensitive Keywords)
        const customSensitive = (process.env.CUSTOM_SENSITIVE_KEYWORDS || "").split(',').map(s => s.trim()).filter(Boolean);
        const authorizedSensitive = (process.env.AUTHORIZED_SENSITIVE_KEYWORDS || "").split(',').map(s => s.trim()).filter(Boolean);

        const isSensitive = this.DEFAULT_SENSITIVE_SYMBOLS.some(regex => regex.test(safeCmd)) ||
                           customSensitive.some(pattern => safeCmd.includes(pattern));

        if (isSensitive) {
            const isAuthorized = authorizedSensitive.some(auth => {
                const target = auth.trim();
                return target && safeCmd.includes(target);
            });
            if (!isAuthorized) {
                return { level: 'WARNING', reason: '包含敏感符號或關鍵字 (如連接符或重導向)，需審批' };
            }
        }

        // 5. 最後檢查白名單 (Legacy Support)
        const whitelist = (process.env.COMMAND_WHITELIST || "").split(',').map(s => s.trim()).filter(Boolean);
        const fullWhitelist = [...this.DEFAULT_SAFE_COMMANDS, ...whitelist];
        
        if (fullWhitelist.includes(safeCmd)) {
            return { level: 'SAFE' };
        }

        // 只有在非遞迴模式下，或者指令不包含空格時，才允許基礎指令比對
        // 這能防止 "grep a" 因為 "grep" 在白名單就被誤判為 SAFE
        if (!isRecursive || !safeCmd.includes(' ')) {
            const baseCmd = safeCmd.split(/\s+/)[0];
            if (fullWhitelist.includes(baseCmd)) {
                return { level: 'SAFE' };
            }
        }

        return { level: 'WARNING', reason: '非預設安全指令，需手動審批' };
    }
}

module.exports = SecurityManager;
