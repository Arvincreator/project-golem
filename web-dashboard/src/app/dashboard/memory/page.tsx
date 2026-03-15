"use client";

import { useEffect, useState } from "react";
import { MemoryTable } from "@/components/MemoryTable";
import { useGolem } from "@/components/GolemContext";
import { BrainCircuit, Cpu, Database, Activity, HardDrive, Search } from "lucide-react";
import { LogStream } from "@/components/LogStream";
import { cn } from "@/lib/utils";

export default function MemoryPage() {
    const { activeGolem, golems } = useGolem();
    const [status, setStatus] = useState("initializing");
    const [stats, setStats] = useState<any>(null);

    useEffect(() => {
        if (activeGolem) {
            setStatus("initializing");
            const timer = setTimeout(() => setStatus("ready"), 1500);
            return () => clearTimeout(timer);
        }
    }, [activeGolem]);

    useEffect(() => {
        fetch("/api/stats").then(r => r.json()).then(setStats).catch(() => {});
        const si = setInterval(() => { fetch("/api/stats").then(r => r.json()).then(setStats).catch(() => {}); }, 30000);
        return () => clearInterval(si);
    }, []);

    const mem3 = stats?.memory3layer || {};
    const brain = stats?.brain || {};
    const rag = stats?.rag || {};

    return (
        <div className="p-6 h-full flex flex-col space-y-6 overflow-hidden bg-gray-950 text-gray-300 relative font-sans">

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between space-y-4 md:space-y-0 pb-4 border-b border-gray-800 z-10">
                <div className="flex items-center space-x-4">
                    <div className="p-3 bg-cyan-950/50 rounded-xl border border-cyan-900/50 shadow-[0_0_15px_rgba(6,182,212,0.15)] flex-shrink-0">
                        <BrainCircuit className="w-8 h-8 text-cyan-400" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500 tracking-tight">
                            Neural Core
                        </h1>
                        <div className="text-sm text-gray-500 mt-1 flex items-center flex-wrap">
                            3-Layer Memory System
                            <span className="ml-3 px-2 py-0.5 rounded-full bg-gray-900 border border-gray-800 text-xs font-mono text-gray-400">
                                v10.0
                            </span>
                        </div>
                    </div>
                </div>

                {activeGolem && (
                    <div className="flex items-center bg-gray-900/80 backdrop-blur-sm border border-gray-800 rounded-lg p-2 px-4 shadow-sm flex-shrink-0">
                        <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse mr-3"></div>
                        <span className="text-gray-400 text-sm mr-2">Target Node:</span>
                        <span className="text-cyan-300 font-mono font-semibold tracking-wide">{activeGolem}</span>
                    </div>
                )}
            </div>

            {!activeGolem && golems.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-500 space-y-4">
                    <Activity className="w-12 h-12 text-gray-700 animate-pulse" />
                    <p>System offline or no Golem nodes detected.</p>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto space-y-6 pb-12 pr-2 custom-scrollbar z-10">

                    {/* 3-Layer Memory Status Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <StatusCard
                            icon={Database}
                            title="Core Memory"
                            value="SystemNativeDriver"
                            status={mem3.core ? "online" : status === "ready" ? "online" : "loading"}
                            description="Long-term facts, personality, user preferences"
                            detail={mem3.core ? "Driver active, file-based storage" : "Initializing..."}
                        />
                        <StatusCard
                            icon={Activity}
                            title="Recall Memory"
                            value="ChatLogManager"
                            status={mem3.recall ? "online" : status === "ready" ? "online" : "loading"}
                            description="Conversation history, context window"
                            detail={mem3.recall ? "Logging active" : "Initializing..."}
                        />
                        <StatusCard
                            icon={Search}
                            title="Archival Memory"
                            value="A-RAG Graph"
                            status={mem3.archival || rag.available ? "online" : "loading"}
                            description="Graph knowledge base, semantic search"
                            detail={rag.url ? `URL: ${rag.url.substring(0, 35)}...` : "No RAG URL configured"}
                        />
                    </div>

                    {/* Brain Info Bar */}
                    <div className="bg-gray-900/50 border border-gray-800 rounded-xl px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-mono">
                        <div><span className="text-gray-500">Engine:</span> <span className="text-cyan-400 font-bold">{brain.engine || "?"}</span></div>
                        <div><span className="text-gray-500">Model:</span> <span className="text-white font-bold">{brain.model || "?"}</span></div>
                        <div><span className="text-gray-500">Provider:</span> <span className="text-gray-300">{brain.provider || "?"}</span></div>
                        <div><span className="text-gray-500">API:</span> <span className={brain.apiAvailable ? "text-emerald-400" : "text-red-400"}>{brain.apiAvailable ? "OK" : "N/A"}</span></div>
                        <div><span className="text-gray-500">Memory Ready:</span> <span className={brain.memoryReady ? "text-emerald-400" : "text-red-400"}>{brain.memoryReady ? "Yes" : "No"}</span></div>
                        <div><span className="text-gray-500">RAG:</span> <span className={brain.ragAvailable ? "text-emerald-400" : "text-red-400"}>{brain.ragAvailable ? "Available" : "Offline"}</span></div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                        {/* Memory Table */}
                        <div className="xl:col-span-2 flex flex-col space-y-4">
                            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-5 shadow-lg flex-1 flex flex-col">
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-lg font-semibold text-white flex items-center">
                                        <Database className="w-5 h-5 mr-2 text-cyan-400" />
                                        Memory Records
                                    </h2>
                                </div>
                                <div className="flex-1"><MemoryTable /></div>
                            </div>
                        </div>

                        {/* Log Sidebar */}
                        <div className="xl:col-span-1 flex flex-col space-y-4 h-[600px] xl:h-[auto]">
                            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-5 shadow-lg flex-1 flex flex-col h-full min-h-[500px]">
                                <h2 className="text-lg font-semibold text-white flex items-center mb-4 flex-shrink-0">
                                    <Activity className="w-5 h-5 mr-2 text-cyan-400" />
                                    Neural Telemetry
                                </h2>
                                <div className="flex-1 bg-black/60 rounded-lg overflow-hidden border border-gray-800/50 shadow-inner">
                                    <LogStream className="border-0 bg-transparent h-full shadow-none p-3" autoScroll={true} types={['memory', 'chronos', 'error']} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Background glow */}
            <div className="absolute top-0 right-0 -mr-32 -mt-32 w-96 h-96 rounded-full bg-cyan-900/10 blur-[100px] pointer-events-none z-0"></div>
            <div className="absolute bottom-0 left-0 -ml-32 -mb-32 w-96 h-96 rounded-full bg-blue-900/10 blur-[100px] pointer-events-none z-0"></div>

            <style dangerouslySetInnerHTML={{ __html: `
                .custom-scrollbar::-webkit-scrollbar { width: 8px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(34, 211, 238, 0.2); border-radius: 4px; border: 1px solid rgba(34, 211, 238, 0.1); }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(34, 211, 238, 0.4); }
            ` }} />
        </div>
    );
}

function StatusCard({ icon: Icon, title, value, description, status, detail }: {
    icon: any; title: string; value: string; description: string; status: "online" | "loading"; detail?: string;
}) {
    return (
        <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-4 flex flex-col relative overflow-hidden group hover:border-gray-700 transition-colors">
            <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                    <div className={cn("p-2 rounded-lg transition-colors", status === "online" ? "bg-cyan-950/50 text-cyan-400 group-hover:bg-cyan-900/50" : "bg-gray-800 text-gray-500")}>
                        <Icon className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider">{title}</h3>
                        <p className={cn("text-sm font-semibold mt-0.5", status === "online" ? "text-gray-100" : "text-gray-600")}>{value}</p>
                    </div>
                </div>
                <div className="flex h-2 w-2">
                    <span className={cn("relative inline-flex rounded-full h-2 w-2", status === "online" ? "bg-cyan-500" : "bg-yellow-500 animate-pulse")}>
                        {status === "online" && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>}
                    </span>
                </div>
            </div>
            <div className="mt-3 text-xs text-gray-500">{description}</div>
            {detail && <div className="mt-1 text-[10px] text-gray-600 font-mono">{detail}</div>}
            <div className={cn("absolute bottom-0 left-0 h-[1px] w-full bg-gradient-to-r from-transparent via-transparent to-transparent opacity-50 group-hover:opacity-100 transition-opacity", status === "online" ? "via-cyan-500/50" : "via-yellow-500/30")}></div>
        </div>
    );
}
