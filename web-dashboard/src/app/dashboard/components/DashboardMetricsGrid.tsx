"use client";

import { Activity, Clock, Cpu, Server } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { useI18n } from "@/components/I18nProvider";
import { DashboardMetrics, MemHistoryPoint } from "../types";

type DashboardMetricsGridProps = {
    metrics: DashboardMetrics;
    memHistory: MemHistoryPoint[];
};

export default function DashboardMetricsGrid({ metrics, memHistory }: DashboardMetricsGridProps) {
    const { t } = useI18n();

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
                title={t("metrics.memoryUsage")}
                value={`${metrics.memUsage.toFixed(1)} MB`}
                icon={Activity}
                data={memHistory}
                color="#10b981"
            />
            <MetricCard title={t("metrics.queueLoad")} value={metrics.queueCount} icon={Server} />
            <MetricCard title={t("metrics.systemUptime")} value={metrics.uptime} icon={Clock} />
            <MetricCard title={t("metrics.nextSchedule")} value={metrics.lastSchedule} icon={Cpu} />
        </div>
    );
}
