"use client";

import { useEffect, useState } from "react";
import { socket } from "@/lib/socket";
import { DashboardMetrics, MemHistoryPoint } from "../types";

const DEFAULT_METRICS: DashboardMetrics = {
    uptime: "0h 0m",
    queueCount: 0,
    lastSchedule: "無排程",
    agentWorkersActive: 0,
    agentWorkerTimeouts: 0,
    lastAgentWorkerEvent: "無事件",
    memUsage: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function parseString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

function parseNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function mergeMetrics(prev: DashboardMetrics, payload: unknown): DashboardMetrics {
    if (!isRecord(payload)) return prev;

    const uptime = parseString(payload.uptime);
    const lastSchedule = parseString(payload.lastSchedule);
    const lastAgentWorkerEvent = parseString(payload.lastAgentWorkerEvent);
    const queueCount = parseNumber(payload.queueCount);
    const agentWorkersActive = parseNumber(payload.agentWorkersActive);
    const agentWorkerTimeouts = parseNumber(payload.agentWorkerTimeouts);
    const memUsage = parseNumber(payload.memUsage);

    return {
        uptime: uptime ?? prev.uptime,
        lastSchedule: lastSchedule ?? prev.lastSchedule,
        lastAgentWorkerEvent: lastAgentWorkerEvent ?? prev.lastAgentWorkerEvent,
        queueCount: queueCount ?? prev.queueCount,
        agentWorkersActive: agentWorkersActive ?? prev.agentWorkersActive,
        agentWorkerTimeouts: agentWorkerTimeouts ?? prev.agentWorkerTimeouts,
        memUsage: memUsage ?? prev.memUsage,
    };
}

export function useDashboardRealtime() {
    const [metrics, setMetrics] = useState<DashboardMetrics>(DEFAULT_METRICS);
    const [memHistory, setMemHistory] = useState<MemHistoryPoint[]>([]);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        const handleConnect = () => setIsConnected(true);
        const handleDisconnect = () => setIsConnected(false);

        const handleInit = (payload: unknown) => {
            setMetrics((prev) => mergeMetrics(prev, payload));
        };

        const handleStateUpdate = (payload: unknown) => {
            setMetrics((prev) => mergeMetrics(prev, payload));
        };

        const handleHeartbeat = (payload: unknown) => {
            setMetrics((prev) => mergeMetrics(prev, payload));

            if (!isRecord(payload)) return;
            const memUsage = parseNumber(payload.memUsage);
            if (memUsage === null) return;

            const timeStr = new Date().toLocaleTimeString("zh-TW", { hour12: false });
            setMemHistory((prev) => {
                const next = [...prev, { time: timeStr, value: parseFloat(memUsage.toFixed(1)) }];
                return next.slice(-60);
            });
        };

        socket.on("connect", handleConnect);
        socket.on("disconnect", handleDisconnect);
        socket.on("init", handleInit);
        socket.on("state_update", handleStateUpdate);
        socket.on("heartbeat", handleHeartbeat);

        // Sync current state immediately.
        const rafId = requestAnimationFrame(() => setIsConnected(socket.connected));

        return () => {
            cancelAnimationFrame(rafId);
            socket.off("connect", handleConnect);
            socket.off("disconnect", handleDisconnect);
            socket.off("init", handleInit);
            socket.off("state_update", handleStateUpdate);
            socket.off("heartbeat", handleHeartbeat);
        };
    }, []);

    return {
        metrics,
        memHistory,
        isConnected,
    };
}
