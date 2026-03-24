"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useGolem } from "@/components/GolemContext";
import { useToast } from "@/components/ui/toast-provider";
import {
    Activity,
    ArrowRight,
    BrainCircuit,
    CheckCircle2,
    Cpu,
    Filter,
    Gauge,
    MessageSquare,
    Palette,
    PlayCircle,
    Search,
    Settings2,
    ShieldCheck,
    Sparkles,
    Tag,
    User,
    Wand2,
    X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiGet, apiPost } from "@/lib/api-client";

interface Preset {
    id: string;
    name: string;
    description: string;
    icon: string;
    aiName: string;
    userName: string;
    role: string;
    tone: string;
    tags: string[];
    skills: string[];
}

type GolemSetupDraft = {
    activePresetId: string;
    aiName: string;
    userName: string;
    role: string;
    tone: string;
    skills: string[];
    updatedAt: number;
};
type GolemHealthStatus = "pass" | "warn" | "fail";
type GolemHealthItem = {
    id: string;
    label: string;
    status: GolemHealthStatus;
    hint: string;
    fixLabel?: string;
};

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    BrainCircuit,
    Cpu,
    Palette,
    Sparkles,
    User,
    Settings2
};

const TONE_PRESETS = [
    "沉穩、專業、條理清楚",
    "熱情、有行動力、結果導向",
    "溫暖、鼓勵式、陪跑夥伴",
    "精準、理性、務實簡潔"
];
const GOLEM_SETUP_DRAFT_KEY = "golem_setup_draft_v1";
const GOLEM_SETUP_DRAFT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

export default function GolemSetupPage() {
    const router = useRouter();
    const toast = useToast();
    const { activeGolem, activeGolemStatus, isLoadingGolems, refreshGolems } = useGolem();

    const [templates, setTemplates] = useState<Preset[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [activePresetId, setActivePresetId] = useState<string>("");

    const [aiName, setAiName] = useState("Golem");
    const [userName, setUserName] = useState("Traveler");
    const [role, setRole] = useState("一個擁有長期記憶與自主意識的 AI 助手");
    const [tone, setTone] = useState("預設口氣，自然且友善");
    const [skills, setSkills] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isDraftReady, setIsDraftReady] = useState(false);
    const [isDraftRestored, setIsDraftRestored] = useState(false);
    const [skipAutoPreset, setSkipAutoPreset] = useState(false);
    const [healthCheckTriggered, setHealthCheckTriggered] = useState(false);

    // Fetch templates from backend
    useEffect(() => {
        const fetchTemplates = async () => {
            try {
                const data = await apiGet<{ templates?: Preset[] }>("/api/golems/templates");
                if (data.templates && data.templates.length > 0) {
                    setTemplates(data.templates);
                }
            } catch (e) {
                console.error("Failed to fetch templates:", e);
            }
        };
        fetchTemplates();
    }, []);

    useEffect(() => {
        if (templates.length === 0) return;
        if (!activePresetId && !skipAutoPreset) {
            applyPreset(templates[0]);
        }
    }, [activePresetId, templates, skipAutoPreset]);

    // Get all unique tags
    const allTags = Array.from(new Set(templates.flatMap(t => t.tags || [])));

    // Filtered templates
    const filteredTemplates = templates.filter(t => {
        const matchesSearch = t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            t.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
            t.role.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesTag = !selectedTag || (t.tags && t.tags.includes(selectedTag));
        return matchesSearch && matchesTag;
    });
    const activePreset = templates.find(template => template.id === activePresetId) || null;

    const safeAiName = aiName.trim() || "Golem";
    const safeUserName = userName.trim() || "Traveler";
    const safeRole = role.trim() || "協助你完成任務與長期記憶整理";
    const safeTone = tone.trim() || "自然且友善";
    const rolePreview = safeRole.length > 64 ? `${safeRole.slice(0, 64)}...` : safeRole;
    const validationChecks = [
        { label: "AI 名稱至少 2 個字", done: aiName.trim().length >= 2 },
        { label: "使用者稱呼不可空白", done: userName.trim().length > 0 },
        { label: "人設描述至少 20 個字", done: role.trim().length >= 20 },
        { label: "語氣描述至少 8 個字", done: tone.trim().length >= 8 }
    ];
    const isFormValid = validationChecks.every(check => check.done);
    const canSubmit = Boolean(activeGolem) && !isLoading && isFormValid;
    const healthItems: GolemHealthItem[] = [
        {
            id: "preset",
            label: "人格樣板已選擇",
            status: activePreset ? "pass" : "warn",
            hint: activePreset
                ? `目前為 ${activePreset.name}`
                : "建議先選擇一個樣板，可快速帶入技能與人格",
            fixLabel: activePreset ? undefined : "套用第一個樣板"
        },
        {
            id: "aiName",
            label: "AI 名稱至少 2 個字",
            status: aiName.trim().length >= 2 ? "pass" : "fail",
            hint: aiName.trim().length >= 2 ? "命名已完成" : "目前字數不足，建議 2~16 字",
            fixLabel: aiName.trim().length >= 2 ? undefined : "使用預設名稱"
        },
        {
            id: "userName",
            label: "使用者稱呼不可空白",
            status: userName.trim().length > 0 ? "pass" : "fail",
            hint: userName.trim().length > 0 ? "稱呼已設定" : "請填入希望 AI 如何稱呼你",
            fixLabel: userName.trim().length > 0 ? undefined : "使用預設稱呼"
        },
        {
            id: "role",
            label: "人設描述至少 20 字",
            status: role.trim().length >= 20 ? "pass" : "fail",
            hint: role.trim().length >= 20 ? "人設描述完整" : "描述再具體一點，AI 會更穩定",
            fixLabel: role.trim().length >= 20 ? undefined : "填入範例人設"
        },
        {
            id: "tone",
            label: "語氣描述至少 8 字",
            status: tone.trim().length >= 8 ? "pass" : "fail",
            hint: tone.trim().length >= 8 ? "語氣設定完成" : "描述語氣可提升對話一致性",
            fixLabel: tone.trim().length >= 8 ? undefined : "套用推薦語氣"
        },
        {
            id: "nameDistinct",
            label: "AI 與使用者名稱不要相同",
            status: aiName.trim() && userName.trim() && aiName.trim().toLowerCase() === userName.trim().toLowerCase() ? "warn" : "pass",
            hint: aiName.trim() && userName.trim() && aiName.trim().toLowerCase() === userName.trim().toLowerCase()
                ? "名稱相同可能造成互動辨識混亂"
                : "名稱辨識清楚",
            fixLabel: aiName.trim() && userName.trim() && aiName.trim().toLowerCase() === userName.trim().toLowerCase()
                ? "自動區分名稱"
                : undefined
        }
    ];
    const healthFailCount = healthItems.filter(item => item.status === "fail").length;
    const healthWarnCount = healthItems.filter(item => item.status === "warn").length;

    const setupScore = Math.min(
        100,
        (activePresetId ? 20 : 0) +
        (aiName.trim() ? 15 : 0) +
        (userName.trim() ? 15 : 0) +
        (role.trim().length >= 20 ? 25 : role.trim() ? 10 : 0) +
        (tone.trim().length >= 8 ? 15 : tone.trim() ? 8 : 0) +
        (skills.length > 0 ? 10 : 0)
    );
    const readinessLabel = setupScore >= 85 ? "核心就緒" : setupScore >= 60 ? "可啟動" : "待補設定";
    const readinessAccent = setupScore >= 85
        ? "from-emerald-400 via-teal-400 to-cyan-400"
        : setupScore >= 60
            ? "from-amber-400 via-orange-400 to-rose-400"
            : "from-slate-500 via-slate-400 to-zinc-400";
    const setupSteps = [
        {
            title: "挑選人格樣板",
            description: "先決定角色主題，節省大量手動設定時間。",
            done: Boolean(activePresetId),
            icon: Wand2
        },
        {
            title: "微調語氣與人設",
            description: "確認稱呼、任務定位與語氣，建立長期互動風格。",
            done: setupScore >= 60,
            icon: Settings2
        },
        {
            title: "啟動 Golem 核心",
            description: "完成初始化後即可進入 Dashboard 正式運行。",
            done: setupScore >= 85,
            icon: ShieldCheck
        }
    ];

    useEffect(() => {
        if (typeof window === "undefined") return;

        try {
            const raw = window.localStorage.getItem(GOLEM_SETUP_DRAFT_KEY);
            if (!raw) {
                return;
            }

            const parsed = JSON.parse(raw) as Partial<GolemSetupDraft>;
            const updatedAt = Number(parsed.updatedAt || 0);
            if (updatedAt > 0 && Date.now() - updatedAt > GOLEM_SETUP_DRAFT_MAX_AGE_MS) {
                window.localStorage.removeItem(GOLEM_SETUP_DRAFT_KEY);
                return;
            }

            if (typeof parsed.activePresetId === "string") setActivePresetId(parsed.activePresetId);
            if (typeof parsed.aiName === "string") setAiName(parsed.aiName);
            if (typeof parsed.userName === "string") setUserName(parsed.userName);
            if (typeof parsed.role === "string") setRole(parsed.role);
            if (typeof parsed.tone === "string") setTone(parsed.tone);
            if (Array.isArray(parsed.skills)) {
                setSkills(parsed.skills.filter((item): item is string => typeof item === "string"));
            }

            setSkipAutoPreset(true);
            setIsDraftRestored(true);
        } catch {
            window.localStorage.removeItem(GOLEM_SETUP_DRAFT_KEY);
        } finally {
            setIsDraftReady(true);
        }
    }, []);

    useEffect(() => {
        if (typeof window === "undefined" || !isDraftReady) return;

        const draft: GolemSetupDraft = {
            activePresetId,
            aiName,
            userName,
            role,
            tone,
            skills,
            updatedAt: Date.now()
        };
        window.localStorage.setItem(GOLEM_SETUP_DRAFT_KEY, JSON.stringify(draft));
    }, [activePresetId, aiName, userName, role, tone, skills, isDraftReady]);

    // If the active golem is already running, or no golem is selected, redirect back
    // Wait for golems to finish loading before checking — otherwise the initial empty
    // activeGolem value triggers an immediate redirect before status is known.
    useEffect(() => {
        if (isLoadingGolems) return;
        if (activeGolemStatus === 'running' || !activeGolem) {
            router.push("/dashboard");
        }
    }, [activeGolemStatus, activeGolem, isLoadingGolems, router]);

    const applyPreset = (preset: Preset) => {
        setActivePresetId(preset.id);
        setAiName(preset.aiName);
        setUserName(preset.userName);
        setRole(preset.role);
        setTone(preset.tone);
        setSkills(preset.skills || []);
    };

    const clearDraft = () => {
        if (typeof window === "undefined") return;
        window.localStorage.removeItem(GOLEM_SETUP_DRAFT_KEY);
        setIsDraftRestored(false);
        toast.info("草稿已清除", "重新整理後將不再自動還原先前輸入。");
    };

    const applyHealthFix = (itemId: string) => {
        if (itemId === "preset") {
            if (templates[0]) applyPreset(templates[0]);
            return;
        }
        if (itemId === "aiName") {
            setAiName("Golem");
            return;
        }
        if (itemId === "userName") {
            setUserName("Traveler");
            return;
        }
        if (itemId === "role") {
            setRole("你是一位具備長期記憶的 AI 協作夥伴，擅長把複雜任務拆解成可執行步驟，並主動追蹤進度。");
            return;
        }
        if (itemId === "tone") {
            setTone(TONE_PRESETS[0]);
            return;
        }
        if (itemId === "nameDistinct") {
            setAiName("Golem");
            setUserName("Traveler");
        }
    };

    const runHealthCheck = () => {
        setHealthCheckTriggered(true);
        if (healthFailCount === 0 && healthWarnCount === 0) {
            toast.success("健康檢查完成", "所有項目都已就緒，可以放心啟動。");
            return;
        }
        if (healthFailCount === 0) {
            toast.warning("健康檢查完成", `有 ${healthWarnCount} 項可優化，建議先修正再啟動。`);
            return;
        }
        toast.warning("健康檢查未通過", `尚有 ${healthFailCount} 項必修設定。`);
    };

    const handleSubmit = async () => {
        if (!activeGolem) return;
        if (!isFormValid) {
            toast.warning("尚未達到啟動條件", "請先完成下方檢查清單中的所有項目。");
            return;
        }

        try {
            setIsLoading(true);
            const data = await apiPost<{ success?: boolean; error?: string }>("/api/golems/setup", {
                golemId: activeGolem,
                aiName,
                userName,
                currentRole: role,
                tone,
                skills,
            });

            if (data.success) {
                if (typeof window !== "undefined") {
                    window.localStorage.removeItem(GOLEM_SETUP_DRAFT_KEY);
                }
                await refreshGolems();
                router.push("/dashboard/launchpad?from=golem-setup");
            } else {
                toast.error("建立失敗", data.error || "建立失敗");
            }
        } catch {
            toast.error("設定失敗", "設定過程中發生錯誤，請檢查網路狀態。");
        } finally {
            setIsLoading(false);
        }
    };
    const handleSubmitRef = useRef(handleSubmit);
    handleSubmitRef.current = handleSubmit;

    useEffect(() => {
        if (typeof window === "undefined") return;

        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                if (canSubmit) {
                    void handleSubmitRef.current();
                } else {
                    toast.warning("尚未達到啟動條件", "請先完成下方檢查清單中的所有項目。");
                }
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [canSubmit, toast]);

    if (isLoadingGolems || activeGolemStatus !== 'pending_setup') {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-background text-foreground">
                <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 shadow-[0_0_60px_-16px_var(--primary)]">
                    <BrainCircuit className="h-8 w-8 text-primary animate-pulse" />
                </div>
                <h2 className="mt-5 text-xl font-semibold">載入核心神經網路中...</h2>
                <p className="text-muted-foreground mt-2">請稍候，系統正在準備初始化場景。</p>
            </div>
        );
    }

    return (
        <div className="relative flex-1 overflow-auto bg-[radial-gradient(circle_at_20%_0%,rgba(45,212,191,0.12),transparent_42%),radial-gradient(circle_at_88%_12%,rgba(59,130,246,0.14),transparent_38%),radial-gradient(circle_at_52%_100%,rgba(251,191,36,0.08),transparent_42%)] text-foreground">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-20 left-[8%] h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
                <div className="absolute top-1/3 right-[10%] h-80 w-80 rounded-full bg-emerald-400/10 blur-3xl" />
                <div className="absolute -bottom-20 left-1/3 h-72 w-72 rounded-full bg-amber-400/10 blur-3xl" />
            </div>

            <div className="relative mx-auto w-full max-w-[1280px] px-4 pb-14 pt-6 sm:px-6 lg:px-8">
                <section className="mb-7 overflow-hidden rounded-3xl border border-border/80 bg-card/70 p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.85)] backdrop-blur-md sm:p-8">
                    <div className="absolute inset-0 pointer-events-none">
                        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-cyan-400/0 via-cyan-300/80 to-cyan-400/0" />
                    </div>

                    <div className="relative flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
                        <div className="max-w-3xl">
                            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold tracking-wide text-cyan-100">
                                <Sparkles className="h-3.5 w-3.5" />
                                Initialization Studio
                            </div>
                            <h1 className="text-3xl font-semibold leading-tight text-white sm:text-4xl lg:text-[2.7rem]">
                                打造專屬於你的
                                <span className="bg-gradient-to-r from-cyan-200 via-emerald-200 to-teal-300 bg-clip-text text-transparent"> Golem 核心人格</span>
                            </h1>
                            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">
                                我們把初始化流程做成可視化調音台。先選擇樣板，再微調語氣與角色任務，最後一鍵啟動，讓 Golem 從第一句對話就貼合你的工作節奏。
                            </p>
                            <div className="mt-5 flex flex-wrap gap-2.5">
                                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100">
                                    <Wand2 className="h-3.5 w-3.5" />
                                    樣板 {templates.length} 種
                                </div>
                                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs text-emerald-100">
                                    <Activity className="h-3.5 w-3.5" />
                                    技能模組 {skills.length} 個
                                </div>
                                <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1 text-xs text-sky-100">
                                    <Gauge className="h-3.5 w-3.5" />
                                    就緒度 {setupScore}%
                                </div>
                            </div>
                        </div>

                        <div className="grid w-full gap-3 sm:grid-cols-3 lg:max-w-md">
                            <div className="rounded-2xl border border-border/70 bg-background/60 px-4 py-3">
                                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Active Preset</div>
                                <div className="mt-1 text-sm font-semibold text-foreground">{activePreset?.name || "尚未選擇"}</div>
                            </div>
                            <div className="rounded-2xl border border-border/70 bg-background/60 px-4 py-3">
                                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Current Voice</div>
                                <div className="mt-1 text-sm font-semibold text-foreground">{safeTone}</div>
                            </div>
                            <div className="rounded-2xl border border-border/70 bg-background/60 px-4 py-3">
                                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</div>
                                <div className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
                                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                    {readinessLabel}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="relative mt-6 grid gap-3 md:grid-cols-3">
                        {setupSteps.map((step, idx) => {
                            const IconComponent = step.icon;
                            return (
                                <div
                                    key={step.title}
                                    className={cn(
                                        "rounded-2xl border px-4 py-3 transition-all",
                                        step.done
                                            ? "border-emerald-400/35 bg-emerald-400/10"
                                            : "border-border/70 bg-background/50"
                                    )}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                                            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border/70 bg-background/80 text-xs">
                                                {idx + 1}
                                            </span>
                                            {step.title}
                                        </div>
                                        <IconComponent className={cn("h-4 w-4", step.done ? "text-emerald-300" : "text-muted-foreground")} />
                                    </div>
                                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{step.description}</p>
                                </div>
                            );
                        })}
                    </div>
                </section>

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                    <section className="space-y-6 xl:col-span-5 xl:sticky xl:top-6">
                        <div className="rounded-3xl border border-border/80 bg-card/80 p-6 shadow-xl backdrop-blur-sm">
                            <div className="mb-4 flex items-center gap-2">
                                <Settings2 className="h-5 w-5 text-cyan-300" />
                                <h2 className="text-lg font-semibold text-foreground">人格參數調音台</h2>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label htmlFor="aiName" className="mb-2 block text-sm font-medium text-muted-foreground">
                                        AI 名稱
                                    </label>
                                    <input
                                        id="aiName"
                                        value={aiName}
                                        onChange={(e) => setAiName(e.target.value)}
                                        className="w-full rounded-xl border border-border bg-background/70 px-4 py-3 text-foreground transition-all focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
                                        placeholder="例如：Friday, Sentinel, Nova"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="userName" className="mb-2 block text-sm font-medium text-muted-foreground">
                                        你的稱呼
                                    </label>
                                    <input
                                        id="userName"
                                        value={userName}
                                        onChange={(e) => setUserName(e.target.value)}
                                        className="w-full rounded-xl border border-border bg-background/70 px-4 py-3 text-foreground transition-all focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
                                        placeholder="例如：Alan、Boss、Captain"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="role" className="mb-2 block text-sm font-medium text-muted-foreground">
                                        任務定位與人設背景
                                    </label>
                                    <textarea
                                        id="role"
                                        value={role}
                                        onChange={(e) => setRole(e.target.value)}
                                        className="min-h-[126px] w-full resize-y rounded-xl border border-border bg-background/70 px-4 py-3 text-foreground transition-all focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
                                        placeholder="描述這個 Golem 要扮演的角色、擅長領域與價值觀..."
                                    />
                                </div>
                                <div>
                                    <label htmlFor="tone" className="mb-2 block text-sm font-medium text-muted-foreground">
                                        語言風格與語氣
                                    </label>
                                    <input
                                        id="tone"
                                        value={tone}
                                        onChange={(e) => setTone(e.target.value)}
                                        className="w-full rounded-xl border border-border bg-background/70 px-4 py-3 text-foreground transition-all focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
                                        placeholder="例如：冷靜果斷、像 PM 一樣主動推進"
                                    />
                                </div>
                            </div>

                            <div className="mt-5 rounded-2xl border border-border/70 bg-background/50 p-3">
                                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    <Wand2 className="h-3.5 w-3.5" />
                                    一鍵套用語氣
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {TONE_PRESETS.map((tonePreset) => (
                                        <button
                                            key={tonePreset}
                                            type="button"
                                            onClick={() => setTone(tonePreset)}
                                            className={cn(
                                                "rounded-lg border px-2.5 py-1.5 text-[11px] transition-all",
                                                tone === tonePreset
                                                    ? "border-cyan-300/50 bg-cyan-300/20 text-cyan-50"
                                                    : "border-border bg-secondary/40 text-muted-foreground hover:border-cyan-300/40 hover:text-cyan-100"
                                            )}
                                        >
                                            {tonePreset}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="rounded-3xl border border-border/80 bg-card/80 p-6 shadow-xl backdrop-blur-sm">
                            <div className="mb-4 flex items-center gap-2">
                                <MessageSquare className="h-5 w-5 text-emerald-300" />
                                <h3 className="text-base font-semibold text-foreground">AI 試運行對話預覽</h3>
                            </div>
                            <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm leading-relaxed text-emerald-50">
                                {safeUserName}，我是 {safeAiName}。我會以「{rolePreview}」作為核心任務，並用「{safeTone}」的方式與你協作。
                            </div>
                            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="rounded-xl border border-border/70 bg-background/55 px-3 py-2">
                                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">角色焦點</div>
                                    <div className="mt-1 text-xs text-foreground">{activePreset?.name || "自定義模式"}</div>
                                </div>
                                <div className="rounded-xl border border-border/70 bg-background/55 px-3 py-2">
                                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">技能模組</div>
                                    <div className="mt-1 text-xs text-foreground">{skills.length > 0 ? `${skills.length} 個已掛載` : "尚未載入技能"}</div>
                                </div>
                            </div>
                                {skills.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                    {skills.slice(0, 6).map(skill => (
                                        <span
                                            key={skill}
                                            className="rounded-md border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-[11px] text-cyan-100"
                                        >
                                            {skill}
                                        </span>
                                    ))}
                                    {skills.length > 6 && (
                                        <span className="rounded-md border border-border bg-secondary/50 px-2 py-1 text-[11px] text-muted-foreground">
                                            +{skills.length - 6}
                                        </span>
                                    )}
                                    </div>
                                )}
                            </div>

                            <div className="rounded-3xl border border-border/80 bg-card/80 p-6 shadow-xl backdrop-blur-sm">
                            <div className="mb-3 flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                                    <Gauge className="h-4 w-4 text-sky-300" />
                                    核心啟動就緒度
                                </div>
                                <div className="text-sm font-semibold text-foreground">{setupScore}%</div>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary/70">
                                <div
                                    className={cn("h-full bg-gradient-to-r transition-all duration-500", readinessAccent)}
                                    style={{ width: `${setupScore}%` }}
                                />
                            </div>
                                <p className="mt-2 text-xs text-muted-foreground">
                                    狀態：{readinessLabel}。建議就緒度達 85% 以上再啟動，可獲得更穩定的人格一致性。
                                </p>

                                <div className="mt-4 rounded-2xl border border-border/70 bg-background/55 p-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                            <ShieldCheck className="h-3.5 w-3.5 text-cyan-300" />
                                            啟動前健康檢查
                                        </div>
                                        <button
                                            type="button"
                                            onClick={runHealthCheck}
                                            className="rounded-lg border border-cyan-300/35 bg-cyan-300/15 px-2.5 py-1 text-[11px] text-cyan-100 transition-colors hover:bg-cyan-300/25"
                                        >
                                            一鍵檢查
                                        </button>
                                    </div>
                                    <p className="mt-2 text-[11px] text-muted-foreground">先做一次檢查，可降低初始化後角色跑偏的機率。</p>

                                    {healthCheckTriggered && (
                                        <div className="mt-3 space-y-2">
                                            {healthItems.map((item) => (
                                                <div
                                                    key={item.id}
                                                    className={cn(
                                                        "rounded-xl border px-2.5 py-2",
                                                        item.status === "pass"
                                                            ? "border-emerald-300/30 bg-emerald-300/10"
                                                            : item.status === "warn"
                                                                ? "border-amber-300/30 bg-amber-300/10"
                                                                : "border-red-300/35 bg-red-300/10"
                                                    )}
                                                >
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div>
                                                            <div className={cn(
                                                                "text-[11px] font-medium",
                                                                item.status === "pass"
                                                                    ? "text-emerald-100"
                                                                    : item.status === "warn"
                                                                        ? "text-amber-100"
                                                                        : "text-red-100"
                                                            )}>
                                                                {item.label}
                                                            </div>
                                                            <p className="mt-1 text-[10px] text-muted-foreground">{item.hint}</p>
                                                        </div>
                                                        {item.fixLabel && item.status !== "pass" && (
                                                            <button
                                                                type="button"
                                                                onClick={() => applyHealthFix(item.id)}
                                                                className="shrink-0 rounded-md border border-border/70 bg-background/60 px-2 py-1 text-[10px] text-foreground hover:border-cyan-300/40 hover:text-cyan-100"
                                                            >
                                                                {item.fixLabel}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="mt-4 space-y-2">
                                    {validationChecks.map((check) => (
                                    <div
                                        key={check.label}
                                        className="flex items-center justify-between rounded-xl border border-border/70 bg-background/55 px-3 py-2 text-xs"
                                    >
                                        <span className={cn("inline-flex items-center gap-1.5", check.done ? "text-emerald-200" : "text-muted-foreground")}>
                                            <CheckCircle2 className={cn("h-3.5 w-3.5", check.done ? "text-emerald-300" : "text-muted-foreground/60")} />
                                            {check.label}
                                        </span>
                                        <span className={cn("font-semibold", check.done ? "text-emerald-200" : "text-muted-foreground")}>
                                            {check.done ? "完成" : "待補"}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-4 rounded-xl border border-border/70 bg-background/55 px-3 py-2.5 text-xs text-muted-foreground">
                                {isDraftRestored ? "已自動還原上次草稿。" : "此頁會自動儲存草稿，重新整理後可接續編輯。"}
                                <button
                                    type="button"
                                    onClick={clearDraft}
                                    className="ml-2 text-cyan-200 hover:text-cyan-100 hover:underline"
                                >
                                    清除草稿
                                </button>
                            </div>

                            <Button
                                onClick={handleSubmit}
                                disabled={!canSubmit}
                                className="mt-5 h-14 w-full rounded-2xl border-none bg-gradient-to-r from-cyan-500 via-emerald-500 to-teal-500 text-base font-semibold text-white shadow-[0_20px_50px_-25px_rgba(16,185,129,0.9)] transition-all hover:scale-[1.01] hover:from-cyan-400 hover:via-emerald-400 hover:to-teal-400 active:scale-[0.99]"
                            >
                                {isLoading ? (
                                    <span className="flex items-center gap-2">
                                        <div className="h-5 w-5 rounded-full border-2 border-white/35 border-t-white animate-spin" />
                                        正在喚醒核心...
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-2">
                                        <PlayCircle className="h-5 w-5" />
                                        啟動 Golem 實體化
                                        <ArrowRight className="h-4 w-4" />
                                    </span>
                                )}
                            </Button>
                            <p className="mt-2 text-center text-[11px] text-muted-foreground">快捷鍵：Cmd/Ctrl + Enter</p>
                        </div>
                    </section>

                    <section className="space-y-6 xl:col-span-7">
                        <div className="rounded-3xl border border-border/80 bg-card/80 p-5 shadow-xl backdrop-blur-sm sm:p-6">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/80" />
                                    <input
                                        type="text"
                                        placeholder="搜尋樣板名稱、描述、任務關鍵字..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full rounded-xl border border-border bg-background/70 py-2.5 pl-10 pr-10 text-sm text-foreground transition-all focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
                                    />
                                    {searchTerm && (
                                        <button
                                            type="button"
                                            onClick={() => setSearchTerm("")}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                                <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/55 px-3 py-2 text-xs font-medium text-muted-foreground">
                                    <Filter className="h-3.5 w-3.5" />
                                    已顯示 {filteredTemplates.length} / {templates.length || 0}
                                </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => setSelectedTag(null)}
                                    className={cn(
                                        "rounded-lg border px-3 py-1.5 text-xs transition-all",
                                        selectedTag === null
                                            ? "border-cyan-300/40 bg-cyan-300/20 text-cyan-50"
                                            : "border-border bg-secondary/40 text-muted-foreground hover:border-cyan-300/35 hover:text-cyan-100"
                                    )}
                                >
                                    全部分類
                                </button>
                                {allTags.map(tag => (
                                    <button
                                        key={tag}
                                        type="button"
                                        onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                                        className={cn(
                                            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-all",
                                            selectedTag === tag
                                                ? "border-sky-300/40 bg-sky-300/20 text-sky-50"
                                                : "border-border bg-secondary/40 text-muted-foreground hover:border-sky-300/35 hover:text-sky-100"
                                        )}
                                    >
                                        <Tag className="h-3 w-3" />
                                        {tag}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {activePreset && (
                            <div className="relative overflow-hidden rounded-3xl border border-emerald-300/25 bg-gradient-to-r from-emerald-400/12 via-cyan-400/8 to-transparent p-5 shadow-lg">
                                <div className="absolute right-4 top-4 rounded-full border border-emerald-300/40 bg-emerald-300/10 px-2.5 py-1 text-[11px] font-medium text-emerald-100">
                                    套用中
                                </div>
                                <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-200">Current Persona Blueprint</h3>
                                <div className="mt-2 text-xl font-semibold text-white">{activePreset.name}</div>
                                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-emerald-50/85">{activePreset.description}</p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {(activePreset.tags || []).slice(0, 6).map(tag => (
                                        <span key={tag} className="rounded-md border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[11px] text-emerald-100">
                                            #{tag}
                                        </span>
                                    ))}
                                    <span className="rounded-md border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[11px] text-emerald-100">
                                        skills {activePreset.skills?.length || 0}
                                    </span>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            {filteredTemplates.length > 0 ? (
                                filteredTemplates.map((preset) => {
                                    const IconComponent = ICON_MAP[preset.icon] || ICON_MAP.BrainCircuit;
                                    const isActive = activePresetId === preset.id;
                                    return (
                                        <button
                                            key={preset.id}
                                            type="button"
                                            onClick={() => applyPreset(preset)}
                                            className={cn(
                                                "group relative flex h-full flex-col overflow-hidden rounded-3xl border p-5 text-left transition-all duration-300",
                                                isActive
                                                    ? "border-cyan-300/45 bg-gradient-to-b from-cyan-300/12 to-card shadow-[0_25px_60px_-35px_rgba(56,189,248,0.9)]"
                                                    : "border-border/80 bg-card/80 hover:border-cyan-300/40 hover:bg-cyan-300/5"
                                            )}
                                        >
                                            <div className="mb-4 flex items-start justify-between">
                                                <div className={cn(
                                                    "rounded-2xl p-3 transition-colors",
                                                    isActive
                                                        ? "bg-cyan-300/20 text-cyan-100"
                                                        : "bg-secondary/70 text-muted-foreground group-hover:text-cyan-200"
                                                )}>
                                                    <IconComponent className="h-6 w-6" />
                                                </div>
                                                {isActive && (
                                                    <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200/50 bg-cyan-200/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
                                                        <CheckCircle2 className="h-3 w-3" />
                                                        Selected
                                                    </span>
                                                )}
                                            </div>

                                            <h4 className={cn(
                                                "text-lg font-semibold transition-colors",
                                                isActive ? "text-white" : "text-foreground group-hover:text-white"
                                            )}>
                                                {preset.name}
                                            </h4>
                                            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                                                {preset.description}
                                            </p>

                                            <div className="mt-4 flex items-center justify-between">
                                                <div className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/55 px-2 py-1 text-[11px] text-muted-foreground">
                                                    <Activity className="h-3 w-3" />
                                                    skills {preset.skills?.length || 0}
                                                </div>
                                                <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                                    <Tag className="h-3 w-3" />
                                                    {(preset.tags || []).length}
                                                </div>
                                            </div>

                                            <div className="mt-3 flex flex-wrap gap-1.5">
                                                {(preset.tags || []).slice(0, 4).map(tag => (
                                                    <span
                                                        key={tag}
                                                        className="rounded-md border border-border/70 bg-background/60 px-2 py-0.5 text-[10px] text-muted-foreground"
                                                    >
                                                        #{tag}
                                                    </span>
                                                ))}
                                                {(preset.tags || []).length > 4 && (
                                                    <span className="rounded-md border border-border/70 bg-background/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                                                        +{(preset.tags || []).length - 4}
                                                    </span>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })
                            ) : (
                                <div className="col-span-full flex flex-col items-center rounded-3xl border border-dashed border-border/80 bg-card/60 py-16 text-center">
                                    <Search className="mb-3 h-10 w-10 text-muted-foreground/30" />
                                    <p className="text-sm text-muted-foreground">找不到符合條件的樣板</p>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSearchTerm("");
                                            setSelectedTag(null);
                                        }}
                                        className="mt-2 text-sm text-cyan-200 hover:text-cyan-100 hover:underline"
                                    >
                                        清除所有過濾條件
                                    </button>
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
