"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
    title: string;
    value: string | number;
    icon: LucideIcon;
    data?: any[];
    dataKey?: string;
    color?: string;
    subtitle?: string;
    status?: "online" | "offline" | "warning" | "unknown";
    trend?: "up" | "down" | "stable";
}

export function MetricCard({
    title,
    value,
    icon: Icon,
    data,
    dataKey,
    color = "#8884d8",
    subtitle,
    status,
    trend,
}: MetricCardProps) {
    const statusColors: Record<string, string> = {
        online: "bg-emerald-500",
        offline: "bg-red-500",
        warning: "bg-amber-500",
        unknown: "bg-gray-500",
    };

    const trendIcons: Record<string, string> = {
        up: "\u2191",
        down: "\u2193",
        stable: "\u2192",
    };

    const trendColors: Record<string, string> = {
        up: "text-emerald-400",
        down: "text-red-400",
        stable: "text-gray-400",
    };

    return (
        <Card className="bg-gray-900 border-gray-800 text-white shadow-md">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 text-gray-300">
                <div className="flex items-center gap-2">
                    {status && (
                        <span
                            className={cn(
                                "w-2 h-2 rounded-full flex-shrink-0",
                                statusColors[status] || statusColors.unknown
                            )}
                        />
                    )}
                    <CardTitle className="text-sm font-medium">{title}</CardTitle>
                </div>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold">{value}</span>
                    {trend && (
                        <span className={cn("text-sm font-bold", trendColors[trend] || "text-gray-400")}>
                            {trendIcons[trend]}
                        </span>
                    )}
                </div>
                {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
                {data && data.length > 0 && (
                    <div className="h-[80px] w-full mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data}>
                                <Tooltip
                                    contentStyle={{ backgroundColor: "#1f2937", border: "none" }}
                                    itemStyle={{ color: "#fff" }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey={dataKey || "value"}
                                    stroke={color}
                                    fill={color}
                                    fillOpacity={0.2}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
