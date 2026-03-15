"use client";

import { useEffect, useState } from "react";
import { Terminal as TerminalIcon, AlertTriangle } from "lucide-react";
import { LogStream } from "@/components/LogStream";
import { MetricCard } from "@/components/MetricCard";
import { socket } from "@/lib/socket";

export default function TerminalPage() {
    const [metrics, setMetrics] = useState({
        uptime: "0h 0m",
        queueCount: 0,
        lastSchedule: "N/A",
        memUsage: 0,
        queueDepth: 0,
        tasksCompleted: 0,
        tasksFailed: 0,
        errors1h: 0,
    });

    const [memHistory, setMemHistory] = useState<{ time: string; value: number }[]>([]);
    const [hoveredPoint, setHoveredPoint] = useState<{ time: string; value: number; x: number; y: number } | null>(null);

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
                queueDepth: data.queueDepth || 0,
                tasksCompleted: data.tasksCompleted || 0,
                tasksFailed: data.tasksFailed || 0,
                errors1h: data.errors1h || 0,
            }));

            setMemHistory((prev) => {
                const newData = [...prev, { time: timeStr, value: parseFloat(data.memUsage.toFixed(1)) }];
                return newData.slice(-60); // Keep last 60 seconds
            });
        });

        return () => {
            socket.off("init");
            socket.off("state_update");
            socket.off("heartbeat");
        };
    }, []);

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        if (memHistory.length < 2) return;
        const svg = e.currentTarget;
        const rect = svg.getBoundingClientRect();

        // Use relative mouse position within the element
        const mouseX = e.clientX - rect.left;
        const width = rect.width;

        // Scale mouseX to match the 1000-unit viewBox width
        const viewBoxX = (mouseX / width) * 1000;

        const index = Math.round((mouseX / width) * (memHistory.length - 1));
        const safeIndex = Math.max(0, Math.min(memHistory.length - 1, index));
        const point = memHistory[safeIndex];

        const max = Math.max(100, ...memHistory.map(m => m.value)) * 1.2;
        const y = 100 - (point.value / max) * 100;

        // Store coordinates relative to viewBox (1000x100)
        setHoveredPoint({ ...point, x: (safeIndex / (memHistory.length - 1)) * 1000, y });
    };

    return (
        <div className="h-full flex flex-col bg-[#050505] font-sans selection:bg-emerald-500/30">
            {/* Header bar */}
            <div className="border-b border-gray-900 bg-[#0a0a0a]/80 backdrop-blur-md p-4 flex items-center justify-between shadow-sm flex-none sticky top-0 z-50">
                <div className="flex items-center space-x-4">
                    <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                        <TerminalIcon className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                        <h2 className="text-base font-bold text-gray-100 tracking-tight">Terminal Dashboard</h2>
                        <p className="text-xs text-gray-500 mt-0.5 font-medium">Real-time Golem Core System Monitor</p>
                    </div>
                </div>
                <div className="flex items-center space-x-2 text-[10px] uppercase tracking-widest text-gray-600 font-bold bg-gray-900/50 px-3 py-1.5 rounded-full border border-gray-800">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                    <span>System Online</span>
                </div>
            </div>

            {/* Terminal Grid Container */}
            <div className="flex-1 p-4 h-[calc(100vh-76px)] grid grid-cols-12 grid-rows-12 gap-4 overflow-hidden">

                {/* [左上 0,0 - 寬8,高4] 系統核心 (System Core) */}
                <div className="col-span-8 row-span-4 bg-[#0a0a0a] border border-gray-800/60 rounded-2xl flex flex-col overflow-hidden relative p-8 shadow-2xl shadow-black/50 group hover:border-emerald-500/30 transition-colors duration-500">
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent"></div>

                    <div className="flex justify-between items-start mb-6 z-10">
                        <div>
                            <h3 className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-2">Memory Usage Snapshot</h3>
                            <div className="flex items-baseline space-x-2">
                                <span className="text-5xl font-black text-white tracking-tighter font-mono">
                                    {metrics.memUsage.toFixed(1)}
                                </span>
                                <span className="text-xl font-bold text-gray-500 uppercase">MB</span>
                            </div>
                        </div>
                        <div className="text-emerald-500/40 p-2 bg-emerald-500/5 rounded-lg border border-emerald-500/10">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                            </svg>
                        </div>
                    </div>

                    <div className="flex-1 relative mt-2">
                        {/* Interactive Area Chart with proper scaling */}
                        <div className="absolute inset-0">
                            <svg
                                className="w-full h-full overflow-visible"
                                viewBox="0 0 1000 100"
                                preserveAspectRatio="none"
                                onMouseMove={handleMouseMove}
                                onMouseLeave={() => setHoveredPoint(null)}
                            >
                                <defs>
                                    <linearGradient id="refinedMemGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="rgba(16, 185, 129, 0.25)" />
                                        <stop offset="100%" stopColor="rgba(16, 185, 129, 0.02)" />
                                    </linearGradient>
                                </defs>

                                {(() => {
                                    if (memHistory.length < 2) return null;
                                    const max = Math.max(100, ...memHistory.map(m => m.value)) * 1.2;
                                    const points = memHistory.map((pt, i) => {
                                        const x = (i / (memHistory.length - 1)) * 1000;
                                        const y = 100 - (pt.value / max) * 100;
                                        return `${x},${y}`;
                                    });

                                    const pathData = `M 0,100 ` + points.map(p => `L ${p}`).join(' ') + ` L 1000,100 Z`;
                                    const lineData = `M ` + points.map(p => `L ${p}`).join(' ').substring(2);

                                    return (
                                        <g>
                                            <path d={pathData} fill="url(#refinedMemGradient)" className="transition-all duration-300" />
                                            <path d={lineData} fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="transition-all duration-300" />

                                            {hoveredPoint && (
                                                <g>
                                                    <line x1={hoveredPoint.x} y1="0" x2={hoveredPoint.x} y2="100" stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="4 2" />
                                                    <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="6" fill="#10b981" stroke="#0a0a0a" strokeWidth="2" />

                                                    <foreignObject
                                                        x={hoveredPoint.x > 850 ? hoveredPoint.x - 130 : hoveredPoint.x + 15}
                                                        y={hoveredPoint.y - 60}
                                                        width="120"
                                                        height="60"
                                                        className="overflow-visible"
                                                    >
                                                        <div className="bg-[#151719]/90 backdrop-blur-md border border-gray-700/50 rounded-xl p-2.5 shadow-2xl pointer-events-none ring-1 ring-white/5">
                                                            <div className="text-[9px] font-bold text-gray-500 uppercase tracking-tighter mb-1 font-sans">{hoveredPoint.time}</div>
                                                            <div className="font-mono font-black text-xs text-white">VAL: {hoveredPoint.value.toFixed(1)} <span className="text-[9px] text-gray-500">MB</span></div>
                                                        </div>
                                                    </foreignObject>
                                                </g>
                                            )}
                                        </g>
                                    );
                                })()}
                            </svg>
                        </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-gray-800/40 flex items-center justify-between">
                        <div className="text-[10px] text-gray-600 font-bold uppercase tracking-widest flex items-center">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2"></span>
                            Live Engine Stream
                        </div>
                        <div className="text-[10px] text-gray-600 font-mono">HISTORY: {memHistory.length}/60s</div>
                    </div>
                </div>

                {/* [右上 0,8 - 寬4,高4] 狀態 (Status) */}
                <div className="col-span-4 row-span-4 bg-[#0a0a0a] border border-gray-800/60 rounded-2xl flex flex-col overflow-hidden shadow-2xl">
                    <div className="bg-gray-900/30 px-4 py-3 border-b border-gray-800/60 flex items-center justify-between">
                        <span className="text-gray-400 text-[10px] font-black uppercase tracking-[0.2em]">System Status</span>
                        <div className="flex space-x-1">
                            <div className="w-1 h-1 rounded-full bg-emerald-500"></div>
                            <div className="w-1 h-1 rounded-full bg-gray-700"></div>
                            <div className="w-1 h-1 rounded-full bg-gray-700"></div>
                        </div>
                    </div>
                    <div className="flex-1 p-5 text-xs space-y-5 overflow-y-auto font-mono custom-scrollbar">
                        <div className="group">
                            <div className="font-bold text-emerald-500/80 mb-2 flex items-center text-[10px] uppercase tracking-wider">
                                <span className="w-1 h-3 bg-emerald-500 mr-2 rounded-full"></span>
                                Core Module (v9.0)
                            </div>
                            <ul className="space-y-2.5 ml-3 border-l border-gray-800 pl-4 py-1">
                                <li className="flex justify-between hover:translate-x-1 transition-transform"><span className="text-gray-500">MODE:</span> <span className="text-gray-200">BROWSER_ENV</span></li>
                                <li className="flex justify-between hover:translate-x-1 transition-transform"><span className="text-gray-500">ENGINE:</span> <span className="text-gray-200 font-bold">MULTI_AGENT</span></li>
                                <li className="flex justify-between hover:translate-x-1 transition-transform"><span className="text-gray-500">UPTIME:</span> <span className="text-emerald-400">{metrics.uptime}</span></li>
                            </ul>
                        </div>
                        <div>
                            <div className="font-bold text-gray-500 mb-2 flex items-center text-[10px] uppercase tracking-wider">
                                <span className="w-1 h-3 bg-gray-700 mr-2 rounded-full"></span>
                                Active Subsystems
                            </div>
                            <ul className="space-y-2.5 ml-3 border-l border-gray-800 pl-4 py-1">
                                <li className="flex justify-between"><span className="text-gray-600">Chronos:</span> <span className="text-green-500">ONLINE</span></li>
                                <li className="flex justify-between"><span className="text-gray-600">Queue:</span> <span className="text-gray-200">{metrics.queueDepth}</span></li>
                                <li className="flex justify-between"><span className="text-gray-600">Tasks:</span> <span className="text-green-400">✅{metrics.tasksCompleted}</span> <span className="text-red-400">❌{metrics.tasksFailed}</span></li>
                                <li className="flex justify-between"><span className="text-gray-600">Errors/1h:</span> <span className={metrics.errors1h > 0 ? "text-red-400" : "text-gray-200"}>{metrics.errors1h}</span></li>
                            </ul>
                        </div>
                    </div>
                </div>

                {/* [中層 4,0 - 寬6,高3] 時序雷達 (Chronos Radar) */}
                <div className="col-span-6 row-span-3 bg-[#0a0a0a] border border-gray-800/60 rounded-2xl flex flex-col overflow-hidden shadow-xl group hover:border-emerald-500/20 transition-colors">
                    <div className="px-4 py-2.5 bg-gray-900/20 border-b border-gray-800/60 flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                            <span className="text-emerald-400">⏰</span>
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">時序雷達 (Chronos Radar)</span>
                        </div>
                    </div>
                    <LogStream className="border-0 rounded-none p-3 bg-transparent text-[10px] font-mono leading-relaxed" types={['chronos']} />
                </div>

                {/* [中層 4,6 - 寬6,高3] 隊列交通 (Queue Traffic) */}
                <div className="col-span-6 row-span-3 bg-[#0a0a0a] border border-gray-800/60 rounded-2xl flex flex-col overflow-hidden shadow-xl group hover:border-purple-500/20 transition-colors">
                    <div className="px-4 py-2.5 bg-gray-900/20 border-b border-gray-800/60 flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                            <span className="text-purple-400">🚦</span>
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">隊列交通 (Traffic & Agents)</span>
                        </div>
                    </div>
                    <LogStream className="border-0 rounded-none p-3 bg-transparent text-[10px] font-mono leading-relaxed" types={['queue', 'agent']} autoScroll={false} />
                </div>

                {/* [底層 7,0 - 寬12,高5] 核心日誌 (Neuro-Link Stream) */}
                <div className="col-span-12 row-span-5 bg-[#0a0a0a] border border-gray-800/60 rounded-2xl flex flex-col overflow-hidden shadow-2xl">
                    <div className="px-5 py-3 bg-gray-900/30 border-b border-gray-800/60 flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                            <span className="text-white">📝</span>
                            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-200">核心日誌 (Neuro-Link Stream)</span>
                        </div>
                        <div className="flex space-x-2 text-[9px] font-bold text-gray-600 uppercase">
                            <span>General</span>
                            <span className="text-gray-800">|</span>
                            <span>Error</span>
                        </div>
                    </div>
                    <LogStream className="border-0 rounded-none p-4 bg-transparent text-[11px] font-mono leading-loose custom-scrollbar" types={['general', 'error']} />
                </div>

            </div>
        </div>
    );
}
