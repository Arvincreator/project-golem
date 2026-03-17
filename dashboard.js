/**
 * 檔案名稱: dashboard.js
 * 版本: v9.1 (MultiAgent Monitor)
 * ---------------------------------------
 * 更新重點：
 * 1. 🟢 適配 v9.1 核心架構。
 * 2. 👥 新增 MultiAgent 活動監控 (青色顯示)。
 * 3. 🎨 介面標題與狀態更新，保留所有 v8.6 功能。
 */
const os = require('os');
const TerminalView = require('./src/views/TerminalView');
const DashboardManager = require('./src/managers/DashboardManager');
const ConsoleInterceptor = require('./src/utils/ConsoleInterceptor');

let WebServer = null;
try {
    WebServer = require('./web-dashboard/server');
} catch (e) {
    console.error("⚠️  Web Dashboard module not found or failed to load:", e.message);
}

class DashboardPlugin {
    constructor() {
        // 1. 保存原始的 Console 方法並初始化 UI 元件與管理器
        this.manager = new DashboardManager();
        // 初始化螢幕 (如果沒有禁用 TUI 則開啟)
        // Web Dashboard 強制啟用，停用 Terminal TUI 模式
        this.useTUI = process.env.DISABLE_TUI !== 'true' && process.env.FORCE_TUI === 'true';

        if (this.useTUI) {
            this.view = new TerminalView({
                title: '🦞 Golem v9.1 戰術控制台 (MultiAgent Edition)',
                onExit: () => this.detach()
            });
        } else {
            console.log("📺 [Dashboard] Terminal TUI mode disabled. Using raw console mode.");
        }

        // 啟動 Web Server (保留 v8.6 Web 介面功能)
        this._initWebServer();

        // 6. 啟動攔截器 (Hijack Console)
        ConsoleInterceptor.hijack({
            onLog: (args) => this._handleLog(args),
            onError: (args) => this._handleError(args)
        });

        this.startMonitoring();
    }

    _initWebServer() {
        if (WebServer) {
            try {
                this.webServer = new WebServer(this);
            } catch (e) {
                console.error("❌ Failed to start Web Dashboard:", e.message);
            }
        }
    }

    _handleLog(args) {
        if (this.manager.state.isDetached) return;

        const { type, msg, cleanMsg, raw } = this.manager.dispatchLog(args);
        const time = new Date().toLocaleTimeString();

        // 更新 UI (使用與原始代碼一致的著色標籤)
        const tags = {
            chronos: { start: '{yellow-fg}', end: '{/yellow-fg}' },
            agent: { start: '{cyan-fg}', end: '{/cyan-fg}' },
            queue: { start: '{magenta-fg}', end: '{/magenta-fg}' }
        };

        const tag = tags[type] || { start: '', end: '' };
        if (this.view) {
            this.view.log(type, `${tag.start}${raw}${tag.end}`);
        }

        // Web 廣播
        if (this.webServer) {
            this.webServer.broadcastLog({ time, msg: cleanMsg, type, raw });
            this.webServer.broadcastState({
                queueCount: this.manager.state.queueCount,
                lastSchedule: this.manager.state.lastSchedule
            });
        }
    }

    _handleError(args) {
        if (this.manager.state.isDetached) return;
        const util = require('util');
        const msg = args.map(a => {
            if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack}`;
            if (typeof a === 'object' && a !== null) {
                if (a.stack || a.message) return `${a.name || 'Error'}: ${a.message || ''}\n${a.stack || ''}`;
                return util.inspect(a, { depth: 1, colors: false });
            }
            return String(a);
        }).join(' ');

        if (this.view) {
            this.view.log('error', `{red-fg}[錯誤] ${msg}{/red-fg}`);
        }
        if (this.webServer) {
            this.webServer.broadcastLog({ time: new Date().toLocaleTimeString(), msg, type: 'error' });
        }
    }

    startMonitoring() {
        let lastCpuUsage = this._getCPUInfo();

        this.timer = setInterval(() => {
            if (this.manager.state.isDetached) return clearInterval(this.timer);

            // CPU Usage Calculation
            const currentCpuUsage = this._getCPUInfo();
            const idleDiff = currentCpuUsage.idle - lastCpuUsage.idle;
            const totalDiff = currentCpuUsage.total - lastCpuUsage.total;
            const cpuUsagePerc = totalDiff > 0 ? (1 - idleDiff / totalDiff) * 100 : 0;
            lastCpuUsage = currentCpuUsage;

            const memUsage = process.memoryUsage().heapUsed / 1024 / 1024;
            const metricsData = this.manager.updateMetrics(memUsage);

            const mode = process.env.GOLEM_MEMORY_MODE || 'Browser';
            const uptime = Math.floor(process.uptime());
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const uptimeStr = `${hours}h ${minutes}m`;

            if (this.view) {
                this.view.updateMetrics(metricsData);
                this.view.updateStatus(this.manager.getSystemStatus(mode, uptimeStr));
            }

            if (this.webServer) {
                this.webServer.broadcastHeartbeat({
                    memUsage,
                    uptime: uptimeStr,
                    cpu: parseFloat(cpuUsagePerc.toFixed(1))
                });
            }
        }, 1000);
    }

    _getCPUInfo() {
        const cpus = os.cpus();
        let idle = 0;
        let total = 0;
        cpus.forEach(cpu => {
            for (const type in cpu.times) {
                total += cpu.times[type];
            }
            idle += cpu.times.idle;
        });
        return { idle, total };
    }

    detach() {
        this.manager.state.isDetached = true;
        ConsoleInterceptor.restore();
        if (this.view) this.view.destroy();

        if (this.webServer) {
            this.webServer.stop();
            ConsoleInterceptor.originalLog("🌐 Web Dashboard has been stopped.");
        }

        process.stdout.write("\n============================================\n");
        process.stdout.write("📺 Dashboard 已關閉 (Visual Interface Detached)\n");
        process.stdout.write("🤖 Golem v9.1 仍在背景執行中...\n");
        process.stdout.write("============================================\n\n");
    }

    setContext(golemId, brain, memory, autonomy) {
        if (this.webServer) {
            this.webServer.setContext(golemId, brain, memory, autonomy);
        }
    }

    removeContext(golemId) {
        if (this.webServer) {
            this.webServer.removeContext(golemId);
        }
    }
}

module.exports = new DashboardPlugin();
