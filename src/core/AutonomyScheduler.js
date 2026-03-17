// ============================================================
// AutonomyScheduler — v11.4 全自動自主運行排程器
// tick 模式 — 不擁有任何 timer，由 AutonomyManager.timeWatcher() 每 60s 呼叫
// env gate: ENABLE_V114_AUTONOMY=true
// ============================================================

const path = require('path');
const fs = require('fs');
const DebouncedWriter = require('../utils/DebouncedWriter');

const DEFAULT_SCAN_INTERVAL_MIN = 120;    // 2hr
const DEFAULT_DEBATE_INTERVAL_MIN = 180;  // 3hr
const DEFAULT_OPTIMIZE_INTERVAL_MIN = 60; // 1hr
const DEFAULT_RSS_HEAL_THRESHOLD = 350;   // MB
const DEFAULT_EPISODE_DEDUP_THRESHOLD = 50;
const MAX_HISTORY_SIZE = 50;

class AutonomyScheduler {
    constructor(options = {}) {
        this.golemId = options.golemId || 'default';
        this._scanner = options.scanner || null;
        this._council = options.council || null;
        this._optimizer = options.optimizer || null;
        this._ragProvider = options.ragProvider || null;
        this._agentBus = options.agentBus || null;

        // v11.5: New modules
        this._workerAuditor = options.workerAuditor || null;
        this._securityAuditor = options.securityAuditor || null;
        this._yerenBridge = options.yerenBridge || null;

        // Configurable intervals (minutes)
        this._scanIntervalMs = (parseInt(process.env.V114_SCAN_INTERVAL_MIN) || DEFAULT_SCAN_INTERVAL_MIN) * 60 * 1000;
        this._debateIntervalMs = (parseInt(process.env.V114_DEBATE_INTERVAL_MIN) || DEFAULT_DEBATE_INTERVAL_MIN) * 60 * 1000;
        this._optimizeIntervalMs = (parseInt(process.env.V114_OPTIMIZE_INTERVAL_MIN) || DEFAULT_OPTIMIZE_INTERVAL_MIN) * 60 * 1000;
        this._rssHealThreshold = parseInt(process.env.V114_RSS_HEAL_THRESHOLD) || DEFAULT_RSS_HEAL_THRESHOLD;
        this._episodeDedupThreshold = parseInt(process.env.V114_EPISODE_DEDUP_THRESHOLD) || DEFAULT_EPISODE_DEDUP_THRESHOLD;

        // v11.5: New intervals
        this._workerCheckIntervalMs = (parseInt(process.env.V115_WORKER_CHECK_INTERVAL_MIN) || 30) * 60 * 1000;
        this._securityAuditIntervalMs = (parseInt(process.env.V115_SECURITY_AUDIT_INTERVAL_MIN) || 360) * 60 * 1000;
        this._yerenSyncIntervalMs = (parseInt(process.env.V115_YEREN_SYNC_INTERVAL_MIN) || 60) * 60 * 1000;

        // Timestamps
        this._lastScan = 0;
        this._lastDebate = 0;
        this._lastOptimize = 0;
        this._lastWorkerCheck = 0;
        this._lastSecurityAudit = 0;
        this._lastYerenSync = 0;

        // Counters
        this._scanCount = 0;
        this._debateCount = 0;
        this._optimizeCount = 0;
        this._workerCheckCount = 0;
        this._securityAuditCount = 0;
        this._yerenSyncCount = 0;

        // Last results (for OODA context)
        this._lastScanReport = null;
        this._lastDebateResult = null;
        this._lastOptimizeReport = null;

        // History persistence
        this._history = [];
        const dataDir = path.resolve(process.cwd(), 'data');
        this._historyPath = path.join(dataDir, `v114_scan_history_${this.golemId}.json`);
        this._writer = new DebouncedWriter(this._historyPath, 3000);
        this._loadHistory();
    }

    /**
     * Main tick — called by AutonomyManager.timeWatcher() every 60s
     * @param {Object} systemState - { rss, uptime, episodeCount, tipCount }
     * @returns {Object} { action, summary }
     */
    async tick(systemState = {}) {
        const now = Date.now();
        const { rss = 0, uptime = 0, episodeCount = 0, tipCount = 0 } = systemState;

        // Priority 1: RSS threshold → emergency optimize
        if (rss > this._rssHealThreshold && this._optimizer) {
            try {
                const report = await this._optimizer.optimize();
                this._lastOptimize = now;
                this._optimizeCount++;
                this._lastOptimizeReport = report;
                this._appendHistory('rss_heal', { rss, report: this._summarizeReport(report) });
                return { action: 'rss_heal', summary: `RSS ${rss}MB > ${this._rssHealThreshold}MB, optimized` };
            } catch (e) {
                return { action: 'rss_heal_failed', summary: e.message };
            }
        }

        // Priority 2: Episode dedup threshold
        if (episodeCount > this._episodeDedupThreshold && this._optimizer) {
            try {
                const dedup = this._optimizer.deduplicateEpisodic();
                this._appendHistory('episode_dedup', { episodeCount, merged: dedup?.merged || 0 });
                return { action: 'episode_dedup', summary: `${episodeCount} episodes, merged ${dedup?.merged || 0}` };
            } catch (e) {
                return { action: 'episode_dedup_failed', summary: e.message };
            }
        }

        // Priority 3: Scan interval expired
        if (now - this._lastScan >= this._scanIntervalMs && this._scanner) {
            try {
                const report = await this._runScanPipeline();
                return { action: 'scan', summary: `Scan #${this._scanCount}: ${report?.totalFindings || 0} findings` };
            } catch (e) {
                return { action: 'scan_failed', summary: e.message };
            }
        }

        // Priority 4: Debate interval expired (needs scan data)
        if (now - this._lastDebate >= this._debateIntervalMs && this._council && this._lastScanReport) {
            try {
                const result = await this._runDebatePipeline();
                return { action: 'debate', summary: `Debate #${this._debateCount}: ${result?.perspectives?.length || 0} perspectives` };
            } catch (e) {
                return { action: 'debate_failed', summary: e.message };
            }
        }

        // Priority 5: Optimize interval expired
        if (now - this._lastOptimize >= this._optimizeIntervalMs && this._optimizer) {
            try {
                const report = await this._runOptimizePipeline();
                return { action: 'optimize', summary: `Optimize #${this._optimizeCount}: dedup=${report?.dedup?.merged || 0} decay=${report?.decay?.decayed || 0}` };
            } catch (e) {
                return { action: 'optimize_failed', summary: e.message };
            }
        }

        // Priority 6: Worker health check (v11.5)
        if (now - this._lastWorkerCheck >= this._workerCheckIntervalMs && this._workerAuditor) {
            try {
                const audit = await this._workerAuditor.auditAll();
                this._lastWorkerCheck = now;
                this._workerCheckCount++;
                this._appendHistory('worker_health_check', { healthy: audit.summary.healthy, unhealthy: audit.summary.unhealthy });
                return { action: 'worker_health_check', summary: `Worker check #${this._workerCheckCount}: ${audit.summary.healthy}/${audit.summary.total} healthy` };
            } catch (e) {
                return { action: 'worker_health_check_failed', summary: e.message };
            }
        }

        // Priority 7: Security audit (v11.5)
        if (now - this._lastSecurityAudit >= this._securityAuditIntervalMs && this._securityAuditor) {
            try {
                const report = await this._securityAuditor.generateAuditReport();
                this._lastSecurityAudit = now;
                this._securityAuditCount++;
                this._appendHistory('security_audit', { riskScore: report.riskScore, risks: report.risks.length });
                return { action: 'security_audit', summary: `Security audit #${this._securityAuditCount}: risk=${report.riskScore}, ${report.risks.length} risks` };
            } catch (e) {
                return { action: 'security_audit_failed', summary: e.message };
            }
        }

        // Priority 8: Yeren sync (v11.5)
        if (now - this._lastYerenSync >= this._yerenSyncIntervalMs && this._yerenBridge) {
            try {
                const mem = this._yerenBridge.syncMemory();
                const scan = this._yerenBridge.syncScanResults();
                this._lastYerenSync = now;
                this._yerenSyncCount++;
                this._appendHistory('yeren_sync', { memSynced: mem.synced.length, scanSynced: scan.synced });
                return { action: 'yeren_sync', summary: `Yeren sync #${this._yerenSyncCount}: mem=${mem.synced.length}, scan=${scan.synced}` };
            } catch (e) {
                return { action: 'yeren_sync_failed', summary: e.message };
            }
        }

        // Nothing to do
        return { action: 'noop', summary: `rss=${rss} up=${uptime}s ep=${episodeCount} tips=${tipCount}` };
    }

    /**
     * Run full scan pipeline: scan → ingest → publish
     */
    async _runScanPipeline() {
        const scanReport = await this._scanner.fullScan();
        this._lastScan = Date.now();
        this._scanCount++;
        this._lastScanReport = scanReport;

        // Ingest findings into RAG
        try {
            await this._scanner.ingestFindings(scanReport);
        } catch (e) { /* non-blocking */ }

        // Publish to AgentBus
        if (this._agentBus) {
            try {
                this._agentBus.publish('autonomy.scan', {
                    type: 'scan_complete',
                    scanCount: this._scanCount,
                    findings: scanReport?.totalFindings || 0,
                    source: `scheduler:${this.golemId}`,
                }, `scheduler:${this.golemId}`);
            } catch (e) { /* non-blocking */ }
        }

        this._appendHistory('scan', { findings: scanReport?.totalFindings || 0 });
        return scanReport;
    }

    /**
     * Run debate pipeline: debate → publish
     */
    async _runDebatePipeline() {
        const debateResult = await this._council.debate(this._lastScanReport);
        this._lastDebate = Date.now();
        this._debateCount++;
        this._lastDebateResult = debateResult;

        // Publish results
        try {
            await this._council.publishResults(debateResult);
        } catch (e) { /* non-blocking */ }

        // AgentBus
        if (this._agentBus) {
            try {
                this._agentBus.publish('autonomy.debate', {
                    type: 'debate_complete',
                    debateCount: this._debateCount,
                    perspectives: debateResult?.perspectives?.length || 0,
                    source: `scheduler:${this.golemId}`,
                }, `scheduler:${this.golemId}`);
            } catch (e) { /* non-blocking */ }
        }

        this._appendHistory('debate', { perspectives: debateResult?.perspectives?.length || 0 });
        return debateResult;
    }

    /**
     * Run optimize pipeline
     */
    async _runOptimizePipeline() {
        const report = await this._optimizer.optimize();
        this._lastOptimize = Date.now();
        this._optimizeCount++;
        this._lastOptimizeReport = report;

        this._appendHistory('optimize', { report: this._summarizeReport(report) });
        return report;
    }

    /**
     * Get scheduler status for status reports
     */
    getStatus() {
        return {
            lastScan: this._lastScan,
            lastDebate: this._lastDebate,
            lastOptimize: this._lastOptimize,
            lastWorkerCheck: this._lastWorkerCheck,
            lastSecurityAudit: this._lastSecurityAudit,
            lastYerenSync: this._lastYerenSync,
            scanCount: this._scanCount,
            debateCount: this._debateCount,
            optimizeCount: this._optimizeCount,
            workerCheckCount: this._workerCheckCount,
            securityAuditCount: this._securityAuditCount,
            yerenSyncCount: this._yerenSyncCount,
            historySize: this._history.length,
        };
    }

    /**
     * Get last decision context for OODALoop orient()
     */
    getLastDecisionContext() {
        const hasActionableFindings = !!(
            this._lastScanReport &&
            (this._lastScanReport.totalFindings || 0) > 0 &&
            Date.now() - this._lastScan < this._debateIntervalMs
        );

        const needsOptimization = !!(
            this._lastOptimizeReport &&
            ((this._lastOptimizeReport.dedup?.merged || 0) > 5 ||
             (this._lastOptimizeReport.decay?.decayed || 0) > 10)
        );

        return {
            hasActionableFindings,
            needsOptimization,
            scanCount: this._scanCount,
            debateCount: this._debateCount,
            optimizeCount: this._optimizeCount,
            lastScanAge: this._lastScan ? Date.now() - this._lastScan : null,
        };
    }

    // ── Persistence ──

    _loadHistory() {
        try {
            if (fs.existsSync(this._historyPath)) {
                const raw = fs.readFileSync(this._historyPath, 'utf-8');
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    this._history = parsed.slice(-MAX_HISTORY_SIZE);
                }
            }
        } catch (e) {
            console.warn('[AutonomyScheduler] History load failed:', e.message);
            this._history = [];
        }
    }

    _saveHistory() {
        try {
            this._writer.markDirty(JSON.stringify(this._history, null, 2));
        } catch (e) {
            console.warn('[AutonomyScheduler] History save failed:', e.message);
        }
    }

    _appendHistory(action, details) {
        this._history.push({
            timestamp: new Date().toISOString(),
            action,
            details,
        });
        // Cap history
        if (this._history.length > MAX_HISTORY_SIZE) {
            this._history = this._history.slice(-MAX_HISTORY_SIZE);
        }
        this._saveHistory();
    }

    _summarizeReport(report) {
        if (!report) return null;
        return {
            dedup: report.dedup?.merged || 0,
            decay: report.decay?.decayed || 0,
            selfHeal: report.selfHeal?.repaired || 0,
        };
    }
}

module.exports = AutonomyScheduler;
