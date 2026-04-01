"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useGolem } from "@/components/GolemContext";
import { useI18n } from "@/components/I18nProvider";
import { socket } from "@/lib/socket";
import { apiGet, apiPostWrite, apiWrite } from "@/lib/api-client";

type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "blocked" | "killed";

type TaskRecord = {
    id: string;
    subject: string;
    status: TaskStatus;
    version: number;
    owner?: string;
    updatedAt?: number;
    createdAt?: number;
    verification?: {
        status?: string;
        note?: string;
    };
};

type RecoveryPayload = {
    pendingCount: number;
    inProgressCount: number;
    blockedCount: number;
    nextTaskId: string | null;
};

type AuditEvent = {
    id: string;
    ts: number;
    type: string;
    taskId?: string | null;
    detail?: Record<string, unknown>;
};

type TaskEventPayload = {
    golemId?: string;
    ts?: number;
    type?: string;
    payload?: Record<string, unknown>;
};

type TaskMetrics = {
    completionRate?: number;
    terminalSuccessRate?: number;
    fakeCompletionIntercepts?: number;
    versionConflicts?: number;
    blockedAge?: {
        count?: number;
        averageMs?: number;
        maxMs?: number;
        oldestTaskId?: string | null;
    };
    recovery?: {
        attempts?: number;
        successes?: number;
        successRate?: number;
    };
    usage?: {
        totalTokens?: number;
        costUsd?: number;
        taskCountWithUsage?: number;
        averageTokensPerTask?: number;
    };
    totals?: {
        totalTasks?: number;
        nonTerminalTasks?: number;
        terminalTasks?: number;
    };
};

type IntegrityReport = {
    ok?: boolean;
    violationCount?: number;
    checkedAt?: number;
    truncated?: boolean;
    byType?: Record<string, number>;
};

const STATUS_OPTIONS: TaskStatus[] = ["pending", "in_progress", "blocked", "completed", "failed", "killed"];

function formatTime(ts?: number): string {
    if (!ts) return "n/a";
    try {
        return new Date(ts).toLocaleString("zh-TW", { hour12: false });
    } catch {
        return String(ts);
    }
}

function formatDuration(ms?: number): string {
    const safeMs = Number(ms || 0);
    if (!Number.isFinite(safeMs) || safeMs <= 0) return "0s";
    const totalSec = Math.floor(safeMs / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    const totalMin = Math.floor(totalSec / 60);
    if (totalMin < 60) return `${totalMin}m`;
    const totalHr = Math.floor(totalMin / 60);
    const remMin = totalMin % 60;
    return `${totalHr}h ${remMin}m`;
}

function buildStatusPatch(status: TaskStatus): Record<string, unknown> {
    if (status === "completed") {
        return {
            status: "completed",
            verification: {
                status: "verified",
                note: "manually verified from dashboard",
            },
            clearError: true,
        };
    }
    if (status === "in_progress") {
        return {
            status: "in_progress",
            clearError: true,
        };
    }
    if (status === "failed") {
        return {
            status: "failed",
            error: "marked failed from dashboard",
        };
    }
    return { status };
}

export default function TasksPage() {
    const { activeGolem } = useGolem();
    const { t } = useI18n();
    const [tasks, setTasks] = useState<TaskRecord[]>([]);
    const [recovery, setRecovery] = useState<RecoveryPayload | null>(null);
    const [metrics, setMetrics] = useState<TaskMetrics | null>(null);
    const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
    const [pendingSummary, setPendingSummary] = useState("");
    const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
    const [subject, setSubject] = useState("");
    const [selectedTaskId, setSelectedTaskId] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [liveEvents, setLiveEvents] = useState<TaskEventPayload[]>([]);

    const fetchTasks = useCallback(async () => {
        if (!activeGolem) return;
        setIsLoading(true);
        try {
            const [taskRes, recoveryRes, metricsRes, integrityRes] = await Promise.all([
                apiGet<{ success?: boolean; tasks?: TaskRecord[] }>(`/api/tasks?golemId=${encodeURIComponent(activeGolem)}&includeCompleted=true`),
                apiGet<{ success?: boolean; recovery?: RecoveryPayload; pendingSummary?: string }>(`/api/tasks/recovery?golemId=${encodeURIComponent(activeGolem)}`),
                apiGet<{ success?: boolean; metrics?: TaskMetrics }>(`/api/tasks/metrics?golemId=${encodeURIComponent(activeGolem)}`),
                apiGet<{ success?: boolean; integrity?: IntegrityReport }>(`/api/tasks/integrity?golemId=${encodeURIComponent(activeGolem)}&limit=50`),
            ]);
            setTasks(Array.isArray(taskRes.tasks) ? taskRes.tasks : []);
            setRecovery(recoveryRes.recovery || null);
            setPendingSummary(String(recoveryRes.pendingSummary || ""));
            setMetrics(metricsRes.metrics || null);
            setIntegrity(integrityRes.integrity || null);
        } catch (error) {
            console.error("Failed to fetch tasks:", error);
        } finally {
            setIsLoading(false);
        }
    }, [activeGolem]);

    const fetchAudit = useCallback(async (taskId: string) => {
        if (!activeGolem || !taskId) {
            setAuditEvents([]);
            return;
        }
        try {
            const result = await apiGet<{ success?: boolean; events?: AuditEvent[] }>(
                `/api/tasks/audit?golemId=${encodeURIComponent(activeGolem)}&taskId=${encodeURIComponent(taskId)}&limit=80`
            );
            setAuditEvents(Array.isArray(result.events) ? result.events.slice().reverse() : []);
        } catch (error) {
            console.error("Failed to fetch task audit events:", error);
        }
    }, [activeGolem]);

    useEffect(() => {
        fetchTasks();
    }, [fetchTasks]);

    useEffect(() => {
        if (!selectedTaskId) {
            setAuditEvents([]);
            return;
        }
        fetchAudit(selectedTaskId);
    }, [selectedTaskId, fetchAudit]);

    useEffect(() => {
        const onTaskEvent = (event: TaskEventPayload) => {
            if (!event || (event.golemId && event.golemId !== activeGolem)) return;
            setLiveEvents((prev) => [event, ...prev].slice(0, 40));
            fetchTasks();
            if (selectedTaskId) {
                fetchAudit(selectedTaskId);
            }
        };

        const onTaskRecovery = (event: { golemId?: string; recovery?: RecoveryPayload; pendingSummary?: string; metrics?: TaskMetrics; integrity?: IntegrityReport }) => {
            if (!event || (event.golemId && event.golemId !== activeGolem)) return;
            if (event.recovery) setRecovery(event.recovery);
            if (typeof event.pendingSummary === "string") setPendingSummary(event.pendingSummary);
            if (event.metrics) setMetrics(event.metrics);
            if (event.integrity) setIntegrity(event.integrity);
            fetchTasks();
        };

        socket.on("task_event", onTaskEvent);
        socket.on("task_recovery", onTaskRecovery);
        return () => {
            socket.off("task_event", onTaskEvent);
            socket.off("task_recovery", onTaskRecovery);
        };
    }, [activeGolem, fetchAudit, fetchTasks, selectedTaskId]);

    const counts = useMemo(() => {
        const data = {
            pending: 0,
            in_progress: 0,
            blocked: 0,
            completed: 0,
            failed: 0,
            killed: 0,
        };
        for (const task of tasks) {
            if (task.status in data) {
                data[task.status as keyof typeof data] += 1;
            }
        }
        return data;
    }, [tasks]);

    const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const trimmed = String(subject || "").trim();
        if (!trimmed || !activeGolem) return;
        setIsSaving(true);
        try {
            await apiPostWrite("/api/tasks", {
                golemId: activeGolem,
                input: {
                    subject: trimmed,
                    status: "pending",
                    source: "dashboard",
                },
                options: {
                    actor: "dashboard",
                },
            });
            setSubject("");
            await fetchTasks();
        } catch (error) {
            console.error("Failed to create task:", error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleStatusChange = async (task: TaskRecord, nextStatus: TaskStatus) => {
        if (!activeGolem || task.status === nextStatus) return;
        setIsSaving(true);
        try {
            await apiWrite(`/api/tasks/${encodeURIComponent(task.id)}?golemId=${encodeURIComponent(activeGolem)}`, {
                method: "PATCH",
                body: {
                    patch: buildStatusPatch(nextStatus),
                    options: {
                        actor: "dashboard",
                        expectedVersion: task.version,
                    },
                },
            });
            await fetchTasks();
            if (selectedTaskId === task.id) {
                await fetchAudit(task.id);
            }
        } catch (error) {
            console.error("Failed to update task:", error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleStop = async (task: TaskRecord) => {
        if (!activeGolem) return;
        setIsSaving(true);
        try {
            await apiPostWrite(`/api/tasks/${encodeURIComponent(task.id)}/stop?golemId=${encodeURIComponent(activeGolem)}`, {
                options: {
                    actor: "dashboard",
                    reason: "manual-stop",
                },
            });
            await fetchTasks();
            if (selectedTaskId === task.id) {
                await fetchAudit(task.id);
            }
        } catch (error) {
            console.error("Failed to stop task:", error);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4">
                <h1 className="text-xl font-semibold">{t("tasks.title")}</h1>
                <p className="mt-1 text-sm text-muted-foreground">{t("tasks.subtitle")}</p>

                <form className="mt-4 flex flex-wrap gap-2" onSubmit={handleCreate}>
                    <input
                        value={subject}
                        onChange={(event) => setSubject(event.target.value)}
                        placeholder={t("tasks.subjectPlaceholder")}
                        className="min-w-[220px] flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                    <button
                        type="submit"
                        disabled={isSaving || !subject.trim()}
                        className="rounded-lg border border-border bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                    >
                        {t("tasks.create")}
                    </button>
                    <button
                        type="button"
                        onClick={() => fetchTasks()}
                        disabled={isLoading}
                        className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm font-medium"
                    >
                        {t("tasks.refresh")}
                    </button>
                </form>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="rounded-xl border border-border bg-card p-4 xl:col-span-2">
                    <div className="mb-3 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-md border border-border bg-background px-2 py-1">pending {counts.pending}</span>
                        <span className="rounded-md border border-border bg-background px-2 py-1">in_progress {counts.in_progress}</span>
                        <span className="rounded-md border border-border bg-background px-2 py-1">blocked {counts.blocked}</span>
                        <span className="rounded-md border border-border bg-background px-2 py-1">completed {counts.completed}</span>
                        <span className="rounded-md border border-border bg-background px-2 py-1">failed {counts.failed}</span>
                        <span className="rounded-md border border-border bg-background px-2 py-1">killed {counts.killed}</span>
                    </div>

                    <div className="max-h-[520px] overflow-auto rounded-lg border border-border">
                        {tasks.length === 0 ? (
                            <div className="p-4 text-sm text-muted-foreground">{t("tasks.empty")}</div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-secondary/60 text-left text-xs uppercase tracking-[0.05em] text-muted-foreground">
                                    <tr>
                                        <th className="px-3 py-2">ID</th>
                                        <th className="px-3 py-2">Subject</th>
                                        <th className="px-3 py-2">Status</th>
                                        <th className="px-3 py-2">Updated</th>
                                        <th className="px-3 py-2">Ops</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tasks.map((task) => (
                                        <tr
                                            key={task.id}
                                            className={`border-t border-border/60 ${selectedTaskId === task.id ? "bg-primary/10" : ""}`}
                                        >
                                            <td className="px-3 py-2 font-mono text-xs">{task.id}</td>
                                            <td className="px-3 py-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedTaskId(task.id)}
                                                    className="text-left hover:underline"
                                                >
                                                    {task.subject}
                                                </button>
                                            </td>
                                            <td className="px-3 py-2">
                                                <select
                                                    value={task.status}
                                                    onChange={(event) => handleStatusChange(task, event.target.value as TaskStatus)}
                                                    className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                                                >
                                                    {STATUS_OPTIONS.map((status) => (
                                                        <option key={`${task.id}-${status}`} value={status}>
                                                            {status}
                                                        </option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td className="px-3 py-2 text-xs text-muted-foreground">{formatTime(task.updatedAt || task.createdAt)}</td>
                                            <td className="px-3 py-2">
                                                <button
                                                    type="button"
                                                    onClick={() => handleStop(task)}
                                                    className="rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary"
                                                >
                                                    stop
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="rounded-xl border border-border bg-card p-4">
                        <h2 className="text-sm font-semibold">{t("tasks.recovery")}</h2>
                        <div className="mt-2 text-xs text-muted-foreground">
                            <div>pending: {recovery ? recovery.pendingCount : 0}</div>
                            <div>in_progress: {recovery ? recovery.inProgressCount : 0}</div>
                            <div>blocked: {recovery ? recovery.blockedCount : 0}</div>
                            <div>next: {recovery && recovery.nextTaskId ? recovery.nextTaskId : "none"}</div>
                        </div>
                        <div className="mt-3 rounded-lg border border-border bg-background p-2 text-xs whitespace-pre-wrap">
                            <div className="mb-1 font-medium">{t("tasks.pendingSummary")}</div>
                            {pendingSummary || "(empty)"}
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-4">
                        <h2 className="text-sm font-semibold">Metrics & Integrity</h2>
                        <div className="mt-2 text-xs text-muted-foreground space-y-1">
                            <div>completionRate: {Math.round(Number((metrics && metrics.completionRate) || 0) * 100)}%</div>
                            <div>terminalSuccessRate: {Math.round(Number((metrics && metrics.terminalSuccessRate) || 0) * 100)}%</div>
                            <div>blocked.avgAge: {formatDuration(metrics && metrics.blockedAge ? metrics.blockedAge.averageMs : 0)}</div>
                            <div>blocked.maxAge: {formatDuration(metrics && metrics.blockedAge ? metrics.blockedAge.maxMs : 0)}</div>
                            <div>fakeCompleteIntercepts: {metrics ? metrics.fakeCompletionIntercepts || 0 : 0}</div>
                            <div>versionConflicts: {metrics ? metrics.versionConflicts || 0 : 0}</div>
                            <div>recovery.successRate: {Math.round(Number((metrics && metrics.recovery && metrics.recovery.successRate) || 0) * 100)}%</div>
                            <div>usage.tokens: {metrics && metrics.usage ? metrics.usage.totalTokens || 0 : 0}</div>
                            <div>usage.costUsd: ${(metrics && metrics.usage ? Number(metrics.usage.costUsd || 0) : 0).toFixed(6)}</div>
                        </div>
                        <div className="mt-3 rounded-lg border border-border bg-background p-2 text-xs">
                            <div className="font-medium">integrity: {integrity && integrity.ok ? "OK" : "FAILED"}</div>
                            <div className="text-muted-foreground">violations: {integrity ? integrity.violationCount || 0 : 0}</div>
                            <div className="mt-1 text-muted-foreground">checkedAt: {formatTime(integrity ? integrity.checkedAt : 0)}</div>
                            {integrity && integrity.byType && Object.keys(integrity.byType).length > 0 ? (
                                <div className="mt-2 space-y-1 text-muted-foreground">
                                    {Object.entries(integrity.byType).slice(0, 6).map(([key, count]) => (
                                        <div key={key}>{key}: {count}</div>
                                    ))}
                                    {integrity.truncated ? <div>...truncated</div> : null}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-4">
                        <h2 className="text-sm font-semibold">{t("tasks.audit")}</h2>
                        <div className="mt-2 max-h-[240px] overflow-auto space-y-2">
                            {auditEvents.length === 0 ? (
                                <div className="text-xs text-muted-foreground">No audit events.</div>
                            ) : (
                                auditEvents.map((event) => (
                                    <div key={event.id} className="rounded-md border border-border bg-background p-2">
                                        <div className="text-xs font-medium">{event.type}</div>
                                        <div className="text-[11px] text-muted-foreground">{formatTime(event.ts)}</div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-4">
                        <h2 className="text-sm font-semibold">Live Events</h2>
                        <div className="mt-2 max-h-[180px] overflow-auto space-y-1 text-xs text-muted-foreground">
                            {liveEvents.length === 0 ? (
                                <div>(none)</div>
                            ) : (
                                liveEvents.map((event, index) => (
                                    <div key={`${event.ts || index}-${index}`} className="rounded-md border border-border bg-background p-2">
                                        <div>{event.type || "task.event"}</div>
                                        <div>{formatTime(event.ts)}</div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
