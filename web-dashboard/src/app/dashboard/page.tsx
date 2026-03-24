"use client";

import { LogStream } from "@/components/LogStream";
import { useGolem } from "@/components/GolemContext";
import { SystemActionDialogs } from "@/components/SystemActionDialogs";
import NoGolemsState from "./components/NoGolemsState";
import DashboardMetricsGrid from "./components/DashboardMetricsGrid";
import SystemStatusPanel from "./components/SystemStatusPanel";
import UpdateMarqueeNotice from "./components/UpdateMarqueeNotice";
import { useDashboardRealtime } from "./hooks/useDashboardRealtime";
import { useSystemActionDialogs } from "./hooks/useSystemActionDialogs";
import { useI18n } from "@/components/I18nProvider";

export default function DashboardPage() {
    const { hasGolems, isLoadingGolems, isSingleNode, isBooting, allowRemote, localIp, dashboardPort } = useGolem();
    const { metrics, memHistory, isConnected } = useDashboardRealtime();
    const { t } = useI18n();
    const {
        confirmDialog,
        doneDialog,
        isLoading,
        openConfirm,
        handleConfirm,
        setConfirmDialogOpen,
        setDoneDialogOpen,
    } = useSystemActionDialogs();

    if (!isLoadingGolems && !hasGolems && !isBooting) {
        return <NoGolemsState />;
    }

    return (
        <div className="p-6 h-full flex flex-col space-y-6">
            <UpdateMarqueeNotice />
            <DashboardMetricsGrid metrics={metrics} memHistory={memHistory} />

            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-6 min-h-0">
                <div className="md:col-span-2 flex flex-col min-h-0">
                    <h2 className="text-lg font-semibold mb-2">{t("dashboard.liveSystemLogs")}</h2>
                    <LogStream className="flex-1" />
                </div>
                <SystemStatusPanel
                    isSingleNode={isSingleNode}
                    allowRemote={allowRemote}
                    localIp={localIp}
                    dashboardPort={dashboardPort}
                    isConnected={isConnected}
                    isLoading={isLoading}
                    onRestart={() => openConfirm("restart")}
                    onShutdown={() => openConfirm("shutdown")}
                />
            </div>

            <SystemActionDialogs
                confirmDialogOpen={confirmDialog.open}
                setConfirmDialogOpen={setConfirmDialogOpen}
                confirmVariant={confirmDialog.variant}
                handleConfirm={handleConfirm}
                isLoading={isLoading}
                doneDialogOpen={doneDialog.open}
                setDoneDialogOpen={setDoneDialogOpen}
                doneVariant={doneDialog.variant}
            />
        </div>
    );
}
