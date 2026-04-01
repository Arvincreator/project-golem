"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentChat } from "@/components/AgentChat";
import { useGolem } from "@/components/GolemContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { socket } from "@/lib/socket";
import { apiGet, apiPostWrite } from "@/lib/api-client";

type SessionRecord = {
    id: string;
    objective: string;
    status: string;
    metadata?: {
        workflow?: {
            phase?: string;
        };
    };
    workerIds?: string[];
    updatedAt?: number;
};

type WorkerRecord = {
    id: string;
    sessionId: string;
    role: string;
    status: string;
    progress?: {
        phase?: string;
        percent?: number;
    };
    updatedAt?: number;
};

type RecoveryRecord = {
    pendingSessions?: number;
    runningSessions?: number;
    blockedSessions?: number;
    failedSessions?: number;
    runningWorkers?: number;
    nextSessionId?: string | null;
};

type ResumeBrief = {
    recoveredSessions?: number;
    runningWorkers?: number;
    nextSession?: {
        id?: string;
        status?: string;
        phase?: string;
    } | null;
    sessions?: Array<{
        id: string;
        status: string;
        phase?: string;
        objective?: string;
        workerCount?: number;
    }>;
};

function formatTime(ts?: number): string {
    if (!ts || !Number.isFinite(ts)) return "n/a";
    try {
        return new Date(ts).toLocaleString("zh-TW", { hour12: false });
    } catch {
        return String(ts);
    }
}

function phaseOf(session?: SessionRecord): string {
    return String(session?.metadata?.workflow?.phase || "research");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

export default function AgentsPage() {
    const { activeGolem } = useGolem();
    const [sessions, setSessions] = useState<SessionRecord[]>([]);
    const [workers, setWorkers] = useState<WorkerRecord[]>([]);
    const [recovery, setRecovery] = useState<RecoveryRecord | null>(null);
    const [resumeBrief, setResumeBrief] = useState<ResumeBrief | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isMutating, setIsMutating] = useState(false);

    const fetchAgentState = useCallback(async () => {
        if (!activeGolem) return;
        setIsLoading(true);
        try {
            const [sessionsRes, recoveryRes, briefRes] = await Promise.all([
                apiGet<{ success?: boolean; sessions?: SessionRecord[]; workers?: WorkerRecord[] }>(
                    `/api/agents/sessions?golemId=${encodeURIComponent(activeGolem)}&includeTerminal=true&limit=120`
                ),
                apiGet<{ success?: boolean; recovery?: RecoveryRecord; resumeBrief?: ResumeBrief }>(
                    `/api/agents/recovery?golemId=${encodeURIComponent(activeGolem)}`
                ),
                apiGet<{ success?: boolean; brief?: ResumeBrief }>(
                    `/api/agents/resume-brief?golemId=${encodeURIComponent(activeGolem)}&limit=40`
                ),
            ]);

            setSessions(Array.isArray(sessionsRes.sessions) ? sessionsRes.sessions : []);
            setWorkers(Array.isArray(sessionsRes.workers) ? sessionsRes.workers : []);
            setRecovery(recoveryRes.recovery || null);
            setResumeBrief((briefRes && briefRes.brief) || recoveryRes.resumeBrief || null);
        } catch (error) {
            console.error("Failed to fetch agent state:", error);
        } finally {
            setIsLoading(false);
        }
    }, [activeGolem]);

    useEffect(() => {
        fetchAgentState();
    }, [fetchAgentState]);

    useEffect(() => {
        const onAgentEvent = (payload: unknown) => {
            if (!isRecord(payload)) return;
            if (payload.golemId && payload.golemId !== activeGolem) return;
            fetchAgentState();
        };

        const onAgentRecovery = (payload: unknown) => {
            if (!isRecord(payload)) return;
            if (payload.golemId && payload.golemId !== activeGolem) return;
            if (payload.recovery && isRecord(payload.recovery)) {
                setRecovery(payload.recovery as RecoveryRecord);
            }
            if (payload.resumeBrief && isRecord(payload.resumeBrief)) {
                setResumeBrief(payload.resumeBrief as ResumeBrief);
            }
            fetchAgentState();
        };

        socket.on("agent_event", onAgentEvent);
        socket.on("agent_recovery", onAgentRecovery);
        socket.on("agent_resume", onAgentEvent);
        socket.on("agent_violation", onAgentEvent);

        return () => {
            socket.off("agent_event", onAgentEvent);
            socket.off("agent_recovery", onAgentRecovery);
            socket.off("agent_resume", onAgentEvent);
            socket.off("agent_violation", onAgentEvent);
        };
    }, [activeGolem, fetchAgentState]);

    const sessionCounters = useMemo(() => {
        const data: Record<string, number> = {};
        for (const session of sessions) {
            const key = String(session.status || "unknown");
            data[key] = Number(data[key] || 0) + 1;
        }
        return data;
    }, [sessions]);

    const runningWorkers = useMemo(() => {
        return workers.filter((worker) => worker.status === "running" || worker.status === "pending");
    }, [workers]);

    const handleResumeAll = async () => {
        if (!activeGolem) return;
        setIsMutating(true);
        try {
            await apiPostWrite("/api/agents/sessions/resume", {
                golemId: activeGolem,
                options: {
                    actor: "dashboard",
                    source: "dashboard_resume",
                },
            });
            await fetchAgentState();
        } catch (error) {
            console.error("Failed to resume agent sessions:", error);
        } finally {
            setIsMutating(false);
        }
    };

    return (
        <div className="flex h-full flex-col space-y-6 p-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Agent Coordinator</h1>
                <div className="flex items-center space-x-2">
                    <span className="flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-primary">
                        <span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-primary" />
                        Live Session
                    </span>
                    <button
                        type="button"
                        onClick={fetchAgentState}
                        disabled={isLoading}
                        className="rounded-lg border border-border bg-secondary px-3 py-1 text-xs font-medium disabled:opacity-60"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-4">
                <div className="flex min-h-0 flex-col lg:col-span-3">
                    <AgentChat />
                </div>

                <div className="space-y-4">
                    <Card className="border-border bg-card shadow-md">
                        <CardHeader>
                            <CardTitle className="text-sm">Sessions</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                {Object.entries(sessionCounters).map(([status, count]) => (
                                    <span key={status} className="rounded border border-border bg-secondary/50 px-2 py-1">
                                        {status} {count}
                                    </span>
                                ))}
                                {Object.keys(sessionCounters).length === 0 && (
                                    <span className="rounded border border-border bg-secondary/50 px-2 py-1">no sessions</span>
                                )}
                            </div>
                            <div className="max-h-[220px] space-y-2 overflow-auto pr-1">
                                {sessions.slice(0, 16).map((session) => (
                                    <div key={session.id} className="rounded bg-secondary/40 p-2 text-xs">
                                        <div className="font-mono text-[11px] text-foreground">{session.id}</div>
                                        <div className="text-muted-foreground">{session.status} / {phaseOf(session)}</div>
                                        <div className="line-clamp-2 text-foreground/90">{session.objective}</div>
                                        <div className="text-[10px] text-muted-foreground">updated {formatTime(session.updatedAt)}</div>
                                    </div>
                                ))}
                                {sessions.length === 0 && (
                                    <div className="text-xs text-muted-foreground">No active sessions.</div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-border bg-card shadow-md">
                        <CardHeader>
                            <CardTitle className="text-sm">Workers</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="max-h-[200px] space-y-2 overflow-auto pr-1 text-xs">
                                {runningWorkers.slice(0, 16).map((worker) => (
                                    <div key={worker.id} className="rounded bg-secondary/40 p-2">
                                        <div className="font-mono text-[11px] text-foreground">{worker.id}</div>
                                        <div className="text-muted-foreground">{worker.role} / {worker.status}</div>
                                        <div className="text-[10px] text-muted-foreground">
                                            {worker.progress?.phase || "n/a"} {typeof worker.progress?.percent === "number" ? `${worker.progress.percent}%` : ""}
                                        </div>
                                    </div>
                                ))}
                                {runningWorkers.length === 0 && (
                                    <div className="text-xs text-muted-foreground">No running workers.</div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-border bg-card shadow-md">
                        <CardHeader>
                            <CardTitle className="text-sm">Resume Brief</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-xs text-muted-foreground">
                            <div className="flex justify-between">
                                <span>pending</span>
                                <span className="text-foreground">{recovery?.pendingSessions || 0}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>running</span>
                                <span className="text-foreground">{recovery?.runningSessions || 0}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>blocked/failed</span>
                                <span className="text-foreground">{(recovery?.blockedSessions || 0) + (recovery?.failedSessions || 0)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>next</span>
                                <span className="font-mono text-foreground">{recovery?.nextSessionId || resumeBrief?.nextSession?.id || "none"}</span>
                            </div>
                            <button
                                type="button"
                                onClick={handleResumeAll}
                                disabled={isMutating}
                                className="w-full rounded border border-border bg-secondary px-2 py-1 text-xs font-medium text-foreground disabled:opacity-60"
                            >
                                Resume Pending Sessions
                            </button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
