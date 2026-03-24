"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, BarChart3, ChevronLeft, Loader2, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast-provider";
import { apiGet } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/I18nProvider";

type PromptPoolItem = {
    id: string;
    shortcut: string;
    note?: string;
    recentUseCount?: number;
};

type RankingItem = {
    id: string;
    shortcut: string;
    note?: string;
    recentUseCount?: number;
    lastUsedAt?: string;
};

type TrendPoint = {
    date: string;
    count: number;
};

type PromptPoolResponse = {
    success?: boolean;
    items?: PromptPoolItem[];
    topUsedShortcuts?: RankingItem[];
    topUsedShortcuts7d?: RankingItem[];
    topUsedShortcuts30d?: RankingItem[];
    usageTrend14d?: TrendPoint[];
};

type ShortcutTrendResponse = {
    success?: boolean;
    shortcut?: string;
    days?: number;
    trend?: TrendPoint[];
    totalUseCount?: number;
    peakDailyUse?: number;
    averagePerDay?: number;
};

type RangeType = "all" | "30d" | "7d";

const RANGE_OPTIONS: Array<{ key: RangeType; zh: string; en: string }> = [
    { key: "all", zh: "全部", en: "All" },
    { key: "30d", zh: "30 天", en: "30d" },
    { key: "7d", zh: "7 天", en: "7d" },
];

function getErrorMessage(error: unknown, fallback: string) {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
}

function normalizeShortcutKey(input: string) {
    return String(input || "")
        .trim()
        .replace(/^((?:\/)?[a-z0-9_]{1,32})@[a-z0-9_]{3,}$/i, "$1")
        .toLowerCase()
        .replace(/^\/+/, "");
}

function resolveShortcutByKey(items: PromptPoolItem[], rawShortcut: string) {
    const targetKey = normalizeShortcutKey(rawShortcut);
    if (!targetKey) return "";
    const found = items.find((item) => normalizeShortcutKey(item.shortcut) === targetKey);
    return found?.shortcut || "";
}

function computeTrendSummary(trend: TrendPoint[]) {
    if (!trend.length) {
        return {
            total: 0,
            average: 0,
            peak: 0,
        };
    }
    const total = trend.reduce((sum, point) => sum + Number(point.count || 0), 0);
    const peak = trend.reduce((value, point) => Math.max(value, Number(point.count || 0)), 0);
    const average = Number((total / trend.length).toFixed(2));
    return { total, average, peak };
}

function TrendBars({
    trend,
    tone,
}: {
    trend: TrendPoint[];
    tone: "cyan" | "emerald";
}) {
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    const safeTrend = Array.isArray(trend) ? trend : [];
    const maxCount = safeTrend.reduce((max, point) => Math.max(max, Number(point.count || 0)), 0);
    const boxTone = tone === "cyan"
        ? "border-cyan-500/25 bg-cyan-500/10"
        : "border-emerald-500/25 bg-emerald-500/10";
    const fillTone = tone === "cyan" ? "bg-cyan-400/75" : "bg-emerald-400/75";
    const start = safeTrend.length ? safeTrend[0].date : "--";
    const end = safeTrend.length ? safeTrend[safeTrend.length - 1].date : "--";

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-14 gap-2">
                {safeTrend.map((point) => {
                    const count = Number(point.count || 0);
                    const ratio = maxCount > 0 ? count / maxCount : 0;
                    const heightPercent = Math.max(8, Math.round(ratio * 100));
                    return (
                        <div
                            key={point.date}
                            className={cn("h-24 rounded-lg border relative overflow-hidden", boxTone)}
                            title={isEnglish ? `${point.date}: ${count} uses` : `${point.date}：${count} 次`}
                        >
                            <div
                                className={cn("absolute left-0 right-0 bottom-0 rounded-b-lg transition-all", fillTone)}
                                style={{ height: `${heightPercent}%` }}
                            />
                        </div>
                    );
                })}
            </div>
            <div className="flex items-center justify-between text-muted-foreground text-sm">
                <span>{start}</span>
                <span>{end}</span>
            </div>
        </div>
    );
}

function PromptTrendsPageFallback() {
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    return (
        <div className="flex flex-col h-full bg-background p-6 gap-6 overflow-auto">
            <Card className="border-border/80 min-h-[300px]">
                <CardContent className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    {isEnglish ? "Loading trends page..." : "載入趨勢頁面中..."}
                </CardContent>
            </Card>
        </div>
    );
}

function PromptTrendsContent() {
    const toast = useToast();
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    const router = useRouter();
    const searchParams = useSearchParams();

    const [items, setItems] = useState<PromptPoolItem[]>([]);
    const [topUsed, setTopUsed] = useState<RankingItem[]>([]);
    const [topUsed7d, setTopUsed7d] = useState<RankingItem[]>([]);
    const [topUsed30d, setTopUsed30d] = useState<RankingItem[]>([]);
    const [usageTrend14d, setUsageTrend14d] = useState<TrendPoint[]>([]);
    const [selectedRange, setSelectedRange] = useState<RangeType>("all");
    const [selectedShortcut, setSelectedShortcut] = useState("");
    const [selectedTrend, setSelectedTrend] = useState<ShortcutTrendResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingDetail, setIsLoadingDetail] = useState(false);

    const queryShortcut = String(searchParams.get("shortcut") || "").trim();

    const loadPromptTrendSummary = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await apiGet<PromptPoolResponse>("/api/prompt-pool");
            setItems(Array.isArray(data.items) ? data.items : []);
            setTopUsed(Array.isArray(data.topUsedShortcuts) ? data.topUsedShortcuts : []);
            setTopUsed7d(Array.isArray(data.topUsedShortcuts7d) ? data.topUsedShortcuts7d : []);
            setTopUsed30d(Array.isArray(data.topUsedShortcuts30d) ? data.topUsedShortcuts30d : []);
            setUsageTrend14d(Array.isArray(data.usageTrend14d) ? data.usageTrend14d : []);
        } catch (error) {
            toast.error(
                isEnglish ? "Load failed" : "讀取失敗",
                getErrorMessage(error, isEnglish ? "Failed to load prompt trend data" : "無法讀取 Prompt 趨勢資料")
            );
        } finally {
            setIsLoading(false);
        }
    }, [isEnglish, toast]);

    const loadSingleShortcutTrend = useCallback(async (shortcut: string) => {
        const safeShortcut = String(shortcut || "").trim();
        if (!safeShortcut) {
            setSelectedTrend(null);
            return;
        }
        setIsLoadingDetail(true);
        try {
            const data = await apiGet<ShortcutTrendResponse>(
                `/api/prompt-pool/usage-trend?shortcut=${encodeURIComponent(safeShortcut)}&days=14`
            );
            setSelectedTrend({
                ...data,
                shortcut: data.shortcut || safeShortcut,
                trend: Array.isArray(data.trend) ? data.trend : [],
                totalUseCount: Number(data.totalUseCount || 0),
                peakDailyUse: Number(data.peakDailyUse || 0),
                averagePerDay: Number(data.averagePerDay || 0),
            });
        } catch (error) {
            setSelectedTrend(null);
            toast.warning(
                isEnglish ? "Failed to load shortcut trend" : "讀取單指令趨勢失敗",
                getErrorMessage(error, isEnglish ? "Please try again later" : "請稍後再試")
            );
        } finally {
            setIsLoadingDetail(false);
        }
    }, [isEnglish, toast]);

    useEffect(() => {
        loadPromptTrendSummary();
    }, [loadPromptTrendSummary]);

    useEffect(() => {
        if (!items.length) {
            setSelectedShortcut("");
            return;
        }

        const fromQuery = resolveShortcutByKey(items, queryShortcut);
        if (fromQuery) {
            setSelectedShortcut((prev) => (
                normalizeShortcutKey(prev) === normalizeShortcutKey(fromQuery)
                    ? prev
                    : fromQuery
            ));
            return;
        }

        setSelectedShortcut((prev) => {
            const currentExists = items.some((item) => normalizeShortcutKey(item.shortcut) === normalizeShortcutKey(prev));
            if (currentExists) return prev;
            return topUsed[0]?.shortcut || items[0]?.shortcut || "";
        });
    }, [items, queryShortcut, topUsed]);

    useEffect(() => {
        if (isLoading) return;

        const selectedKey = normalizeShortcutKey(selectedShortcut);
        const queryKey = normalizeShortcutKey(queryShortcut);
        if (selectedKey === queryKey) return;

        if (!selectedKey) {
            router.replace("/dashboard/prompt-trends");
            return;
        }
        router.replace(`/dashboard/prompt-trends?shortcut=${encodeURIComponent(selectedShortcut)}`);
    }, [isLoading, queryShortcut, router, selectedShortcut]);

    useEffect(() => {
        if (!selectedShortcut) {
            setSelectedTrend(null);
            return;
        }
        loadSingleShortcutTrend(selectedShortcut);
    }, [loadSingleShortcutTrend, selectedShortcut]);

    const activeRanking = useMemo(() => {
        if (selectedRange === "7d") return topUsed7d;
        if (selectedRange === "30d") return topUsed30d;
        return topUsed;
    }, [selectedRange, topUsed, topUsed30d, topUsed7d]);

    const globalSummary = useMemo(() => computeTrendSummary(usageTrend14d), [usageTrend14d]);

    const detailSummary = useMemo(() => {
        if (!selectedTrend) {
            return {
                total: 0,
                average: 0,
                peak: 0,
            };
        }
        return {
            total: Number(selectedTrend.totalUseCount || 0),
            average: Number(selectedTrend.averagePerDay || 0),
            peak: Number(selectedTrend.peakDailyUse || 0),
        };
    }, [selectedTrend]);

    return (
        <div className="flex flex-col h-full bg-background p-6 gap-6 overflow-auto">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-emerald-400">
                        {isEnglish ? "Prompt Trends" : "Prompt 趨勢視圖"}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                        {isEnglish
                            ? "A dedicated page for trend analytics so management views stay clean. Quickly inspect overall usage, per-shortcut trends, and rankings."
                            : "將趨勢分析獨立成單頁，避免管理頁塞入過多資訊。可快速看整體熱度、單指令曲線與使用排行。"}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() => router.push("/dashboard/prompt-pool")}
                        className="gap-2"
                    >
                        <ChevronLeft className="w-4 h-4" />
                        {isEnglish ? "Back to Pool" : "回到指令池"}
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={loadPromptTrendSummary}
                        disabled={isLoading}
                        className="gap-2"
                    >
                        <RefreshCcw className={cn("w-4 h-4", isLoading && "animate-spin")} />
                        {isEnglish ? "Refresh" : "重新整理"}
                    </Button>
                </div>
            </div>

            {isLoading ? (
                <Card className="border-border/80 min-h-[300px]">
                    <CardContent className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        {isEnglish ? "Loading trend data..." : "載入趨勢資料中..."}
                    </CardContent>
                </Card>
            ) : (
                <>
                    <Card className="border-border/80">
                        <CardHeader className="pb-4">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <BarChart3 className="w-4 h-4 text-cyan-300" />
                                {isEnglish ? "Overall Usage (Last 14 Days)" : "近 14 天整體使用趨勢"}
                            </CardTitle>
                            <CardDescription>
                                {isEnglish
                                    ? `Total ${globalSummary.total} · Avg/day ${globalSummary.average} · Peak ${globalSummary.peak}`
                                    : `總計 ${globalSummary.total} 次 · 日均 ${globalSummary.average} 次 · 峰值 ${globalSummary.peak} 次`}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <TrendBars trend={usageTrend14d} tone="cyan" />
                        </CardContent>
                    </Card>

                    <Card className="border-border/80">
                        <CardHeader className="pb-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <Activity className="w-4 h-4 text-emerald-300" />
                                        {isEnglish ? "Single Shortcut Trend (14 Days)" : "單指令 14 天趨勢"}
                                    </CardTitle>
                                    <CardDescription>
                                        {isEnglish
                                            ? `Total ${detailSummary.total} · Avg/day ${detailSummary.average} · Peak ${detailSummary.peak}`
                                            : `總計 ${detailSummary.total} 次 · 日均 ${detailSummary.average} 次 · 峰值 ${detailSummary.peak} 次`}
                                    </CardDescription>
                                </div>
                                <select
                                    value={selectedShortcut}
                                    onChange={(e) => setSelectedShortcut(String(e.target.value || ""))}
                                    className="rounded-md border border-border bg-secondary/40 text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/40"
                                    disabled={items.length === 0}
                                >
                                    {items.length === 0 ? (
                                        <option value="">{isEnglish ? "No shortcuts yet" : "尚無快捷指令"}</option>
                                    ) : (
                                        items.map((item) => (
                                            <option key={item.id} value={item.shortcut}>
                                                {item.shortcut}
                                            </option>
                                        ))
                                    )}
                                </select>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {isLoadingDetail ? (
                                <div className="h-[140px] flex items-center justify-center text-muted-foreground text-sm">
                                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                    {isEnglish ? "Loading shortcut trend..." : "載入單指令趨勢..."}
                                </div>
                            ) : selectedTrend && Array.isArray(selectedTrend.trend) ? (
                                <TrendBars trend={selectedTrend.trend} tone="emerald" />
                            ) : (
                                <div className="h-[140px] flex items-center justify-center text-muted-foreground text-sm italic">
                                    {isEnglish ? "No trend data for the selected shortcut" : "目前沒有可顯示的單指令趨勢資料"}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="border-border/80">
                        <CardHeader className="pb-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <CardTitle className="text-lg">
                                        {isEnglish ? "Shortcut Ranking (Telegram + Dashboard)" : "快捷指令使用排行 (Telegram + Dashboard)"}
                                    </CardTitle>
                                    <CardDescription>
                                        {isEnglish ? "Switch ranges to find the most frequently triggered shortcuts." : "可切換統計區間，快速找出最常被觸發的快捷指令。"}
                                    </CardDescription>
                                </div>
                                <div className="inline-flex rounded-lg border border-border overflow-hidden">
                                    {RANGE_OPTIONS.map((option) => (
                                        <button
                                            key={option.key}
                                            type="button"
                                            onClick={() => setSelectedRange(option.key)}
                                            className={cn(
                                                "px-3 py-1.5 text-sm transition-colors border-r border-border last:border-r-0",
                                                selectedRange === option.key
                                                    ? "bg-secondary text-foreground font-semibold"
                                                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                                            )}
                                        >
                                            {isEnglish ? option.en : option.zh}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {activeRanking.length === 0 ? (
                                <p className="text-sm text-muted-foreground italic">{isEnglish ? "No usage records yet" : "尚無使用記錄"}</p>
                            ) : (
                                <div className="space-y-2">
                                    {activeRanking.map((item, index) => {
                                        const isSelected = normalizeShortcutKey(item.shortcut) === normalizeShortcutKey(selectedShortcut);
                                        return (
                                            <button
                                                key={`${item.id}-${item.shortcut}`}
                                                type="button"
                                                onClick={() => setSelectedShortcut(item.shortcut)}
                                                className={cn(
                                                    "w-full rounded-lg border px-3 py-2 text-left flex items-center justify-between gap-2 transition-colors",
                                                    isSelected
                                                        ? "border-primary/50 bg-primary/10"
                                                        : "border-border bg-secondary/20 hover:bg-secondary/40"
                                                )}
                                            >
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <span className="text-xs text-muted-foreground w-7">#{index + 1}</span>
                                                    <span className="font-medium">{item.shortcut}</span>
                                                    {item.note && (
                                                        <span className="text-xs text-muted-foreground truncate">
                                                            {item.note}
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="text-sm text-cyan-300 whitespace-nowrap">
                                                    {Number(item.recentUseCount || 0)} {isEnglish ? "uses" : "次"}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
}

export default function PromptTrendsPage() {
    return (
        <Suspense fallback={<PromptTrendsPageFallback />}>
            <PromptTrendsContent />
        </Suspense>
    );
}
