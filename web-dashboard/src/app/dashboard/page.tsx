"use client";

import { useEffect, useState } from "react";
import { socket } from "@/lib/socket";
import { MetricCard } from "@/components/MetricCard";
import { LogStream } from "@/components/LogStream";
import { useGolem } from "@/components/GolemContext";
import { Activity, Cpu, Server, Clock, RefreshCcw, PowerOff, AlertTriangle, TriangleAlert, BrainCircuit, UserPlus, Zap } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";

// ── 通用確認彈窗元件 ────────────────────────────────────────────────────────
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
            title: "重新啟動 Golem？",
            description: "這將終止目前進程並立即重啟。前端會短暫斷線（約 3-5 秒）後自動重新連線。",
            warning: "進行中的對話將被中斷。",
            confirmLabel: "確認重啟",
            loadingLabel: "正在重啟...",
            confirmClass: "bg-amber-600 hover:bg-amber-500 text-white",
        }
        : {
            icon: <PowerOff className="w-5 h-5 text-red-400" />,
            iconBg: "bg-red-500/10 border-red-500/20",
            title: "關閉 Golem？",
            description: "這將完全終止後端進程。關閉後需手動在終端機執行 npm start 重新啟動。",
            warning: "所有運行中的任務將立即停止。",
            confirmLabel: "確認關閉",
            loadingLabel: "正在關閉...",
            confirmClass: "bg-red-700 hover:bg-red-600 text-white",
        };

    return (
        <Dialog open={open} onOpenChange={isLoading ? undefined : onOpenChange}>
            <DialogContent
                showCloseButton={!isLoading}
                className="bg-gray-900 border-gray-700 text-white max-w-sm"
            >
                <DialogHeader>
                    {/* 圖示卡片 */}
                    <div className={`w-12 h-12 rounded-xl border flex items-center justify-center mb-2 ${config.iconBg}`}>
                        {config.icon}
                    </div>
                    <DialogTitle className="text-white text-base">
                        {config.title}
                    </DialogTitle>
                    <DialogDescription className="text-gray-400 text-sm leading-relaxed">
                        {config.description}
                    </DialogDescription>
                </DialogHeader>

                {/* 警示欄 */}
                <div className="flex items-start gap-2 rounded-lg bg-gray-800/60 border border-gray-700/50 px-3 py-2.5">
                    <TriangleAlert className="w-3.5 h-3.5 text-gray-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-gray-500">{config.warning}</p>
                </div>

                <DialogFooter className="gap-2 sm:gap-2">
                    <Button
                        variant="outline"
                        className="flex-1 bg-transparent border-gray-800 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                        onClick={() => onOpenChange(false)}
                        disabled={isLoading}
                    >
                        取消
                    </Button>
                    <Button
                        className={`flex-1 ${config.confirmClass}`}
                        onClick={onConfirm}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <span className="flex items-center gap-1.5">
                                <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
                                {config.loadingLabel}
                            </span>
                        ) : config.confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── 完成通知彈窗 ───────────────────────────────────────────────────────────
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
                        {isRestarted
                            ? <RefreshCcw className="w-5 h-5 text-green-400 animate-spin" />
                            : <PowerOff className="w-5 h-5 text-gray-400" />
                        }
                    </div>
                    <DialogTitle className="text-white text-base">
                        {isRestarted ? "正在重新啟動..." : "Golem 已關閉"}
                    </DialogTitle>
                    <DialogDescription className="text-gray-400 text-sm">
                        {isRestarted
                            ? "系統正在重啟中，頁面將在 3 秒後自動重新整理。"
                            : "進程已完全停止。若需重新啟動，請在終端機執行："
                        }
                    </DialogDescription>
                </DialogHeader>
                {!isRestarted && (
                    <div className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2">
                        <code className="text-xs text-cyan-400 font-mono">npm start</code>
                    </div>
                )}
                {!isRestarted && (
                    <DialogFooter>
                        <Button
                            variant="outline"
                            className="w-full border-gray-800 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                            onClick={() => onOpenChange(false)}
                        >
                            關閉
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}

// ── 主頁面 ─────────────────────────────────────────────────────────────────
export default function DashboardPage() {
    const { hasGolems, isLoadingGolems } = useGolem();
    const [metrics, setMetrics] = useState({
        uptime: "0h 0m",
        queueCount: 0,
        lastSchedule: "無排程",
        memUsage: 0,
    });

    const [memHistory, setMemHistory] = useState<{ time: string; value: number }[]>([]);

    // Dialog states
    const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; variant: "restart" | "shutdown" }>({
        open: false, variant: "restart"
    });
    const [doneDialog, setDoneDialog] = useState<{ open: boolean; variant: "restarted" | "shutdown" }>({
        open: false, variant: "restarted"
    });
    const [isLoading, setIsLoading] = useState(false);

    // 開啟確認 dialog
    const openConfirm = (variant: "restart" | "shutdown") => {
        setConfirmDialog({ open: true, variant });
    };

    // 執行重啟
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
        } catch (e) {
            console.error("Reload failed:", e);
        } finally {
            setIsLoading(false);
        }
    };

    // 執行關閉
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
            // 進程已關閉時 fetch 會拋出錯誤，此為預期行為
            setConfirmDialog(prev => ({ ...prev, open: false }));
            setDoneDialog({ open: true, variant: "shutdown" });
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirm = () => {
        if (confirmDialog.variant === "restart") handleReload();
        else handleShutdown();
    };

    useEffect(() => {
        socket.on("init", (data: any) => {
            setMetrics((prev) => ({ ...prev, ...data }));
        });

        socket.on("state_update", (data: any) => {
            setMetrics((prev) => ({ ...prev, ...data }));
        });

        socket.on("heartbeat", (data: any) => {
            const timeStr = new Date().toLocaleTimeString('zh-TW', { hour12: false });
            setMetrics((prev) => ({
                ...prev,
                uptime: data.uptime,
                memUsage: data.memUsage,
            }));

            setMemHistory((prev) => {
                const newData = [...prev, { time: timeStr, value: parseFloat(data.memUsage.toFixed(1)) }];
                return newData.slice(-60);
            });
        });

        return () => {
            socket.off("init");
            socket.off("state_update");
            socket.off("heartbeat");
        };
    }, []);

    const isBusy = isLoading;

    // ── Onboarding: 沒有任何 Golem 時顯示引導介面 ──
    if (!isLoadingGolems && !hasGolems) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-gray-950 text-white">
                <div className="max-w-md w-full text-center animate-in fade-in slide-in-from-bottom-6 duration-700">
                    {/* Icon */}
                    <div className="inline-flex items-center justify-center p-5 bg-indigo-950/50 border border-indigo-800/40 rounded-3xl mb-8 shadow-[0_0_50px_-10px_theme(colors.indigo.900)]">
                        <BrainCircuit className="w-12 h-12 text-indigo-400" />
                    </div>

                    <h1 className="text-4xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-br from-white to-indigo-400">
                        歡迎使用 Golem
                    </h1>
                    <p className="text-gray-400 text-lg leading-relaxed mb-10">
                        你的神經網路艦隊尚未部署。<br />
                        建立第一個 Golem 實體，賦予它身分、技能與任務。
                    </p>

                    {/* Feature Highlights */}
                    <div className="grid grid-cols-3 gap-4 mb-10 text-sm">
                        {[
                            { icon: Zap, label: "快速建立", desc: "填寫 Token 即可啟動" },
                            { icon: BrainCircuit, label: "長期記憶", desc: "向量記憶持久化" },
                            { icon: UserPlus, label: "多實體", desc: "管理多台 Bot" },
                        ].map(({ icon: Icon, label, desc }) => (
                            <div key={label} className="bg-gray-900/50 border border-gray-800 rounded-xl p-3 flex flex-col items-center gap-1.5">
                                <Icon className="w-5 h-5 text-indigo-400" />
                                <span className="text-white font-medium text-xs">{label}</span>
                                <span className="text-gray-500 text-[10px]">{desc}</span>
                            </div>
                        ))}
                    </div>

                    <Link href="/dashboard/agents/create">
                        <Button className="w-full h-14 text-base font-bold bg-gradient-to-r from-indigo-600 to-blue-500 hover:from-indigo-500 hover:to-blue-400 border-none shadow-xl shadow-indigo-900/20 rounded-2xl group transition-all hover:scale-[1.02] active:scale-95">
                            <UserPlus className="w-5 h-5 mr-2 group-hover:animate-pulse" />
                            建立第一個 Golem 實體
                        </Button>
                    </Link>

                    <p className="text-xs text-gray-600 mt-4">
                        或直接修改 <code className="text-gray-500 font-mono">golems.json</code> 並重啟系統
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 h-full flex flex-col space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                    title="Memory Usage"
                    value={`${metrics.memUsage.toFixed(1)} MB`}
                    icon={Activity}
                    data={memHistory}
                    color="#10b981"
                />
                <MetricCard title="Queue Load" value={metrics.queueCount} icon={Server} />
                <MetricCard title="System Uptime" value={metrics.uptime} icon={Clock} />
                <MetricCard title="Next Schedule" value={metrics.lastSchedule} icon={Cpu} />
            </div>

            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-6 min-h-0">
                <div className="md:col-span-2 flex flex-col min-h-0">
                    <h2 className="text-lg font-semibold mb-2">Live System Logs</h2>
                    <LogStream className="flex-1" />
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 flex flex-col justify-between">
                    <div>
                        <h2 className="text-lg font-semibold mb-4">System Status</h2>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center text-sm border-b border-gray-800 pb-2">
                                <span className="text-gray-400">Environment</span>
                                <span className="text-white">Production</span>
                            </div>
                            <div className="flex justify-between items-center text-sm border-b border-gray-800 pb-2">
                                <span className="text-gray-400">Mode</span>
                                <span className="text-cyan-400">Multi-Agent</span>
                            </div>
                            <div className="flex justify-between items-center text-sm border-b border-gray-800 pb-2">
                                <span className="text-gray-400">Backend</span>
                                <span className="text-green-400">Connected</span>
                            </div>
                        </div>
                    </div>

                    {/* 操控區 */}
                    <div className="mt-6 pt-6 border-t border-gray-800 space-y-2">
                        {/* 重啟按鈕 */}
                        <button
                            onClick={() => openConfirm("restart")}
                            disabled={isBusy}
                            className="w-full group flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-900/40 bg-amber-950/20 hover:bg-amber-950/40 hover:border-amber-700/60 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <div className="w-7 h-7 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0 group-hover:bg-amber-500/20 transition-colors">
                                <RefreshCcw className="w-3.5 h-3.5 text-amber-400" />
                            </div>
                            <div className="text-left">
                                <p className="text-xs font-medium text-amber-300">重新啟動</p>
                                <p className="text-[10px] text-gray-500">Hot-reload · 自動重連</p>
                            </div>
                        </button>

                        {/* 關閉按鈕 */}
                        <button
                            onClick={() => openConfirm("shutdown")}
                            disabled={isBusy}
                            className="w-full group flex items-center gap-3 px-4 py-2.5 rounded-lg border border-red-900/40 bg-red-950/20 hover:bg-red-950/40 hover:border-red-700/60 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <div className="w-7 h-7 rounded-md bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0 group-hover:bg-red-500/20 transition-colors">
                                <PowerOff className="w-3.5 h-3.5 text-red-400" />
                            </div>
                            <div className="text-left">
                                <p className="text-xs font-medium text-red-300">關閉 Golem</p>
                                <p className="text-[10px] text-gray-500">完全停止 · 需手動重啟</p>
                            </div>
                        </button>
                    </div>
                </div>
            </div>

            {/* 確認 Dialog */}
            <ConfirmDialog
                open={confirmDialog.open}
                onOpenChange={(open) => !isLoading && setConfirmDialog(prev => ({ ...prev, open }))}
                variant={confirmDialog.variant}
                onConfirm={handleConfirm}
                isLoading={isLoading}
            />

            {/* 完成通知 Dialog */}
            <DoneDialog
                open={doneDialog.open}
                onOpenChange={(open) => setDoneDialog(prev => ({ ...prev, open }))}
                variant={doneDialog.variant}
            />
        </div>
    );
}
