"use client";

import { useEffect, useState } from "react";
import { Terminal as TerminalIcon, Cpu, Database, Shield, Radio, BrainCircuit, Layers } from "lucide-react";
import { LogStream } from "@/components/LogStream";
import { socket } from "@/lib/socket";

export default function TerminalPage() {
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

    const [stats, setStats] = useState<any>(null);

    // Chart histories
    const [rssHistory, setRssHistory] = useState<number[]>([]);
    const [heapHistory, setHeapHistory] = useState<number[]>([]);
    const [cpuHistory, setCpuHistory] = useState<number[]>([]);

    useEffect(() => {
        fetch("/api/stats").then(r => r.json()).then(setStats).catch(() => {});
        const si = setInterval(() => { fetch("/api/stats").then(r => r.json()).then(setStats).catch(() => {}); }, 30000);
        return () => clearInterval(si);
    }, []);

    useEffect(() => {
        socket.on("init", (data: any) => setMetrics(prev => ({ ...prev, ...data })));
        socket.on("state_update", (data: any) => setMetrics(prev => ({ ...prev, ...data })));
        socket.on("heartbeat", (data: any) => {
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
            setRssHistory(prev => [...prev, data.memUsage || 0].slice(-60));
            setHeapHistory(prev => [...prev, data.heapUsed || 0].slice(-60));
            setCpuHistory(prev => [...prev, data.cpuPercent || 0].slice(-60));
        });
        return () => { socket.off("init"); socket.off("state_update"); socket.off("heartbeat"); };
    }, []);

    const brain = stats?.brain || {};
    const mem3 = stats?.memory3layer || {};
    const sys = stats?.system || {};
    const autonomy = stats?.autonomy || {};

    return (
        <div className="h-full flex flex-col bg-[#050505] font-sans selection:bg-emerald-500/30">
            {/* Header */}
            <div className="border-b border-gray-900 bg-[#0a0a0a]/80 backdrop-blur-md p-4 flex items-center justify-between shadow-sm flex-none sticky top-0 z-50">
                <div className="flex items-center space-x-4">
                    <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                        <TerminalIcon className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                        <h2 className="text-base font-bold text-gray-100 tracking-tight">Terminal Dashboard v10.0</h2>
                        <p className="text-xs text-gray-500 mt-0.5 font-medium">Real-time System Monitor — All metrics live</p>
                    </div>
                </div>
                <div className="flex items-center space-x-2 text-[10px] uppercase tracking-widest text-gray-600 font-bold bg-gray-900/50 px-3 py-1.5 rounded-full border border-gray-800">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                    <span>System Online</span>
                </div>
            </div>

            {/* 3x2 Grid */}
            <div className="flex-1 p-4 grid grid-cols-12 grid-rows-12 gap-4 overflow-hidden">

                {/* [1] System Core (top-left, 4 cols, 4 rows) */}
                <div className="col-span-4 row-span-4 bg-[#0a0a0a] border border-gray-800/60 rounded-2xl flex flex-col overflow-hidden shadow-xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <Cpu className="w-4 h-4 text-emerald-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">System Core</span>
                    </div>
                    <div className="space-y-3 text-xs font-mono flex-1">
                        <div className="flex justify-between"><span className="text-gray-500">Uptime</span><span className="text-emerald-400 font-bold">{metrics.uptime}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Node</span><span className="text-gray-200">{sys.nodeVersion || "?"}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Platform</span><span className="text-gray-200">{sys.platform || "?"} {sys.arch || "?"}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Engine</span><span className="text-cyan-400 font-bold">{brain.engine || metrics.engineMode || "api"}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Model</span><span className="text-white font-bold">{brain.model || "?"}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Provider</span><span className="text-gray-300">{brain.provider || "?"}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">API</span><span className={brain.apiAvailable ? "text-emerald-400" : "text-red-400"}>{brain.apiAvailable ? "Available" : "Unavailable"}</span></div>
                    </div>
                </div>

                {/* [2] Memory Chart (top-middle, 4 cols, 4 rows) — RSS + Heap dual line */}
                <div className="col-span-4 row-span-4 bg-[#0a0a0a] border border-gray-800/60 rounded-2xl flex flex-col overflow-hidden shadow-xl p-5 group hover:border-emerald-500/30 transition-colors duration-500">
                    <div className="flex justify-between items-start mb-3">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <Layers className="w-4 h-4 text-blue-400" />
                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Memory</span>
                            </div>
                            <div className="flex items-baseline space-x-2">
                                <span className="text-3xl font-black text-white tracking-tighter font-mono">{metrics.memUsage.toFixed(0)}</span>
                                <span className="text-sm font-bold text-gray-500">MB RSS</span>
                            </div>
                            <span className="text-xs text-blue-400">{metrics.heapUsed.toFixed(0)} MB Heap</span>
                        </div>
                        <div className="text-right text-[10px] text-gray-600 font-mono">
                            <div>Total: {sys.totalMem ? Math.round(sys.totalMem / 1024) : "?"} GB</div>
                            <div>Free: {sys.freeMem ? Math.round(sys.freeMem / 1024) : "?"} GB</div>
                        </div>
                    </div>
                    <div className="flex-1 relative">
                        <MiniChart data={rssHistory} color="#10b981" />
                        <div className="absolute inset-0">
                            <MiniChart data={heapHistory} color="#3b82f6" opacity={0.5} />
                        </div>
                    </div>
                    <div className="mt-2 flex items-center gap-4 text-[10px] text-gray-600">
                        <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-emerald-500 rounded"></span>RSS</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-blue-500 rounded"></span>Heap</span>
                        <span className="ml-auto font-mono">{rssHistory.length}/60s</span>
                    </div>
                </div>

                {/* [3] CPU Chart (top-right, 4 cols, 4 rows) */}
                <div className="col-span-4 row-span-4 bg-[#0a0a0a] border border-gray-800/60 rounded-2xl flex flex-col overflow-hidden shadow-xl p-5 group hover:border-amber-500/30 transition-colors duration-500">
                    <div className="flex justify-between items-start mb-3">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <Cpu className="w-4 h-4 text-amber-400" />
                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">CPU Usage</span>
                            </div>
                            <div className="flex items-baseline space-x-2">
                                <span className="text-3xl font-black text-white tracking-tighter font-mono">{metrics.cpuPercent.toFixed(1)}</span>
                                <span className="text-sm font-bold text-gray-500">%</span>
                            </div>
                        </div>
                        <div className="text-right text-[10px] text-gray-600 font-mono">
                            <div>Load: {(sys.loadAvg || [0, 0, 0]).map((l: number) => l.toFixed(2)).join(" ")}</div>
                        </div>
                    </div>
                    <div className="flex-1 relative">
                        <MiniChart data={cpuHistory} color="#f59e0b" />
                    </div>
                    <div className="mt-2 text-[10px] text-gray-600 font-mono">{cpuHistory.length}/60s</div>
                </div>

                {/* [4] 3-Layer Memory Status (mid-left, 4 cols, 3 rows) */}
                <div className="col-span-4 row-span-3 bg-[#0a0a0a] border border-gray-800/60 rounded-2xl flex flex-col overflow-hidden shadow-xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <Database className="w-4 h-4 text-cyan-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">3-Layer Memory</span>
                    </div>
                    <div className="space-y-3 flex-1">
                        <MemoryLayerRow label="Core (SystemNative)" ready={mem3.core} description="Long-term facts & personality" />
                        <MemoryLayerRow label="Recall (ChatLog)" ready={mem3.recall} description="Conversation history & context" />
                        <MemoryLayerRow label="Archival (A-RAG)" ready={mem3.archival} description="Graph knowledge base" />
                    </div>
                    <div className="mt-3 pt-2 border-t border-gray-800/40 text-[10px] text-gray-600">
                        Skills loaded: <span className="text-emerald-400 font-bold">{metrics.skillsLoaded}</span> | RAG: <span className={metrics.ragAvailable ? "text-emerald-400" : "text-red-400"}>{metrics.ragAvailable ? "UP" : "DOWN"}</span>
                    </div>
                </div>

                {/* [5] Autonomy Panel (mid-middle, 4 cols, 3 rows) */}
                <div className="col-span-4 row-span-3 bg-[#0a0a0a] border border-gray-800/60 rounded-2xl flex flex-col overflow-hidden shadow-xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <Shield className="w-4 h-4 text-amber-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Autonomy L0-L3</span>
                    </div>
                    <div className="space-y-2.5 text-xs font-mono flex-1">
                        <div className="flex justify-between">
                            <span className="text-gray-500">Min Notify Level</span>
                            <span className={`font-bold px-2 py-0.5 rounded ${metrics.autonomyLevel === "L0" ? "bg-gray-800 text-gray-400" : metrics.autonomyLevel === "L1" ? "bg-blue-900/40 text-blue-400" : metrics.autonomyLevel === "L2" ? "bg-amber-900/40 text-amber-400" : "bg-red-900/40 text-red-400"}`}>
                                {metrics.autonomyLevel}
                            </span>
                        </div>
                        <div className="flex justify-between"><span className="text-gray-500">Telegram Mode</span><span className="text-gray-200">{autonomy.telegramMode || "console"}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Sleep Window</span><span className="text-gray-200">{autonomy.sleepStart || 1}:00 - {autonomy.sleepEnd || 7}:00</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Wake Interval</span><span className="text-gray-200">{autonomy.awakeMin || 2}-{autonomy.awakeMax || 5} min</span></div>
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-1">
                        {["L0", "L1", "L2", "L3"].map(l => (
                            <div key={l} className={`text-center text-[9px] py-1 rounded ${l === "L0" ? "bg-gray-800/50 text-gray-500" : l === "L1" ? "bg-blue-900/20 text-blue-500" : l === "L2" ? "bg-amber-900/20 text-amber-500" : "bg-red-900/20 text-red-500"}`}>
                                {l}: {l === "L0" ? "Silent" : l === "L1" ? "Auto+Log" : l === "L2" ? "Approve" : "Critical"}
                            </div>
                        ))}
                    </div>
                </div>

                {/* [6] Queue & Telegram Status (mid-right, 4 cols, 3 rows) */}
                <div className="col-span-4 row-span-3 bg-[#0a0a0a] border border-gray-800/60 rounded-2xl flex flex-col overflow-hidden shadow-xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <Radio className="w-4 h-4 text-purple-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Queue & Status</span>
                    </div>
                    <div className="space-y-2.5 text-xs font-mono flex-1">
                        <div className="flex justify-between"><span className="text-gray-500">Pending Tasks</span><span className="text-white font-bold">{metrics.queueCount}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">L1 Buffer</span><span className="text-blue-400">{metrics.l1BufferCount}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Golems Active</span><span className="text-emerald-400">{stats?.golems?.active ?? 1}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Golems Total</span><span className="text-gray-300">{stats?.golems?.total ?? 1}</span></div>
                    </div>
                </div>

                {/* [Bottom] Full-width log stream (12 cols, 5 rows) */}
                <div className="col-span-12 row-span-5 bg-[#0a0a0a] border border-gray-800/60 rounded-2xl flex flex-col overflow-hidden shadow-2xl">
                    <div className="px-5 py-3 bg-gray-900/30 border-b border-gray-800/60 flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                            <BrainCircuit className="w-4 h-4 text-white" />
                            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-200">Neuro-Link Stream</span>
                        </div>
                        <div className="flex space-x-2 text-[9px] font-bold text-gray-600 uppercase">
                            <span>General</span><span className="text-gray-800">|</span><span>Error</span>
                        </div>
                    </div>
                    <LogStream className="border-0 rounded-none p-4 bg-transparent text-[11px] font-mono leading-loose custom-scrollbar" types={['general', 'error']} />
                </div>
            </div>
        </div>
    );
}

// ── Mini SVG chart component ──
function MiniChart({ data, color, opacity = 1 }: { data: number[]; color: string; opacity?: number }) {
    if (data.length < 2) return <div className="w-full h-full flex items-center justify-center text-gray-700 text-xs">Collecting data...</div>;
    const max = Math.max(1, ...data) * 1.2;
    const points = data.map((v, i) => {
        const x = (i / (data.length - 1)) * 1000;
        const y = 100 - (v / max) * 100;
        return `${x},${y}`;
    });
    const pathData = `M 0,100 ` + points.map(p => `L ${p}`).join(" ") + ` L 1000,100 Z`;
    const lineData = `M ` + points.join(" L ");

    return (
        <svg className="w-full h-full" viewBox="0 0 1000 100" preserveAspectRatio="none" style={{ opacity }}>
            <defs>
                <linearGradient id={`grad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.25" />
                    <stop offset="100%" stopColor={color} stopOpacity="0.02" />
                </linearGradient>
            </defs>
            <path d={pathData} fill={`url(#grad-${color.replace("#", "")})`} />
            <path d={lineData} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// ── Memory layer row ──
function MemoryLayerRow({ label, ready, description }: { label: string; ready?: boolean; description: string }) {
    return (
        <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${ready ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" : "bg-gray-700"}`}>
                {ready && <span className="block w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping opacity-30"></span>}
            </div>
            <div className="flex-1">
                <div className="text-xs font-mono text-gray-200">{label}</div>
                <div className="text-[10px] text-gray-600">{description}</div>
            </div>
            <span className={`text-[10px] font-bold ${ready ? "text-emerald-400" : "text-gray-600"}`}>{ready ? "ONLINE" : "OFFLINE"}</span>
        </div>
    );
}
