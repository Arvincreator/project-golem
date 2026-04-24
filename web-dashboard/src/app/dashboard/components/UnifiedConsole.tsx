"use client";

import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Activity, AlertTriangle, BarChart3, Bot, CalendarClock, CheckCircle2, ChevronDown, ChevronUp, Clock3, Cpu, GripVertical, HardDrive, LayoutDashboard, ListChecks, MemoryStick, Play, RefreshCw, Server, ShieldCheck, SlidersHorizontal, Terminal as TerminalIcon, Waves, Wifi, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogStream } from "@/components/LogStream";
import { SystemActionDialogs } from "@/components/SystemActionDialogs";
import { useGolem } from "@/components/GolemContext";
import { useI18n } from "@/components/I18nProvider";
import { useToast } from "@/components/ui/toast-provider";
import { apiGet, apiPost } from "@/lib/api-client";
import { socket } from "@/lib/socket";
import { cn } from "@/lib/utils";
import DashboardMetricsGrid, { type DashboardMetricCard } from "./DashboardMetricsGrid";
import DeveloperPlaque from "./DeveloperPlaque";
import NoGolemsState from "./NoGolemsState";
import UpdateMarqueeNotice from "./UpdateMarqueeNotice";

type MetricsState = {
    uptime: string;
    queueCount: number;
    lastSchedule: string;
    agentWorkersActive: number;
    agentWorkerTimeouts: number;
    lastAgentWorkerEvent: string;
    memUsage: number;
    cpuUsage: number;
};

type TimePoint = {
    time: string;
    value: number;
};

type HoveredPoint = TimePoint & {
    x: number;
    y: number;
    type: "cpu" | "queue";
};

type SystemStatusData = {
    runtime?: {
        osName?: string;
        uptime?: number;
        platform?: string;
    };
    health?: {
        env?: boolean;
        deps?: boolean;
        core?: boolean;
    };
    system?: {
        diskAvail?: string;
        freeMem?: string;
    };
};

type MetricsUpdatePayload = Partial<Pick<MetricsState, "uptime" | "queueCount" | "lastSchedule" | "agentWorkersActive" | "agentWorkerTimeouts" | "lastAgentWorkerEvent" | "memUsage" | "cpuUsage">>;

type HeartbeatPayload = {
    uptime?: string;
    memUsage?: number;
    cpu?: number;
};

type UnifiedTab = "OVERVIEW" | "LOGS";

type UnifiedConsoleProps = {
    defaultTab?: UnifiedTab;
    showUpdateMarquee?: boolean;
};

type MetricCardId =
    | "queueLoad"
    | "systemUptime"
    | "nextSchedule"
    | "backendStatus"
    | "activeGolem"
    | "activeGolemStatus"
    | "runtimePlatform"
    | "healthScore"
    | "diskAvailable"
    | "freeSystemMemory"
    | "golemCount"
    | "logsPerMinute"
    | "errorRate"
    | "agentEvents";

const METRIC_SELECTION_STORAGE_KEY = "golem-dashboard-selected-metrics-v1";

const ALL_METRIC_IDS: MetricCardId[] = [
    "queueLoad",
    "systemUptime",
    "nextSchedule",
    "backendStatus",
    "activeGolem",
    "activeGolemStatus",
    "runtimePlatform",
    "healthScore",
    "diskAvailable",
    "freeSystemMemory",
    "golemCount",
    "logsPerMinute",
    "errorRate",
    "agentEvents",
];

const DEFAULT_SELECTED_METRIC_IDS: MetricCardId[] = [
    "queueLoad",
    "systemUptime",
    "backendStatus",
    "healthScore",
    "logsPerMinute",
    "errorRate",
];

type ConsoleLogEvent = {
    ts: number;
    type: string;
};

function isMetricCardId(value: string): value is MetricCardId {
    return ALL_METRIC_IDS.includes(value as MetricCardId);
}

function readStoredMetricSelection(): MetricCardId[] {
    if (typeof window === "undefined") return DEFAULT_SELECTED_METRIC_IDS;
    try {
        const raw = localStorage.getItem(METRIC_SELECTION_STORAGE_KEY);
        if (!raw) return DEFAULT_SELECTED_METRIC_IDS;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return DEFAULT_SELECTED_METRIC_IDS;
        const ids = parsed
            .filter((item): item is string => typeof item === "string")
            .filter(isMetricCardId);
        return ids.length > 0 ? ids : DEFAULT_SELECTED_METRIC_IDS;
    } catch {
        return DEFAULT_SELECTED_METRIC_IDS;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function parseNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function parseMetricsUpdate(payload: unknown): MetricsUpdatePayload | null {
    if (!isRecord(payload)) return null;
    const patch: MetricsUpdatePayload = {};

    if (typeof payload.uptime === "string") patch.uptime = payload.uptime;
    if (typeof payload.lastSchedule === "string") patch.lastSchedule = payload.lastSchedule;
    if (typeof payload.lastAgentWorkerEvent === "string") patch.lastAgentWorkerEvent = payload.lastAgentWorkerEvent;

    const queueCount = parseNumber(payload.queueCount);
    if (queueCount !== null) patch.queueCount = queueCount;
    const agentWorkersActive = parseNumber(payload.agentWorkersActive);
    if (agentWorkersActive !== null) patch.agentWorkersActive = agentWorkersActive;
    const agentWorkerTimeouts = parseNumber(payload.agentWorkerTimeouts);
    if (agentWorkerTimeouts !== null) patch.agentWorkerTimeouts = agentWorkerTimeouts;

    const memUsage = parseNumber(payload.memUsage);
    if (memUsage !== null) patch.memUsage = memUsage;

    const cpuUsage = parseNumber(payload.cpuUsage);
    if (cpuUsage !== null) patch.cpuUsage = cpuUsage;

    return Object.keys(patch).length > 0 ? patch : null;
}

function parseHeartbeat(payload: unknown): HeartbeatPayload | null {
    if (!isRecord(payload)) return null;
    const memUsage = parseNumber(payload.memUsage);
    if (memUsage === null) return null;

    const heartbeat: HeartbeatPayload = { memUsage };
    if (typeof payload.uptime === "string") heartbeat.uptime = payload.uptime;

    const cpu = parseNumber(payload.cpu);
    if (cpu !== null) heartbeat.cpu = cpu;
    return heartbeat;
}

function parseSystemStatus(payload: unknown): SystemStatusData | null {
    if (!isRecord(payload)) return null;
    const status: SystemStatusData = {};

    if (isRecord(payload.runtime)) {
        const uptime = parseNumber(payload.runtime.uptime);
        status.runtime = {
            osName: typeof payload.runtime.osName === "string" ? payload.runtime.osName : undefined,
            platform: typeof payload.runtime.platform === "string" ? payload.runtime.platform : undefined,
            uptime: uptime ?? undefined,
        };
    }

    if (isRecord(payload.health)) {
        status.health = {
            env: typeof payload.health.env === "boolean" ? payload.health.env : undefined,
            deps: typeof payload.health.deps === "boolean" ? payload.health.deps : undefined,
            core: typeof payload.health.core === "boolean" ? payload.health.core : undefined,
        };
    }

    if (isRecord(payload.system)) {
        status.system = {
            diskAvail: typeof payload.system.diskAvail === "string" ? payload.system.diskAvail : undefined,
            freeMem: typeof payload.system.freeMem === "string" ? payload.system.freeMem : undefined,
        };
    }

    return status;
}

export default function UnifiedConsole({
    defaultTab = "OVERVIEW",
    showUpdateMarquee = true,
}: UnifiedConsoleProps) {
    const toast = useToast();
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    const { activeGolem, activeGolemStatus, startGolem, hasGolems, isLoadingGolems, isBooting, golems } = useGolem();

    const [metrics, setMetrics] = useState<MetricsState>({
        uptime: "0h 0m",
        queueCount: 0,
        lastSchedule: "N/A",
        agentWorkersActive: 0,
        agentWorkerTimeouts: 0,
        lastAgentWorkerEvent: "N/A",
        memUsage: 0,
        cpuUsage: 0,
    });
    const [memHistory, setMemHistory] = useState<TimePoint[]>([]);
    const [cpuHistory, setCpuHistory] = useState<TimePoint[]>([]);
    const [queueHistory, setQueueHistory] = useState<TimePoint[]>([]);
    const [recentLogEvents, setRecentLogEvents] = useState<ConsoleLogEvent[]>([]);
    const [hoveredPoint, setHoveredPoint] = useState<HoveredPoint | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [systemStatus, setSystemStatus] = useState<SystemStatusData | null>(null);
    const [activeTab, setActiveTab] = useState<UnifiedTab>(defaultTab);
    const [selectedMetricIds, setSelectedMetricIds] = useState<MetricCardId[]>(() => readStoredMetricSelection());
    const [isMetricCustomizerOpen, setIsMetricCustomizerOpen] = useState(false);
    const [draggingMetricId, setDraggingMetricId] = useState<MetricCardId | null>(null);
    const [dragOverMetricId, setDragOverMetricId] = useState<MetricCardId | null>(null);

    const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; variant: "restart" | "shutdown" | "start" }>({
        open: false,
        variant: "restart",
    });
    const [doneDialog, setDoneDialog] = useState<{ open: boolean; variant: "restarted" | "shutdown" | "started" }>({
        open: false,
        variant: "restarted",
    });
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        setActiveTab(defaultTab);
    }, [defaultTab]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        localStorage.setItem(METRIC_SELECTION_STORAGE_KEY, JSON.stringify(selectedMetricIds));
    }, [selectedMetricIds]);

    const openConfirm = (variant: "restart" | "shutdown" | "start") => {
        setConfirmDialog({ open: true, variant });
    };

    const handleReload = async () => {
        setIsLoading(true);
        try {
            const data = await apiPost<{ success?: boolean }>("/api/system/reload");
            if (data.success) {
                setConfirmDialog((prev) => ({ ...prev, open: false }));
                setDoneDialog({ open: true, variant: "restarted" });
                setTimeout(() => window.location.reload(), 3000);
            }
        } catch (error) {
            console.error("Reload failed:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleShutdown = async () => {
        setIsLoading(true);
        try {
            const data = await apiPost<{ success?: boolean }>("/api/system/shutdown");
            if (data.success) {
                setConfirmDialog((prev) => ({ ...prev, open: false }));
                setDoneDialog({ open: true, variant: "shutdown" });
                setTimeout(() => window.location.reload(), 2000);
            }
        } catch (error) {
            console.error("Shutdown failed:", error);
            setConfirmDialog((prev) => ({ ...prev, open: false }));
            setDoneDialog({ open: true, variant: "shutdown" });
        } finally {
            setIsLoading(false);
        }
    };

    const handleStart = async () => {
        const golemId = activeGolem || "golem_A";
        setIsLoading(true);
        try {
            const success = await startGolem(golemId);
            if (success) {
                setConfirmDialog((prev) => ({ ...prev, open: false }));
                setDoneDialog({ open: true, variant: "started" });
            } else {
                toast.error(
                    isEnglish ? "Start failed" : "啟動失敗",
                    isEnglish ? "Backend timeout or not ready. Please try again later." : "後端服務逾時或未就緒。請稍後再試。"
                );
            }
        } catch (error) {
            console.error("Start failed:", error);
            toast.error(
                isEnglish ? "Start failed" : "啟動失敗",
                isEnglish ? "An error occurred while starting. Please check logs." : "啟動過程發生錯誤，請查看控制台日誌。"
            );
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirm = () => {
        if (confirmDialog.variant === "restart") {
            void handleReload();
            return;
        }
        if (confirmDialog.variant === "shutdown") {
            void handleShutdown();
            return;
        }
        void handleStart();
    };

    const handleClearLogs = () => {
        (window as Window & { clearLogs?: () => void }).clearLogs?.();
    };

    const toggleMetricSelection = (id: MetricCardId) => {
        setSelectedMetricIds((prev) => {
            if (prev.includes(id)) {
                if (prev.length === 1) {
                    toast.warning(
                        isEnglish ? "Keep at least one metric" : "至少保留一張指標卡",
                        isEnglish ? "Dashboard requires at least one metric card to stay visible." : "控制台至少需要顯示一張指標卡。"
                    );
                    return prev;
                }
                return prev.filter((item) => item !== id);
            }
            return [...prev, id];
        });
    };

    const reorderMetricCards = (dragId: MetricCardId, dropId: MetricCardId) => {
        if (dragId === dropId) return;
        setSelectedMetricIds((prev) => {
            const fromIndex = prev.indexOf(dragId);
            const toIndex = prev.indexOf(dropId);
            if (fromIndex === -1 || toIndex === -1) return prev;

            const next = [...prev];
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            return next;
        });
    };

    const moveMetricCardByOffset = (id: MetricCardId, offset: -1 | 1) => {
        setSelectedMetricIds((prev) => {
            const index = prev.indexOf(id);
            if (index === -1) return prev;
            const target = index + offset;
            if (target < 0 || target >= prev.length) return prev;
            const next = [...prev];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    const applyMetricPreset = (preset: "executive" | "observability" | "all" | "minimal") => {
        if (preset === "all") {
            setSelectedMetricIds(ALL_METRIC_IDS);
            return;
        }
        if (preset === "observability") {
            setSelectedMetricIds([
                "queueLoad",
                "backendStatus",
                "healthScore",
                "logsPerMinute",
                "errorRate",
                "agentEvents",
                "diskAvailable",
                "freeSystemMemory",
            ]);
            return;
        }
        if (preset === "minimal") {
            setSelectedMetricIds(["backendStatus", "logsPerMinute"]);
            return;
        }
        setSelectedMetricIds(DEFAULT_SELECTED_METRIC_IDS);
    };

    useEffect(() => {
        const handleConnect = () => setIsConnected(true);
        const handleDisconnect = () => setIsConnected(false);
        const handleInit = (payload: unknown) => {
            const patch = parseMetricsUpdate(payload);
            if (!patch) return;
            const timeStr = new Date().toLocaleTimeString(locale, { hour12: false });
            setMetrics((prev) => {
                const next = { ...prev, ...patch };
                setQueueHistory((history) => [...history, { time: timeStr, value: next.queueCount }].slice(-60));
                return next;
            });
        };
        const handleStateUpdate = (payload: unknown) => {
            const patch = parseMetricsUpdate(payload);
            if (!patch) return;
            const timeStr = new Date().toLocaleTimeString(locale, { hour12: false });
            setMetrics((prev) => {
                const next = { ...prev, ...patch };
                setQueueHistory((history) => [...history, { time: timeStr, value: next.queueCount }].slice(-60));
                return next;
            });
        };
        const handleHeartbeat = (payload: unknown) => {
            const heartbeat = parseHeartbeat(payload);
            if (!heartbeat) return;

            const timeStr = new Date().toLocaleTimeString(locale, { hour12: false });
            setMetrics((prev) => {
                const next = {
                    ...prev,
                    uptime: heartbeat.uptime ?? prev.uptime,
                    memUsage: heartbeat.memUsage ?? prev.memUsage,
                    cpuUsage: heartbeat.cpu ?? prev.cpuUsage,
                };
                setQueueHistory((history) => [...history, { time: timeStr, value: next.queueCount }].slice(-60));
                return next;
            });

            setMemHistory((prev) => {
                const next = [...prev, { time: timeStr, value: Number(heartbeat.memUsage?.toFixed(1) ?? "0") }];
                return next.slice(-60);
            });

            if (heartbeat.cpu !== undefined) {
                setCpuHistory((prev) => {
                    const next = [...prev, { time: timeStr, value: Number(heartbeat.cpu?.toFixed(1) ?? "0") }];
                    return next.slice(-60);
                });
            }
        };

        const handleLog = (payload: unknown) => {
            if (!isRecord(payload) || typeof payload.type !== "string") return;
            const logType = payload.type;
            const now = Date.now();
            const windowStart = now - 5 * 60 * 1000;
            setRecentLogEvents((prev) => {
                const trimmed = prev.filter((event) => event.ts >= windowStart);
                const next = [...trimmed, { ts: now, type: logType }];
                return next.slice(-2400);
            });
        };

        socket.on("connect", handleConnect);
        socket.on("disconnect", handleDisconnect);
        socket.on("init", handleInit);
        socket.on("state_update", handleStateUpdate);
        socket.on("heartbeat", handleHeartbeat);
        socket.on("log", handleLog);
        setIsConnected(socket.connected);

        const fetchFullStatus = async () => {
            try {
                const data = await apiGet<unknown>("/api/system/status");
                const parsed = parseSystemStatus(data);
                if (parsed) setSystemStatus(parsed);
            } catch {
                console.debug("Backend unavailable (fetchFullStatus)");
            }
        };

        void fetchFullStatus();
        const interval = setInterval(() => {
            void fetchFullStatus();
        }, 30000);

        return () => {
            socket.off("connect", handleConnect);
            socket.off("disconnect", handleDisconnect);
            socket.off("init", handleInit);
            socket.off("state_update", handleStateUpdate);
            socket.off("heartbeat", handleHeartbeat);
            socket.off("log", handleLog);
            clearInterval(interval);
        };
    }, [locale]);

    const healthScore = useMemo(() => {
        const checks = [systemStatus?.health?.env, systemStatus?.health?.deps, systemStatus?.health?.core];
        const definedChecks = checks.filter((item): item is boolean => typeof item === "boolean");
        if (definedChecks.length === 0) {
            return {
                value: isEnglish ? "N/A" : "未知",
                passed: 0,
                total: 0,
            };
        }
        const passed = definedChecks.filter(Boolean).length;
        return {
            value: `${passed}/${definedChecks.length}`,
            passed,
            total: definedChecks.length,
        };
    }, [isEnglish, systemStatus?.health?.core, systemStatus?.health?.deps, systemStatus?.health?.env]);

    const logStats = useMemo(() => {
        const now = Date.now();
        const oneMinuteStart = now - 60 * 1000;
        const fiveMinuteStart = now - 5 * 60 * 1000;

        const lastMinute = recentLogEvents.filter((event) => event.ts >= oneMinuteStart);
        const lastFiveMinutes = recentLogEvents.filter((event) => event.ts >= fiveMinuteStart);

        const errorsLastMinute = lastMinute.filter((event) => event.type === "error").length;
        const agentEventsLastMinute = lastMinute.filter((event) => event.type === "agent" || event.type === "queue").length;

        const fiveMinuteErrors = lastFiveMinutes.filter((event) => event.type === "error").length;
        const fiveMinuteErrorRate = lastFiveMinutes.length > 0
            ? Math.round((fiveMinuteErrors / lastFiveMinutes.length) * 100)
            : 0;

        return {
            logsPerMinute: lastMinute.length,
            errorsLastMinute,
            agentEventsLastMinute,
            fiveMinuteErrorRate,
        };
    }, [recentLogEvents]);

    const metricOptions = useMemo(() => ([
        { id: "queueLoad", label: isEnglish ? "Queue Load" : "任務佇列", description: isEnglish ? "Current queued workload" : "目前佇列負載量" },
        { id: "systemUptime", label: isEnglish ? "System Uptime" : "系統運行時間", description: isEnglish ? "Runtime duration since boot" : "系統啟動後運行時間" },
        { id: "nextSchedule", label: isEnglish ? "Next Schedule" : "下次排程", description: isEnglish ? "Upcoming schedule trigger" : "下一個排程觸發資訊" },
        { id: "backendStatus", label: isEnglish ? "Backend Status" : "後端連線狀態", description: isEnglish ? "WebSocket live connectivity" : "WebSocket 即時連線狀態" },
        { id: "activeGolem", label: isEnglish ? "Active Golem" : "目前 Golem", description: isEnglish ? "Current selected instance" : "目前選取中的實體" },
        { id: "activeGolemStatus", label: isEnglish ? "Golem Status" : "Golem 狀態", description: isEnglish ? "Runtime status of active instance" : "活躍實體運行狀態" },
        { id: "runtimePlatform", label: isEnglish ? "Runtime Platform" : "運行平台", description: isEnglish ? "Core runtime platform mode" : "核心執行平台資訊" },
        { id: "healthScore", label: isEnglish ? "Health Score" : "健康分數", description: isEnglish ? "Core health check ratio" : "核心健康檢查通過比率" },
        { id: "diskAvailable", label: isEnglish ? "Disk Available" : "可用磁碟空間", description: isEnglish ? "Remaining local storage" : "本地剩餘儲存空間" },
        { id: "freeSystemMemory", label: isEnglish ? "Free System Memory" : "系統可用記憶體", description: isEnglish ? "Host free memory" : "主機層可用記憶體" },
        { id: "golemCount", label: isEnglish ? "Golem Instances" : "Golem 實體數", description: isEnglish ? "Number of managed golem instances" : "目前管理中的 golem 實體數量" },
        { id: "logsPerMinute", label: isEnglish ? "Logs / Min" : "每分鐘日誌量", description: isEnglish ? "Ingested logs in the last 60s" : "最近 60 秒接收日誌數" },
        { id: "errorRate", label: isEnglish ? "5m Error Rate" : "5 分鐘錯誤率", description: isEnglish ? "Error ratio over the last 5 minutes" : "最近 5 分鐘錯誤事件比例" },
        { id: "agentEvents", label: isEnglish ? "Agent Events / Min" : "每分鐘 Agent 事件", description: isEnglish ? "Agent + queue events in the last 60s" : "最近 60 秒 Agent / Queue 事件量" },
    ] as const), [isEnglish]);

    const allMetricCards = useMemo<DashboardMetricCard[]>(() => {
        const statusLabel = activeGolemStatus
            ? activeGolemStatus.replaceAll("_", " ")
            : (isEnglish ? "unknown" : "未知");
        return [
            {
                id: "queueLoad",
                title: isEnglish ? "Queue Load" : "任務佇列",
                value: metrics.queueCount,
                icon: Server,
                data: queueHistory,
                color: "#f59e0b",
            },
            {
                id: "systemUptime",
                title: isEnglish ? "System Uptime" : "系統運行時間",
                value: metrics.uptime,
                icon: Clock3,
            },
            {
                id: "nextSchedule",
                title: isEnglish ? "Next Schedule" : "下次排程",
                value: metrics.lastSchedule,
                icon: CalendarClock,
            },
            {
                id: "backendStatus",
                title: isEnglish ? "Backend Status" : "後端連線狀態",
                value: isConnected ? (isEnglish ? "Connected" : "已連線") : (isEnglish ? "Disconnected" : "未連線"),
                icon: Wifi,
            },
            {
                id: "activeGolem",
                title: isEnglish ? "Active Golem" : "目前 Golem",
                value: activeGolem || "golem_A",
                icon: Bot,
            },
            {
                id: "activeGolemStatus",
                title: isEnglish ? "Golem Status" : "Golem 狀態",
                value: statusLabel,
                icon: isConnected ? CheckCircle2 : XCircle,
            },
            {
                id: "runtimePlatform",
                title: isEnglish ? "Runtime Platform" : "運行平台",
                value: systemStatus?.runtime?.platform?.toUpperCase() || "N/A",
                icon: Cpu,
            },
            {
                id: "healthScore",
                title: isEnglish ? "Health Score" : "健康分數",
                value: healthScore.value,
                icon: ShieldCheck,
            },
            {
                id: "diskAvailable",
                title: isEnglish ? "Disk Available" : "可用磁碟空間",
                value: systemStatus?.system?.diskAvail || "N/A",
                icon: HardDrive,
            },
            {
                id: "freeSystemMemory",
                title: isEnglish ? "Free System Memory" : "系統可用記憶體",
                value: systemStatus?.system?.freeMem || "N/A",
                icon: MemoryStick,
            },
            {
                id: "golemCount",
                title: isEnglish ? "Golem Instances" : "Golem 實體數",
                value: golems.length,
                icon: ListChecks,
            },
            {
                id: "logsPerMinute",
                title: isEnglish ? "Logs / Min" : "每分鐘日誌量",
                value: logStats.logsPerMinute,
                icon: Waves,
            },
            {
                id: "errorRate",
                title: isEnglish ? "5m Error Rate" : "5 分鐘錯誤率",
                value: `${logStats.fiveMinuteErrorRate}%`,
                icon: AlertTriangle,
            },
            {
                id: "agentEvents",
                title: isEnglish ? "Agent Events / Min" : "每分鐘 Agent 事件",
                value: logStats.agentEventsLastMinute,
                icon: BarChart3,
            },
        ];
    }, [
        activeGolem,
        activeGolemStatus,
        golems.length,
        healthScore.value,
        isConnected,
        isEnglish,
        logStats.agentEventsLastMinute,
        logStats.fiveMinuteErrorRate,
        logStats.logsPerMinute,
        metrics.lastSchedule,
        metrics.queueCount,
        metrics.uptime,
        queueHistory,
        systemStatus?.runtime?.platform,
        systemStatus?.system?.diskAvail,
        systemStatus?.system?.freeMem,
    ]);

    const visibleMetricCards = useMemo(() => {
        const cardMap = new Map(allMetricCards.map((card) => [card.id as MetricCardId, card]));
        return selectedMetricIds
            .map((id) => cardMap.get(id))
            .filter((item): item is DashboardMetricCard => Boolean(item));
    }, [allMetricCards, selectedMetricIds]);

    const handleChartHover = (event: MouseEvent<SVGSVGElement>, history: TimePoint[], type: "cpu" | "queue", maxValue?: number) => {
        if (history.length < 2) return;
        const svg = event.currentTarget;
        const rect = svg.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const width = rect.width;

        const index = Math.round((mouseX / width) * (history.length - 1));
        const safeIndex = Math.max(0, Math.min(history.length - 1, index));
        const point = history[safeIndex];

        const max = maxValue ?? Math.max(100, ...history.map((metric) => metric.value)) * 1.2;
        const y = 100 - (point.value / max) * 100;

        setHoveredPoint({
            ...point,
            x: (safeIndex / (history.length - 1)) * 1000,
            y,
            type,
        });
    };

    if (!isLoadingGolems && !hasGolems && !isBooting) {
        return <NoGolemsState />;
    }

    return (
        <div className="h-full overflow-y-auto custom-scrollbar">
            <div className="p-6 md:p-8 space-y-6">
                {showUpdateMarquee && <UpdateMarqueeNotice />}

                <div className="sticky top-0 z-30 enterprise-card border border-border rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl border border-primary/25 bg-primary/10 flex items-center justify-center">
                            <TerminalIcon className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold tracking-tight">
                                {isEnglish ? "Unified Command Console" : "整合控制台"}
                            </h2>
                            <p className="text-xs text-muted-foreground">
                                {isEnglish
                                    ? "Tactical insights + terminal telemetry in one comprehensive cockpit."
                                    : "將戰術資訊與終端機遙測整合到同一個全面控制台。"}
                            </p>
                        </div>
                    </div>

                    <div className="flex bg-muted/50 p-1 rounded-xl border border-border/50">
                        <button
                            onClick={() => setActiveTab("OVERVIEW")}
                            className={cn(
                                "px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 flex items-center gap-2",
                                activeTab === "OVERVIEW" ? "bg-background text-primary shadow-sm border border-border/50" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <LayoutDashboard className="w-3.5 h-3.5" />
                            <span>{isEnglish ? "Overview" : "全域總覽"}</span>
                        </button>
                        <button
                            onClick={() => setActiveTab("LOGS")}
                            className={cn(
                                "px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 flex items-center gap-2",
                                activeTab === "LOGS" ? "bg-background text-primary shadow-sm border border-border/50" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <TerminalIcon className="w-3.5 h-3.5" />
                            <span>{isEnglish ? "Deep Logs" : "深度日誌"}</span>
                        </button>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="enterprise-badge">
                            {typeof systemStatus?.runtime?.uptime === "number"
                                ? `${Math.floor(systemStatus.runtime.uptime / 3600)}h ${Math.floor((systemStatus.runtime.uptime % 3600) / 60)}m`
                                : metrics.uptime}
                        </div>
                        <div className={cn("enterprise-badge", isConnected ? "text-emerald-500" : "text-destructive")}>
                            {isConnected ? (isEnglish ? "System Online" : "系統在線") : (isEnglish ? "System Offline" : "系統離線")}
                        </div>
                    </div>
                </div>

                {activeTab === "OVERVIEW" && (
                    <div className="space-y-6">
                        <div className="enterprise-card border border-border rounded-2xl p-4">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                                <div>
                                    <h3 className="text-sm font-semibold tracking-tight">
                                        {isEnglish ? "Metric Cards Customizer" : "指標卡片自訂"}
                                    </h3>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {isEnglish
                                            ? "Memory usage is now part of persistent telemetry and excluded from removable metric cards."
                                            : "記憶體用量已納入常駐遙測，不再出現在可移除的指標卡。"}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8"
                                        onClick={() => setIsMetricCustomizerOpen((prev) => !prev)}
                                    >
                                        <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />
                                        {isMetricCustomizerOpen
                                            ? (isEnglish ? "Hide Panel" : "隱藏面板")
                                            : (isEnglish ? "Customize Metrics" : "自訂指標")}
                                    </Button>
                                </div>
                            </div>

                            {isMetricCustomizerOpen && (
                                <div className="mt-4 pt-4 border-t border-border/70 space-y-3">
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                        {metricOptions.map((option) => {
                                            const checked = selectedMetricIds.includes(option.id);
                                            return (
                                                <label
                                                    key={option.id}
                                                    className={cn(
                                                        "flex items-start gap-2 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors",
                                                        checked
                                                            ? "bg-primary/10 border-primary/35"
                                                            : "bg-secondary/35 border-border hover:bg-secondary/60"
                                                    )}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className="mt-0.5 accent-[var(--color-primary)]"
                                                        checked={checked}
                                                        onChange={() => toggleMetricSelection(option.id)}
                                                    />
                                                    <span>
                                                        <span className="text-sm font-medium text-foreground block">{option.label}</span>
                                                        <span className="text-[11px] text-muted-foreground block mt-0.5">{option.description}</span>
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2">
                                        <Button variant="secondary" size="sm" className="h-8" onClick={() => applyMetricPreset("executive")}>
                                            {isEnglish ? "Executive Preset" : "管理者預設"}
                                        </Button>
                                        <Button variant="secondary" size="sm" className="h-8" onClick={() => applyMetricPreset("observability")}>
                                            {isEnglish ? "Observability Preset" : "可觀測性預設"}
                                        </Button>
                                        <Button variant="outline" size="sm" className="h-8" onClick={() => applyMetricPreset("all")}>
                                            {isEnglish ? "Show All" : "全部顯示"}
                                        </Button>
                                        <Button variant="outline" size="sm" className="h-8" onClick={() => applyMetricPreset("minimal")}>
                                            {isEnglish ? "Minimal Set" : "精簡模式"}
                                        </Button>
                                    </div>

                                    <div className="pt-2">
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs font-semibold text-foreground">
                                                {isEnglish ? "Card Display Order (Drag to Sort)" : "卡片顯示順序（拖曳排序）"}
                                            </p>
                                            <span className="text-[11px] text-muted-foreground">
                                                {isEnglish ? `${selectedMetricIds.length} selected` : `已選 ${selectedMetricIds.length} 張`}
                                            </span>
                                        </div>

                                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                            {selectedMetricIds.map((id, index) => {
                                                const option = metricOptions.find((item) => item.id === id);
                                                if (!option) return null;

                                                const isDragging = draggingMetricId === id;
                                                const isDragOver = dragOverMetricId === id && draggingMetricId !== id;

                                                return (
                                                    <div
                                                        key={`metric-order-${id}`}
                                                        draggable
                                                        onDragStart={() => {
                                                            setDraggingMetricId(id);
                                                            setDragOverMetricId(id);
                                                        }}
                                                        onDragOver={(event) => {
                                                            event.preventDefault();
                                                            setDragOverMetricId(id);
                                                        }}
                                                        onDrop={(event) => {
                                                            event.preventDefault();
                                                            if (draggingMetricId) {
                                                                reorderMetricCards(draggingMetricId, id);
                                                            }
                                                            setDraggingMetricId(null);
                                                            setDragOverMetricId(null);
                                                        }}
                                                        onDragEnd={() => {
                                                            setDraggingMetricId(null);
                                                            setDragOverMetricId(null);
                                                        }}
                                                        className={cn(
                                                            "rounded-xl border px-2.5 py-2 bg-background/50 transition-colors cursor-move",
                                                            isDragging && "opacity-70 border-primary/50",
                                                            isDragOver && "bg-primary/10 border-primary/45"
                                                        )}
                                                    >
                                                        <div className="flex items-center justify-between gap-2">
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                                                <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                                                                    {index + 1}.
                                                                </span>
                                                                <span className="text-sm font-medium text-foreground truncate">
                                                                    {option.label}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-1 shrink-0">
                                                                <button
                                                                    type="button"
                                                                    className="h-6 w-6 rounded-md border border-border bg-secondary/50 hover:bg-secondary/80 disabled:opacity-40"
                                                                    onClick={() => moveMetricCardByOffset(id, -1)}
                                                                    disabled={index === 0}
                                                                    aria-label={isEnglish ? "Move up" : "上移"}
                                                                >
                                                                    <ChevronUp className="w-3 h-3 mx-auto" />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="h-6 w-6 rounded-md border border-border bg-secondary/50 hover:bg-secondary/80 disabled:opacity-40"
                                                                    onClick={() => moveMetricCardByOffset(id, 1)}
                                                                    disabled={index === selectedMetricIds.length - 1}
                                                                    aria-label={isEnglish ? "Move down" : "下移"}
                                                                >
                                                                    <ChevronDown className="w-3 h-3 mx-auto" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <DashboardMetricsGrid
                            cards={visibleMetricCards}
                            fixedIndicator={{
                                node: <DeveloperPlaque variant="indicator" />,
                            }}
                        />

                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                            <MetricChart
                                className="lg:col-span-5"
                                title={isEnglish ? "CPU Performance Trend" : "CPU 效能趨勢"}
                                value={metrics.cpuUsage.toFixed(1)}
                                unit="%"
                                history={cpuHistory}
                                hoveredPoint={hoveredPoint?.type === "cpu" ? hoveredPoint : null}
                                onHover={(event) => handleChartHover(event, cpuHistory, "cpu", 100)}
                                onLeave={() => setHoveredPoint(null)}
                                gradientId="cpuGradient"
                                color="cyan"
                                icon={<Cpu className="w-4 h-4" />}
                            />
                            <MetricChart
                                className="lg:col-span-5"
                                title={isEnglish ? "Memory Snapshot" : "記憶體快照"}
                                value={metrics.memUsage.toFixed(1)}
                                unit="MB"
                                history={memHistory}
                                hoveredPoint={null}
                                onHover={() => { }}
                                onLeave={() => { }}
                                gradientId="memTrendGradient"
                                color="primary"
                                icon={<Activity className="w-4 h-4" />}
                            />
                            <MetricChart
                                className="lg:col-span-2"
                                title={isEnglish ? "Queue Load Trend" : "佇列負載趨勢"}
                                value={String(metrics.queueCount)}
                                unit={isEnglish ? "TASKS" : "任務"}
                                history={queueHistory}
                                hoveredPoint={hoveredPoint?.type === "queue" ? hoveredPoint : null}
                                onHover={(event) => handleChartHover(event, queueHistory, "queue")}
                                onLeave={() => setHoveredPoint(null)}
                                gradientId="queueGradient"
                                color="amber"
                                icon={<BarChart3 className="w-4 h-4" />}
                                compact
                            />
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                            <div className="xl:col-span-4 space-y-6">
                                <div className="enterprise-card border border-border rounded-2xl overflow-hidden">
                                    <PanelHeader icon={<ShieldCheck className="w-3 h-3" />} title={isEnglish ? "System Status" : "系統狀態"} />
                                    <div className="p-5 text-sm font-mono bg-background/35">
                                        <ul className="space-y-3.5">
                                            <StatusItem label={isEnglish ? "Core Mode" : "核心模式"} value={systemStatus?.runtime?.platform?.toUpperCase() || "N/A"} icon={<Cpu className="w-3 h-3" />} />
                                            <StatusItem label={isEnglish ? "Environment" : "環境配置"} value={systemStatus?.health?.env ? (isEnglish ? "Loaded" : "已載入") : (isEnglish ? "Check" : "檢查")} color={systemStatus?.health?.env ? "primary" : "destructive"} />
                                            <StatusItem label={isEnglish ? "Dependencies" : "依賴狀態"} value={systemStatus?.health?.deps ? (isEnglish ? "Healthy" : "正常") : (isEnglish ? "Check" : "檢查")} color={systemStatus?.health?.deps ? "primary" : "destructive"} />
                                            <StatusItem label={isEnglish ? "Core Service" : "核心服務"} value={systemStatus?.health?.core ? (isEnglish ? "Online" : "在線") : (isEnglish ? "Offline" : "離線")} color={systemStatus?.health?.core ? "primary" : "destructive"} />
                                            <StatusItem label={isEnglish ? "Disk Space" : "磁碟空間"} value={systemStatus?.system?.diskAvail || "N/A"} />
                                            <StatusItem label={isEnglish ? "Queue Agent" : "佇列代理"} value={isEnglish ? `Ready (${metrics.queueCount})` : `就緒 (${metrics.queueCount})`} color="primary" />
                                            <StatusItem label={isEnglish ? "Worker Tabs" : "子代理分頁"} value={String(metrics.agentWorkersActive)} color="primary" />
                                            <StatusItem label={isEnglish ? "Worker Timeouts" : "子代理逾時"} value={String(metrics.agentWorkerTimeouts)} color={metrics.agentWorkerTimeouts > 0 ? "destructive" : "primary"} />
                                            <StatusItem label={isEnglish ? "Worker Last Event" : "子代理最後事件"} value={metrics.lastAgentWorkerEvent || "N/A"} />
                                            <StatusItem label={isEnglish ? "Health Score" : "健康分數"} value={healthScore.value} color={healthScore.total > 0 && healthScore.passed === healthScore.total ? "primary" : "destructive"} />
                                        </ul>
                                    </div>
                                </div>

                                <div className="enterprise-card border border-border rounded-2xl overflow-hidden">
                                    <PanelHeader icon={<LayoutDashboard className="w-3 h-3" />} title={isEnglish ? "Quick Actions" : "快捷操作"} />
                                    <div className="p-5 grid grid-cols-1 gap-3 bg-background/35">
                                        <ActionButton
                                            icon={<Play className="w-5 h-5" />}
                                            label={isEnglish ? "Start Golem" : "啟動 Golem"}
                                            description={isEnglish ? "Initialize core instance" : "初始化核心實體"}
                                            onClick={() => openConfirm("start")}
                                            disabled={activeGolemStatus === "running" || isLoading}
                                            color="primary"
                                        />
                                        <ActionButton
                                            icon={<RefreshCw className="w-5 h-5" />}
                                            label={isEnglish ? "Restart" : "重新啟動"}
                                            description={isEnglish ? "Hot-reload · Auto reconnect" : "Hot-reload · 自動重連"}
                                            onClick={() => openConfirm("restart")}
                                            disabled={!isConnected || isLoading}
                                            color="primary"
                                        />
                                        <ActionButton
                                            icon={<Zap className="w-5 h-5" />}
                                            label={isEnglish ? "Shutdown Golem" : "關閉 Golem"}
                                            description={isEnglish ? "Full stop · Manual restart required" : "完全停止 · 需手動重啟"}
                                            onClick={() => openConfirm("shutdown")}
                                            disabled={!isConnected || isLoading}
                                            color="destructive"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="xl:col-span-8 enterprise-card border border-border rounded-2xl overflow-hidden min-h-[540px]">
                                <PanelHeader icon={<span className="text-[10px]">📡</span>} title={isEnglish ? "Signal Overview (Latest Logs)" : "訊號總覽（最新日誌）"} />
                                <div className="p-4 h-[540px]">
                                    <LogStream className="h-full" types={["general", "error", "queue", "agent"]} showHeader={false} />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === "LOGS" && (
                    <div className="space-y-6">
                        <div className="enterprise-card border border-border rounded-2xl overflow-hidden h-[68vh]">
                            <div className="px-5 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-foreground">📝</span>
                                    <span className="text-[10px] font-black uppercase tracking-[0.24em] text-foreground">
                                        {isEnglish ? "Core Log Stream (Neuro-Link)" : "核心日誌串流 (Neuro-Link)"}
                                    </span>
                                </div>
                                <Button variant="ghost" size="sm" className="h-7 text-[10px] font-semibold uppercase" onClick={handleClearLogs}>
                                    {isEnglish ? "Clear Buffer" : "清除緩衝區"}
                                </Button>
                            </div>
                            <div className="p-4 h-[calc(68vh-3.2rem)]">
                                <LogStream className="h-full" types={["general", "error"]} showHeader={false} />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <div className="enterprise-card border border-border rounded-2xl overflow-hidden h-[400px]">
                                <PanelHeader icon={<span className="text-[10px]">⏰</span>} title={isEnglish ? "Timeline Events (Chronos)" : "時間軸事件 (Chronos)"} />
                                <div className="p-4 h-[calc(400px-2.25rem)]">
                                    <LogStream className="h-full" types={["chronos"]} showHeader={false} />
                                </div>
                            </div>
                            <div className="enterprise-card border border-border rounded-2xl overflow-hidden h-[400px]">
                                <PanelHeader icon={<span className="text-[10px]">🚦</span>} title={isEnglish ? "Traffic Monitor" : "流量監控"} />
                                <div className="p-4 h-[calc(400px-2.25rem)]">
                                    <LogStream className="h-full" types={["queue", "agent"]} autoScroll={false} showHeader={false} />
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <SystemActionDialogs
                confirmDialogOpen={confirmDialog.open}
                setConfirmDialogOpen={(open) => !isLoading && setConfirmDialog((prev) => ({ ...prev, open }))}
                confirmVariant={confirmDialog.variant}
                handleConfirm={handleConfirm}
                isLoading={isLoading}
                doneDialogOpen={doneDialog.open}
                setDoneDialogOpen={(open) => setDoneDialog((prev) => ({ ...prev, open }))}
                doneVariant={doneDialog.variant}
            />
        </div>
    );
}

type MetricChartProps = {
    className?: string;
    title: string;
    value: string;
    unit: string;
    history: TimePoint[];
    hoveredPoint: HoveredPoint | null;
    onHover: (event: MouseEvent<SVGSVGElement>) => void;
    onLeave: () => void;
    gradientId: string;
    color: "primary" | "cyan" | "amber";
    icon: ReactNode;
    maxValue?: number;
    compact?: boolean;
};

function MetricChart({
    className,
    title,
    value,
    unit,
    history,
    hoveredPoint,
    onHover,
    onLeave,
    gradientId,
    color,
    icon,
    maxValue,
    compact = false,
}: MetricChartProps) {
    const chartColor = color === "primary"
        ? "var(--primary)"
        : color === "cyan"
            ? "var(--color-cyan, #22d3ee)"
            : "var(--color-chart-5, #f59e0b)";
    const max = maxValue ?? Math.max(100, ...history.map((metric) => metric.value)) * 1.2;
    const chartHeightClass = compact ? "h-[86px]" : "h-[120px]";

    return (
        <div className={cn(
            "enterprise-card border border-border rounded-2xl flex flex-col overflow-hidden relative p-5 group hover:border-primary/35 transition-all duration-500",
            className
        )}>
            <div className="flex justify-between items-start mb-4 z-10">
                <div>
                    <h3 className="text-muted-foreground text-[10px] font-bold uppercase tracking-[0.15em] mb-1">{title}</h3>
                    <div className="flex items-baseline gap-1.5">
                        <span className="text-4xl font-semibold text-foreground tracking-tighter font-mono">{value}</span>
                        <span className="text-sm font-semibold text-muted-foreground uppercase opacity-70">{unit}</span>
                    </div>
                </div>
                <div
                    className={cn(
                        "p-2 rounded-xl border",
                        color === "primary"
                            ? "text-primary bg-primary/5 border-primary/10"
                            : color === "cyan"
                                ? "text-cyan-500 bg-cyan-400/5 border-cyan-400/10"
                                : "text-amber-400 bg-amber-400/8 border-amber-400/20"
                    )}
                >
                    {icon}
                </div>
            </div>

            <div className={cn("flex-1 relative mt-1", chartHeightClass)}>
                <svg className="w-full h-full overflow-visible" viewBox="0 0 1000 100" preserveAspectRatio="none" onMouseMove={onHover} onMouseLeave={onLeave}>
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={chartColor} stopOpacity="0.3" />
                            <stop offset="100%" stopColor={chartColor} stopOpacity="0.02" />
                        </linearGradient>
                    </defs>
                    {history.length > 1 && (() => {
                        const points = history.map((pt, index) => {
                            const x = (index / (history.length - 1)) * 1000;
                            const y = 100 - (pt.value / max) * 100;
                            return `${x},${y}`;
                        });
                        const pathData = `M 0,100 ${points.map((point) => `L ${point}`).join(" ")} L 1000,100 Z`;
                        const lineData = `M ${points.map((point) => `L ${point}`).join(" ").substring(2)}`;

                        return (
                            <g>
                                <path d={pathData} fill={`url(#${gradientId})`} />
                                <path d={lineData} fill="none" stroke={chartColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                                {hoveredPoint && (
                                    <g>
                                        <line x1={hoveredPoint.x} y1="0" x2={hoveredPoint.x} y2="100" stroke="currentColor" className="text-foreground/10" strokeWidth="1" strokeDasharray="4 4" />
                                        <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="5" fill={chartColor} stroke="var(--card)" strokeWidth="2.5" />
                                    </g>
                                )}
                            </g>
                        );
                    })()}
                </svg>

                {hoveredPoint && (
                    <div
                        className="absolute pointer-events-none transition-all duration-75 z-50 flex flex-col items-center"
                        style={{
                            left: `${hoveredPoint.x / 10}%`,
                            top: `${hoveredPoint.y}%`,
                            transform: `translate(${hoveredPoint.x > 750 ? "-100%" : "0%"}, -110%)`,
                            marginLeft: hoveredPoint.x > 750 ? "-15px" : "15px",
                        }}
                    >
                        <div className="bg-popover/90 backdrop-blur-xl border border-primary/30 rounded-2xl p-4 shadow-[0_15px_40px_rgba(0,0,0,0.4)] text-center ring-1 ring-white/10 min-w-[130px]">
                            <div className="text-2xl font-semibold text-primary tracking-tight leading-none">
                                {hoveredPoint.value}
                                <span className="text-xs ml-1 font-semibold opacity-60">{unit}</span>
                            </div>
                            <div className="text-[11px] text-muted-foreground font-bold uppercase tracking-[0.14em] mt-3 opacity-80">
                                {hoveredPoint.time}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function PanelHeader({ icon, title }: { icon: ReactNode; title: string }) {
    return (
        <div className="bg-muted/30 px-4 py-2 border-b border-border flex items-center gap-2">
            <span className="text-muted-foreground">{icon}</span>
            <span className="text-muted-foreground text-[10px] font-black uppercase tracking-[0.18em]">{title}</span>
        </div>
    );
}

function StatusItem({
    label,
    value,
    color,
    icon,
}: {
    label: string;
    value: string;
    color?: "primary" | "destructive";
    icon?: ReactNode;
}) {
    return (
        <li className="flex justify-between items-center gap-2">
            <div className="flex items-center gap-2">
                {icon && <span className="text-muted-foreground/60">{icon}</span>}
                <span className="text-muted-foreground/90">{label}:</span>
            </div>
            <span
                className={cn(
                    "font-semibold tracking-tight px-2 py-0.5 rounded text-[10px]",
                    color === "primary" ? "text-primary bg-primary/5" :
                        color === "destructive" ? "text-destructive bg-destructive/5" :
                            "text-foreground bg-muted/30"
                )}
            >
                {value}
            </span>
        </li>
    );
}

function ActionButton({
    icon,
    label,
    description,
    onClick,
    color,
    disabled,
}: {
    icon: ReactNode;
    label: string;
    description: string;
    onClick: () => void;
    color?: "primary" | "destructive";
    disabled?: boolean;
}) {
    return (
        <button
            className={cn(
                "group w-full flex items-center p-3 rounded-2xl border border-white/[0.05] bg-white/[0.02] transition-all duration-300 active:scale-[0.98]",
                "hover:bg-white/[0.05] hover:border-white/[0.1] hover:shadow-xl",
                "disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none",
                color === "destructive" ? "hover:border-destructive/20" : "hover:border-primary/20"
            )}
            onClick={onClick}
            disabled={disabled}
        >
            <div
                className={cn(
                    "w-12 h-12 rounded-[14px] flex items-center justify-center transition-all duration-300",
                    color === "destructive"
                        ? "bg-destructive/10 text-destructive border border-destructive/20 group-hover:bg-destructive group-hover:text-white"
                        : "bg-white/[0.05] text-muted-foreground border border-white/[0.05] group-hover:bg-white/[0.1] group-hover:text-foreground"
                )}
            >
                {icon}
            </div>
            <div className="ml-4 text-left">
                <div className={cn("text-[15px] font-semibold tracking-tight transition-colors", color === "destructive" ? "text-destructive/90" : "text-foreground group-hover:text-primary")}>
                    {label}
                </div>
                <div className="text-[11px] text-muted-foreground font-medium opacity-70 mt-0.5">
                    {description}
                </div>
            </div>
        </button>
    );
}
