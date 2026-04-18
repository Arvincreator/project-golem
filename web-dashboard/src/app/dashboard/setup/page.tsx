"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useGolem } from "@/components/GolemContext";
import { useToast } from "@/components/ui/toast-provider";
import {
    BrainCircuit, Cpu, Palette, Sparkles, User, Settings2,
    PlayCircle, Search, Tag, X, Filter, Zap, CheckCircle2,
    ChevronRight, Moon, BookOpen, Plus, Info, Eye,
    AlertCircle
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

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    BrainCircuit,
    Cpu,
    Palette,
    Sparkles,
    User,
    Settings2
};

// 已知技能的描述對應表
const SKILL_META: Record<string, { label: string; desc: string; icon: React.ComponentType<{ className?: string }> }> = {
    "git": { label: "Git 操作", desc: "讀取 Git 歷史、差異與提交記錄", icon: BookOpen },
    "youtube": { label: "YouTube", desc: "搜尋、摘要影片內容", icon: Zap },
    "spotify": { label: "Spotify", desc: "音樂搜尋與播放清單管理", icon: Moon },
    "image-prompt": { label: "圖像 Prompt", desc: "生成 AI 繪圖提示詞", icon: Palette },
    "wiki": { label: "Wikipedia", desc: "查詢維基百科知識庫", icon: BookOpen },
    "notebooklm": { label: "NotebookLM", desc: "Google NotebookLM 整合", icon: BrainCircuit },
};

function SkillBadge({
    skill,
    enabled,
    onToggle,
}: {
    skill: string;
    enabled: boolean;
    onToggle?: () => void;
}) {
    const meta = SKILL_META[skill];
    const Icon = meta?.icon ?? Sparkles;

    return (
        <button
            type="button"
            onClick={onToggle}
            className={cn(
                "group flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all duration-200",
                enabled
                    ? "bg-primary/10 border-primary/40 text-primary hover:bg-primary/15 hover:border-primary/60"
                    : "bg-secondary/30 border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
            )}
            title={meta?.desc}
        >
            <Icon className={cn("w-3.5 h-3.5 transition-colors", enabled ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
            <span>{meta?.label ?? skill}</span>
            {onToggle && (
                enabled
                    ? <CheckCircle2 className="w-3 h-3 text-primary ml-0.5" />
                    : <Plus className="w-3 h-3 opacity-40 group-hover:opacity-70 ml-0.5" />
            )}
        </button>
    );
}

// 所有可用技能的總表（用於手動選擇）
const ALL_AVAILABLE_SKILLS = Object.keys(SKILL_META);

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
    const [showRoleHelp, setShowRoleHelp] = useState(false);

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

    // Redirect logic
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

    const toggleSkill = useCallback((skill: string) => {
        setSkills(prev =>
            prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]
        );
    }, []);

    // Extra skills that exist in ALL_AVAILABLE_SKILLS but not in the template
    const extraSkillsToShow = ALL_AVAILABLE_SKILLS.filter(s => !skills.includes(s));

    const handleSubmit = async () => {
        if (!activeGolem) return;

        if (!aiName.trim() || !userName.trim()) {
            toast.error("欄位缺失", "請填寫 AI 名稱與您的稱呼");
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
                await refreshGolems();
                router.push("/dashboard");
            } else {
                toast.error("建立失敗", data.error || "建立失敗");
            }
        } catch {
            toast.error("設定失敗", "設定過程中發生錯誤，請檢查網路狀態。");
        } finally {
            setIsLoading(false);
        }
    };

    const activeTemplate = templates.find(t => t.id === activePresetId);

    if (isLoadingGolems || activeGolemStatus !== 'pending_setup') {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-background text-foreground">
                <div className="p-4 bg-primary/10 border border-primary/20 rounded-2xl mb-4 shadow-[0_0_40px_-8px] shadow-primary/20">
                    <BrainCircuit className="w-10 h-10 text-primary animate-pulse" />
                </div>
                <h2 className="text-xl font-semibold">載入核心神經網路中...</h2>
                <p className="text-muted-foreground mt-2">請稍候，系統正在準備連線。</p>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto bg-background p-4 md:p-6 flex flex-col text-foreground">
            <div className="max-w-7xl w-full mx-auto pb-12 pt-4 md:pt-8">

                {/* Header */}
                <div className="flex flex-col items-center text-center mb-8 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="inline-flex items-center justify-center p-4 bg-primary/10 border border-primary/20 rounded-2xl mb-5 shadow-[0_0_30px_-5px] shadow-primary/20">
                        <Sparkles className="w-8 h-8 text-primary" />
                    </div>
                    <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-foreground via-foreground/80 to-primary mb-3 tracking-tight">
                        初始化 Golem
                    </h1>
                    <p className="text-base md:text-lg text-muted-foreground max-w-2xl">
                        賦予您的 Golem 專屬的人格、身分與技能配置，再正式啟動。
                    </p>

                    {/* 流程步驟指示 */}
                    <div className="flex items-center gap-2 mt-6 text-sm">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 text-primary font-medium">
                            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center">1</span>
                            選擇模板
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 text-primary font-medium">
                            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center">2</span>
                            調整設定
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary border border-border text-muted-foreground font-medium">
                            <span className="w-5 h-5 rounded-full bg-secondary border border-border text-muted-foreground text-[11px] font-bold flex items-center justify-center">3</span>
                            啟動
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">

                    {/* ===== Left Column: Settings Form ===== */}
                    <div className="xl:col-span-5 space-y-5 xl:sticky xl:top-6 animate-in fade-in slide-in-from-left-8 duration-700 delay-150">

                        <div className="flex items-center gap-3 mb-1 px-1">
                            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                                <Settings2 className="w-4 h-4 text-primary" />
                            </div>
                            <h2 className="text-lg font-semibold text-foreground">參數定義</h2>
                        </div>

                        {/* Section 1: Identity */}
                        <div className="bg-card/80 backdrop-blur-sm border border-border rounded-2xl p-5 shadow-xl relative overflow-hidden">
                            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-blue-500 via-primary to-blue-600" />
                            <div className="flex items-center gap-2 mb-4">
                                <User className="w-4 h-4 text-primary" />
                                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">身分識別</h3>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label htmlFor="aiName" className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                                        AI 名稱
                                    </label>
                                    <input
                                        id="aiName"
                                        value={aiName}
                                        onChange={(e) => setAiName(e.target.value)}
                                        className="w-full bg-secondary/40 border border-border rounded-xl px-4 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all placeholder:text-muted-foreground/50"
                                        placeholder="例如：Friday, Golem, Turing"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="userName" className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                                        您的稱呼
                                    </label>
                                    <input
                                        id="userName"
                                        value={userName}
                                        onChange={(e) => setUserName(e.target.value)}
                                        className="w-full bg-secondary/40 border border-border rounded-xl px-4 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all placeholder:text-muted-foreground/50"
                                        placeholder="例如：Boss, Commander, Creator"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Section 2: Persona */}
                        <div className="bg-card/80 backdrop-blur-sm border border-border rounded-2xl p-5 shadow-xl relative overflow-hidden">
                            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-purple-500 via-primary to-blue-500" />
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <BrainCircuit className="w-4 h-4 text-primary" />
                                    <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">人設 & 語氣</h3>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowRoleHelp(!showRoleHelp)}
                                    className="text-muted-foreground hover:text-foreground transition-colors"
                                    title="說明"
                                >
                                    <Info className="w-4 h-4" />
                                </button>
                            </div>
                            {showRoleHelp && (
                                <div className="mb-4 p-3 bg-primary/5 border border-primary/20 rounded-xl text-xs text-muted-foreground leading-relaxed animate-in fade-in duration-200">
                                    <strong className="text-primary">角色定位</strong> 是 Golem 核心身分的完整描述，決定它的思維方式與行為準則。
                                    <br /><strong className="text-primary">語言風格</strong> 控制它與您溝通時的語氣與措辭方式。
                                </div>
                            )}
                            <div className="space-y-4">
                                <div>
                                    <label htmlFor="role" className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                                        任務定位 & 人設背景
                                    </label>
                                    <textarea
                                        id="role"
                                        value={role}
                                        onChange={(e) => setRole(e.target.value)}
                                        className="w-full bg-secondary/40 border border-border rounded-xl px-4 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all resize-y min-h-[100px] placeholder:text-muted-foreground/50"
                                        placeholder="描述 Golem 的核心身分、使命與行為準則..."
                                    />
                                </div>
                                <div>
                                    <label htmlFor="tone" className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                                        語言風格 & 語氣
                                    </label>
                                    <input
                                        id="tone"
                                        value={tone}
                                        onChange={(e) => setTone(e.target.value)}
                                        className="w-full bg-secondary/40 border border-border rounded-xl px-4 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all placeholder:text-muted-foreground/50"
                                        placeholder="例如：客觀精確、活潑友善、充滿詩意..."
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Section 3: Skills */}
                        <div className="bg-card/80 backdrop-blur-sm border border-border rounded-2xl p-5 shadow-xl relative overflow-hidden">
                            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-500 to-teal-500" />
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <Zap className="w-4 h-4 text-emerald-500" />
                                    <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">技能配置</h3>
                                </div>
                                <span className="text-[11px] text-muted-foreground font-mono bg-secondary/60 border border-border px-2 py-0.5 rounded-full">
                                    {skills.length} / {ALL_AVAILABLE_SKILLS.length} 已啟用
                                </span>
                            </div>

                            {/* Active skills */}
                            {skills.length > 0 ? (
                                <div className="mb-4">
                                    <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">已啟用技能</p>
                                    <div className="flex flex-wrap gap-2">
                                        {skills.map(skill => (
                                            <SkillBadge
                                                key={skill}
                                                skill={skill}
                                                enabled={true}
                                                onToggle={() => toggleSkill(skill)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="mb-4 p-3 bg-muted/30 border border-dashed border-border/60 rounded-xl flex items-center gap-2 text-xs text-muted-foreground">
                                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                    此模板未預設任何技能，您可以從下方手動新增。
                                </div>
                            )}

                            {/* Available skills to add */}
                            {extraSkillsToShow.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="flex-1 h-px bg-border/60" />
                                        <p className="text-[11px] text-muted-foreground uppercase tracking-wider whitespace-nowrap">可新增技能</p>
                                        <div className="flex-1 h-px bg-border/60" />
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {extraSkillsToShow.map(skill => (
                                            <SkillBadge
                                                key={skill}
                                                skill={skill}
                                                enabled={false}
                                                onToggle={() => toggleSkill(skill)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Submit Button */}
                        <div className="pt-2">
                            {/* 設定摘要預覽 */}
                            {activeTemplate && (
                                <div className="mb-4 p-3 bg-secondary/40 border border-border rounded-xl text-xs text-muted-foreground flex items-center gap-3">
                                    <Eye className="w-4 h-4 text-primary flex-shrink-0" />
                                    <div className="min-w-0">
                                        <span className="font-medium text-foreground">{aiName}</span>
                                        <span className="text-muted-foreground"> × </span>
                                        <span className="font-medium text-foreground">{userName}</span>
                                        <span className="text-muted-foreground ml-2">·</span>
                                        <span className="text-muted-foreground ml-2">{skills.length} 技能</span>
                                        <span className="text-muted-foreground ml-2">·</span>
                                        <span className="text-muted-foreground ml-2">模板：{activeTemplate.name}</span>
                                    </div>
                                </div>
                            )}
                            <Button
                                onClick={handleSubmit}
                                disabled={isLoading || !activeGolem}
                                className="w-full h-13 text-base font-bold bg-primary hover:bg-primary/90 text-primary-foreground border-none shadow-xl shadow-primary/20 transition-all hover:scale-[1.02] active:scale-95 group rounded-2xl"
                            >
                                {isLoading ? (
                                    <span className="flex items-center gap-2">
                                        <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                                        正在喚醒核心...
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-2">
                                        <PlayCircle className="w-5 h-5 group-hover:animate-pulse" />
                                        啟動 Golem 實體化
                                    </span>
                                )}
                            </Button>
                        </div>
                    </div>

                    {/* ===== Right Column: Templates Grid ===== */}
                    <div className="xl:col-span-7 space-y-5 animate-in fade-in slide-in-from-right-8 duration-700 delay-300">

                        <div className="flex items-center gap-3 mb-1 px-1">
                            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                                <BookOpen className="w-4 h-4 text-primary" />
                            </div>
                            <h2 className="text-lg font-semibold text-foreground">選擇模板</h2>
                            {templates.length > 0 && (
                                <span className="text-xs text-muted-foreground font-mono bg-secondary/60 border border-border px-2 py-0.5 rounded-full ml-auto">
                                    {filteredTemplates.length} / {templates.length} 個模板
                                </span>
                            )}
                        </div>

                        {/* Search & Tags */}
                        <div className="bg-card/60 backdrop-blur-sm border border-border rounded-2xl p-4 shadow-sm">
                            <div className="flex flex-col md:flex-row gap-3 mb-4">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    <input
                                        type="text"
                                        placeholder="搜尋樣板名稱、關鍵字..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full bg-secondary/30 border border-border rounded-xl pl-9 pr-4 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all placeholder:text-muted-foreground/50"
                                    />
                                    {searchTerm && (
                                        <button
                                            onClick={() => setSearchTerm("")}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 hover:bg-secondary rounded-md text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                    <Filter className="w-3.5 h-3.5" />
                                    <span>篩選</span>
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => setSelectedTag(null)}
                                    className={cn(
                                        "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                                        selectedTag === null
                                            ? "bg-primary text-primary-foreground shadow-sm"
                                            : "bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground border border-border"
                                    )}
                                >
                                    全部
                                </button>
                                {allTags.map(tag => (
                                    <button
                                        key={tag}
                                        onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                                        className={cn(
                                            "px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border",
                                            selectedTag === tag
                                                ? "bg-primary/10 border-primary/40 text-primary"
                                                : "bg-secondary/50 border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
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
                                filteredTemplates.map((preset) => {
                                    const IconComponent = ICON_MAP[preset.icon] || ICON_MAP.BrainCircuit;
                                    const isActive = activePresetId === preset.id;
                                    return (
                                        <button
                                            key={preset.id}
                                            onClick={() => applyPreset(preset)}
                                            className={cn(
                                                "text-left p-5 rounded-2xl border transition-all duration-300 group relative overflow-hidden flex flex-col h-full text-foreground",
                                                isActive
                                                    ? "bg-primary/5 border-primary/50 ring-2 ring-primary/20 shadow-[0_0_25px_-5px] shadow-primary/15"
                                                    : "bg-card border-border hover:border-primary/40 hover:bg-accent/30 hover:shadow-md"
                                            )}
                                        >
                                            {/* Top */}
                                            <div className="flex items-start justify-between mb-3">
                                                <div className={cn(
                                                    "p-2.5 rounded-xl transition-all",
                                                    isActive
                                                        ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
                                                        : "bg-secondary text-muted-foreground group-hover:text-primary group-hover:bg-primary/10"
                                                )}>
                                                    <IconComponent className="w-5 h-5" />
                                                </div>
                                                {isActive && (
                                                    <div className="flex items-center gap-1 bg-primary/15 border border-primary/30 text-primary text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                                        <CheckCircle2 className="w-3 h-3" />
                                                        已選
                                                    </div>
                                                )}
                                            </div>

                                            {/* Name */}
                                            <h4 className={cn(
                                                "text-sm font-bold mb-1.5 transition-colors",
                                                isActive ? "text-foreground" : "text-foreground/90 group-hover:text-foreground"
                                            )}>
                                                {preset.name}
                                            </h4>

                                            {/* Description */}
                                            <p className="text-xs text-muted-foreground leading-relaxed mb-3 flex-1">
                                                {preset.description}
                                            </p>

                                            {/* Meta Row: aiName, userName, skills count */}
                                            <div className="flex items-center gap-2 mb-3 text-[11px] text-muted-foreground">
                                                <span className="flex items-center gap-1">
                                                    <span className="font-mono bg-secondary/60 border border-border/60 px-1.5 py-0.5 rounded text-[10px]">{preset.aiName}</span>
                                                </span>
                                                <span className="text-border">×</span>
                                                <span className="flex items-center gap-1">
                                                    <span className="font-mono bg-secondary/60 border border-border/60 px-1.5 py-0.5 rounded text-[10px]">{preset.userName}</span>
                                                </span>
                                                {preset.skills && preset.skills.length > 0 && (
                                                    <>
                                                        <span className="flex-1" />
                                                        <span className="flex items-center gap-1 text-emerald-500/80">
                                                            <Zap className="w-3 h-3" />
                                                            {preset.skills.length} 技能
                                                        </span>
                                                    </>
                                                )}
                                            </div>

                                            {/* Tags */}
                                            <div className="flex flex-wrap gap-1.5 mt-auto">
                                                {preset.tags?.map(tag => (
                                                    <span
                                                        key={tag}
                                                        className="px-1.5 py-0.5 bg-secondary/60 border border-border/60 text-[10px] text-muted-foreground rounded-md"
                                                    >
                                                        #{tag}
                                                    </span>
                                                ))}
                                            </div>

                                            {/* Background decoration */}
                                            <div className={cn(
                                                "absolute -right-3 -bottom-3 transition-opacity",
                                                isActive ? "opacity-[0.06]" : "opacity-[0.02] group-hover:opacity-[0.04]"
                                            )}>
                                                <IconComponent className="w-20 h-20" />
                                            </div>

                                            {/* Active indicator bar */}
                                            {isActive && (
                                                <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-primary/60 via-primary to-primary/60 rounded-b-2xl" />
                                            )}
                                        </button>
                                    );
                                })
                            ) : (
                                <div className="col-span-full py-16 text-center bg-muted/20 border border-dashed border-border rounded-2xl flex flex-col items-center">
                                    <Search className="w-10 h-10 text-muted-foreground/30 mb-3" />
                                    <p className="text-muted-foreground text-sm">找不到符合條件的樣板</p>
                                    <button
                                        onClick={() => { setSearchTerm(""); setSelectedTag(null); }}
                                        className="text-primary text-sm mt-2 hover:underline flex items-center gap-1"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                        清除所有過濾條件
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Skills reference legend */}
                        {Object.keys(SKILL_META).length > 0 && (
                            <div className="bg-card/40 border border-border/60 rounded-2xl p-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <Zap className="w-3.5 h-3.5 text-muted-foreground" />
                                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">技能說明</p>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {Object.entries(SKILL_META).map(([key, meta]) => {
                                        const Icon = meta.icon;
                                        return (
                                            <div key={key} className="flex items-start gap-2 text-xs text-muted-foreground">
                                                <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary/70" />
                                                <div>
                                                    <span className="font-medium text-foreground/80">{meta.label}</span>
                                                    <span className="text-muted-foreground/70 ml-1">— {meta.desc}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
