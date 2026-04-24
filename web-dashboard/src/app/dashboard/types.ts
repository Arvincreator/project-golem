export type DashboardMetrics = {
    uptime: string;
    queueCount: number;
    lastSchedule: string;
    agentWorkersActive: number;
    agentWorkerTimeouts: number;
    agentWorkerSendTimeouts: number;
    agentWorkerIdleTimeouts: number;
    agentWorkerDraftPendingChecks: number;
    lastAgentWorkerEvent: string;
    memUsage: number;
};

export type MemHistoryPoint = {
    time: string;
    value: number;
};

export type ConfirmDialogVariant = "restart" | "shutdown" | "start";

export type DoneDialogVariant = "restarted" | "shutdown" | "started";

export type ConfirmDialogState = {
    open: boolean;
    variant: ConfirmDialogVariant;
};

export type DoneDialogState = {
    open: boolean;
    variant: DoneDialogVariant;
};
