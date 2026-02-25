"use client";

import { useEffect, useState } from "react";
import { socket } from "@/lib/socket";
import { MetricCard } from "@/components/MetricCard";
import { LogStream } from "@/components/LogStream";
import { Activity, Cpu, Server, Clock, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
    const [metrics, setMetrics] = useState({
        uptime: "0h 0m",
        queueCount: 0,
        lastSchedule: "無排程",
        memUsage: 0,
    });

    const [memHistory, setMemHistory] = useState<{ time: string; value: number }[]>([]);
    const [isReloading, setIsReloading] = useState(false);

    const handleReload = async () => {
        if (!confirm("確定要重新啟動 Golem 嗎？")) return;
        
        setIsReloading(true);
        try {
            const res = await fetch("/api/system/reload", { method: "POST" });
            const data = await res.json();
            if (data.success) {
                alert("系統正在重新啟動，請稍候...");
                // Reload the page after a delay to reconnect to the new server instance
                setTimeout(() => {
                    window.location.reload();
                }, 3000);
            }
        } catch (e) {
            console.error("Reload failed:", e);
            alert("重新啟動失敗");
            setIsReloading(false);
        }
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
                return newData.slice(-60); // Keep last 60 seconds
            });
        });

        return () => {
            socket.off("init");
            socket.off("state_update");
            socket.off("heartbeat");
        };
    }, []);

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
                <MetricCard
                    title="Queue Load"
                    value={metrics.queueCount}
                    icon={Server}
                />
                <MetricCard
                    title="System Uptime"
                    value={metrics.uptime}
                    icon={Clock}
                />
                <MetricCard
                    title="Next Schedule"
                    value={metrics.lastSchedule}
                    icon={Cpu}
                />
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

                    <div className="mt-6 pt-6 border-t border-gray-800">
                        <Button
                            variant="destructive"
                            className="w-full flex items-center justify-center space-x-2"
                            onClick={handleReload}
                            disabled={isReloading}
                        >
                            <RefreshCcw className={`w-4 h-4 ${isReloading ? 'animate-spin' : ''}`} />
                            <span>{isReloading ? "正在重啟..." : "重新啟動 Golem"}</span>
                        </Button>
                        <p className="text-[10px] text-gray-500 mt-2 text-center">
                            注意：這將重啟整個後端進程，前端會短暫斷線。
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
