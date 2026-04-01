"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { socket } from "@/lib/socket";
import { apiGet } from "@/lib/api-client";

type AgentEventPayload = {
    id?: string;
    type?: string;
    timestamp?: number;
    golemId?: string;
    sessionId?: string | null;
    workerId?: string | null;
    status?: string;
    message?: string;
    reason?: string;
    source?: string;
    actor?: string;
    notification?: {
        message?: string;
        actor?: string;
    };
    recoveryType?: string;
    recovery?: {
        pendingSessions?: number;
        runningSessions?: number;
        blockedSessions?: number;
        failedSessions?: number;
        nextSessionId?: string | null;
    };
};

type AuditResponse = {
    success?: boolean;
    events?: AgentEventPayload[];
};

type RecoveryResponse = {
    success?: boolean;
    recovery?: AgentEventPayload["recovery"];
};

type AgentMessage = {
    id: string;
    sender: string;
    content: string;
    timestamp: string;
    isSystem: boolean;
};

function formatTimestamp(value?: number): string {
    if (!value || !Number.isFinite(value)) {
        return new Date().toLocaleTimeString();
    }
    try {
        return new Date(value).toLocaleTimeString();
    } catch {
        return new Date().toLocaleTimeString();
    }
}

function renderEventContent(event: AgentEventPayload): string {
    const type = String(event.type || "").trim();
    if (type === "agent.notification") {
        const note = event.notification && typeof event.notification.message === "string"
            ? event.notification.message
            : event.message || "notification";
        return `[notification] ${note}`;
    }
    if (type === "agent.resume") {
        return `[resume] sessions resumed`;
    }
    if (type === "agent.violation") {
        return `[violation] ${event.reason || event.message || "policy violation"}`;
    }
    if (type === "agent.session.created" || type === "agent.session.updated") {
        return `[session] ${event.sessionId || "unknown"} status=${event.status || "n/a"}`;
    }
    if (type === "agent.worker.created" || type === "agent.worker.updated") {
        return `[worker] ${event.workerId || "unknown"} status=${event.status || "n/a"}`;
    }
    if (type === "agent.recovery") {
        const recovery = event.recovery || {};
        return `[recovery:${event.recoveryType || "unknown"}] pending=${recovery.pendingSessions || 0} running=${recovery.runningSessions || 0} blocked=${recovery.blockedSessions || 0} failed=${recovery.failedSessions || 0} next=${recovery.nextSessionId || "none"}`;
    }
    return `${type || "agent_event"} ${event.message || ""}`.trim();
}

function normalizeEvent(event: AgentEventPayload): AgentMessage {
    const type = String(event.type || "").trim();
    const sender = type.startsWith("agent.") ? "Coordinator" : "System";
    const content = renderEventContent(event);
    return {
        id: String(event.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
        sender,
        content,
        timestamp: formatTimestamp(event.timestamp),
        isSystem: true,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

export function AgentChat() {
    const [messages, setMessages] = useState<AgentMessage[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const seenIds = useRef<Set<string>>(new Set());

    const appendEvent = (event: AgentEventPayload) => {
        const message = normalizeEvent(event);
        if (seenIds.current.has(message.id)) return;
        seenIds.current.add(message.id);
        setMessages((prev) => [...prev.slice(-999), message]);
    };

    useEffect(() => {
        const fetchInitial = async () => {
            try {
                const [audit, recovery] = await Promise.all([
                    apiGet<AuditResponse>("/api/agents/audit?limit=200"),
                    apiGet<RecoveryResponse>("/api/agents/recovery"),
                ]);

                const initialEvents = Array.isArray(audit.events) ? audit.events.slice().reverse() : [];
                for (const event of initialEvents) {
                    appendEvent(event);
                }

                if (recovery && recovery.recovery) {
                    appendEvent({
                        id: `agent_recovery_bootstrap_${Date.now()}`,
                        type: "agent.recovery",
                        timestamp: Date.now(),
                        recoveryType: "bootstrap",
                        recovery: recovery.recovery,
                    });
                }
            } catch (error) {
                console.error("Failed to fetch agent audit/recovery:", error);
            }
        };

        fetchInitial();

        const onInit = (payload: unknown) => {
            if (!isRecord(payload)) return;
            const agentEventsRaw = payload.agentEvents;
            const agentRecoveryRaw = payload.agentRecovery;
            if (Array.isArray(agentEventsRaw)) {
                for (const item of agentEventsRaw) {
                    if (!isRecord(item)) continue;
                    appendEvent(item as AgentEventPayload);
                }
            }
            if (isRecord(agentRecoveryRaw)) {
                for (const value of Object.values(agentRecoveryRaw)) {
                    if (!isRecord(value)) continue;
                    appendEvent({
                        ...(value as AgentEventPayload),
                        type: "agent.recovery",
                    });
                }
            }
        };

        const onAgentEvent = (event: unknown) => {
            if (!isRecord(event)) return;
            appendEvent(event as AgentEventPayload);
        };

        const onAgentRecovery = (event: unknown) => {
            if (!isRecord(event)) return;
            appendEvent({
                ...(event as AgentEventPayload),
                type: "agent.recovery",
            });
        };

        socket.on("init", onInit);
        socket.on("agent_event", onAgentEvent);
        socket.on("agent_recovery", onAgentRecovery);

        return () => {
            socket.off("init", onInit);
            socket.off("agent_event", onAgentEvent);
            socket.off("agent_recovery", onAgentRecovery);
        };
    }, []);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const rendered = useMemo(() => messages.slice(-300), [messages]);

    return (
        <div className="flex h-full flex-col rounded-xl border border-border bg-card p-4">
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pr-2">
                {rendered.map((msg) => {
                    const isUser = msg.sender === "User";
                    return (
                        <div
                            key={msg.id}
                            className={cn(
                                "flex max-w-[90%] flex-col",
                                msg.isSystem ? "mx-auto items-center text-center" : isUser ? "ml-auto items-end" : "mr-auto"
                            )}
                        >
                            {!msg.isSystem && (
                                <div className={cn("mb-1 flex items-center space-x-2", isUser && "flex-row-reverse space-x-reverse")}>
                                    <div className={cn(
                                        "flex h-6 w-6 items-center justify-center rounded-full border",
                                        isUser ? "border-primary/30 bg-primary/20" : "border-primary/20 bg-primary/10"
                                    )}>
                                        {isUser ? <User className="h-3 w-3 text-primary" /> : <Bot className="h-3 w-3 text-primary" />}
                                    </div>
                                    <span className={cn("text-xs font-bold", isUser ? "text-primary" : "text-foreground")}>{msg.sender}</span>
                                    <span className="text-[10px] text-muted-foreground">{msg.timestamp}</span>
                                </div>
                            )}
                            <div
                                className={cn(
                                    "rounded-lg border p-3 text-sm",
                                    msg.isSystem
                                        ? "border-border bg-muted text-xs text-muted-foreground"
                                        : isUser
                                            ? "rounded-tr-none border-primary/20 bg-primary/10 font-medium text-foreground"
                                            : "rounded-tl-none border-border bg-secondary font-medium text-foreground"
                                )}
                            >
                                {msg.content}
                            </div>
                        </div>
                    );
                })}
                {rendered.length === 0 && (
                    <div className="flex h-full items-center justify-center italic text-muted-foreground">
                        Waiting for agent activity...
                    </div>
                )}
            </div>
        </div>
    );
}
