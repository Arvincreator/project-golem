"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useSearchParams } from "next/navigation";
import {
    ArrowRight,
    BookOpen,
    BrainCircuit,
    CheckCircle2,
    MessageSquare,
    RefreshCcw,
    Rocket,
    Settings2,
    ShieldCheck,
    Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type LaunchAction = {
    href: string;
    label: string;
    description: string;
    icon: ComponentType<{ className?: string }>;
    featured?: boolean;
    milestoneId?: MilestoneId;
};

type MilestoneId = "system_setup" | "golem_setup" | "first_chat" | "diary_center";
type MilestoneState = Record<MilestoneId, boolean>;
type MilestoneItem = {
    id: MilestoneId;
    label: string;
    hint: string;
    href?: string;
};

const MILESTONE_STORAGE_KEY = "golem-launchpad-milestones-v1";

const BASE_MILESTONES: MilestoneState = {
    system_setup: false,
    golem_setup: false,
    first_chat: false,
    diary_center: false
};

function readInitialMilestones(isFromSystemSetup: boolean, isFromGolemSetup: boolean): MilestoneState {
    let merged: MilestoneState = { ...BASE_MILESTONES };
    if (typeof window !== "undefined") {
        try {
            const raw = window.localStorage.getItem(MILESTONE_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as Partial<MilestoneState>;
                merged = {
                    system_setup: parsed.system_setup === true,
                    golem_setup: parsed.golem_setup === true,
                    first_chat: parsed.first_chat === true,
                    diary_center: parsed.diary_center === true
                };
            }
        } catch {
            window.localStorage.removeItem(MILESTONE_STORAGE_KEY);
        }
    }

    if (isFromSystemSetup) merged.system_setup = true;
    if (isFromGolemSetup) {
        merged.system_setup = true;
        merged.golem_setup = true;
    }

    return merged;
}

export default function LaunchpadPage() {
    const searchParams = useSearchParams();
    const from = searchParams.get("from");
    const isFromSystemSetup = from === "system-setup";
    const isFromGolemSetup = from === "golem-setup";
    const [milestones, setMilestones] = useState<MilestoneState>(() =>
        readInitialMilestones(isFromSystemSetup, isFromGolemSetup)
    );

    const title = isFromSystemSetup ? "系統初始化完成" : "Golem 核心已上線";
    const subtitle = isFromSystemSetup
        ? "基礎系統已準備就緒，下一步只要建立第一個節點，就能開始實戰。"
        : "人格、語氣與記憶設定都已生效，現在可以正式進入使用流程。";

    const actions = useMemo<LaunchAction[]>(() => {
        if (isFromSystemSetup) {
            return [
                {
                    href: "/dashboard/agents/create",
                    label: "建立第一個 Golem",
                    description: "建立節點並綁定平台，完成最後一哩。",
                    icon: Rocket,
                    featured: true,
                    milestoneId: "golem_setup"
                },
                {
                    href: "/dashboard/settings",
                    label: "檢查系統設定",
                    description: "快速確認安全、更新與服務狀態。",
                    icon: Settings2
                },
                {
                    href: "/dashboard",
                    label: "返回主控台",
                    description: "先查看目前系統總覽資訊。",
                    icon: BrainCircuit
                }
            ];
        }

        return [
            {
                href: "/dashboard/chat",
                label: "開始第一段對話",
                description: "立刻測試角色風格與行為一致性。",
                icon: MessageSquare,
                featured: true,
                milestoneId: "first_chat"
            },
            {
                href: "/dashboard/diary",
                label: "開啟 AI 日記中心",
                description: "設定自主日記節奏與回顧機制。",
                icon: BookOpen,
                milestoneId: "diary_center"
            },
            {
                href: "/dashboard/settings",
                label: "進階調整系統",
                description: "優化後端、記憶與安全策略。",
                icon: ShieldCheck
            }
        ];
    }, [isFromSystemSetup]);

    const milestoneItems = useMemo<MilestoneItem[]>(() => {
        return [
            {
                id: "system_setup",
                label: "系統初始化完成",
                hint: "後端、記憶與安全策略已儲存",
                href: "/dashboard/system-setup"
            },
            {
                id: "golem_setup",
                label: "建立與初始化 Golem",
                hint: "完成節點建立並設定人格",
                href: "/dashboard/agents/create"
            },
            {
                id: "first_chat",
                label: "完成第一段對話",
                hint: "用真實任務驗證角色是否穩定",
                href: "/dashboard/chat"
            },
            {
                id: "diary_center",
                label: "啟用日記回顧流程",
                hint: "設定 AI 日記節奏，建立長期成長循環",
                href: "/dashboard/diary"
            }
        ];
    }, []);

    const completeCount = milestoneItems.filter(item => milestones[item.id]).length;
    const progressPercent = Math.round((completeCount / milestoneItems.length) * 100);
    const nextMilestone = milestoneItems.find(item => !milestones[item.id]) || null;
    const nextAction = actions.find(action => action.milestoneId === nextMilestone?.id) || actions[0];

    useEffect(() => {
        if (typeof window === "undefined") return;
        window.localStorage.setItem(MILESTONE_STORAGE_KEY, JSON.stringify(milestones));
    }, [milestones]);

    const markDone = (id: MilestoneId) => {
        setMilestones(prev => ({ ...prev, [id]: true }));
    };

    const toggleMilestone = (id: MilestoneId) => {
        setMilestones(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const resetMilestones = () => {
        setMilestones(BASE_MILESTONES);
    };

    return (
        <div className="relative flex-1 overflow-auto bg-[radial-gradient(circle_at_12%_0%,rgba(45,212,191,0.14),transparent_40%),radial-gradient(circle_at_90%_16%,rgba(14,165,233,0.12),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(251,191,36,0.1),transparent_42%)] text-foreground">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-24 left-[8%] h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl" />
                <div className="absolute top-1/3 right-[12%] h-80 w-80 rounded-full bg-emerald-400/10 blur-3xl" />
                <div className="absolute -bottom-28 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-amber-400/10 blur-3xl" />
            </div>

            <div className="relative mx-auto w-full max-w-[1100px] px-4 pb-16 pt-10 sm:px-6 lg:px-8">
                <section className="overflow-hidden rounded-3xl border border-border/80 bg-card/80 p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.85)] backdrop-blur-sm sm:p-8">
                    <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-300/35 bg-emerald-300/10 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-100">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Setup Completed
                    </div>
                    <h1 className="text-3xl font-semibold leading-tight text-white sm:text-4xl lg:text-[2.5rem]">
                        {title}
                        <span className="ml-2 bg-gradient-to-r from-cyan-200 via-emerald-200 to-teal-300 bg-clip-text text-transparent">
                            歡迎進入實戰模式
                        </span>
                    </h1>
                    <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">
                        {subtitle}
                    </p>

                    <div className="mt-5 flex flex-wrap gap-2.5">
                        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100">
                            <Sparkles className="h-3.5 w-3.5" />
                            初始化流程已驗證完成
                        </div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1 text-xs text-emerald-100">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            你可以隨時回到設定做精調
                        </div>
                    </div>
                </section>

                <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
                    <div className="space-y-4 lg:col-span-3">
                        <div className="rounded-3xl border border-border/80 bg-card/80 p-5 shadow-xl backdrop-blur-sm">
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="text-base font-semibold text-foreground">啟動里程碑</h2>
                                <button
                                    type="button"
                                    onClick={resetMilestones}
                                    className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                                >
                                    <RefreshCcw className="h-3.5 w-3.5" />
                                    重置
                                </button>
                            </div>

                            <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-secondary/70">
                                <div
                                    className="h-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-teal-400 transition-all duration-500"
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                            <p className="mb-4 text-xs text-muted-foreground">完成度 {completeCount}/{milestoneItems.length}（{progressPercent}%）</p>

                            <div className="space-y-2">
                                {milestoneItems.map(item => (
                                    <div
                                        key={item.id}
                                        className={cn(
                                            "rounded-2xl border px-3 py-2.5",
                                            milestones[item.id]
                                                ? "border-emerald-300/30 bg-emerald-300/10"
                                                : "border-border/70 bg-background/55"
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <div className={cn("text-sm font-medium", milestones[item.id] ? "text-emerald-100" : "text-foreground")}>
                                                    {item.label}
                                                </div>
                                                <p className="mt-0.5 text-[11px] text-muted-foreground">{item.hint}</p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => toggleMilestone(item.id)}
                                                className={cn(
                                                    "shrink-0 rounded-md border px-2 py-1 text-[10px] transition-colors",
                                                    milestones[item.id]
                                                        ? "border-emerald-300/40 bg-emerald-300/20 text-emerald-100"
                                                        : "border-border/70 bg-background/60 text-foreground hover:border-cyan-300/40 hover:text-cyan-100"
                                                )}
                                            >
                                                {milestones[item.id] ? "已完成" : "標記完成"}
                                            </button>
                                        </div>
                                        {item.href && !milestones[item.id] && (
                                            <Link
                                                href={item.href}
                                                className="mt-2 inline-flex items-center gap-1 text-[11px] text-cyan-200 hover:text-cyan-100"
                                                onClick={() => markDone(item.id)}
                                            >
                                                前往執行
                                                <ArrowRight className="h-3.5 w-3.5" />
                                            </Link>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4 lg:col-span-2">
                        <div className="rounded-3xl border border-border/80 bg-card/80 p-5 shadow-xl backdrop-blur-sm">
                            <h2 className="text-base font-semibold text-foreground">下一步最佳行動</h2>
                            <p className="mt-2 text-sm text-muted-foreground">
                                {nextMilestone
                                    ? `建議先完成「${nextMilestone.label}」，可以大幅提升首次使用體驗。`
                                    : "你已完成啟動里程碑，現在可以進入日常高效運作。"}
                            </p>
                            <Button asChild className="mt-4 h-11 w-full rounded-2xl bg-gradient-to-r from-cyan-500 via-emerald-500 to-teal-500 text-white hover:from-cyan-400 hover:via-emerald-400 hover:to-teal-400">
                                <Link
                                    href={nextAction?.href || "/dashboard"}
                                    onClick={() => {
                                        if (nextAction?.milestoneId) markDone(nextAction.milestoneId);
                                    }}
                                >
                                    {nextAction?.label || "前往主控台"}
                                </Link>
                            </Button>
                        </div>

                        <div className="rounded-3xl border border-border/80 bg-card/80 p-5 shadow-xl backdrop-blur-sm">
                            <h2 className="text-base font-semibold text-foreground">快速入口</h2>
                            <div className="mt-3 grid grid-cols-1 gap-3">
                                {actions.map((action) => {
                                    const IconComponent = action.icon;
                                    return (
                                        <Link
                                            key={action.href}
                                            href={action.href}
                                            onClick={() => {
                                                if (action.milestoneId) markDone(action.milestoneId);
                                            }}
                                            className={cn(
                                                "group rounded-2xl border p-3 transition-all",
                                                action.featured
                                                    ? "border-cyan-300/45 bg-cyan-300/12"
                                                    : "border-border/70 bg-background/55 hover:border-cyan-300/35 hover:bg-cyan-300/8"
                                            )}
                                        >
                                            <div className="inline-flex rounded-xl border border-border/70 bg-background/60 p-2 text-cyan-200">
                                                <IconComponent className="h-4 w-4" />
                                            </div>
                                            <h3 className="mt-2 text-sm font-semibold text-foreground group-hover:text-white">{action.label}</h3>
                                            <p className="mt-1 text-xs text-muted-foreground">{action.description}</p>
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
