"use client";

import { LucideIcon } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
export type DashboardMetricCard = {
    id: string;
    title: string;
    value: string | number;
    icon: LucideIcon;
    data?: Record<string, number | string>[];
    dataKey?: string;
    color?: string;
};

type DashboardMetricsGridProps = {
    cards: DashboardMetricCard[];
};

export default function DashboardMetricsGrid({ cards }: DashboardMetricsGridProps) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {cards.map((card) => (
                <MetricCard
                    key={card.id}
                    title={card.title}
                    value={card.value}
                    icon={card.icon}
                    data={card.data}
                    dataKey={card.dataKey}
                    color={card.color}
                />
            ))}
        </div>
    );
}
