"use client";

import React, { useEffect, useState } from "react";
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    Clock,
    Cpu,
    MessageSquare,
    RefreshCw,
    Save,
    Server,
    Settings,
    Settings2,
    ShieldCheck
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmModal } from "@/components/ConfirmModal";
import { useToast } from "@/components/ui/toast-provider";
import { apiGet, apiPost, apiPostWrite } from "@/lib/api-client";
import EngineTab from "./components/tabs/EngineTab";
import MessagingTab from "./components/tabs/MessagingTab";
import TgAdvancedTab from "./components/tabs/TgAdvancedTab";
import ScheduleTab from "./components/tabs/ScheduleTab";
import SecurityTab from "./components/tabs/SecurityTab";
import AdvancedTab from "./components/tabs/AdvancedTab";
import SystemHealthDashboard from "./components/SystemHealthDashboard";
import SystemUpdateSection from "./components/SystemUpdateSection";
import UrlsTab from "./tabs/UrlsTab";
import { ConfigData, LogInfo, SystemStatus } from "./types";
import { useI18n } from "@/components/I18nProvider";

type StatusMessage = {
    type: "success" | "error" | "warning";
    text: string;
};

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
}

const TAB_ITEMS = [
    { id: "overview", labelKey: "settings.tab.overview", icon: Activity },
    { id: "engine", labelKey: "settings.tab.engine", icon: Cpu },
    { id: "messaging", labelKey: "settings.tab.messaging", icon: MessageSquare },
    { id: "tg_advanced", labelKey: "settings.tab.tgAdvanced", icon: Settings2 },
    { id: "urls", labelKey: "settings.tab.urls", icon: Server },
    { id: "schedule", labelKey: "settings.tab.schedule", icon: Clock },
    { id: "security", labelKey: "settings.tab.security", icon: ShieldCheck },
    { id: "advanced", labelKey: "settings.tab.advanced", icon: Settings2 }
] as const;

export default function SettingsPage() {
    const toast = useToast();
    const { t } = useI18n();
    const [config, setConfig] = useState<ConfigData>({ env: {}, golems: [] });
    const [originalConfig, setOriginalConfig] = useState<ConfigData>({ env: {}, golems: [] });
    const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
    const [logInfo, setLogInfo] = useState<LogInfo | null>(null);
    const [isRestartConfirmOpen, setIsRestartConfirmOpen] = useState(false);
    const [activeTab, setActiveTab] = useState("overview");

    useEffect(() => {
        fetchConfig();
        fetchStatus();
        fetchLogInfo();
    }, []);

    const fetchConfig = async () => {
        setIsLoading(true);
        setStatusMessage(null);
        try {
            const data = await apiGet<ConfigData>("/api/config");
            setConfig(data);
            setOriginalConfig(data);
        } catch (error: unknown) {
            setStatusMessage({ type: "error", text: getErrorMessage(error, t("settings.error.loadConfigFailed")) });
        } finally {
            setIsLoading(false);
        }
    };

    const fetchStatus = async () => {
        try {
            const data = await apiGet<SystemStatus>("/api/system/status");
            setSystemStatus(data);
        } catch (error) {
            console.error("Failed to fetch system status:", error);
        }
    };

    const fetchLogInfo = async () => {
        try {
            const data = await apiGet<{ success?: boolean; size?: string; bytes?: number }>("/api/system/log-info");
            if (data.success === true && data.size && typeof data.bytes === "number") {
                setLogInfo({ size: data.size, bytes: data.bytes });
            }
        } catch (error) {
            console.error("Failed to fetch log info:", error);
        }
    };

    const handleChangeEnv = (key: string, value: string) => {
        setConfig((prev) => ({
            ...prev,
            env: { ...prev.env, [key]: value }
        }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        setStatusMessage(null);

        const changedEnv: Record<string, string> = {};
        let hasEnvChanges = false;

        Object.keys(config.env).forEach((key) => {
            if (config.env[key] !== originalConfig.env[key]) {
                changedEnv[key] = config.env[key];
                hasEnvChanges = true;
            }
        });

        if (hasEnvChanges === false) {
            setStatusMessage({ type: "warning", text: t("settings.warning.noChanges") });
            setIsSaving(false);
            return;
        }

        try {
            const data = await apiPostWrite<{ success?: boolean; message?: string; error?: string }>("/api/config", {
                env: changedEnv
            });

            if (data.success === true) {
                setOriginalConfig(config);
                setStatusMessage({ type: "warning", text: t("settings.warning.partialSavedNeedsRestart") });
            } else {
                throw new Error(data.message || data.error || t("settings.error.saveFailed"));
            }
        } catch (error: unknown) {
            setStatusMessage({ type: "error", text: getErrorMessage(error, t("settings.error.saveFailed")) });
        } finally {
            setIsSaving(false);
        }
    };

    const handleRestartSystem = () => {
        setIsRestartConfirmOpen(true);
    };

    const executeRestart = async () => {
        setIsRestartConfirmOpen(false);

        try {
            await apiPost("/api/system/reload");
            setStatusMessage({ type: "warning", text: t("settings.warning.restartCommandSent") });

            let retries = 0;
            const maxRetries = 30;

            const pollInterval = setInterval(async () => {
                retries += 1;

                try {
                    const data = await apiGet<{ isBooting?: boolean }>("/api/system/status");
                    if (data.isBooting === false) {
                        clearInterval(pollInterval);
                        setStatusMessage({ type: "success", text: t("settings.success.restartComplete") });
                        setTimeout(() => {
                            window.location.reload();
                        }, 1000);
                    } else {
                        setStatusMessage({ type: "warning", text: t("settings.warning.systemInitializing") });
                    }
                } catch {
                    // Ignore errors while backend is still rebooting.
                }

                if (retries >= maxRetries) {
                    clearInterval(pollInterval);
                    setStatusMessage({ type: "error", text: t("settings.error.restartTimeout") });
                }
            }, 1000);
        } catch (error: unknown) {
            toast.error(t("settings.restartSystem"), getErrorMessage(error, t("settings.error.restartRequestFailed")));
        }
    };

    if (isLoading) {
        return (
            <div className="flex-1 p-6 flex items-center justify-center">
                <div className="flex flex-col items-center space-y-4">
                    <RefreshCw className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-muted-foreground font-mono text-sm">{t("settings.loading")}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 p-4 md:p-6 overflow-y-auto">
            <div className="max-w-6xl mx-auto space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4 sticky top-0 bg-background/95 backdrop-blur z-20">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Settings className="w-6 h-6 text-primary" />
                            {t("settings.title")}
                        </h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            {t("settings.subtitle")}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleRestartSystem}
                            className="px-4 py-2 bg-secondary hover:bg-destructive/10 text-muted-foreground hover:text-destructive border border-border hover:border-destructive/30 rounded-lg text-sm transition-all flex items-center gap-2"
                        >
                            <RefreshCw className="w-4 h-4" />
                            {t("settings.restartSystem")}
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className={cn(
                                "px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
                                isSaving
                                    ? "bg-muted text-muted-foreground cursor-not-allowed border border-border"
                                    : "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30 hover:border-primary"
                            )}
                        >
                            {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {isSaving ? t("settings.saving") : t("settings.saveSettings")}
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-1 bg-muted/30 p-1 rounded-xl border border-border/50 overflow-x-auto no-scrollbar">
                    {TAB_ITEMS.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
                                activeTab === tab.id
                                    ? "bg-primary text-primary-foreground shadow-sm"
                                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                            )}
                        >
                            <tab.icon className="w-4 h-4" />
                            {t(tab.labelKey)}
                        </button>
                    ))}
                </div>

                {statusMessage && (
                    <div
                        className={cn(
                            "p-4 rounded-lg flex items-start gap-3 border",
                            statusMessage.type === "success" && "bg-green-950/30 border-green-900/50 text-green-400",
                            statusMessage.type === "warning" && "bg-orange-950/30 border-orange-900/50 text-orange-400",
                            statusMessage.type === "error" && "bg-red-950/30 border-red-900/50 text-red-400"
                        )}
                    >
                        {statusMessage.type === "success" && <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />}
                        {(statusMessage.type === "warning" || statusMessage.type === "error") && (
                            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                        )}
                        <p className="text-sm">{statusMessage.text}</p>
                    </div>
                )}

                {activeTab === "overview" && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
                        <SystemHealthDashboard systemStatus={systemStatus} />
                        <SystemUpdateSection />
                    </div>
                )}

                {activeTab === "engine" && (
                    <EngineTab env={config.env} onChangeEnv={handleChangeEnv} />
                )}

                {activeTab === "messaging" && (
                    <MessagingTab env={config.env} onChangeEnv={handleChangeEnv} />
                )}

                {activeTab === "tg_advanced" && (
                    <TgAdvancedTab env={config.env} onChangeEnv={handleChangeEnv} />
                )}

                {activeTab === "urls" && (
                    <UrlsTab
                        geminiUrls={config.env.GEMINI_URLS || ""}
                        onChange={(value) => handleChangeEnv("GEMINI_URLS", value)}
                    />
                )}

                {activeTab === "schedule" && (
                    <ScheduleTab env={config.env} onChangeEnv={handleChangeEnv} />
                )}

                {activeTab === "security" && (
                    <SecurityTab env={config.env} onChangeEnv={handleChangeEnv} />
                )}

                {activeTab === "advanced" && (
                    <AdvancedTab env={config.env} logInfo={logInfo} onChangeEnv={handleChangeEnv} />
                )}

                <ConfirmModal
                    isOpen={isRestartConfirmOpen}
                    onClose={() => setIsRestartConfirmOpen(false)}
                    onConfirm={executeRestart}
                    variant="warning"
                    title={t("settings.confirmRestartTitle")}
                    description={t("settings.confirmRestartDescription")}
                    confirmText={t("settings.confirmRestartConfirm")}
                    cancelText={t("settings.confirmRestartCancel")}
                />
            </div>
        </div>
    );
}
