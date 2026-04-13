"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useGolem } from "@/components/GolemContext";
import { useToast } from "@/components/ui/toast-provider";
import { BrainCircuit, Cpu, Palette, Sparkles, User, Settings2, PlayCircle, Search, Tag, X, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiError, apiGet, apiPost } from "@/lib/api-client";
import GeminiAuthCard from "../settings/components/GeminiAuthCard";

interface Preset {
    id: string;
    name: string;
    description: string;
    icon: string;
    aiName: string;
    userName: string;
    role: string;
    tone: string;
    tags: string[]; // Added tags
    skills: string[];
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    BrainCircuit,
    Cpu,
    Palette,
    Sparkles,
    User,
    Settings2
};

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
    const [isGeminiBackend, setIsGeminiBackend] = useState<boolean>(false);

    // Fetch system config and templates from backend
    useEffect(() => {
        const fetchTemplatesAndConfig = async () => {
            try {
                const configData = await apiGet<any>("/api/system/config");
                setIsGeminiBackend(configData.golemBackend === "gemini");
                
                const data = await apiGet<{ templates?: Preset[] }>("/api/golems/templates");
                if (data.templates && data.templates.length > 0) {
                    setTemplates(data.templates);
                }
            } catch (e) {
                console.error("Failed to fetch templates/config:", e);
            }
        };
        fetchTemplatesAndConfig();
    }, []);

    useEffect(() => {
        if (templates.length > 0 && !activePresetId) {
            applyPreset(templates[0]);
        }
    }, [activePresetId, templates]);

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

    const handleSubmit = async () => {
        if (!activeGolem) return;

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
                await refreshGolems();
                router.push("/dashboard");
            } else {
                toast.error("建立失敗", data.error || "建立失敗");
            }
        } catch (error: unknown) {
            if (error instanceof ApiError && error.status === 409) {
                const payload = (error.payload && typeof error.payload === "object")
                    ? (error.payload as Record<string, unknown>)
                    : null;
                const errorCode = typeof payload?.error === "string" ? payload.error : "";

                if (errorCode === "system_setup_required") {
                    toast.error("請先完成系統初始化", "正在導向系統設定頁面。");
                    router.push("/dashboard/system-setup");
                    return;
                }
            }

            toast.error("設定失敗", "設定過程中發生錯誤，請檢查網路狀態。");
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoadingGolems || activeGolemStatus !== 'pending_setup') {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-background text-foreground">
                <BrainCircuit className="w-12 h-12 text-primary animate-pulse mb-4" />
                <h2 className="text-xl font-semibold">載入核心神經網路中...</h2>
                <p className="text-muted-foreground mt-2">請稍候，系統正在準備連線。</p>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto bg-background p-6 flex flex-col text-foreground">
            <div className="max-w-6xl w-full mx-auto pb-12 pt-8">
                {/* Header */}
                <div className="flex flex-col items-center text-center mb-10 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="inline-flex items-center justify-center p-4 bg-primary/10 border border-primary/20 rounded-2xl mb-5 shadow-[0_0_30px_-5px_var(--primary)] shadow-primary/20">
                        <Sparkles className="w-8 h-8 text-primary" />
                    </div>
                    <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-foreground via-foreground/80 to-primary mb-3 tracking-tight">
                        初始化 Golem
                    </h1>
                    <p className="text-lg text-muted-foreground max-w-2xl">
                        此 Golem 的大腦層尚未初始化。請在正式啟動前，賦予它專屬的人格、身分與任務模板。
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
                    {/* Left Column: Form Settings (Sticky) */}
                    <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-8 animate-in fade-in slide-in-from-left-8 duration-700 delay-150">

                        <div className="flex items-center gap-3 mb-2 px-2">
                            <Settings2 className="w-6 h-6 text-primary" />
                            <h2 className="text-xl font-semibold text-foreground">參數定義 (Parameters)</h2>
                        </div>

                        {/* Section 1: Basic Info */}
                        <div className="bg-card/80 backdrop-blur-sm border border-border rounded-2xl p-6 shadow-2xl relative overflow-hidden group">
                            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 to-primary"></div>
                            <div className="space-y-5">
                                <div>
                                    <label htmlFor="aiName" className="block text-sm font-medium text-muted-foreground mb-2">
                                        AI 名稱
                                    </label>
                                    <input
                                        id="aiName"
                                        value={aiName}
                                        onChange={(e) => setAiName(e.target.value)}
                                        className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                                        placeholder="例如：Friday, Golem"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="userName" className="block text-sm font-medium text-muted-foreground mb-2">
                                        你的稱呼
                                    </label>
                                    <input
                                        id="userName"
                                        value={userName}
                                        onChange={(e) => setUserName(e.target.value)}
                                        className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                                        placeholder="例如：Boss, Commander"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Section 2: Core Persona */}
                        <div className="bg-card/80 backdrop-blur-sm border border-border rounded-2xl p-6 shadow-2xl relative overflow-hidden group">
                            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-purple-500 to-blue-500"></div>
                            <div className="space-y-5">
                                <div>
                                    <label htmlFor="role" className="block text-sm font-medium text-muted-foreground mb-2">
                                        任務定位 & 人設背景
                                    </label>
                                    <textarea
                                        id="role"
                                        value={role}
                                        onChange={(e) => setRole(e.target.value)}
                                        className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all resize-y min-h-[120px]"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="tone" className="block text-sm font-medium text-muted-foreground mb-2">
                                        語言風格 & 語氣
                                    </label>
                                    <input
                                        id="tone"
                                        value={tone}
                                        onChange={(e) => setTone(e.target.value)}
                                        className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Gemini Auth Check (Only if Backend is Gemini) */}
                        {isGeminiBackend && (
                            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <GeminiAuthCard />
                            </div>
                        )}

                        {/* Submit Button */}
                        <div className="pt-4">
                            <Button
                                onClick={handleSubmit}
                                disabled={isLoading || !activeGolem}
                                className="w-full h-14 text-lg font-bold bg-primary hover:bg-primary/90 text-primary-foreground border-none shadow-xl shadow-primary/20 transition-all hover:scale-[1.02] active:scale-95 group rounded-2xl"
                            >
                                {isLoading ? (
                                    <span className="flex items-center gap-2">
                                        <div className="w-5 h-5 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                                        正在喚醒核心...
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-2">
                                        <PlayCircle className="w-6 h-6 group-hover:animate-pulse" />
                                        啟動 Golem 實體化
                                    </span>
                                )}
                            </Button>
                        </div>
                    </div>

                    {/* Right Column: Templates Grid & Filters */}
                    <div className="lg:col-span-7 space-y-6 animate-in fade-in slide-in-from-right-8 duration-700 delay-300">
                        {/* Search & Tags */}
                        <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6 shadow-sm">
                            <div className="flex flex-col md:flex-row gap-4 mb-6">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                                    <input
                                        type="text"
                                        placeholder="搜尋樣板名稱、關鍵字..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full bg-secondary/30 border border-border rounded-xl pl-10 pr-4 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                                    />
                                    {searchTerm && (
                                        <button
                                            onClick={() => setSearchTerm("")}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-800 rounded-md"
                                        >
                                            <X className="w-3 h-3 text-gray-500" />
                                        </button>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 text-sm font-medium text-gray-400">
                                    <Filter className="w-4 h-4" />
                                    篩選標籤
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => setSelectedTag(null)}
                                    className={cn(
                                        "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                                        selectedTag === null
                                            ? "bg-cyan-500 text-white shadow-lg shadow-cyan-900/20"
                                            : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
                                    )}
                                >
                                    全部
                                </button>
                                {allTags.map(tag => (
                                    <button
                                        key={tag}
                                        onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                                        className={cn(
                                            "px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5",
                                            selectedTag === tag
                                                ? "bg-blue-500 text-white shadow-lg shadow-blue-900/20"
                                                : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
                                        )}
                                    >
                                        <Tag className="w-3 h-3" />
                                        {tag}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Templates Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {filteredTemplates.length > 0 ? (
                                filteredTemplates.map((preset) => (
                                    <button
                                        key={preset.id}
                                        onClick={() => applyPreset(preset)}
                                        className={cn(
                                            "text-left p-5 rounded-2xl border transition-all duration-300 group relative overflow-hidden flex flex-col h-full",
                                            activePresetId === preset.id
                                                ? "bg-primary/5 border-primary/50 ring-1 ring-primary/30 shadow-[0_0_25px_-5px_var(--primary)] shadow-primary/20"
                                                : "bg-card border-border hover:border-primary/50 hover:bg-accent/50"
                                        )}
                                    >
                                        <div className="flex items-start justify-between mb-4">
                                            <div className={cn(
                                                "p-3 rounded-xl transition-colors",
                                                activePresetId === preset.id ? "bg-primary text-primary-foreground shadow-lg shadow-primary/40" : "bg-secondary text-muted-foreground group-hover:text-primary"
                                            )}>
                                                {(() => {
                                                    const IconComponent = ICON_MAP[preset.icon] || ICON_MAP.BrainCircuit;
                                                    return <IconComponent className="w-6 h-6" />;
                                                })()}
                                            </div>
                                            {activePresetId === preset.id && (
                                                <div className="bg-primary/20 border border-primary/30 text-primary text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                                    Selected
                                                </div>
                                            )}
                                        </div>

                                        <h4 className={cn(
                                            "text-lg font-bold mb-2 transition-colors",
                                            activePresetId === preset.id ? "text-white" : "text-gray-200 group-hover:text-white"
                                        )}>{preset.name}</h4>

                                        <p className="text-sm text-gray-400 leading-relaxed mb-4 flex-1">
                                            {preset.description}
                                        </p>

                                        <div className="flex flex-wrap gap-1.5 mt-auto">
                                            {preset.tags?.map(tag => (
                                                <span
                                                    key={tag}
                                                    className="px-2 py-0.5 bg-secondary border border-border text-[10px] text-muted-foreground rounded-md"
                                                >
                                                    #{tag}
                                                </span>
                                            ))}
                                        </div>

                                        {/* Background Decoration */}
                                        <div className={cn(
                                            "absolute -right-4 -bottom-4 opacity-[0.03] transition-opacity",
                                            activePresetId === preset.id ? "opacity-[0.08]" : ""
                                        )}>
                                            {(() => {
                                                const IconComponent = ICON_MAP[preset.icon] || ICON_MAP.BrainCircuit;
                                                return <IconComponent className="w-24 h-24" />;
                                            })()}
                                        </div>
                                    </button>
                                ))
                            ) : (
                                <div className="col-span-full py-20 text-center bg-muted/20 border border-dashed border-border rounded-2xl flex flex-col items-center">
                                    <Search className="w-10 h-10 text-muted-foreground/30 mb-3" />
                                    <p className="text-muted-foreground">找不到符合條件的樣板</p>
                                    <button
                                        onClick={() => { setSearchTerm(""); setSelectedTag(null); }}
                                        className="text-primary text-sm mt-2 hover:underline"
                                    >
                                        清除所有過濾條件
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
