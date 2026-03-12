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
        // L3: 高風險(刪除/權限/sudo) — 需要 Telegram 審批
        // ============================================================
        this._actionLog = [];
        this._errorHistory = [];
    }

    /**
     * 判斷技能類動作的風險等級 (L0-L3 分級)
     */
    classifyAction(action) {
        if (!action || !action.action) return 'L2';

        const act = String(action.action).toLowerCase();
        const task = String(action.task || '').toLowerCase();

        // ─── L0: 純讀取 / 資訊 / 控制流 ───
        const l0MoltbotTasks = ['feed', 'read_comments', 'read_post', 'my_profile', 'my_status', 'list_submolts', 'dm_list', 'search'];
        if (act === 'moltbot' && l0MoltbotTasks.includes(task)) return 'L0';

        // RAG 讀取類 = L0
        const l0RagTasks = ['query', 'q', 'search', 'stats', 's', 'lessons', 'l', 'recent', 'r', 'entity', 'e', 'health', 'h', 'local', 'local_stats'];
        if (act === 'rag' && l0RagTasks.includes(task)) return 'L0';

        // Fleet 讀取類 = L0
        const l0FleetTasks = ['status', 'dashboard', 'health', 'sweep', 'intel', 'fleet_status', 'revenue', 'revenue_dashboard', 'revenue_trends', 'system_dashboard', 'circuit', 'breaker'];
        if (act === 'fleet' && l0FleetTasks.includes(task)) return 'L0';

        // Selfheal 診斷類 = L0
        const l0SelfhealTasks = ['diagnose', 'scan', 'read', 'history', 'stats'];
        if (act === 'selfheal' && l0SelfhealTasks.includes(task)) return 'L0';

        // 排程/日誌/反思/noop/abort = L0
        if (['schedule', 'log-archive', 'reflection', 'noop', 'abort'].includes(act)) return 'L0';

        // Analytics 讀取 = L0
        if (act === 'analytics') return 'L0';

        // ─── L1: 低風險寫入 ───
        const l1MoltbotTasks = ['post', 'reply', 'vote', 'follow', 'unfollow', 'join_submolt', 'leave_submolt', 'dm_send', 'comment'];
        if (act === 'moltbot' && l1MoltbotTasks.includes(task)) return 'L1';

        // RAG 寫入類 = L1
        const l1RagTasks = ['ingest', 'write', 'evolve', 'learn', 'consolidate', 'c', 'sync', 'push', 'pull'];
        if (act === 'rag' && l1RagTasks.includes(task)) return 'L1';

        // Fleet 操作類 = L1
        const l1FleetTasks = ['intel_sweep', 'dispatch', 'generate_content', 'content_history', 'reset_circuit'];
        if (act === 'fleet' && l1FleetTasks.includes(task)) return 'L1';

        // Selfheal 修復類 = L1 (有備份+語法驗證保護)
        const l1SelfhealTasks = ['patch', 'fix', 'rollback', 'autofix', 'auto'];
        if (act === 'selfheal' && l1SelfhealTasks.includes(task)) return 'L1';

        // Community / Auto-optimizer = L1
        if (['community', 'auto-optimizer', 'optimizer'].includes(act)) return 'L1';

        // ─── L2: 中風險 ───
        if (act === 'command') return 'L2';
        if (act === 'multi_agent') return 'L2';
        if (act === 'evolution') return 'L2';

        // ─── 未知 = L2 ───
        return 'L2';
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
    assess(cmd) {
        const safeCmd = (cmd || "").trim();
        if (this.BLOCK_PATTERNS.some(regex => regex.test(safeCmd))) return { level: 'BLOCKED', reason: '毀滅性指令' };

        // 依然阻擋重導向 (> <) 與子殼層 ($() ``) 因為過於複雜且具破壞性
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
