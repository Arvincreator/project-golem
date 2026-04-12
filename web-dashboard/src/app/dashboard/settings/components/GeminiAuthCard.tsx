"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, LogIn, RefreshCw, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiGet, apiPostWrite } from "@/lib/api-client";
import { useI18n } from "@/components/I18nProvider";
import { useToast } from "@/components/ui/toast-provider";

type GeminiFocusResult = {
    pageBroughtToFront?: boolean;
    osWindowActivated?: boolean;
    osMethod?: string;
    warning?: string;
};

type GeminiAuthStatusResponse = {
    success?: boolean;
    error?: string;
    message?: string;
    golemId?: string;
    backend?: string;
    profileName?: string;
    userDataDir?: string;
    primaryUrl?: string;
    pageUrl?: string;
    pageTitle?: string;
    isLoggedIn?: boolean;
    checkedAt?: string;
    detectionReason?: string;
    headlessMode?: boolean;
    focus?: GeminiFocusResult;
};

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
}

export default function GeminiAuthCard() {
    const { t } = useI18n();
    const toast = useToast();
    const [status, setStatus] = useState<GeminiAuthStatusResponse | null>(null);
    const [statusError, setStatusError] = useState<string>("");
    const [isChecking, setIsChecking] = useState(false);
    const [activeAction, setActiveAction] = useState<"open" | "focus" | null>(null);

    const refreshStatus = useCallback(async () => {
        setIsChecking(true);
        setStatusError("");
        try {
            const data = await apiGet<GeminiAuthStatusResponse>("/api/system/gemini-auth/status");
            setStatus(data);
        } catch (error: unknown) {
            setStatusError(getErrorMessage(error, t("settings.error.operationFailed")));
        } finally {
            setIsChecking(false);
        }
    }, [t]);

    useEffect(() => {
        refreshStatus();
    }, [refreshStatus]);

    const runAction = useCallback(async (action: "open" | "focus") => {
        setActiveAction(action);
        setStatusError("");
        try {
            const data = await apiPostWrite<GeminiAuthStatusResponse>(`/api/system/gemini-auth/${action}`);
            setStatus(data);
            toast.info(
                action === "open" ? t("settings.geminiAuth.toast.openedTitle") : t("settings.geminiAuth.toast.focusedTitle"),
                data.message || ""
            );
        } catch (error: unknown) {
            const message = getErrorMessage(error, t("settings.error.operationFailed"));
            setStatusError(message);
            toast.error(t("settings.geminiAuth.toast.failedTitle"), message);
        } finally {
            setActiveAction(null);
            await refreshStatus();
        }
    }, [refreshStatus, t, toast]);

    const statusTone = useMemo(() => {
        if (isChecking && !status) return "checking";
        if (status && status.isLoggedIn === true) return "ok";
        if (statusError) return "error";
        return "warn";
    }, [isChecking, status, statusError]);

    const statusText = useMemo(() => {
        if (isChecking && !status) return t("settings.geminiAuth.status.checking");
        if (status && status.isLoggedIn === true) return t("settings.geminiAuth.status.loggedIn");
        if (status && status.isLoggedIn === false) return t("settings.geminiAuth.status.loggedOut");
        return t("settings.geminiAuth.status.unknown");
    }, [isChecking, status, t]);

    const isBusy = isChecking || activeAction !== null;
    const profileName = status?.profileName || t("settings.geminiAuth.profileDefault");
    const currentUrl = status?.pageUrl || status?.primaryUrl || "-";

    return (
        <div className="bg-card border border-border hover:border-primary/30 transition-colors rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-primary" />
                        {t("settings.geminiAuth.title")}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {t("settings.geminiAuth.description")}
                    </p>
                </div>
                <button
                    onClick={refreshStatus}
                    disabled={isBusy}
                    className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-2",
                        isBusy
                            ? "bg-muted text-muted-foreground border-border cursor-not-allowed"
                            : "bg-secondary/40 hover:bg-secondary text-foreground border-border"
                    )}
                >
                    <RefreshCw className={cn("w-3.5 h-3.5", isChecking && "animate-spin")} />
                    {t("settings.geminiAuth.actions.refresh")}
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-xs">
                    <p className="text-muted-foreground">{t("settings.geminiAuth.profileLabel")}</p>
                    <p className="text-foreground font-mono mt-1 break-all">{profileName}</p>
                </div>
                <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-xs">
                    <p className="text-muted-foreground">{t("settings.geminiAuth.statusLabel")}</p>
                    <p className="mt-1 flex items-center gap-1.5">
                        {statusTone === "ok" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                        {statusTone === "warn" && <AlertCircle className="w-3.5 h-3.5 text-amber-500" />}
                        {statusTone === "error" && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
                        {statusTone === "checking" && <RefreshCw className="w-3.5 h-3.5 text-primary animate-spin" />}
                        <span
                            className={cn(
                                "font-semibold",
                                statusTone === "ok" && "text-emerald-500",
                                statusTone === "warn" && "text-amber-500",
                                statusTone === "error" && "text-red-500",
                                statusTone === "checking" && "text-primary"
                            )}
                        >
                            {statusText}
                        </span>
                    </p>
                </div>
            </div>

            <div className="space-y-2 text-xs">
                <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                    <p className="text-muted-foreground">{t("settings.geminiAuth.userDataDirLabel")}</p>
                    <p className="text-foreground font-mono mt-1 break-all">{status?.userDataDir || "-"}</p>
                </div>
                <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                    <p className="text-muted-foreground">{t("settings.geminiAuth.currentUrlLabel")}</p>
                    <p className="text-foreground font-mono mt-1 break-all">{currentUrl}</p>
                </div>
            </div>

            {(statusError || status?.headlessMode === true) && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    {statusError || t("settings.geminiAuth.headlessWarning")}
                </div>
            )}

            <div className="flex flex-wrap gap-2">
                <button
                    onClick={() => runAction("open")}
                    disabled={isBusy}
                    className={cn(
                        "px-3 py-2 rounded-lg text-xs font-medium border transition-all flex items-center gap-2",
                        isBusy
                            ? "bg-muted text-muted-foreground border-border cursor-not-allowed"
                            : "bg-primary/10 hover:bg-primary/20 text-primary border-primary/40"
                    )}
                >
                    {activeAction === "open" ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
                    {activeAction === "open" ? t("settings.geminiAuth.actions.processing") : t("settings.geminiAuth.actions.openLogin")}
                </button>
                <button
                    onClick={() => runAction("focus")}
                    disabled={isBusy}
                    className={cn(
                        "px-3 py-2 rounded-lg text-xs font-medium border transition-all flex items-center gap-2",
                        isBusy
                            ? "bg-muted text-muted-foreground border-border cursor-not-allowed"
                            : "bg-secondary/40 hover:bg-secondary text-foreground border-border"
                    )}
                >
                    {activeAction === "focus" ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                    {activeAction === "focus" ? t("settings.geminiAuth.actions.processing") : t("settings.geminiAuth.actions.focusConfirm")}
                </button>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
                {t("settings.geminiAuth.hint")}
            </p>
        </div>
    );
}
