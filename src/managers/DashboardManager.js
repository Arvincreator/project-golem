/**
 * 🧠 DashboardManager - 負責 Dashboard 的業務邏輯與狀態管理
 */
class DashboardManager {
    constructor() {
        this.state = {
            queueCount: 0,
            lastSchedule: "無排程",
            isDetached: false,
            agentWorkersActive: 0,
            agentWorkerTimeouts: 0,
            agentWorkerSendTimeouts: 0,
            agentWorkerIdleTimeouts: 0,
            agentWorkerDraftPendingChecks: 0,
            lastAgentWorkerEvent: "無事件"
        };
        this._agentWorkerRegistry = new Set();
        // 4. 資料初始化
        this.metrics = {
            title: 'Memory (MB)',
            x: Array(60).fill(0).map((_, i) => i.toString()),
            y: Array(60).fill(0)
        };
    }

    /**
     * 解析日誌內容並決定分流類型
     */
    dispatchLog(args) {
        let attachment = null;
        // 🚀 [v9.1.10] 提取附加檔案 Metadata
        const lastArg = args[args.length - 1];
        if (typeof lastArg === 'object' && lastArg !== null && lastArg.attachment) {
            attachment = lastArg.attachment;
        }

        const util = require('util');
        const msg = args.map(a => {
            if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack}`;
            if (typeof a === 'object' && a !== null) {
                // 如果是 metadata 物件且裡面有 attachment，在字串化日誌中可略過或簡化
                if (a.attachment) return ''; 
                if (a.stack || a.message) return `${a.name || 'Error'}: ${a.message || ''}\n${a.stack || ''}`;
                return util.inspect(a, { depth: 1, colors: false });
            }
            return String(a);
        }).filter(s => s !== '').join(' ');
        const cleanMsg = msg.replace(/\u001b\[.*?m/g, '').replace(/\{.*?\}/g, '');

        // 分流邏輯 - 根據日誌關鍵字決定顯示區域
        let type = 'general';
        if (cleanMsg.includes('[Chronos]') || cleanMsg.includes('排程') || cleanMsg.includes('TimeWatcher')) {
            type = 'chronos';
            if (cleanMsg.includes('新增排程')) {
                // 解析排程內容
                this.state.lastSchedule = (cleanMsg.split('新增排程:')[1] || "更新中...").trim();
            }
        } else if (cleanMsg.includes('[MultiAgent]') || cleanMsg.includes('[InteractiveMultiAgent]')) {
            // v9.1 新增：捕捉 MultiAgent 會議紀錄
            type = 'agent';
            this._handleAgentWorkerLifecycle(cleanMsg);
        } else if (cleanMsg.includes('[Queue]') || cleanMsg.includes('隊列')) {
            // 處理隊列流量監控
            type = 'queue';
            if (cleanMsg.includes('加入隊列')) this.state.queueCount++;
            if (cleanMsg.includes('開始處理')) this.state.queueCount = Math.max(0, this.state.queueCount - 1);
        } else if (cleanMsg.includes('[Memory]') || cleanMsg.includes('[Memory:Browser]')) {
            type = 'memory';
        }

        return { type, msg, cleanMsg, raw: msg };
    }

    _handleAgentWorkerLifecycle(cleanMsg) {
        const match = cleanMsg.match(/\[InteractiveMultiAgent\]\[WorkerLifecycle\]\s+(.+)$/);
        if (!match) return;

        const kvRaw = match[1].trim().split(/\s+/);
        const kv = {};
        kvRaw.forEach(part => {
            const idx = part.indexOf('=');
            if (idx <= 0) return;
            const key = part.slice(0, idx);
            const value = part.slice(idx + 1);
            kv[key] = value;
        });

        const event = String(kv.event || '').toLowerCase();
        const agentKey = String(kv.agentKey || kv.agent || '').toLowerCase();
        const timeoutKind = String(kv.timeoutKind || '').toLowerCase();

        if (!event) return;

        if (['spawned', 'recreated', 'recovered', 'on_demand'].includes(event) && agentKey) {
            this._agentWorkerRegistry.add(agentKey);
        }

        if (['disposed', 'idle_timeout', 'timeout', 'fallback_main', 'spawn_failed', 'timeout_after_recovery'].includes(event) && agentKey) {
            this._agentWorkerRegistry.delete(agentKey);
        }

        const isSendTimeout = event === 'timeout'
            || event === 'timeout_after_recovery'
            || timeoutKind === 'send';
        const isIdleTimeout = event === 'idle_timeout'
            || timeoutKind === 'idle';

        if (isSendTimeout || isIdleTimeout) {
            this.state.agentWorkerTimeouts += 1;
        }
        if (isSendTimeout) {
            this.state.agentWorkerSendTimeouts += 1;
        }
        if (isIdleTimeout) {
            this.state.agentWorkerIdleTimeouts += 1;
        }
        if (event === 'draft_pending') {
            this.state.agentWorkerDraftPendingChecks += 1;
        }

        this.state.agentWorkersActive = this._agentWorkerRegistry.size;
        const at = new Date().toLocaleTimeString();
        this.state.lastAgentWorkerEvent = `${event}${agentKey ? `(${agentKey})` : ''} @ ${at}`;
    }

    updateMetrics(value) {
        this.metrics.y.shift();
        this.metrics.y.push(value);
        return [this.metrics];
    }

    getSystemStatus(mode, uptime) {
        return `
# 核心狀態 (v9.1)
- **模式**: ${mode}
- **架構**: Multi-Agent
- **運行**: ${uptime}

# System Modules
- **Chronos**: Online
- **Agents**: Ready
- **狀態**: 🟢 Online
- **隊列**: ${this.state.queueCount}
- **排程**: ${this.state.lastSchedule}
- **Agent Workers**: ${this.state.agentWorkersActive} active / ${this.state.agentWorkerTimeouts} timeout
- **Agent Worker Send Timeout**: ${this.state.agentWorkerSendTimeouts}
- **Agent Worker Idle Timeout**: ${this.state.agentWorkerIdleTimeouts}
- **Agent Worker Draft Pending**: ${this.state.agentWorkerDraftPendingChecks}
- **Agent Worker Last**: ${this.state.lastAgentWorkerEvent}
`;
    }
}

module.exports = DashboardManager;
