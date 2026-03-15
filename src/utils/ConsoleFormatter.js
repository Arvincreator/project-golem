// ConsoleFormatter v10.0 — Clean console-style output for Telegram
class ConsoleFormatter {
    /**
     * Format action result for notification
     * @returns {string|null} null for L0 (silent)
     */
    static actionResult(level, cmd, result, success) {
        if (level === 'L0') return null;
        const status = success ? 'OK' : 'FAIL';
        const truncated = (result || '').length > 200 ? result.substring(0, 200) + '...' : (result || '');
        return `[${level}] ${cmd.substring(0, 80)}\n> ${status}: ${truncated}`;
    }

    /**
     * Format health dashboard for /status command
     */
    static healthDashboard(healthData) {
        const h = healthData || {};
        const brain = h.brain || {};
        const mem = brain.memory || {};
        const skills = h.skills || {};

        const lines = [
            `=== rendan status ===`,
            `engine: ${brain.engine || 'unknown'} | model: ${brain.apiModel || 'unknown'} | provider: ${brain.apiProvider || 'unknown'}`,
            `memory: core=${mem.core || 'N/A'} recall=${mem.recall || 'N/A'} archival=${mem.archival || 'N/A'}`,
            `skills: ${skills.loaded || 0} loaded | rag: ${brain.ragAvailable ? 'UP' : 'DOWN'}`,
            `uptime: ${h.uptimeHuman || '?'} | status: ${h.status || 'unknown'}`,
        ];
        return `<pre>${lines.join('\n')}</pre>`;
    }

    /**
     * Format metrics for /metrics command
     */
    static metrics(statsData) {
        const s = statsData || {};
        const mem = s.memory || {};
        const sys = s.system || {};

        const lines = [
            `=== rendan metrics ===`,
            `rss: ${mem.rss || 0} MB | heap: ${mem.heapUsed || 0}/${mem.heapTotal || 0} MB`,
            `cpu: ${s.cpu || 0}% | uptime: ${s.uptime || 0}s`,
            `sys_mem: ${Math.round((sys.freeMem || 0) / 1024)}/${Math.round((sys.totalMem || 0) / 1024)} GB free`,
            `load: ${(sys.loadAvg || [0, 0, 0]).map(l => l.toFixed(2)).join(' ')}`,
            `queue: ${(s.queue || {}).pending || 0} pending | l1_buf: ${(s.queue || {}).l1Buffer || 0}`,
        ];
        return `<pre>${lines.join('\n')}</pre>`;
    }

    /**
     * Format batch digest
     */
    static batchDigest(items) {
        if (!items || items.length === 0) return null;
        const lines = items.map(i => {
            const t = (i.time || '').slice(11, 19);
            return `${t} [${i.status || '?'}] ${(i.cmd || '').substring(0, 60)}`;
        });
        return `<pre>[L1 Digest: ${items.length} actions]\n${lines.join('\n')}</pre>`;
    }

    /**
     * Format task approval for L2/L3
     */
    static taskApproval(level, cmd, reason) {
        return `<b>[${level} ${level === 'L3' ? 'CRITICAL' : 'APPROVAL'}]</b> ${reason}\n<pre>${cmd}</pre>`;
    }

    /**
     * Format queue status for /q command
     */
    static queueStatus(pendingTasks, queueLength) {
        if (pendingTasks.size === 0 && queueLength === 0) {
            return '<pre>Queue empty. No pending tasks.</pre>';
        }
        const lines = [`=== queue status ===`, `pending_approval: ${pendingTasks.size}`, `queue_length: ${queueLength}`];
        if (pendingTasks.size > 0) {
            lines.push('---');
            let i = 0;
            for (const [id, task] of pendingTasks.entries()) {
                if (i >= 5) { lines.push(`... and ${pendingTasks.size - 5} more`); break; }
                const age = Math.round((Date.now() - task.timestamp) / 1000);
                lines.push(`${id.substring(0, 8)} (${age}s ago)`);
                i++;
            }
        }
        return `<pre>${lines.join('\n')}</pre>`;
    }
}

module.exports = ConsoleFormatter;
