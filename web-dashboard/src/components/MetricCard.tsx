"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";
import { LucideIcon } from "lucide-react";

interface MetricCardProps {
    title: string;
    value: string | number;
    icon: LucideIcon;
    data?: Record<string, number | string>[];
    dataKey?: string;
    color?: string;
}

export function MetricCard({ title, value, icon: Icon, data, dataKey, color = "#8884d8" }: MetricCardProps) {
    return (
        <Card className="h-full text-foreground">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <CardTitle className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground font-semibold">
                    {title}
                </CardTitle>
                <div className="w-8 h-8 rounded-lg border border-border/80 bg-secondary/60 flex items-center justify-center shadow-inner">
                    <Icon className="h-4 w-4 text-primary" />
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-[1.8rem] leading-none font-semibold tracking-tight">{value}</div>
                {data && data.length > 0 && (
                    <div className="h-[78px] w-full mt-4 rounded-lg border border-border/70 bg-secondary/35 px-1">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data}>
                                <Tooltip
                                    contentStyle={{ 
                                        backgroundColor: "var(--color-popover)", 
                                        borderColor: "var(--color-border)",
                                        borderRadius: "calc(var(--radius) - 0.2rem)",
                                        boxShadow: "0 10px 24px rgba(0,0,0,0.28)"
                                    }}
                                    itemStyle={{ color: "var(--color-popover-foreground)" }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey={dataKey || "value"}
                                    stroke={color}
                                    fill={color}
                                    strokeWidth={2}
                                    fillOpacity={0.18}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
