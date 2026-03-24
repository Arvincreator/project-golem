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

    return (
        <div className="bg-card border border-border rounded-xl p-6 flex flex-col justify-between">
            <div>
                <h2 className="text-lg font-semibold mb-4">{t("status.title")}</h2>
                <div className="space-y-4">
                    <div className="flex justify-between items-center text-sm border-b border-border pb-2">
                        <span className="text-muted-foreground">{t("status.environment")}</span>
                        <span className="text-foreground">{t("status.production")}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm border-b border-border pb-2">
                        <span className="text-muted-foreground">{t("status.mode")}</span>
                        <span className="text-primary font-medium">
                            {isSingleNode ? t("status.singleNode") : t("status.multiNode")}
                        </span>
                    </div>
                    {allowRemote && (
                        <div className="flex justify-between items-center text-sm border-b border-border pb-2">
                            <span className="text-muted-foreground">{t("status.accessUrl")}</span>
                            <span className="text-cyan-500 font-bold">
                                http://{localIp}:{dashboardPort}
                            </span>
                        </div>
                    )}
                    <div className="flex justify-between items-center text-sm border-b border-border pb-2">
                        <span className="text-muted-foreground">{t("status.backend")}</span>
                        <span className={isConnected ? "text-green-600 dark:text-green-400" : "text-destructive animate-pulse"}>
                            {isConnected ? t("status.connected") : t("status.disconnected")}
                        </span>
                    </div>
                </div>
            </div>

            <div className="mt-6 pt-6 border-t border-border space-y-2">
                <button
                    onClick={onRestart}
                    disabled={isLoading}
                    className="w-full group flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-secondary/50 hover:bg-secondary transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
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
                    className="w-full group flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-secondary/50 hover:bg-destructive/5 hover:border-destructive/20 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <div className="w-7 h-7 rounded-md bg-destructive/10 border border-destructive/20 flex items-center justify-center flex-shrink-0 group-hover:bg-destructive/20 transition-colors">
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
