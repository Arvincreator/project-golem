"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { socket } from "@/lib/socket";
import { User, Bot } from "lucide-react";
import { apiGet } from "@/lib/api-client";

interface AgentMessage {
    id: string;
    sender: string;
    content: string;
    timestamp: string;
    isSystem: boolean;
}

interface AgentLogRecord {
    timestamp: string;
    sender: string;
    content: string;
    isSystem: boolean;
}

interface SocketLogPayload {
    type?: string;
    msg?: string;
    time?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isAgentLogRecord(value: unknown): value is AgentLogRecord {
    if (!isRecord(value)) return false;
    return (
        typeof value.timestamp === "string" &&
        typeof value.sender === "string" &&
        typeof value.content === "string" &&
        typeof value.isSystem === "boolean"
    );
}

export function AgentChat() {
    const [messages, setMessages] = useState<AgentMessage[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const data = await apiGet<unknown>("/api/agent/logs", undefined, { profile: "none" });
                if (Array.isArray(data)) {
                    const logs = data.filter(isAgentLogRecord);
                    setMessages(logs.map((log) => ({
                        id: log.timestamp + Math.random().toString(),
                        sender: log.sender,
                        content: log.content,
                        timestamp: new Date(log.timestamp).toLocaleTimeString(),
                        isSystem: log.isSystem
                    })));
                }
            } catch (err) {
                console.error("Failed to load history:", err);
            }
        };
        fetchHistory();

        const handleSocketLog = (data: unknown) => {
            if (!isRecord(data)) return;
            const payload = data as SocketLogPayload;
            const rawSocketMsg = typeof payload.msg === "string" ? payload.msg : "";
            const socketType = typeof payload.type === "string" ? payload.type : "";

            // Filter for agent related logs
            if (socketType === 'agent' || rawSocketMsg.includes('[MultiAgent]')) {
                let rawMsg = rawSocketMsg;

                // Strip [MultiAgent] tag if present to clean up
                if (rawMsg.startsWith('[MultiAgent]')) {
                    rawMsg = rawMsg.replace('[MultiAgent]', '').trim();
                }

                let sender = "System";
                let content = rawMsg;
                let isSystem = true;

                // Parse: "[AgentName] content"
                const match = rawMsg.match(/\[(.*?)\]\s*(.*)/);
                if (match) {
                    sender = match[1];
                    content = match[2];
                    // System if sender is strictly MultiAgent or InteractiveMultiAgent
                    isSystem = sender === "MultiAgent" || sender === "InteractiveMultiAgent";
                }

                setMessages((prev) => [...prev.slice(-499), {
                    id: Date.now().toString() + Math.random(),
                    sender,
                    content,
                    timestamp: typeof payload.time === "string" ? payload.time : new Date().toLocaleTimeString(),
                    isSystem
                }]);
            }
        };

        socket.on("log", handleSocketLog);

        return () => {
            socket.off("log", handleSocketLog);
        };
    }, []);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    return (
        <div className="flex flex-col h-full bg-card rounded-xl border border-border p-4">
            <div className="flex-1 overflow-y-auto space-y-4 pr-2" ref={scrollRef}>
                {messages.map((msg) => {
                    const isUser = msg.sender === 'User';
                    return (
                        <div
                            key={msg.id}
                            className={cn(
                                "flex flex-col max-w-[80%]",
                                msg.isSystem ? "mx-auto items-center text-center" : isUser ? "ml-auto items-end" : "mr-auto"
                            )}
                        >
                            {!msg.isSystem && (
                                <div className={cn("flex items-center space-x-2 mb-1", isUser && "flex-row-reverse space-x-reverse")}>
                                    <div className={cn(
                                        "w-6 h-6 rounded-full flex items-center justify-center border",
                                        isUser ? "bg-primary/20 border-primary/30" : "bg-primary/10 border-primary/20"
                                    )}>
                                        {isUser ? <User className="w-3 h-3 text-primary" /> : <Bot className="w-3 h-3 text-primary" />}
                                    </div>
                                    <span className={cn("text-xs font-bold", isUser ? "text-primary" : "text-foreground")}>{msg.sender}</span>
                                    <span className="text-[10px] text-muted-foreground">{msg.timestamp}</span>
                                </div>
                            )}
                            <div
                                className={cn(
                                    "p-3 rounded-lg text-sm",
                                    msg.isSystem
                                        ? "bg-muted text-muted-foreground text-xs border border-border"
                                        : isUser
                                            ? "bg-primary/10 text-foreground font-medium border border-primary/20 rounded-tr-none"
                                            : "bg-secondary text-foreground font-medium border border-border rounded-tl-none"
                                )}
                            >
                                {msg.content}
                            </div>
                        </div>
                    );
                })}
                {messages.length === 0 && (
                    <div className="flex items-center justify-center h-full text-muted-foreground italic">
                        Waiting for agent activity...
                    </div>
                )}
            </div>
        </div>
    );
}
