// ============================================================
// 🛡️ Security Manager (安全審計)
// ============================================================
// ==================== [KERNEL PROTECTED START] ====================
class SecurityManager {
    constructor() {
        this.SAFE_COMMANDS = ['ls', 'dir', 'pwd', 'date', 'echo', 'cat', 'grep', 'find', 'whoami', 'tail', 'head', 'df', 'free', 'Get-ChildItem', 'Select-String', 'golem-check'];
        this.BLOCK_PATTERNS = [/rm\s+-rf\s+\//, /rd\s+\/s\s+\/q\s+[c-zC-Z]:\\$/, />\s*\/dev\/sd/, /:(){:|:&};:/, /mkfs/, /Format-Volume/, /dd\s+if=/, /chmod\s+[-]x\s+/];

        // ============================================================
        // L0: 純讀取/資訊類 — 完全自動，Telegram 報告
        // L1: 低風險寫入(社群/RAG/自我修復) — 完全自動，Telegram 報告
        // L2: 中風險(系統操作/evolution) — 需要 Telegram 審批
        // L3: 高風險(刪除/權限/sudo/破壞性指令) — 需要 Telegram 審批 (🔴)
        // ============================================================

        // 統一 regex 規則表 — 20 rules covering 40+ task combinations
        this.LEVEL_RULES = [
            // L0: Pure Read
            { level: 'L0', test: /^moltbot:(feed|read_comments|read_post|my_profile|my_status|list_submolts|dm_list|search)$/ },
            { level: 'L0', test: /^rag:(query|q|search|stats|s|lessons|l|recent|r|entity|e|health|h|local|local_stats|replay)$/ },
            { level: 'L0', test: /^fleet:(status|dashboard|health|sweep|intel|intel_feed|fleet_status|revenue|revenue_dashboard|revenue_trends|system_dashboard|circuit|breaker)$/ },
            { level: 'L0', test: /^selfheal:(diagnose|scan|read|history|stats)$/ },
            { level: 'L0', test: /^(schedule|log-archive|log-reader|reflection|noop|abort|analytics|model-router|list-schedules|definition|persona|reincarnate):/ },
            { level: 'L0', test: /^analytics:/ },
            // L1: Low-Risk Write
            { level: 'L1', test: /^moltbot:(post|reply|vote|follow|unfollow|join_submolt|leave_submolt|dm_send|comment)$/ },
            { level: 'L1', test: /^rag:(ingest|write|evolve|learn|consolidate|c|sync|push|pull)$/ },
            { level: 'L1', test: /^fleet:(intel_sweep|dispatch|generate_content|content_history|reset_circuit)$/ },
            { level: 'L1', test: /^selfheal:(patch|fix|rollback|autofix|auto)$/ },
            { level: 'L1', test: /^(community|auto-optimizer|optimizer|adaptive-learning):/ },
            // L2: Medium Risk
            { level: 'L2', test: /^command:/ },
            { level: 'L2', test: /^multi_agent:/ },
            { level: 'L2', test: /^evolution:/ },
            { level: 'L2', test: /^skill-inject:/ },
            // v10.9: PromptForge
            { level: 'L0', test: /^prompt-forge:(generate|evaluate|detect-pattern|compare|history|stats|export)$/ },
            { level: 'L1', test: /^prompt-forge:(optimize|evolve|templates|import)$/ },
            // v10.9.2: Nexus meta-orchestrator
            { level: 'L0', test: /^nexus:(research|benchmark|validate|report|status)$/ },
            { level: 'L1', test: /^nexus:(auto|plan)$/ },
            { level: 'L2', test: /^nexus:(execute_plan)$/ },
            // v10.9: Agent operations
            { level: 'L0', test: /^agent:(status|list|health|metrics)$/ },
            { level: 'L1', test: /^agent:(spawn|stop|pause|resume)$/ },
            { level: 'L2', test: /^agent:(stop_all|config)$/ },
            // L3: High Risk — destructive shell commands
            { level: 'L3', test: /^command:.*(rm\s|sudo|chmod|chown|reboot|shutdown|kill|pkill|mkfs|dd\s)/ },
            { level: 'L3', test: /^command:.*(npm\s+uninstall|pip\s+uninstall|apt\s+remove)/ },
            { level: 'L3', test: /^command:.*>\s*\/etc\// },
            { level: 'L3', test: /^evolution:(code_modify|file_delete|dependency_change)$/ },
        ];

        this._actionLog = [];
        this._errorHistory = [];
    }

    /**
     * 判斷技能類動作的風險等級 (L0-L3 分級) — 統一 regex 匹配
     */
    classifyAction(action) {
        if (!action || !action.action) return 'L2';

        const act = String(action.action).toLowerCase();
        const task = String(action.task || action.parameter || '').toLowerCase();
        const key = `${act}:${task}`;

        // L3 rules checked first (more specific patterns override L2 catch-all)
        for (const rule of this.LEVEL_RULES) {
            if (rule.level === 'L3' && rule.test.test(key)) return 'L3';
        }
        // Then L0, L1, L2
        for (const rule of this.LEVEL_RULES) {
            if (rule.level !== 'L3' && rule.test.test(key)) return rule.level;
        }

        return 'L2'; // 未知 = L2 需審批
    }

    /**
     * 回傳各級別規則數量統計
     */
    getLevelStats() {
        const stats = { L0: 0, L1: 0, L2: 0, L3: 0 };
        for (const rule of this.LEVEL_RULES) {
            stats[rule.level] = (stats[rule.level] || 0) + 1;
        }
        return stats;
    }

    /**
     * 記錄行動（供 RAG 查詢避免重複錯誤）
     */
    logAction(action, level, result, success) {
        this._actionLog.push({
            action: action?.action || 'unknown',
            task: action?.task || '',
            level, success,
            result: String(result).substring(0, 200),
            timestamp: new Date().toISOString()
        });
        if (this._actionLog.length > 100) this._actionLog.shift();

        if (!success) {
            const errorKey = `${action?.action}:${action?.task}:${String(result).substring(0, 80)}`;
            this._errorHistory.push({ key: errorKey, timestamp: Date.now() });
            if (this._errorHistory.length > 50) this._errorHistory.shift();
        }
    }

    /**
     * 檢查是否為重複錯誤（10 分鐘內同樣的動作+錯誤）
     */
    isRepeatedError(action) {
        const key = `${action?.action}:${action?.task}`;
        const recent = this._errorHistory.filter(e =>
            e.key.startsWith(key) && Date.now() - e.timestamp < 600000
        );
        return recent.length >= 2;
    }

    /**
     * 取得行動日誌摘要
     */
    getActionSummary(limit = 10) {
        return this._actionLog.slice(-limit).map(a =>
            `[${a.level}${a.success ? '✓' : '✗'}] ${a.action}${a.task ? ':' + a.task : ''}`
        ).join(' | ');
    }
    /**
     * v11.5: Get rules coverage across skill categories
     */
    getRulesCoverage() {
        const categories = new Set();
        for (const rule of this.LEVEL_RULES) {
            const src = rule.test.source;
            const match = src.match(/^\^([a-z_-]+):/);
            if (match) categories.add(match[1]);
        }
        return {
            coveredCategories: [...categories],
            totalCategories: categories.size,
            totalRules: this.LEVEL_RULES.length,
        };
    }

    assess(cmd) {
        const safeCmd = (cmd || "").trim();
        if (this.BLOCK_PATTERNS.some(regex => regex.test(safeCmd))) return { level: 'BLOCKED', reason: '毀滅性指令' };

        // Block dangerous redirect combos
        if (/>\s*\/dev\/sd|>\s*\/etc\/|`.*rm\s|`.*sudo|\$\(.*rm|\$\(.*sudo/.test(safeCmd)) {
            return { level: 'BLOCKED', reason: 'Dangerous system modification' };
        }
        // Soft warning for other redirects (allows L2 approval)
        if (/([><`])|\$\(/.test(safeCmd)) {
            return { level: 'WARNING', reason: '包含重導向或子系統呼叫等複雜操作，需確認' };
        }

        // ✨ [v9.1] 讀取使用者設定的白名單 (環境變數)
        const userWhitelist = (process.env.COMMAND_WHITELIST || "")
            .split(',')
            .map(cmd => cmd.trim())
            .filter(cmd => cmd.length > 0);

        const dangerousOps = ['rm', 'mv', 'chmod', 'chown', 'sudo', 'su', 'reboot', 'shutdown', 'npm uninstall', 'Remove-Item', 'Stop-Computer'];

        // 處理解析複合指令 (&&, ||, ;, |)
        if (/([;&|])/.test(safeCmd)) {
            // 用正規表達式將指令以 &&, ||, ;, | 切割
            const subCmds = safeCmd.split(/[;&|]+/).map(c => c.trim()).filter(c => c.length > 0);

            let allSafe = true;
            for (const sub of subCmds) {
                const subBaseCmd = sub.split(/\s+/)[0];

                // 在毀滅清單/高危險操作
                if (dangerousOps.includes(subBaseCmd)) return { level: 'DANGER', reason: '高風險操作' };

                // 檢查是否所有小指令都在白名單中
                if (!userWhitelist.includes(subBaseCmd)) {
                    allSafe = false;
                    break;
                }
            }

            if (allSafe) return { level: 'SAFE' };
            return { level: 'WARNING', reason: '複合指令中包含非信任授權的指令，需確認' };
        }

        const baseCmd = safeCmd.split(/\s+/)[0];

        // 原本的 SAFE_COMMANDS 不再預設放行，只看 userWhitelist
        if (userWhitelist.includes(baseCmd)) return { level: 'SAFE' };

        // 這些危險指令會直接進 DANGER
        if (dangerousOps.includes(baseCmd)) return { level: 'DANGER', reason: '高風險操作' };

        return { level: 'WARNING', reason: '需確認' };
    }
}
// ==================== [KERNEL PROTECTED END] ====================

module.exports = SecurityManager;
