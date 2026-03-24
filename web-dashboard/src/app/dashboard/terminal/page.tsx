"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Terminal as TerminalIcon, Cpu, Activity, RefreshCw, Zap, LayoutDashboard, ShieldCheck, Play } from "lucide-react";
import { LogStream } from "@/components/LogStream";
import { socket } from "@/lib/socket";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SystemActionDialogs } from "@/components/SystemActionDialogs";
import { useGolem } from "@/components/GolemContext";
import { useToast } from "@/components/ui/toast-provider";
import { apiGet, apiPost } from "@/lib/api-client";
import { useI18n } from "@/components/I18nProvider";

type MetricsState = {
    uptime: string;
    queueCount: number;
    lastSchedule: string;
    memUsage: number;
    cpuUsage: number;
};

type TimePoint = {
    time: string;
    value: number;
};

type HoveredPoint = TimePoint & {
    x: number;
    y: number;
    type: "mem" | "cpu";
};

type SystemStatusData = {
    runtime?: {
        osName?: string;
        uptime?: number;
        platform?: string;
    };
    health?: {
        env?: boolean;
        deps?: boolean;
        core?: boolean;
    };
    system?: {
        diskAvail?: string;
        freeMem?: string;
    };
};

type MetricsUpdatePayload = Partial<Pick<MetricsState, "uptime" | "queueCount" | "lastSchedule" | "memUsage" | "cpuUsage">>;

type HeartbeatPayload = {
    uptime?: string;
    memUsage?: number;
    cpu?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function parseNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function parseMetricsUpdate(payload: unknown): MetricsUpdatePayload | null {
    if (!isRecord(payload)) return null;
    const patch: MetricsUpdatePayload = {};

    if (typeof payload.uptime === "string") patch.uptime = payload.uptime;
    if (typeof payload.lastSchedule === "string") patch.lastSchedule = payload.lastSchedule;
    const queueCount = parseNumber(payload.queueCount);
    if (queueCount !== null) patch.queueCount = queueCount;
    const memUsage = parseNumber(payload.memUsage);
    if (memUsage !== null) patch.memUsage = memUsage;
    const cpuUsage = parseNumber(payload.cpuUsage);
    if (cpuUsage !== null) patch.cpuUsage = cpuUsage;

    return Object.keys(patch).length > 0 ? patch : null;
}

function parseHeartbeat(payload: unknown): HeartbeatPayload | null {
    if (!isRecord(payload)) return null;
    const memUsage = parseNumber(payload.memUsage);
    if (memUsage === null) return null;

    const heartbeat: HeartbeatPayload = { memUsage };
    if (typeof payload.uptime === "string") heartbeat.uptime = payload.uptime;
    const cpu = parseNumber(payload.cpu);
    if (cpu !== null) heartbeat.cpu = cpu;
    return heartbeat;
}

function parseSystemStatus(payload: unknown): SystemStatusData | null {
    if (!isRecord(payload)) return null;
    const status: SystemStatusData = {};

    if (isRecord(payload.runtime)) {
        const uptime = parseNumber(payload.runtime.uptime);
        status.runtime = {
            osName: typeof payload.runtime.osName === "string" ? payload.runtime.osName : undefined,
            platform: typeof payload.runtime.platform === "string" ? payload.runtime.platform : undefined,
            uptime: uptime ?? undefined,
        };
    }

    if (isRecord(payload.health)) {
        status.health = {
            env: typeof payload.health.env === "boolean" ? payload.health.env : undefined,
            deps: typeof payload.health.deps === "boolean" ? payload.health.deps : undefined,
            core: typeof payload.health.core === "boolean" ? payload.health.core : undefined,
        };
    }

    if (isRecord(payload.system)) {
        status.system = {
            diskAvail: typeof payload.system.diskAvail === "string" ? payload.system.diskAvail : undefined,
            freeMem: typeof payload.system.freeMem === "string" ? payload.system.freeMem : undefined,
        };
    }

    return status;
}

export default function TerminalPage() {
    const toast = useToast();
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    const { activeGolem, activeGolemStatus, startGolem } = useGolem();
    const [metrics, setMetrics] = useState<MetricsState>({
        uptime: "0h 0m",
        queueCount: 0,
        lastSchedule: "N/A",
        memUsage: 0,
        cpuUsage: 0,
    });

    const [memHistory, setMemHistory] = useState<TimePoint[]>([]);
    const [cpuHistory, setCpuHistory] = useState<TimePoint[]>([]);
    const [hoveredPoint, setHoveredPoint] = useState<HoveredPoint | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [systemStatus, setSystemStatus] = useState<SystemStatusData | null>(null);

    const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'LOGS'>('OVERVIEW');

    // Dialog states
    const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; variant: "restart" | "shutdown" | "start" }>({
        open: false, variant: "restart"
    });
    const [doneDialog, setDoneDialog] = useState<{ open: boolean; variant: "restarted" | "shutdown" | "started" }>({
        open: false, variant: "restarted"
    });
    const [isLoading, setIsLoading] = useState(false);

    // 開啟確認 dialog
    const openConfirm = (variant: "restart" | "shutdown" | "start") => {
        setConfirmDialog({ open: true, variant });
    };

    // 執行重啟 (reload)
    const handleReload = async () => {
        setIsLoading(true);
        try {
            const data = await apiPost<{ success?: boolean }>("/api/system/reload");
            if (data.success) {
                setConfirmDialog(prev => ({ ...prev, open: false }));
                setDoneDialog({ open: true, variant: "restarted" });
                setTimeout(() => window.location.reload(), 3000);
            }
        } catch (e) {
            console.error("Reload failed:", e);
        } finally {
            setIsLoading(false);
        }
    };

    // 執行關閉 (Shutdown the entire system)
    const handleShutdown = async () => {
        setIsLoading(true);
        try {
            const data = await apiPost<{ success?: boolean }>("/api/system/shutdown");
            if (data.success) {
                setConfirmDialog(prev => ({ ...prev, open: false }));
                setDoneDialog({ open: true, variant: "shutdown" });
                // 一秒後自動重整頁面，觸發 GolemContext 的離線處理邏輯，讓「啟動」按鈕變為可按
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            }
        } catch (e) {
            console.error("Shutdown failed:", e);
            // Even if connection fails (because server is shutting down), consider it a success
            setConfirmDialog(prev => ({ ...prev, open: false }));
            setDoneDialog({ open: true, variant: "shutdown" });
        } finally {
            setIsLoading(false);
        }
    };

    // 執行啟動 (start)
    const handleStart = async () => {
        // 在單機模式下，如果 activeGolem 為空 (例如已斷連)，預設使用 golem_A
        const golemId = activeGolem || "golem_A";
        setIsLoading(true);
        try {
            const success = await startGolem(golemId);
            if (success) {
                setConfirmDialog(prev => ({ ...prev, open: false }));
                setDoneDialog({ open: true, variant: "started" });
            } else {
                toast.error(
                    isEnglish ? "Start failed" : "啟動失敗",
                    isEnglish ? "Backend timeout or not ready. Please try again later." : "後端服務逾時或未就緒。請稍後再試。"
                );
            }
        } catch (e) {
            console.error("Start failed:", e);
            toast.error(
                isEnglish ? "Start failed" : "啟動失敗",
                isEnglish ? "An error occurred while starting. Please check logs." : "啟動過程發生錯誤，請查看控制台日誌。"
            );
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirm = () => {
        if (confirmDialog.variant === "restart") handleReload();
        else if (confirmDialog.variant === "shutdown") handleShutdown();
        else handleStart();
    };

    const handleClearLogs = () => {
        (window as Window & { clearLogs?: () => void }).clearLogs?.();
    };

    useEffect(() => {
        const handleConnect = () => setIsConnected(true);
        const handleDisconnect = () => setIsConnected(false);
        const handleInit = (payload: unknown) => {
            const patch = parseMetricsUpdate(payload);
            if (!patch) return;
            setMetrics((prev) => ({ ...prev, ...patch }));
        };
        const handleStateUpdate = (payload: unknown) => {
            const patch = parseMetricsUpdate(payload);
            if (!patch) return;
            setMetrics((prev) => ({ ...prev, ...patch }));
        };
        const handleHeartbeat = (payload: unknown) => {
            const heartbeat = parseHeartbeat(payload);
            if (!heartbeat) return;

            const timeStr = new Date().toLocaleTimeString(locale, { hour12: false });
            setMetrics((prev) => ({
                ...prev,
                uptime: heartbeat.uptime ?? prev.uptime,
                memUsage: heartbeat.memUsage ?? prev.memUsage,
                cpuUsage: heartbeat.cpu ?? prev.cpuUsage,
            }));

            setMemHistory((prev) => {
                const newData = [...prev, { time: timeStr, value: Number(heartbeat.memUsage?.toFixed(1) ?? "0") }];
                return newData.slice(-60);
            });

            if (heartbeat.cpu !== undefined) {
                setCpuHistory((prev) => {
                    const newData = [...prev, { time: timeStr, value: Number(heartbeat.cpu?.toFixed(1) ?? "0") }];
                    return newData.slice(-60);
                });
            }
        };

        socket.on("connect", handleConnect);
        socket.on("disconnect", handleDisconnect);
        setIsConnected(socket.connected);

        socket.on("init", handleInit);
        socket.on("state_update", handleStateUpdate);
        socket.on("heartbeat", handleHeartbeat);

        // Fetch full system status
        const fetchFullStatus = async () => {
            try {
                const data = await apiGet<unknown>("/api/system/status");
                const parsed = parseSystemStatus(data);
                if (parsed) setSystemStatus(parsed);
            } catch {
                // Silently handle connection errors
                console.debug("Backend unavailable (fetchFullStatus)");
            }
        };

        fetchFullStatus();
        const interval = setInterval(fetchFullStatus, 30000); // 30s refresh

        return () => {
            socket.off("connect", handleConnect);
            socket.off("disconnect", handleDisconnect);
            socket.off("init", handleInit);
            socket.off("state_update", handleStateUpdate);
            socket.off("heartbeat", handleHeartbeat);
            clearInterval(interval);
        };
    }, [locale]);

    const handleChartHover = (e: MouseEvent<SVGSVGElement>, history: TimePoint[], type: "mem" | "cpu") => {
        if (history.length < 2) return;
        const svg = e.currentTarget;
        const rect = svg.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const width = rect.width;

        const index = Math.round((mouseX / width) * (history.length - 1));
        const safeIndex = Math.max(0, Math.min(history.length - 1, index));
        const point = history[safeIndex];

        const max = type === "mem" ? Math.max(100, ...history.map((metric) => metric.value)) * 1.2 : 100;
        const y = 100 - (point.value / max) * 100;

        setHoveredPoint({
            ...point,
            x: (safeIndex / (history.length - 1)) * 1000,
            y,
            type,
        });
    };

    return (
        <div className="min-h-screen flex flex-col bg-background font-sans selection:bg-primary/30">
            {/* Header bar - Sticky */}
            <div className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-md p-4 flex items-center justify-between shadow-sm flex-none">
                <div className="flex items-center space-x-4">
                    <div className="p-2 bg-primary/10 rounded-xl border border-primary/20 shadow-[0_0_15px_rgba(var(--primary),0.1)]">
                        <TerminalIcon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                        <h2 className="text-base font-bold text-foreground tracking-tight">Terminal Dashboard</h2>
                        <div className="flex items-center space-x-2">
                            <p className="text-xs text-muted-foreground font-medium">
                                {isEnglish ? "Real-time monitoring dashboard for Golem core system" : "Golem 核心系統即時監測儀表板"}
                            </p>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border font-mono">{systemStatus?.runtime?.osName || "Loading..."}</span>
                        </div>
                    </div>
                </div>

                <div className="flex bg-muted/50 p-1 rounded-xl border border-border/50">
                    <button
                        onClick={() => setActiveTab('OVERVIEW')}
                        className={cn(
                            "px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 flex items-center space-x-2",
                            activeTab === 'OVERVIEW' ? "bg-background text-primary shadow-sm border border-border/50" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <LayoutDashboard className="w-3.5 h-3.5" />
                        <span>{isEnglish ? "Overview" : "核心監視"}</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('LOGS')}
                        className={cn(
                            "px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 flex items-center space-x-2",
                            activeTab === 'LOGS' ? "bg-background text-primary shadow-sm border border-border/50" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <TerminalIcon className="w-3.5 h-3.5" />
                        <span>{isEnglish ? "Logs" : "日誌串流"}</span>
                    </button>
                </div>

                <div className="flex items-center space-x-3">
                    <div className={cn(
                        "flex items-center space-x-2 text-[10px] uppercase tracking-widest font-bold bg-secondary/50 px-3 py-1.5 rounded-full border border-border text-foreground/80",
                    )}>
                        <Activity className="w-3 h-3 text-primary animate-pulse" />
                        <span>
                            {typeof systemStatus?.runtime?.uptime === "number"
                                ? `${Math.floor(systemStatus.runtime.uptime / 3600)}h ${Math.floor((systemStatus.runtime.uptime % 3600) / 60)}m`
                                : metrics.uptime}
                        </span>
                    </div>
                    <div className={cn(
                        "flex items-center space-x-2 text-[10px] uppercase tracking-widest font-bold bg-secondary/50 px-3 py-1.5 rounded-full border border-border",
                        isConnected ? "text-primary border-primary/20" : "text-destructive border-destructive/20"
                    )}>
                        <div className={cn(
                            "w-1.5 h-1.5 rounded-full",
                            isConnected ? "bg-primary shadow-[0_0_8px_rgba(var(--primary),0.5)] animate-pulse" : "bg-destructive"
                        )}></div>
                        <span>{isConnected ? (isEnglish ? "Online" : "系統在線") : (isEnglish ? "Offline" : "系統離線")}</span>
                    </div>
                </div>
            </div>

            {/* Terminal Container - Fluid Scroll */}
            <div className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-8 pb-20">

                {/* Tab: Overview (Fluid Layout) */}
                <div className={cn(
                    "flex flex-col space-y-8 transition-all duration-500",
                    activeTab === 'OVERVIEW' ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8 pointer-events-none hidden"
                )}>
                    {/* System Metrics (Fluid) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <MetricChart
                            title={isEnglish ? "Memory Snapshot" : "記憶體使用率快照"}
                            value={metrics.memUsage.toFixed(1)}
                            unit="MB"
                            history={memHistory}
                            hoveredPoint={hoveredPoint?.type === "mem" ? hoveredPoint : null}
                            onHover={(e: MouseEvent<SVGSVGElement>) => handleChartHover(e, memHistory, "mem")}
                            onLeave={() => setHoveredPoint(null)}
                            gradientId="memGradient"
                            color="primary"
                            icon={<Activity className="w-4 h-4" />}
                        />
                        <MetricChart
                            title={isEnglish ? "CPU Performance" : "CPU 效能指數"}
                            value={metrics.cpuUsage.toFixed(1)}
                            unit="%"
                            history={cpuHistory}
                            hoveredPoint={hoveredPoint?.type === "cpu" ? hoveredPoint : null}
                            onHover={(e: MouseEvent<SVGSVGElement>) => handleChartHover(e, cpuHistory, "cpu")}
                            onLeave={() => setHoveredPoint(null)}
                            gradientId="cpuGradient"
                            color="cyan"
                            icon={<Cpu className="w-4 h-4" />}
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
                        {/* Middle Panels */}
                        <div className="md:col-span-4 space-y-8">
                            {/* System Status */}
                            <div className="bg-card border border-border rounded-2xl flex flex-col overflow-hidden shadow-sm">
                                <PanelHeader icon={<ShieldCheck className="w-3 h-3" />} title={isEnglish ? "System Status" : "系統狀態"} />
                                <div className="p-6 text-sm font-mono bg-background/50">
                                    <ul className="space-y-4">
                                        <StatusItem label={isEnglish ? "Core Mode" : "核心模擬"} value={systemStatus?.runtime?.platform?.toUpperCase() || "N/A"} icon={<Cpu className="w-3 h-3" />} />
                                        <StatusItem label={isEnglish ? "Environment" : "環境配置"} value={systemStatus?.health?.env ? (isEnglish ? "Loaded" : "已載入") : (isEnglish ? "Error" : "錯誤")} color={systemStatus?.health?.env ? "primary" : "destructive"} />
                                        <StatusItem label={isEnglish ? "Dependencies" : "依賴項目"} value={systemStatus?.health?.deps ? (isEnglish ? "Healthy" : "正常") : (isEnglish ? "Check" : "檢查")} color={systemStatus?.health?.deps ? "primary" : "destructive"} />
                                        <StatusItem label={isEnglish ? "Core Service" : "核心服務"} value={systemStatus?.health?.core ? (isEnglish ? "Online" : "在線") : (isEnglish ? "Offline" : "離線")} color={systemStatus?.health?.core ? "primary" : "destructive"} />
                                        <StatusItem label={isEnglish ? "Disk Space" : "磁碟空間"} value={systemStatus?.system?.diskAvail || "N/A"} />
                                        <StatusItem label={isEnglish ? "Free Memory" : "可用記憶體"} value={systemStatus?.system?.freeMem || "N/A"} />
                                        <StatusItem label={isEnglish ? "Queue Agent" : "隊列代理"} value={isEnglish ? `Ready (${metrics.queueCount})` : `就緒 (${metrics.queueCount})`} color="primary" />
                                    </ul>
                                </div>
                            </div>

                            {/* Quick Actions */}
                            <div className="bg-card border border-border rounded-2xl flex flex-col overflow-hidden shadow-sm">
                                <PanelHeader icon={<LayoutDashboard className="w-3 h-3" />} title={isEnglish ? "Quick Actions" : "快捷操作"} />
                                <div className="p-6 grid grid-cols-1 gap-4 bg-background/50">
                                    <ActionButton
                                        icon={<Play className="w-5 h-5" />}
                                        label={isEnglish ? "Start Golem" : "啟動 Golem"}
                                        description={isEnglish ? "Initialize core instance" : "初始化核心實體"}
                                        onClick={() => openConfirm("start")}
                                        disabled={activeGolemStatus === "running" || isLoading}
                                        color="primary"
                                    />
                                    <ActionButton
                                        icon={<RefreshCw className="w-5 h-5" />}
                                        label={isEnglish ? "Restart" : "重新啟動"}
                                        description={isEnglish ? "Hot-reload · Auto reconnect" : "Hot-reload · 自動重連"}
                                        onClick={() => openConfirm("restart")}
                                        disabled={!isConnected || isLoading}
                                        color="primary"
                                    />
                                    <ActionButton
                                        icon={<Zap className="w-5 h-5" />}
                                        label={isEnglish ? "Shutdown Golem" : "關閉 Golem"}
                                        description={isEnglish ? "Full stop · Manual restart required" : "完全停止 · 需手動重啟"}
                                        onClick={() => openConfirm("shutdown")}
                                        disabled={!isConnected || isLoading}
                                        color="destructive"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Large Logs Preview */}
                        <div className="md:col-span-8 bg-card border border-border rounded-2xl flex flex-col overflow-hidden shadow-sm min-h-[500px]">
                            <PanelHeader icon={<span className="text-[10px]">📡</span>} title={isEnglish ? "Signal Overview (Latest Logs)" : "信號總覽 (最新日誌)"} />
                            <div className="flex-1 bg-black/20">
                                <LogStream className="border-0 rounded-none p-6 text-[12px] font-mono leading-relaxed h-[500px]" types={["general", "error"]} />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Tab: Logs (Fluid Layout) */}
                <div className={cn(
                    "flex flex-col space-y-8 transition-all duration-500",
                    activeTab === 'LOGS' ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8 pointer-events-none hidden"
                )}>
                    {/* Main Neuro-Link Stream */}
                    <div className="bg-card border border-border rounded-2xl flex flex-col overflow-hidden shadow-sm h-[70vh]">
                        <div className="px-5 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                                <span className="text-foreground">📝</span>
                                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground">
                                    {isEnglish ? "Core Log Stream (Neuro-Link)" : "核心日誌串流 (Neuro-Link)"}
                                </span>
                            </div>
                            <Button variant="ghost" size="sm" className="h-6 text-[9px] font-bold uppercase" onClick={handleClearLogs}>
                                {isEnglish ? "Clear Buffer" : "清除緩衝區"}
                            </Button>
                        </div>
                        <div className="flex-1 relative bg-black/20">
                            <LogStream className="absolute inset-0 border-0 rounded-none p-6 text-[13px] font-mono leading-relaxed" types={["general", "error"]} />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="bg-card border border-border rounded-2xl flex flex-col overflow-hidden shadow-sm h-[400px]">
                            <PanelHeader icon={<span className="text-[10px]">⏰</span>} title={isEnglish ? "Timeline Events (Chronos)" : "時間軸事件 (Chronos)"} />
                            <div className="flex-1 relative bg-black/20">
                                <LogStream className="absolute inset-0 border-0 rounded-none p-4 text-[11px] font-mono" types={["chronos"]} />
                            </div>
                        </div>
                        <div className="bg-card border border-border rounded-2xl flex flex-col overflow-hidden shadow-sm h-[400px]">
                            <PanelHeader icon={<span className="text-[10px]">🚦</span>} title={isEnglish ? "Traffic Monitor" : "流量監控"} />
                            <div className="flex-1 relative bg-black/20">
                                <LogStream className="absolute inset-0 border-0 rounded-none p-4 text-[11px] font-mono" types={["queue", "agent"]} autoScroll={false} />
                            </div>
                        </div>
                    </div>
                </div>

            </div>

            <SystemActionDialogs
                confirmDialogOpen={confirmDialog.open}
                setConfirmDialogOpen={(open) => !isLoading && setConfirmDialog(prev => ({ ...prev, open }))}
                confirmVariant={confirmDialog.variant}
                handleConfirm={handleConfirm}
                isLoading={isLoading}
                doneDialogOpen={doneDialog.open}
                setDoneDialogOpen={(open) => setDoneDialog(prev => ({ ...prev, open }))}
                doneVariant={doneDialog.variant}
            />
        </div>
    );
}

// Helper Components
type MetricChartProps = {
    title: string;
    value: string;
    unit: "MB" | "%";
    history: TimePoint[];
    hoveredPoint: HoveredPoint | null;
    onHover: (event: MouseEvent<SVGSVGElement>) => void;
    onLeave: () => void;
    gradientId: string;
    color: "primary" | "cyan";
    icon: ReactNode;
};

function MetricChart({ title, value, unit, history, hoveredPoint, onHover, onLeave, gradientId, color, icon }: MetricChartProps) {
    const chartColor = color === "primary" ? "var(--primary)" : "var(--color-cyan, #22d3ee)";
    const max = unit === "MB" ? Math.max(100, ...history.map((metric) => metric.value)) * 1.2 : 100;

    return (
        <div className="bg-card border border-border rounded-2xl flex flex-col overflow-hidden relative p-6 shadow-sm group hover:border-primary/30 transition-all duration-500">
            <div className="flex justify-between items-start mb-4 z-10">
                <div>
                    <h3 className="text-muted-foreground text-[10px] font-bold uppercase tracking-[0.15em] mb-1">{title}</h3>
                    <div className="flex items-baseline space-x-1.5">
                        <span className="text-4xl font-bold text-foreground tracking-tighter font-mono">{value}</span>
                        <span className="text-sm font-bold text-muted-foreground uppercase opacity-60">{unit}</span>
                    </div>
                </div>
                <div className={cn("p-2 rounded-xl border", color === "primary" ? "text-primary bg-primary/5 border-primary/10" : "text-cyan-500 bg-cyan-400/5 border-cyan-400/10")}>
                    {icon}
                </div>
            </div>

            <div className="flex-1 relative mt-1 h-[120px] group/chart">
                {/* SVG Chart Layer */}
                <svg className="w-full h-full overflow-visible" viewBox="0 0 1000 100" preserveAspectRatio="none" onMouseMove={onHover} onMouseLeave={onLeave}>
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={chartColor} stopOpacity="0.3" />
                            <stop offset="100%" stopColor={chartColor} stopOpacity="0.02" />
                        </linearGradient>
                    </defs>
                    {history.length > 1 && (() => {
                        const points = history.map((pt: { value: number }, i: number) => {
                            const x = (i / (history.length - 1)) * 1000;
                            const y = 100 - (pt.value / max) * 100;
                            return `${x},${y}`;
                        });
                        const pathData = `M 0,100 ${points.map((point) => `L ${point}`).join(" ")} L 1000,100 Z`;
                        const lineData = `M ${points.map((point) => `L ${point}`).join(" ").substring(2)}`;
                        return (
                            <g>
                                <path d={pathData} fill={`url(#${gradientId})`} className="transition-all duration-300" />
                                <path d={lineData} fill="none" stroke={chartColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                                {hoveredPoint && (
                                    <g>
                                        <line x1={hoveredPoint.x} y1="0" x2={hoveredPoint.x} y2="100" stroke="currentColor" className="text-foreground/10" strokeWidth="1" strokeDasharray="4 4" />
                                        <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="5" fill={chartColor} stroke="var(--card)" strokeWidth="2.5" className="shadow-lg" />
                                    </g>
                                )}
                            </g>
                        );
                    })()}
                </svg>

                {/* HTML Overlay Tooltip (Optimized Scale) */}
                {hoveredPoint && (
                    <div
                        className="absolute pointer-events-none transition-all duration-75 z-50 flex flex-col items-center"
                        style={{
                            left: `${hoveredPoint.x / 10}%`,
                            top: `${hoveredPoint.y}%`,
                            transform: `translate(${hoveredPoint.x > 750 ? "-100%" : "0%"}, -110%)`,
                            marginLeft: hoveredPoint.x > 750 ? "-15px" : "15px",
                        }}
                    >
                        <div className="bg-popover/90 backdrop-blur-xl border border-primary/30 rounded-2xl p-4 shadow-[0_15px_40px_rgba(0,0,0,0.6)] text-center ring-1 ring-white/10 min-w-[140px]">
                            <div className="text-2xl font-bold text-primary tracking-tight leading-none">
                                {hoveredPoint.value}
                                <span className="text-xs ml-1 font-bold opacity-60">{unit}</span>
                            </div>
                            <div className="text-[11px] text-muted-foreground font-black uppercase tracking-[0.2em] mt-3 opacity-70">
                                {hoveredPoint.time}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function PanelHeader({ icon, title }: { icon: ReactNode; title: string }) {
    return (
        <div className="bg-muted/30 px-4 py-2 border-b border-border flex items-center space-x-2">
            <span className="text-muted-foreground">{icon}</span>
            <span className="text-muted-foreground text-[10px] font-black uppercase tracking-[0.2em]">{title}</span>
        </div>
    );
}

function StatusItem({ label, value, color, icon }: { label: string; value: string; color?: "primary" | "destructive"; icon?: ReactNode }) {
    return (
        <li className="flex justify-between items-center group">
            <div className="flex items-center space-x-2">
                {icon && <span className="text-muted-foreground/60">{icon}</span>}
                <span className="text-muted-foreground/80 group-hover:text-muted-foreground transition-colors">{label}:</span>
            </div>
            <span className={cn(
                "font-bold tracking-tight px-2 py-0.5 rounded text-[10px]",
                color === 'primary' ? "text-primary bg-primary/5" :
                    color === 'destructive' ? "text-destructive bg-destructive/5" :
                        "text-foreground bg-muted/30"
            )}>{value}</span>
        </li>
    );
}

function ActionButton({
    icon,
    label,
    description,
    onClick,
    color,
    disabled,
}: {
    icon: ReactNode;
    label: string;
    description: string;
    onClick: () => void;
    color?: "primary" | "destructive";
    disabled?: boolean;
}) {
    return (
        <button
            className={cn(
                "group w-full flex items-center p-3 rounded-2xl border border-white/[0.05] bg-white/[0.02] transition-all duration-300 transform active:scale-[0.98]",
                "hover:bg-white/[0.05] hover:border-white/[0.1] hover:shadow-xl",
                "disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none",
                color === 'destructive' ? "hover:border-destructive/20" : "hover:border-primary/20"
            )}
            onClick={onClick}
            disabled={disabled}
        >
            <div className={cn(
                "w-12 h-12 rounded-[14px] flex items-center justify-center transition-all duration-300",
                color === 'destructive'
                    ? "bg-destructive/10 text-destructive border border-destructive/20 group-hover:bg-destructive group-hover:text-white"
                    : "bg-white/[0.05] text-muted-foreground border border-white/[0.05] group-hover:bg-white/[0.1] group-hover:text-foreground"
            )}>
                {icon}
            </div>
            <div className="ml-4 text-left">
                <div className={cn(
                    "text-[15px] font-bold tracking-tight transition-colors",
                    color === 'destructive' ? "text-destructive/90" : "text-foreground group-hover:text-primary"
                )}>
                    {label}
                </div>
                <div className="text-[11px] text-muted-foreground font-medium opacity-50 mt-0.5">
                    {description}
                </div>
            </div>
        </button>
    );
}
