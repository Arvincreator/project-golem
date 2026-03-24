"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Activity, AlertTriangle, CheckCircle2, DownloadCloud, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import { apiGet, apiPost } from "@/lib/api-client";
import { useQuery } from "@/hooks/useQuery";
import { LogInfo, UpdateInfo } from "../types";
import { useI18n } from "@/components/I18nProvider";

type LogInfoResponse = { success?: boolean; size?: string; bytes?: number };
type UpdateProgressEvent = { status?: string; message?: string; progress?: number | null };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function parseUpdateProgressEvent(payload: unknown): UpdateProgressEvent | null {
    if (!isRecord(payload)) return null;
    const progress = payload.progress;
    return {
        status: typeof payload.status === "string" ? payload.status : undefined,
        message: typeof payload.message === "string" ? payload.message : undefined,
        progress: typeof progress === "number" || progress === null ? progress : undefined,
    };
}

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
}

export default function SystemUpdateSection() {
    const toast = useToast();
    const { t } = useI18n();
    const [showModal, setShowModal] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusText, setStatusText] = useState("");
    const [keepOldData, setKeepOldData] = useState(true);
    const [keepMemory, setKeepMemory] = useState(true);
    const [updateDone, setUpdateDone] = useState(false);
    const socketRef = useRef<Socket | null>(null);

    const updateInfoQuery = useQuery<UpdateInfo>(() => apiGet<UpdateInfo>("/api/system/update/check"), []);
    const logInfoQuery = useQuery<LogInfoResponse>(() => apiGet<LogInfoResponse>("/api/system/log-info"), []);

    useEffect(() => {
        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };
    }, []);

    const updateInfo = updateInfoQuery.data;
    const logInfo: LogInfo | null = (() => {
        const raw = logInfoQuery.data;
        if (!raw || raw.success !== true || !raw.size || typeof raw.bytes !== "number") return null;
        return { size: raw.size, bytes: raw.bytes };
    })();

    const handleStartUpdate = async () => {
        setIsUpdating(true);
        setProgress(0);
        setStatusText(t("settings.update.status.connecting"));
        setUpdateDone(false);

        if (socketRef.current) {
            socketRef.current.disconnect();
        }

        const socket = io(window.location.origin);
        socketRef.current = socket;

        socket.on("system:update_progress", (payload: unknown) => {
            const data = parseUpdateProgressEvent(payload);
            if (!data) return;

            if (data.status === "running") {
                setStatusText(data.message ?? "");
                if (typeof data.progress === "number") setProgress(data.progress);
            } else if (data.status === "requires_restart") {
                setStatusText(data.message ?? "");
                setProgress(100);
                setUpdateDone(true);
                setIsUpdating(false);
                socket.disconnect();
                socketRef.current = null;
            } else if (data.status === "error") {
                setStatusText(data.message ?? "");
                setIsUpdating(false);
                socket.disconnect();
                socketRef.current = null;
            }
        });

        socket.on("connect", async () => {
            try {
                await apiPost("/api/system/update/execute", { keepOldData, keepMemory });
            } catch {
                setStatusText(t("settings.update.status.startFailed"));
                toast.error(t("settings.update.toast.startFailedTitle"), t("settings.update.toast.startFailedBody"));
                setIsUpdating(false);
                socket.disconnect();
                socketRef.current = null;
            }
        });
    };

    const handleRestart = async () => {
        try {
            await apiPost("/api/system/restart");
            setStatusText(t("settings.update.status.restartSent"));

            let retries = 0;
            const maxRetries = 40;
            const pollInterval = setInterval(async () => {
                retries++;
                try {
                    const data = await apiGet<{ isBooting?: boolean }>("/api/system/status");
                    if (!data.isBooting) {
                        clearInterval(pollInterval);
                        setStatusText(t("settings.update.status.restartComplete"));
                        setTimeout(() => { window.location.reload(); }, 1500);
                    } else {
                        setStatusText(t("settings.update.status.initializing"));
                    }
                } catch {
                    // server might be offline during restart
                }

                if (retries >= maxRetries) {
                    clearInterval(pollInterval);
                    setStatusText(t("settings.update.status.restartTimeout"));
                }
            }, 1000);
        } catch (error: unknown) {
            toast.error(t("settings.update.toast.restartFailedTitle"), getErrorMessage(error, t("settings.error.restartRequestFailed")));
        }
    };

    if (!updateInfo) return null;

    return (
        <div className="bg-card border border-primary/20 hover:border-primary/40 transition-colors rounded-xl p-5 shadow-sm mb-6 animate-in fade-in">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                        <DownloadCloud className="w-5 h-5 text-primary" />
                        {t("settings.update.title")}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        {t("settings.update.currentVersion")} <span className="font-mono text-primary px-1">{updateInfo.currentVersion}</span>
                        | {t("settings.update.installMode")} <span className="uppercase text-[10px] bg-secondary px-1.5 py-0.5 rounded ml-1 tracking-wider text-muted-foreground">{updateInfo.installMode}</span>
                    </p>
                </div>
                <button
                    onClick={() => { setShowModal(true); setUpdateDone(false); setIsUpdating(false); setStatusText(""); }}
                    className="px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-lg text-sm transition-all font-medium"
                >
                    {t("settings.update.openButton")}
                </button>
            </div>

            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full p-6 space-y-6">
                        <h3 className="text-xl font-bold flex items-center gap-2 text-foreground">
                            <DownloadCloud className="w-6 h-6 text-primary" />
                            {t("settings.update.modalTitle")}
                        </h3>

                        {!isUpdating && !updateDone ? (
                            <div className="space-y-4">
                                <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
                                <p className="text-sm text-gray-300 text-center">
                                    {t("settings.update.modalWarning")}
                                </p>

                                {updateInfo.installMode === "git" && updateInfo.gitInfo && (
                                    <div className="bg-secondary/30 p-4 rounded-lg border border-border text-sm space-y-2">
                                        <div className="flex items-center gap-2 text-primary font-semibold mb-2">
                                            <Activity className="w-4 h-4" /> {t("settings.update.gitDiffTitle")}
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">{t("settings.update.currentBranch")}</span>
                                            <span className="text-foreground bg-secondary px-1.5 rounded">{updateInfo.gitInfo.currentBranch}</span>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <span className="text-gray-500">{t("settings.update.currentLabel")}</span>
                                            <span className="text-gray-400 font-mono text-xs">{updateInfo.gitInfo.currentCommit}</span>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <span className="text-gray-500">{t("settings.update.latestLabel")}</span>
                                            <span className="text-emerald-400/90 font-mono text-xs">{updateInfo.gitInfo.latestCommit}</span>
                                        </div>
                                        <div className="pt-2 border-t border-gray-800 mt-2">
                                            {updateInfo.gitInfo.behindCount > 0 ? (
                                                <span className="text-amber-400 font-medium">{t("settings.update.gitBehindNotice", { count: updateInfo.gitInfo.behindCount })}</span>
                                            ) : (
                                                <span className="text-emerald-400 font-medium">{t("settings.update.upToDateNotice")}</span>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {updateInfo.installMode === "zip" && updateInfo.remoteVersion && updateInfo.remoteVersion !== "Unknown" && (
                                    <div className="bg-gray-950 p-4 rounded-lg border border-gray-800 text-sm space-y-2">
                                        <div className="flex items-center gap-2 text-indigo-400 font-semibold mb-2">
                                            <Activity className="w-4 h-4" /> {t("settings.update.zipDiffTitle")}
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">{t("settings.update.currentLabel")}</span>
                                            <span className="text-gray-400 font-mono text-xs text-right">{updateInfo.currentVersion}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">{t("settings.update.latestLabel")}</span>
                                            <span className="text-emerald-400/90 font-mono text-xs text-right">{updateInfo.remoteVersion}</span>
                                        </div>
                                        <div className="pt-2 border-t border-gray-800 mt-2">
                                            {updateInfo.isOutdated ? (
                                                <span className="text-amber-400 font-medium">{t("settings.update.newVersionNotice", { version: updateInfo.remoteVersion })}</span>
                                            ) : (
                                                <span className="text-emerald-400 font-medium">{t("settings.update.zipUpToDateNotice", { version: updateInfo.currentVersion })}</span>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-3 bg-muted/30 p-4 rounded-lg border border-border">
                                    <label className="flex items-start gap-3 cursor-pointer group">
                                        <input type="checkbox" checked={keepMemory} onChange={(e) => setKeepMemory(e.target.checked)} className="mt-1" />
                                        <div className="text-sm">
                                            <span className="text-foreground block group-hover:text-primary transition-colors">{t("settings.update.keepMemory.label")}</span>
                                            <span className="text-muted-foreground text-xs mt-1 block">{t("settings.update.keepMemory.desc")}</span>
                                        </div>
                                    </label>

                                    {updateInfo.installMode === "zip" && (
                                        <label className="flex items-start gap-3 cursor-pointer group pt-3 border-t border-border">
                                            <input type="checkbox" checked={keepOldData} onChange={(e) => setKeepOldData(e.target.checked)} className="mt-1" />
                                            <div className="text-sm">
                                                <span className="text-foreground block group-hover:text-primary transition-colors">{t("settings.update.keepBackup.label")}</span>
                                                <span className="text-muted-foreground text-xs mt-1 block">{t("settings.update.keepBackup.desc")}</span>
                                            </div>
                                        </label>
                                    )}
                                </div>

                                <div className="flex gap-3 justify-end pt-2">
                                    <button onClick={() => setShowModal(false)} className="px-4 py-2 hover:bg-secondary text-muted-foreground rounded-lg text-sm transition-colors">{t("settings.update.cancel")}</button>
                                    <button
                                        onClick={handleStartUpdate}
                                        disabled={
                                            (updateInfo.installMode === "git" && updateInfo.gitInfo && updateInfo.gitInfo.behindCount === 0) ||
                                            (updateInfo.installMode === "zip" && !updateInfo.isOutdated)
                                        }
                                        className="px-5 py-2 bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-primary-foreground rounded-lg text-sm font-medium transition-colors"
                                    >{t("settings.update.start")}</button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-6 py-4">
                                <div className="text-center space-y-2">
                                    {updateDone ? (
                                        <CheckCircle2 className="w-12 h-12 text-primary mx-auto animate-bounce" />
                                    ) : (
                                        <Loader2 className="w-12 h-12 text-primary mx-auto animate-spin" />
                                    )}
                                    <p className="text-foreground font-medium">{statusText || t("settings.update.pleaseWait")}</p>
                                </div>

                                {!updateDone && (
                                    <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                                        <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
                                    </div>
                                )}

                                {updateDone && (
                                    <div className="flex gap-3 justify-center pt-4">
                                        <button onClick={() => setShowModal(false)} className="px-4 py-2 hover:bg-secondary text-muted-foreground border border-border rounded-lg text-sm">{t("settings.update.restartLater")}</button>
                                        <button onClick={handleRestart} className="px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-bold shadow-lg">{t("settings.update.restartNow")}</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {logInfoQuery.error && (
                <p className="text-xs text-amber-500 mt-3">{t("settings.update.logInfoLoadFailed")} {logInfoQuery.error.message}</p>
            )}
            {updateInfoQuery.error && (
                <p className="text-xs text-amber-500 mt-1">{t("settings.update.checkLoadFailed")} {updateInfoQuery.error.message}</p>
            )}
            {logInfo && (
                <p className="text-xs text-muted-foreground mt-2">{t("settings.update.logSize", { size: logInfo.size })}</p>
            )}
        </div>
    );
}
