"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { socket } from "@/lib/socket";

interface LogMessage {
    time: string;
    msg: string;
    type: 'general' | 'chronos' | 'queue' | 'agent' | 'error' | 'memory';
    raw?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isLogMessage(value: unknown): value is LogMessage {
    if (!isRecord(value)) return false;
    return (
        typeof value.time === "string" &&
        typeof value.msg === "string" &&
        typeof value.type === "string"
    );
}

export function LogStream({
    className,
    types,
    autoScroll = true,
    showHeader = true,
}: {
    className?: string;
    types?: LogMessage["type"][];
    autoScroll?: boolean;
    showHeader?: boolean;
}) {
    const [logs, setLogs] = useState<LogMessage[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleInit = (payload: unknown) => {
            if (!isRecord(payload) || !Array.isArray(payload.logs)) return;
            const parsed = payload.logs.filter(isLogMessage);
            if (parsed.length > 0) {
                setLogs(parsed);
            }
        };

        const handleLog = (payload: unknown) => {
            if (!isLogMessage(payload)) return;
            setLogs((prev) => [...prev.slice(-199), payload]); // Keep last 200 logs
        };

        socket.on("init", handleInit);
        socket.on("log", handleLog);

        // Explicitly request logs on mount (handles navigation)
        socket.emit("request_logs");

        return () => {
            socket.off("log", handleLog);
            socket.off("init", handleInit);
        };
    }, []);

    useEffect(() => {
        if (!autoScroll) return;
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [autoScroll, logs]);

    const getLogColor = (type: LogMessage['type']) => {
        switch (type) {
            case 'error': return 'text-destructive';
            case 'agent': return 'text-primary font-semibold';
            case 'chronos': return 'text-muted-foreground italic';
            case 'queue': return 'text-primary/70';
            case 'memory': return 'text-muted-foreground';
            default: return 'text-foreground';
        }
    };

    return (
        <div className={cn("enterprise-card border border-border rounded-2xl font-mono text-xs h-full flex flex-col overflow-hidden", className)}>
            {showHeader && (
                <div className="mx-4 mt-4 px-3 py-2 rounded-lg border border-border/70 bg-secondary/45 flex items-center justify-between">
                    <span className="enterprise-panel-title text-[10px]">System Stream</span>
                    <span className="enterprise-badge">Live {logs.length}</span>
                </div>
            )}
            <div className={cn(
                "flex-1 overflow-y-auto space-y-1 px-4 pb-4 custom-scrollbar",
                showHeader ? "pt-3" : "pt-4"
            )} ref={scrollRef}>
                {logs.filter(log => !types || types.includes(log.type)).map((log, i) => {
                    // Aggressive regex to catch both ISO and Local timestamps if they leak into msg
                    const isoRegex = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\]/;
                    const localRegex = /^\[\d{2}:\d{2}:\d{2}\]/;
                    
                    let trimmedMsg = log.msg.trim();
                    let displayTime = log.time;
                    let displayMsg = log.msg;

                    // 1. Try ISO Match
                    const isoMatch = trimmedMsg.match(isoRegex);
                    if (isoMatch) {
                        const date = new Date(isoMatch[1]);
                        if (!Number.isNaN(date.getTime())) {
                            displayTime = date.toLocaleTimeString('zh-TW', {
                                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
                            });
                            trimmedMsg = trimmedMsg.replace(isoRegex, "").trim();
                        }
                    }
                    
                    // 2. Secondary check: if message starts with another timestamp [HH:mm:ss], strip it
                    if (trimmedMsg.match(localRegex)) {
                        trimmedMsg = trimmedMsg.replace(localRegex, "").trim();
                    }
                    
                    // 3. Final display message (strip redundant level tags if they are already at the start)
                    displayMsg = trimmedMsg;

                    return (
                        <div key={i} className="flex border-b border-dashed border-border/70 pb-1 mb-1 last:border-0">
                            <span className="text-muted-foreground/90 mr-2 flex-shrink-0">[{displayTime}]</span>
                            <span className={cn(getLogColor(log.type), "break-words")}>
                                {displayMsg}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
