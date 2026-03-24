"use client";

import { PowerOff, RefreshCcw } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";

type SystemStatusPanelProps = {
    isSingleNode: boolean;
    allowRemote: boolean;
    localIp?: string;
    dashboardPort?: string | number;
    isConnected: boolean;
    isLoading: boolean;
    onRestart: () => void;
    onShutdown: () => void;
};

export default function SystemStatusPanel({
    isSingleNode,
    allowRemote,
    localIp,
    dashboardPort,
    isConnected,
    isLoading,
    onRestart,
    onShutdown,
}: SystemStatusPanelProps) {
    const { t } = useI18n();
    const accessUrl = allowRemote ? `http://${localIp}:${dashboardPort}` : "N/A";

    return (
        <div className="enterprise-card border border-border rounded-2xl p-6 flex flex-col justify-between">
            <div>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold tracking-tight">{t("status.title")}</h2>
                    <span className="enterprise-badge">{isConnected ? t("status.connected") : t("status.disconnected")}</span>
                </div>
                <div className="space-y-4">
                    <div className="flex justify-between items-center text-sm border-b border-border/70 pb-2">
                        <span className="text-muted-foreground">{t("status.environment")}</span>
                        <span className="text-foreground">{t("status.production")}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm border-b border-border/70 pb-2">
                        <span className="text-muted-foreground">{t("status.mode")}</span>
                        <span className="text-primary font-semibold">
                            {isSingleNode ? t("status.singleNode") : t("status.multiNode")}
                        </span>
                    </div>
                    <div className="flex justify-between items-center text-sm border-b border-border/70 pb-2 gap-2">
                        <span className="text-muted-foreground">{t("status.accessUrl")}</span>
                        <span className="text-primary font-semibold text-right truncate">
                            {accessUrl}
                        </span>
                    </div>
                    <div className="flex justify-between items-center text-sm border-b border-border/70 pb-2">
                        <span className="text-muted-foreground">{t("status.backend")}</span>
                        <span className={isConnected ? "text-emerald-500 dark:text-emerald-300 font-semibold" : "text-destructive animate-pulse font-semibold"}>
                            {isConnected ? t("status.connected") : t("status.disconnected")}
                        </span>
                    </div>
                </div>
            </div>

            <div className="mt-6 pt-6 border-t border-border/70 space-y-2">
                <button
                    onClick={onRestart}
                    disabled={isLoading}
                    className="w-full group flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border bg-secondary/55 hover:bg-secondary/85 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                        <RefreshCcw className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div className="text-left">
                        <p className="text-xs font-medium text-foreground">{t("status.restartTitle")}</p>
                        <p className="text-[10px] text-muted-foreground">{t("status.restartSubtitle")}</p>
                    </div>
                </button>

                <button
                    onClick={onShutdown}
                    disabled={isLoading}
                    className="w-full group flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border bg-secondary/55 hover:bg-destructive/6 hover:border-destructive/25 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <div className="w-8 h-8 rounded-lg bg-destructive/10 border border-destructive/20 flex items-center justify-center flex-shrink-0 group-hover:bg-destructive/20 transition-colors">
                        <PowerOff className="w-3.5 h-3.5 text-destructive" />
                    </div>
                    <div className="text-left">
                        <p className="text-xs font-medium text-destructive">{t("status.shutdownTitle")}</p>
                        <p className="text-[10px] text-muted-foreground">{t("status.shutdownSubtitle")}</p>
                    </div>
                </button>
            </div>
        </div>
    );
}
