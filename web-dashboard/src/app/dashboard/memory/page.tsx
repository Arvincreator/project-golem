"use client";

import { useEffect, useState } from "react";
import { MemoryTable } from "@/components/MemoryTable";
import { useGolem } from "@/components/GolemContext";
import { BrainCircuit, Cpu, Database, Activity } from "lucide-react";
import { LogStream } from "@/components/LogStream";
import { cn } from "@/lib/utils";

export default function MemoryPage() {
    const { activeGolem, golems } = useGolem();
    const [status, setStatus] = useState("initializing");

    useEffect(() => {
        if (activeGolem) {
            setStatus("initializing");
            const timer = setTimeout(() => setStatus("ready"), 1500);
            return () => clearTimeout(timer);
        }
    }, [activeGolem]);

    return (
        <div className="p-6 h-full flex flex-col space-y-6 overflow-hidden bg-background text-foreground/80 relative font-sans">

            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between space-y-4 md:space-y-0 pb-4 border-b border-border z-10">
                <div className="flex items-center space-x-4">
                    <div className="p-3 bg-primary/10 rounded-xl border border-primary/20 shadow-[0_0_15px_rgba(var(--primary),0.1)] flex-shrink-0">
                        <BrainCircuit className="w-8 h-8 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary via-primary/80 to-blue-500 tracking-tight">
                            記憶核心 (Neural Core)
                        </h1>
                        <div className="text-sm text-muted-foreground mt-1 flex items-center flex-wrap">
                            向量記憶與 Chronos 引擎 (Vector Memory & Chronos Engine)
                            <span className="ml-3 px-2 py-0.5 rounded-full bg-secondary border border-border text-xs font-mono text-muted-foreground">
                                v9.1.5
                            </span>
                        </div>
                    </div>
                </div>

                {activeGolem && (
                    <div className="flex items-center bg-card/80 backdrop-blur-sm border border-border rounded-lg p-2 px-4 shadow-sm flex-shrink-0">
                        <div className="w-2 h-2 rounded-full bg-primary animate-pulse mr-3"></div>
                        <span className="text-muted-foreground text-sm mr-2">目標節點 (Target Node):</span>
                        <span className="text-primary font-mono font-semibold tracking-wide">
                            {activeGolem}
                        </span>
                    </div>
                )}
            </div>

            {!activeGolem && golems.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-500 space-y-4">
                    <Activity className="w-12 h-12 text-gray-700 animate-pulse" />
                    <p>系統離線或未偵測到 Golem 節點。</p>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto space-y-6 pb-12 pr-2 custom-scrollbar z-10">

                    {/* Status Dashboard */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <StatusCard
                            icon={Cpu}
                            title="向量模型 (Embedding)"
                            value="all-MiniLM-L6-v2"
                            status={status === 'ready' ? 'online' : 'loading'}
                            description="本地 Transformers.js 推論引擎"
                        />
                        <StatusCard
                            icon={Database}
                            title="記憶儲存 (Storage)"
                            value="IndexedDB Bank"
                            status={status === 'ready' ? 'online' : 'loading'}
                            description="瀏覽器原生向量儲存空間"
                        />
                        <StatusCard
                            icon={Activity}
                            title="Chronos 引擎"
                            value="TimeWatch 運行中"
                            status="online"
                            description="時序調度與自動化觸發系統"
                        />
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                        {/* Main Memory Table (Takes 2 columns on XL screens) */}
                        <div className="xl:col-span-2 flex flex-col space-y-4">
                            <div className="bg-card/50 backdrop-blur-sm border border-border rounded-xl p-5 shadow-lg flex-1 flex flex-col">
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-lg font-semibold text-foreground flex items-center">
                                        <Database className="w-5 h-5 mr-2 text-primary" />
                                        記憶紀錄 (Memory Records)
                                    </h2>
                                </div>
                                <div className="flex-1">
                                    <MemoryTable />
                                </div>
                            </div>
                        </div>

                        {/* System Log Sidebar (Takes 1 column on XL screens) */}
                        <div className="xl:col-span-1 flex flex-col space-y-4 h-[600px] xl:h-[auto]">
                            <div className="bg-card/50 backdrop-blur-sm border border-border rounded-xl p-5 shadow-lg flex-1 flex flex-col h-full min-h-[500px]">
                                <h2 className="text-lg font-semibold text-foreground flex items-center mb-4 flex-shrink-0">
                                    <Activity className="w-5 h-5 mr-2 text-primary" />
                                    核心遙測 (Neural Telemetry)
                                </h2>
                                <div className="flex-1 bg-background/60 rounded-lg overflow-hidden border border-border/50 shadow-inner">
                                    <LogStream
                                        className="border-0 bg-transparent h-full shadow-none p-3"
                                        autoScroll={true}
                                        types={['memory', 'chronos', 'error']}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Background Ambient Glow */}
            <div className="absolute top-0 right-0 -mr-32 -mt-32 w-96 h-96 rounded-full bg-cyan-900/10 blur-[100px] pointer-events-none z-0"></div>
            <div className="absolute bottom-0 left-0 -ml-32 -mb-32 w-96 h-96 rounded-full bg-blue-900/10 blur-[100px] pointer-events-none z-0"></div>

            <style dangerouslySetInnerHTML={{
                __html: `
                .custom-scrollbar::-webkit-scrollbar { width: 8px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(34, 211, 238, 0.2); border-radius: 4px; border: 1px solid rgba(34, 211, 238, 0.1); }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(34, 211, 238, 0.4); }
            `}} />
        </div>
    );
}

function StatusCard({ icon: Icon, title, value, description, status }: { icon: any, title: string, value: string, description: string, status: 'online' | 'loading' }) {
    return (
        <div className="bg-card/50 backdrop-blur-sm border border-border rounded-xl p-4 flex flex-col relative overflow-hidden group hover:border-primary/50 transition-colors">
            <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                    <div className={cn(
                        "p-2 rounded-lg transition-colors",
                        status === 'online' ? "bg-primary/10 text-primary group-hover:bg-primary/20" : "bg-muted text-muted-foreground"
                    )}>
                        <Icon className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">{title}</h3>
                        <p className={cn(
                            "text-sm font-semibold mt-0.5",
                            status === 'online' ? "text-foreground" : "text-muted-foreground/60"
                        )}>{value}</p>
                    </div>
                </div>
                <div className="flex h-2 w-2">
                    <span className={cn(
                        "relative inline-flex rounded-full h-2 w-2",
                        status === 'online' ? "bg-cyan-500" : "bg-yellow-500 animate-pulse"
                    )}>
                        {status === 'online' && (
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                        )}
                    </span>
                </div>
            </div>
            <div className="mt-4 text-xs text-gray-500">
                {description}
            </div>

            {/* Subtle bottom border glow */}
            <div className={cn(
                "absolute bottom-0 left-0 h-[1px] w-full bg-gradient-to-r from-transparent via-transparent to-transparent opacity-50 group-hover:opacity-100 transition-opacity",
                status === 'online' ? "via-cyan-500/50" : "via-yellow-500/30"
            )}></div>
        </div>
    );
}
