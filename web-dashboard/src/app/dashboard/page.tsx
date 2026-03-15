"use client";

import { useEffect, useState } from "react";
import { socket } from "@/lib/socket";
import { MetricCard } from "@/components/MetricCard";
import { LogStream } from "@/components/LogStream";
import { useGolem } from "@/components/GolemContext";
import {
    Activity, Cpu, Server, Clock, RefreshCcw, PowerOff,
    AlertTriangle, TriangleAlert, BrainCircuit, UserPlus, Zap,
    Database, Shield, BarChart3, Layers
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

// ── Confirm Dialog ──
interface ConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    variant: "restart" | "shutdown";
    onConfirm: () => void;
    isLoading: boolean;
}

function ConfirmDialog({ open, onOpenChange, variant, onConfirm, isLoading }: ConfirmDialogProps) {
    const isRestart = variant === "restart";
    const config = isRestart
        ? {
            icon: <RefreshCcw className="w-5 h-5 text-amber-400" />,
            iconBg: "bg-amber-500/10 border-amber-500/20",
            title: "Restart Golem?",
            description: "Process will restart. Dashboard reconnects in 3-5s.",
            warning: "Active conversations will be interrupted.",
            confirmLabel: "Confirm Restart",
            loadingLabel: "Restarting...",
            confirmClass: "bg-amber-600 hover:bg-amber-500 text-white",
        }
        : {
            icon: <PowerOff className="w-5 h-5 text-red-400" />,
            iconBg: "bg-red-500/10 border-red-500/20",
            title: "Shutdown Golem?",
            description: "Process will terminate. Manual restart required (npm start).",
            warning: "All running tasks will stop immediately.",
            confirmLabel: "Confirm Shutdown",
            loadingLabel: "Shutting down...",
            confirmClass: "bg-red-700 hover:bg-red-600 text-white",
        };

    return (
        <Dialog open={open} onOpenChange={isLoading ? undefined : onOpenChange}>
            <DialogContent showCloseButton={!isLoading} className="bg-gray-900 border-gray-700 text-white max-w-sm">
                <DialogHeader>
                    <div className={`w-12 h-12 rounded-xl border flex items-center justify-center mb-2 ${config.iconBg}`}>
                        {config.icon}
                    </div>
                    <DialogTitle className="text-white text-base">{config.title}</DialogTitle>
                    <DialogDescription className="text-gray-400 text-sm leading-relaxed">{config.description}</DialogDescription>
                </DialogHeader>
                <div className="flex items-start gap-2 rounded-lg bg-gray-800/60 border border-gray-700/50 px-3 py-2.5">
                    <TriangleAlert className="w-3.5 h-3.5 text-gray-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-gray-500">{config.warning}</p>
                </div>
                <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="outline" className="flex-1 bg-transparent border-gray-800 text-gray-500 hover:bg-gray-800 hover:text-gray-300" onClick={() => onOpenChange(false)} disabled={isLoading}>Cancel</Button>
                    <Button className={`flex-1 ${config.confirmClass}`} onClick={onConfirm} disabled={isLoading}>
                        {isLoading ? (<span className="flex items-center gap-1.5"><RefreshCcw className="w-3.5 h-3.5 animate-spin" />{config.loadingLabel}</span>) : config.confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Done Dialog ──
interface DoneDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    variant: "restarted" | "shutdown";
}

function DoneDialog({ open, onOpenChange, variant }: DoneDialogProps) {
    const isRestarted = variant === "restarted";
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm" showCloseButton={false}>
                <DialogHeader>
                    <div className={`w-12 h-12 rounded-xl border flex items-center justify-center mb-2 ${isRestarted ? "bg-green-500/10 border-green-500/20" : "bg-gray-800 border-gray-700"}`}>
                        {isRestarted ? <RefreshCcw className="w-5 h-5 text-green-400 animate-spin" /> : <PowerOff className="w-5 h-5 text-gray-400" />}
                    </div>
                    <DialogTitle className="text-white text-base">{isRestarted ? "Restarting..." : "Golem Stopped"}</DialogTitle>
                    <DialogDescription className="text-gray-400 text-sm">{isRestarted ? "Page will refresh in 3 seconds." : "Run `npm start` to restart."}</DialogDescription>
                </DialogHeader>
                {!isRestarted && (
                    <>
                        <div className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2"><code className="text-xs text-cyan-400 font-mono">npm start</code></div>
                        <DialogFooter><Button variant="outline" className="w-full border-gray-800 text-gray-500 hover:bg-gray-800 hover:text-gray-300" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

// ── Action Log Component ──
function ActionLog({ actions }: { actions: any[] }) {
    const levelColors: Record<string, string> = {
        L0: "text-gray-500 bg-gray-800",
        L1: "text-blue-400 bg-blue-900/30",
        L2: "text-amber-400 bg-amber-900/30",
        L3: "text-red-400 bg-red-900/30",
    };

    return (
        <div className="space-y-1.5 max-h-full overflow-y-auto custom-scrollbar">
            {actions.length === 0 && (
                <p className="text-gray-600 text-xs text-center py-8">No actions recorded yet</p>
            )}
            {actions.map((a: any, i: number) => (
                <div key={i} className="flex items-start gap-2 text-xs py-1.5 border-b border-gray-800/40 last:border-0">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${levelColors[a.level] || levelColors.L0}`}>
                        {a.level || "L0"}
                    </span>
                    <span className="text-gray-500 font-mono flex-shrink-0">
                        {a.ts ? new Date(a.ts).toLocaleTimeString("en-US", { hour12: false }) : "--:--:--"}
                    </span>
                    <span className="text-gray-300 truncate flex-1">{(a.cmd || "").substring(0, 60)}</span>
                    <span className={a.status === "ok" ? "text-emerald-500" : a.status === "fail" ? "text-red-400" : "text-gray-500"}>
                        {a.status || "?"}
                    </span>
                </div>
            ))}
        </div>
    );
}

// ── Main Page ──
export default function DashboardPage() {
    const { hasGolems, isLoadingGolems, isSingleNode } = useGolem();

    // Basic metrics from heartbeat
    const [metrics, setMetrics] = useState({
        uptime: "0h 0m",
        queueCount: 0,
        l1BufferCount: 0,
        memUsage: 0,
        heapUsed: 0,
        cpuPercent: 0,
        skillsLoaded: 0,
        ragAvailable: false,
        autonomyLevel: "L1",
        engineMode: "unknown",
    });

    // Full stats from /api/stats
    const [stats, setStats] = useState<any>(null);

    // Metrics history for sparklines
    const [rssHistory, setRssHistory] = useState<{ time: string; value: number }[]>([]);
    const [heapHistory, setHeapHistory] = useState<{ time: string; value: number }[]>([]);
    const [cpuHistory, setCpuHistory] = useState<{ time: string; value: number }[]>([]);

    // Action log
    const [actionLog, setActionLog] = useState<any[]>([]);

    // Dialog states
    const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; variant: "restart" | "shutdown" }>({ open: false, variant: "restart" });
    const [doneDialog, setDoneDialog] = useState<{ open: boolean; variant: "restarted" | "shutdown" }>({ open: false, variant: "restarted" });
    const [isLoading, setIsLoading] = useState(false);

    const openConfirm = (variant: "restart" | "shutdown") => setConfirmDialog({ open: true, variant });

    const handleReload = async () => {
        setIsLoading(true);
        try {
            const res = await fetch("/api/system/reload", { method: "POST" });
            const data = await res.json();
            if (data.success) {
                setConfirmDialog(prev => ({ ...prev, open: false }));
                setDoneDialog({ open: true, variant: "restarted" });
                setTimeout(() => window.location.reload(), 3000);
            }
        } catch (e) { console.error("Reload failed:", e); }
        finally { setIsLoading(false); }
    };

    const handleShutdown = async () => {
        setIsLoading(true);
        try {
            const res = await fetch("/api/system/shutdown", { method: "POST" });
            const data = await res.json();
            if (data.success) {
                setConfirmDialog(prev => ({ ...prev, open: false }));
                setDoneDialog({ open: true, variant: "shutdown" });
            }
        } catch (e) {
            setConfirmDialog(prev => ({ ...prev, open: false }));
            setDoneDialog({ open: true, variant: "shutdown" });
        } finally { setIsLoading(false); }
    };

    const handleConfirm = () => {
        if (confirmDialog.variant === "restart") handleReload();
        else handleShutdown();
    };

    // Fetch full stats on mount + every 30s
    useEffect(() => {
        const fetchStats = () => {
            fetch("/api/stats").then(r => r.json()).then(setStats).catch(() => {});
        };
        const fetchActions = () => {
            fetch("/api/action-log").then(r => r.json()).then(d => setActionLog(d.actions || [])).catch(() => {});
        };
        fetchStats();
        fetchActions();
        const si = setInterval(() => { fetchStats(); fetchActions(); }, 30000);
        return () => clearInterval(si);
    }, []);

    // Socket listeners
    useEffect(() => {
        socket.on("init", (data: any) => setMetrics(prev => ({ ...prev, ...data })));
        socket.on("state_update", (data: any) => setMetrics(prev => ({ ...prev, ...data })));
        socket.on("heartbeat", (data: any) => {
            const t = new Date().toLocaleTimeString("en-US", { hour12: false });
            setMetrics(prev => ({
                ...prev,
                uptime: data.uptime || prev.uptime,
                memUsage: data.memUsage || prev.memUsage,
                heapUsed: data.heapUsed || prev.heapUsed,
                cpuPercent: data.cpuPercent || prev.cpuPercent,
                queueCount: data.queueCount ?? prev.queueCount,
                l1BufferCount: data.l1BufferCount ?? prev.l1BufferCount,
                skillsLoaded: data.skillsLoaded ?? prev.skillsLoaded,
                ragAvailable: data.ragAvailable ?? prev.ragAvailable,
                autonomyLevel: data.autonomyLevel || prev.autonomyLevel,
                engineMode: data.engineMode || prev.engineMode,
            }));
            setRssHistory(prev => [...prev, { time: t, value: parseFloat((data.memUsage || 0).toFixed(1)) }].slice(-60));
            setHeapHistory(prev => [...prev, { time: t, value: parseFloat((data.heapUsed || 0).toFixed(1)) }].slice(-60));
            setCpuHistory(prev => [...prev, { time: t, value: parseFloat((data.cpuPercent || 0).toFixed(2)) }].slice(-60));
        });
        return () => { socket.off("init"); socket.off("state_update"); socket.off("heartbeat"); };
    }, []);

    const isBusy = isLoading;
    const brain = stats?.brain || {};
    const mem3 = stats?.memory3layer || {};

    // No golems state
    if (!isLoadingGolems && !hasGolems) {
        return (
            <div className="h-full flex items-center justify-center p-6 bg-gray-950">
                <div className="max-w-md w-full text-center space-y-6 animate-in fade-in zoom-in-95 duration-500">
                    <div className="inline-flex items-center justify-center w-24 h-24 bg-indigo-950/30 border border-indigo-900/50 rounded-[2rem] shadow-[0_0_40px_-10px_theme(colors.indigo.900)] mb-2">
                        <BrainCircuit className="w-12 h-12 text-indigo-400" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-white mb-3 tracking-tight">System Ready</h1>
                        <p className="text-gray-400 text-base leading-relaxed">No Golem instances deployed yet.<br />Create your first AI agent to begin.</p>
                    </div>
                    <Link href="/dashboard/agents/create" className="inline-block w-full pt-4">
                        <Button className="w-full h-14 bg-indigo-600 hover:bg-indigo-500 text-white text-base font-semibold border-0 shadow-lg shadow-indigo-900/20 transition-all hover:scale-[1.02] hover:shadow-indigo-500/25">
                            <UserPlus className="w-5 h-5 mr-2" />Create First Golem
                        </Button>
                    </Link>
                    {isSingleNode && (
                        <div className="pt-2 p-3 rounded-xl bg-amber-950/10 border border-amber-900/20 text-amber-200/50 text-[10px] text-left">
                            <p>Single node mode detected. Setup wizard will guide .env configuration.</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 h-full flex flex-col space-y-4">
            {/* [A] Status Bar */}
            <div className="bg-gray-900/80 border border-gray-800 rounded-xl px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-mono">
                <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">Engine:</span>
                    <span className="text-cyan-400 font-bold">{brain.engine || metrics.engineMode || "api"}</span>
                    <span className="text-gray-600">({brain.provider || "?"})</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">Model:</span>
                    <span className="text-white font-bold">{brain.model || "?"}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">Skills:</span>
                    <span className="text-emerald-400 font-bold">{metrics.skillsLoaded || (stats?.skills?.loaded ?? 0)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">Queue:</span>
                    <span className="text-white font-bold">{metrics.queueCount}</span>
                    {metrics.l1BufferCount > 0 && <span className="text-amber-400">+{metrics.l1BufferCount} L1</span>}
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">Autonomy:</span>
                    <span className={`font-bold ${metrics.autonomyLevel === "L0" ? "text-gray-400" : metrics.autonomyLevel === "L1" ? "text-blue-400" : metrics.autonomyLevel === "L2" ? "text-amber-400" : "text-red-400"}`}>
                        {metrics.autonomyLevel}
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">RAG:</span>
                    <span className={`w-2 h-2 rounded-full ${metrics.ragAvailable ? "bg-emerald-500" : "bg-red-500"}`} />
                    <span className={metrics.ragAvailable ? "text-emerald-400" : "text-red-400"}>{metrics.ragAvailable ? "UP" : "DOWN"}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">Memory:</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${mem3.core ? "bg-emerald-500" : "bg-gray-600"}`} />
                    <span className={`w-1.5 h-1.5 rounded-full ${mem3.recall ? "bg-emerald-500" : "bg-gray-600"}`} />
                    <span className={`w-1.5 h-1.5 rounded-full ${mem3.archival ? "bg-emerald-500" : "bg-gray-600"}`} />
                </div>
            </div>

            {/* [B] 6 MetricCards (2x3 grid) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <MetricCard
                    title="RSS Memory"
                    value={`${metrics.memUsage.toFixed(1)} MB`}
                    icon={Activity}
                    data={rssHistory}
                    color="#10b981"
                    status="online"
                    subtitle={stats ? `Total: ${(stats.system?.totalMem / 1024).toFixed(1)} GB` : undefined}
                />
                <MetricCard
                    title="Heap Memory"
                    value={`${metrics.heapUsed.toFixed(1)} MB`}
                    icon={Layers}
                    data={heapHistory}
                    color="#3b82f6"
                    status="online"
                    subtitle={stats ? `Total: ${stats.memory?.heapTotal || 0} MB` : undefined}
                />
                <MetricCard
                    title="CPU Usage"
                    value={`${metrics.cpuPercent.toFixed(1)}%`}
                    icon={Cpu}
                    data={cpuHistory}
                    color="#f59e0b"
                    status="online"
                    subtitle={stats ? `Load: ${(stats.system?.loadAvg || [0]).map((l: number) => l.toFixed(2)).join(" ")}` : undefined}
                />
                <MetricCard
                    title="Uptime"
                    value={metrics.uptime}
                    icon={Clock}
                    subtitle={stats ? `Node ${stats.system?.nodeVersion || "?"} | ${stats.system?.platform || "?"} ${stats.system?.arch || "?"}` : undefined}
                />
                <MetricCard
                    title="Queue / L1 Buffer"
                    value={`${metrics.queueCount} / ${metrics.l1BufferCount}`}
                    icon={Server}
                    subtitle={`Golems active: ${stats?.golems?.active ?? 1}`}
                />
                <MetricCard
                    title="RAG Status"
                    value={metrics.ragAvailable ? "Available" : "Offline"}
                    icon={Database}
                    status={metrics.ragAvailable ? "online" : "offline"}
                    subtitle={stats?.rag?.url ? `URL: ${stats.rag.url.substring(0, 40)}` : "No RAG URL configured"}
                />
            </div>

            {/* [C] Bottom: LogStream + Action Log + Controls */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 min-h-0">
                {/* Log Stream */}
                <div className="md:col-span-2 flex flex-col min-h-0">
                    <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">Live System Logs</h2>
                    <LogStream className="flex-1" />
                </div>

                {/* Right sidebar: Action Log + Controls */}
                <div className="flex flex-col gap-4 min-h-0">
                    {/* Action Log */}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex-1 flex flex-col min-h-0">
                        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <BarChart3 className="w-4 h-4" />Action Log
                        </h2>
                        <div className="flex-1 overflow-hidden">
                            <ActionLog actions={actionLog} />
                        </div>
                    </div>

                    {/* System Controls */}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
                        <div className="space-y-3 mb-4">
                            <div className="flex justify-between items-center text-xs border-b border-gray-800 pb-2">
                                <span className="text-gray-500">Mode</span>
                                <span className="text-cyan-400">{isSingleNode ? "Single Node" : "Multi-Agent"}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs border-b border-gray-800 pb-2">
                                <span className="text-gray-500">Backend</span>
                                <span className="text-green-400">Connected</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-gray-500">Security</span>
                                <span className="text-amber-400 flex items-center gap-1"><Shield className="w-3 h-3" />L0-L3</span>
                            </div>
                        </div>

                        <button onClick={() => openConfirm("restart")} disabled={isBusy}
                            className="w-full group flex items-center gap-3 px-3 py-2 rounded-lg border border-amber-900/40 bg-amber-950/20 hover:bg-amber-950/40 hover:border-amber-700/60 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed">
                            <div className="w-6 h-6 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                                <RefreshCcw className="w-3 h-3 text-amber-400" />
                            </div>
                            <span className="text-xs font-medium text-amber-300">Restart</span>
                        </button>
                        <button onClick={() => openConfirm("shutdown")} disabled={isBusy}
                            className="w-full group flex items-center gap-3 px-3 py-2 rounded-lg border border-red-900/40 bg-red-950/20 hover:bg-red-950/40 hover:border-red-700/60 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed">
                            <div className="w-6 h-6 rounded-md bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
                                <PowerOff className="w-3 h-3 text-red-400" />
                            </div>
                            <span className="text-xs font-medium text-red-300">Shutdown</span>
                        </button>
                    </div>
                </div>
            </div>

            <ConfirmDialog open={confirmDialog.open} onOpenChange={(open) => !isLoading && setConfirmDialog(prev => ({ ...prev, open }))} variant={confirmDialog.variant} onConfirm={handleConfirm} isLoading={isLoading} />
            <DoneDialog open={doneDialog.open} onOpenChange={(open) => setDoneDialog(prev => ({ ...prev, open }))} variant={doneDialog.variant} />
        </div>
    );
}
