/**
 * 🧠 DashboardManager - 負責 Dashboard 的業務邏輯與狀態管理
 */
class DashboardManager {
    constructor() {
        this.state = {
            queueCount: 0,
            lastSchedule: "無排程",
            isDetached: false
        };
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
        const util = require('util');
        const msg = args.map(a => {
            if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack}`;
            if (typeof a === 'object' && a !== null) {
                if (a.stack || a.message) return `${a.name || 'Error'}: ${a.message || ''}\n${a.stack || ''}`;
                return util.inspect(a, { depth: 1, colors: false });
            }
            return String(a);
        }).join(' ');
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
`;
    }
}

module.exports = DashboardManager;
