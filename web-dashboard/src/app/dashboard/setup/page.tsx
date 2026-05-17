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
    AlertCircle, FolderOpen, ArrowUp, RotateCcw, HardDrive,
    Copy, SkipForward
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiGet, apiPost } from "@/lib/api-client";
import { socket } from "@/lib/socket";

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

interface MemoryBrowseEntry {
    name: string;
    path: string;
    hasMemory?: boolean;
}

interface MemoryBrowseResponse {
    currentPath: string;
    parentPath: string | null;
    entries: MemoryBrowseEntry[];
    hasMemory?: boolean;
    memoryPath?: string | null;
    roots?: { label: string; path: string }[];
}

interface MemoryImportResponse {
    success?: boolean;
    error?: string;
    sourcePath?: string;
    targetPath?: string;
    backupPath?: string | null;
    summary?: {
        mode?: "replace" | "merge-fallback";
        files?: number;
        directories?: number;
        bytes?: number;
        skipped?: { path: string; reason: string }[];
        copiedFromTemp?: {
            files?: number;
            directories?: number;
            bytes?: number;
            skipped?: { path: string; reason: string }[];
        };
        mergedInPlace?: {
            files?: number;
            directories?: number;
            bytes?: number;
            skipped?: { path: string; reason: string }[];
        };
    };
    lockHints?: string[];
    skipped?: { path: string; reason: string }[];
    warning?: string;
}

interface SystemBackupRestoreResponse {
    success?: boolean;
    error?: string;
    message?: string;
    summary?: {
        restoredFiles?: number;
        sections?: Record<string, number>;
    };
}

interface SystemBackupPreviewResponse {
    success?: boolean;
    error?: string;
    preview?: {
        schemaVersion?: number;
        sourceAppVersion?: string;
        createdAt?: string | null;
        migrationApplied?: string;
        sections?: {
            name: string;
            fileCount: number;
            bytes: number;
            skippedCount: number;
            restorable: boolean;
            risk: string;
        }[];
        totals?: {
            files: number;
            bytes: number;
            unrestorableSections: number;
            partialSections: number;
        };
        warnings?: string[];
    };
}

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
    "notebooklm-studio": { label: "NotebookLM Studio", desc: "NotebookLM 研究工作流與產物交付", icon: BrainCircuit },
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
    const [memoryMode, setMemoryMode] = useState<"fresh" | "reincarnate" | "backup_restore">("fresh");
    const [memoryPathInput, setMemoryPathInput] = useState("");
    const [memoryBrowser, setMemoryBrowser] = useState<MemoryBrowseResponse | null>(null);
    const [isBrowsingMemory, setIsBrowsingMemory] = useState(false);
    const [isImportingMemory, setIsImportingMemory] = useState(false);
    const [memoryImportResult, setMemoryImportResult] = useState<MemoryImportResponse | null>(null);
    const [backupFileName, setBackupFileName] = useState("");
    const [isRestoringBackup, setIsRestoringBackup] = useState(false);
    const [backupRestoreResult, setBackupRestoreResult] = useState<SystemBackupRestoreResponse | null>(null);
    const [backupPayload, setBackupPayload] = useState<unknown>(null);
    const [backupPreview, setBackupPreview] = useState<SystemBackupPreviewResponse["preview"] | null>(null);
    const [isPreviewingBackup, setIsPreviewingBackup] = useState(false);
    const [setupOperationId, setSetupOperationId] = useState<string | null>(null);
    const [showInjectOverlay, setShowInjectOverlay] = useState(false);
    const [injectProgress, setInjectProgress] = useState(0);
    const [injectMessage, setInjectMessage] = useState("初始提示詞尚在注入中，請稍後...");

    const extractSkippedItems = useCallback((result: MemoryImportResponse | null) => {
        if (!result) return [] as { path: string; reason: string }[];
        const direct = result.summary?.skipped || [];
        const fromMerge = result.summary?.mergedInPlace?.skipped || [];
        const legacy = result.skipped || [];
        return [...direct, ...fromMerge, ...legacy].slice(0, 8);
    }, []);

    const getCopiedFilesCount = useCallback((result: MemoryImportResponse | null) => {
        if (!result) return 0;
        const mode = result.summary?.mode;
        if (mode === "merge-fallback") {
            const a = Number(result.summary?.copiedFromTemp?.files || 0);
            const b = Number(result.summary?.mergedInPlace?.files || 0);
            return a + b;
        }
        return Number(result.summary?.files || 0);
    }, []);

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

    useEffect(() => {
        const onProgress = (payload: {
            golemId?: string;
            operationId?: string | null;
            progress?: number;
            message?: string;
            phase?: string;
            segmentIndex?: number | null;
            segmentTotal?: number | null;
        }) => {
            if (!setupOperationId) return;
            if ((payload.operationId || null) !== setupOperationId) return;
            if (activeGolem && payload.golemId && payload.golemId !== activeGolem) return;
            if (typeof payload.progress === "number") {
                setInjectProgress(Math.max(0, Math.min(100, Math.round(payload.progress))));
            }
            const segmentText = (payload.segmentIndex && payload.segmentTotal)
                ? `（第 ${payload.segmentIndex}/${payload.segmentTotal} 段）`
                : "";
            setInjectMessage(payload.message ? `${payload.message}${segmentText}` : "初始提示詞尚在注入中，請稍後...");
            if (payload.phase === "done" || payload.phase === "error") {
                setTimeout(() => {
                    setShowInjectOverlay(false);
                    setSetupOperationId(null);
                }, 800);
            }
        };
        socket.on("setup:inject_progress", onProgress);
        return () => {
            socket.off("setup:inject_progress", onProgress);
        };
    }, [activeGolem, setupOperationId]);

    const applyPreset = useCallback((preset: Preset) => {
        setActivePresetId(preset.id);
        setAiName(preset.aiName);
        setUserName(preset.userName);
        setRole(preset.role);
        setTone(preset.tone);
        setSkills(preset.skills || []);
    }, []);

    useEffect(() => {
        if (templates.length > 0 && !activePresetId) {
            applyPreset(templates[0]);
        }
    }, [activePresetId, applyPreset, templates]);

    const toggleSkill = useCallback((skill: string) => {
        setSkills(prev =>
            prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]
        );
    }, []);

    const browseMemoryPath = useCallback(async (targetPath?: string) => {
        try {
            setIsBrowsingMemory(true);
            const query = targetPath ? `?path=${encodeURIComponent(targetPath)}` : "";
            const data = await apiGet<MemoryBrowseResponse>(`/api/golems/memory-reincarnation/browse${query}`);
            setMemoryBrowser(data);
            setMemoryPathInput(data.currentPath);
        } catch (e) {
            const message = e instanceof Error ? e.message : "無法讀取資料夾";
            toast.error("資料夾瀏覽失敗", message);
        } finally {
            setIsBrowsingMemory(false);
        }
    }, [toast]);

    const importReincarnatedMemory = useCallback(async () => {
        if (!memoryPathInput.trim()) {
            toast.error("缺少來源資料夾", "請選擇或輸入舊專案資料夾路徑。");
            return;
        }

        try {
            setIsImportingMemory(true);
            setMemoryImportResult(null);
            const data = await apiPost<MemoryImportResponse>("/api/golems/memory-reincarnation/import", {
                sourcePath: memoryPathInput.trim(),
            });

            if (data.success) {
                setMemoryImportResult(data);
                const skippedCount = extractSkippedItems(data).length;
                const copiedFiles = getCopiedFilesCount(data);
                if (skippedCount > 0) {
                    toast.warning("記憶轉生部分完成", `已複製 ${copiedFiles} 個檔案，另有 ${skippedCount} 個項目因權限或特殊類型被跳過。`);
                } else {
                    toast.success("記憶轉生完成", `已複製 ${copiedFiles} 個記憶檔案。`);
                }
            } else {
                setMemoryImportResult(data);
                toast.error("記憶轉生失敗", data.error || "無法複製舊記憶。");
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : "匯入過程中發生錯誤";
            toast.error("記憶轉生失敗", message);
        } finally {
            setIsImportingMemory(false);
        }
    }, [extractSkippedItems, getCopiedFilesCount, memoryPathInput, toast]);

    const stopGolemAndRetryMemoryImport = useCallback(async () => {
        if (!activeGolem) {
            toast.error("無法停止 Golem", "目前沒有可停止的 Golem 實例。");
            return;
        }
        try {
            setIsImportingMemory(true);
            await apiPost("/api/golems/stop", { id: activeGolem });
            toast.success("已停止 Golem", "已嘗試釋放記憶體與瀏覽器鎖定，準備重試轉生。");
            await importReincarnatedMemory();
        } catch (e) {
            const message = e instanceof Error ? e.message : "停止 Golem 失敗";
            toast.error("停止 Golem 失敗", message);
        } finally {
            setIsImportingMemory(false);
        }
    }, [activeGolem, importReincarnatedMemory, toast]);

    const handlePreviewBackupFromFile = useCallback(async (file: File) => {
        try {
            setIsPreviewingBackup(true);
            setBackupRestoreResult(null);
            setBackupPreview(null);
            setBackupFileName(file.name);
            const text = await file.text();
            const payload = JSON.parse(text);
            setBackupPayload(payload);
            const data = await apiPost<SystemBackupPreviewResponse>("/api/system/backup/restore/preview", payload);
            if (data.success && data.preview) {
                setBackupPreview(data.preview);
                toast.success("預檢完成", "請確認可還原項目與風險後再執行還原。");
            } else {
                toast.error("預檢失敗", data.error || "無法解析備份檔");
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : "備份檔解析或預檢失敗";
            setBackupRestoreResult({ success: false, error: message });
            toast.error("預檢失敗", message);
        } finally {
            setIsPreviewingBackup(false);
        }
    }, [toast]);

    const handleConfirmRestoreBackup = useCallback(async () => {
        if (!backupPayload) {
            toast.error("還原失敗", "請先選擇備份檔並完成預檢。");
            return;
        }
        try {
            setIsRestoringBackup(true);
            const data = await apiPost<SystemBackupRestoreResponse>("/api/system/backup/restore", backupPayload);
            setBackupRestoreResult(data);
            if (data.success) {
                const restored = Number(data.summary?.restoredFiles || 0);
                toast.success("備份還原完成", `已還原 ${restored} 個檔案。`);
            } else {
                toast.error("備份還原失敗", data.error || "無法還原備份檔");
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : "備份檔還原失敗";
            setBackupRestoreResult({ success: false, error: message });
            toast.error("備份還原失敗", message);
        } finally {
            setIsRestoringBackup(false);
        }
    }, [backupPayload, toast]);

    // Extra skills that exist in ALL_AVAILABLE_SKILLS but not in the template
    const extraSkillsToShow = ALL_AVAILABLE_SKILLS.filter(s => !skills.includes(s));

    const handleSubmit = async () => {
        if (!activeGolem) return;

        if (!aiName.trim() || !userName.trim()) {
            toast.error("欄位缺失", "請填寫 AI 名稱與您的稱呼");
            return;
        }

        if (memoryMode === "reincarnate" && !memoryImportResult?.success) {
            toast.warning("尚未完成記憶轉生", "請先匯入舊記憶，或選擇略過並開啟全新代理人。");
            return;
        }
        if (memoryMode === "backup_restore" && !backupRestoreResult?.success) {
            toast.warning("尚未完成備份還原", "請先匯入備份檔並完成還原。");
            return;
        }

        try {
            setIsLoading(true);
            const operationId = `setup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            setSetupOperationId(operationId);
            setInjectProgress(3);
            setInjectMessage("正在啟動核心，準備注入初始提示詞...");
            setShowInjectOverlay(true);
            const data = await apiPost<{ success?: boolean; error?: string }>("/api/golems/setup", {
                golemId: activeGolem,
                aiName,
                userName,
                currentRole: role,
                tone,
                skills,
                operationId,
            });

            if (data.success) {
                await refreshGolems();
                router.push("/dashboard");
            } else {
                setShowInjectOverlay(false);
                setSetupOperationId(null);
                toast.error("建立失敗", data.error || "建立失敗");
            }
        } catch {
            setShowInjectOverlay(false);
            setSetupOperationId(null);
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
        <div className="flex-1 overflow-auto bg-background p-4 md:p-6 flex flex-col text-foreground relative">
            {showInjectOverlay && (
                <div className="fixed inset-0 z-[120] bg-black/65 backdrop-blur-sm flex items-center justify-center px-4">
                    <div className="w-full max-w-lg rounded-2xl border border-primary/30 bg-card/95 p-6 shadow-2xl">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
                                <Sparkles className="w-4 h-4 text-primary animate-pulse" />
                            </div>
                            <p className="text-sm md:text-base font-semibold text-foreground">
                                初始提示詞尚在注入中，請稍後...
                            </p>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">{injectMessage}</p>
                        <div className="h-2 w-full rounded-full bg-secondary/60 overflow-hidden border border-border">
                            <div
                                className="h-full bg-gradient-to-r from-cyan-400 via-primary to-emerald-400 transition-all duration-300"
                                style={{ width: `${injectProgress}%` }}
                            />
                        </div>
                        <div className="mt-2 text-right text-xs text-primary font-mono">{injectProgress}%</div>
                    </div>
                </div>
            )}
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
                    <div className="flex flex-wrap items-center justify-center gap-2 mt-6 text-sm">
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
                        <div className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-full border font-medium",
                            memoryImportResult?.success
                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"
                                : "bg-primary/10 border-primary/30 text-primary"
                        )}>
                            <span className={cn(
                                "w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center",
                                memoryImportResult?.success
                                    ? "bg-emerald-500 text-white"
                                    : "bg-primary text-primary-foreground"
                            )}>3</span>
                            記憶轉生
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary border border-border text-muted-foreground font-medium">
                            <span className="w-5 h-5 rounded-full bg-secondary border border-border text-muted-foreground text-[11px] font-bold flex items-center justify-center">4</span>
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

                        {/* Section 4: Memory Reincarnation */}
                        <div className="bg-card/80 backdrop-blur-sm border border-border rounded-2xl p-5 shadow-xl relative overflow-hidden">
                            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-amber-500 via-primary to-cyan-500" />
                            <div className="flex items-center justify-between gap-3 mb-4">
                                <div className="flex items-center gap-2">
                                    <RotateCcw className="w-4 h-4 text-amber-500" />
                                    <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">記憶轉生</h3>
                                </div>
                                {memoryImportResult?.success && (
                                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500 font-medium bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                                        <CheckCircle2 className="w-3 h-3" />
                                        已匯入
                                    </span>
                                )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMemoryMode("reincarnate");
                                        setBackupRestoreResult(null);
                                    }}
                                    className={cn(
                                        "text-left p-3 rounded-xl border transition-all",
                                        memoryMode === "reincarnate"
                                            ? "bg-primary/10 border-primary/40 text-foreground"
                                            : "bg-secondary/30 border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                                    )}
                                >
                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                        <Copy className="w-4 h-4 text-primary" />
                                        從舊專案帶入
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                                        選擇舊資料夾，自動複製 golem_memory。
                                    </p>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMemoryMode("fresh");
                                        setMemoryImportResult(null);
                                        setBackupRestoreResult(null);
                                    }}
                                    className={cn(
                                        "text-left p-3 rounded-xl border transition-all",
                                        memoryMode === "fresh"
                                            ? "bg-primary/10 border-primary/40 text-foreground"
                                            : "bg-secondary/30 border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                                    )}
                                >
                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                        <SkipForward className="w-4 h-4 text-primary" />
                                        略過並新生
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                                        不帶入舊記憶，開啟全新的代理人。
                                    </p>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMemoryMode("backup_restore");
                                        setMemoryImportResult(null);
                                    }}
                                    className={cn(
                                        "text-left p-3 rounded-xl border transition-all sm:col-span-2",
                                        memoryMode === "backup_restore"
                                            ? "bg-primary/10 border-primary/40 text-foreground"
                                            : "bg-secondary/30 border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                                    )}
                                >
                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                        <Copy className="w-4 h-4 text-primary" />
                                        從備份檔還原
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                                        使用一鍵備份 JSON 還原私人資料（支援 macOS / Windows / Linux）。
                                    </p>
                                </button>
                            </div>

                            <div className="p-3 bg-amber-500/10 border border-amber-500/25 rounded-xl text-xs text-amber-200/90 leading-relaxed mb-4">
                                舊版資料轉移後，部分記憶、技能索引、瀏覽器狀態或腳本功能可能因新版本結構差異而無法完整保留。
                            </div>

                            {memoryMode === "reincarnate" && (
                                <div className="space-y-3 animate-in fade-in duration-200">
                                    <div>
                                        <label htmlFor="memoryPath" className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                                            舊專案資料夾或 golem_memory 路徑
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                id="memoryPath"
                                                value={memoryPathInput}
                                                onChange={(e) => setMemoryPathInput(e.target.value)}
                                                className="min-w-0 flex-1 bg-secondary/40 border border-border rounded-xl px-4 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all placeholder:text-muted-foreground/50"
                                                placeholder="例如：/Users/you/Desktop/project-golem"
                                            />
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                onClick={() => browseMemoryPath(memoryPathInput || undefined)}
                                                disabled={isBrowsingMemory}
                                                className="shrink-0"
                                                title="瀏覽資料夾"
                                            >
                                                {isBrowsingMemory ? (
                                                    <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
                                                ) : (
                                                    <FolderOpen className="w-4 h-4" />
                                                )}
                                            </Button>
                                        </div>
                                    </div>

                                    {memoryBrowser && (
                                        <div className="border border-border/70 rounded-xl overflow-hidden bg-secondary/20">
                                            <div className="flex items-center gap-2 px-3 py-2 border-b border-border/70 text-xs text-muted-foreground">
                                                <HardDrive className="w-3.5 h-3.5" />
                                                <span className="truncate font-mono">{memoryBrowser.currentPath}</span>
                                            </div>
                                            <div className="flex flex-wrap gap-2 p-3 border-b border-border/70">
                                                {memoryBrowser.roots?.map((root) => (
                                                    <button
                                                        key={root.path}
                                                        type="button"
                                                        onClick={() => browseMemoryPath(root.path)}
                                                        className="px-2 py-1 rounded-lg bg-background/60 border border-border text-[11px] text-muted-foreground hover:text-foreground"
                                                    >
                                                        {root.label}
                                                    </button>
                                                ))}
                                                {memoryBrowser.parentPath && (
                                                    <button
                                                        type="button"
                                                        onClick={() => browseMemoryPath(memoryBrowser.parentPath || undefined)}
                                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-background/60 border border-border text-[11px] text-muted-foreground hover:text-foreground"
                                                    >
                                                        <ArrowUp className="w-3 h-3" />
                                                        上一層
                                                    </button>
                                                )}
                                            </div>
                                            <div className="max-h-52 overflow-auto p-2 space-y-1">
                                                {memoryBrowser.entries.length > 0 ? memoryBrowser.entries.map((entry) => (
                                                    <button
                                                        key={entry.path}
                                                        type="button"
                                                        onClick={() => browseMemoryPath(entry.path)}
                                                        className={cn(
                                                            "w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-xs transition-colors",
                                                            entry.hasMemory
                                                                ? "bg-primary/10 text-primary border border-primary/30"
                                                                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                                                        )}
                                                    >
                                                        <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                                                        <span className="truncate flex-1">{entry.name}</span>
                                                        {entry.hasMemory && <span className="text-[10px] font-semibold">golem_memory</span>}
                                                    </button>
                                                )) : (
                                                    <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                                                        此層沒有可瀏覽的資料夾
                                                    </div>
                                                )}
                                            </div>
                                            {memoryBrowser.hasMemory && (
                                                <div className="px-3 py-2 bg-primary/10 border-t border-primary/20 text-xs text-primary">
                                                    已偵測到可轉生記憶：{memoryBrowser.memoryPath}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {memoryImportResult?.success && (
                                        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 leading-relaxed">
                                            已從舊專案複製 {getCopiedFilesCount(memoryImportResult)} 個檔案到新專案記憶庫。
                                            {memoryImportResult.summary?.mode === "merge-fallback" && (
                                                <span className="block mt-1 text-amber-200">
                                                    偵測到 Windows/瀏覽器鎖定，已改用「就地合併」模式完成轉生。
                                                </span>
                                            )}
                                            {memoryImportResult.backupPath && (
                                                <span className="block mt-1 text-emerald-300/75">原本的新專案記憶已備份：{memoryImportResult.backupPath}</span>
                                            )}
                                            {(extractSkippedItems(memoryImportResult).length ?? 0) > 0 && (
                                                <span className="block mt-2 text-amber-200">
                                                    有 {extractSkippedItems(memoryImportResult).length} 個項目因權限或特殊檔案類型被跳過：
                                                    {extractSkippedItems(memoryImportResult).slice(0, 3).map((item) => ` ${item.path} (${item.reason})`).join("；")}
                                                </span>
                                            )}
                                            {(memoryImportResult.lockHints?.length ?? 0) > 0 && (
                                                <span className="block mt-2 text-amber-200">
                                                    可能鎖定檔案：
                                                    {memoryImportResult.lockHints?.slice(0, 3).map((item) => ` ${item}`).join("；")}
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {!memoryImportResult?.success && (memoryImportResult?.skipped?.length ?? 0) > 0 && (
                                        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-300 leading-relaxed">
                                            無法讀取舊記憶資料夾。第一批被跳過項目：
                                            {memoryImportResult?.skipped?.slice(0, 3).map((item) => ` ${item.path} (${item.reason})`).join("；")}
                                        </div>
                                    )}

                                    <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={importReincarnatedMemory}
                                        disabled={isImportingMemory || !memoryPathInput.trim()}
                                        className="w-full"
                                    >
                                        {isImportingMemory ? (
                                            <span className="flex items-center gap-2">
                                                <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
                                                正在拷貝舊記憶...
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-2">
                                                <RotateCcw className="w-4 h-4" />
                                                執行記憶轉生
                                            </span>
                                        )}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={stopGolemAndRetryMemoryImport}
                                        disabled={isImportingMemory || !memoryPathInput.trim() || !activeGolem}
                                        className="w-full"
                                    >
                                        <span className="flex items-center gap-2">
                                            <HardDrive className="w-4 h-4" />
                                            先停止 Golem 並重試轉生
                                        </span>
                                    </Button>
                                </div>
                            )}
                            {memoryMode === "backup_restore" && (
                                <div className="space-y-3 animate-in fade-in duration-200">
                                    <label className="block">
                                        <span className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">備份檔案 (JSON)</span>
                                        <input
                                            type="file"
                                            accept="application/json,.json"
                                            disabled={isRestoringBackup || isPreviewingBackup}
                                            onChange={(event) => {
                                                const file = event.target.files?.[0];
                                                if (!file) return;
                                                void handlePreviewBackupFromFile(file);
                                            }}
                                            className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-secondary/60 file:px-3 file:py-2 file:text-xs file:text-foreground hover:file:bg-secondary"
                                        />
                                    </label>
                                    {backupFileName && (
                                        <p className="text-xs text-muted-foreground">已選檔案：{backupFileName}</p>
                                    )}
                                    {isPreviewingBackup && (
                                        <div className="p-3 bg-primary/10 border border-primary/30 rounded-xl text-xs text-primary">
                                            正在預檢備份檔，請稍候...
                                        </div>
                                    )}
                                    {backupPreview && (
                                        <div className="p-3 bg-secondary/30 border border-border rounded-xl text-xs text-muted-foreground space-y-2">
                                            <p>來源版本：{backupPreview.sourceAppVersion || "unknown"} | Schema：v{backupPreview.schemaVersion} | Migration：{backupPreview.migrationApplied || "none"}</p>
                                            <p>可處理檔案：{backupPreview.totals?.files ?? 0}，不可還原區段：{backupPreview.totals?.unrestorableSections ?? 0}，部分還原風險區段：{backupPreview.totals?.partialSections ?? 0}</p>
                                            {(backupPreview.warnings || []).length > 0 && (
                                                <p className="text-amber-300">{(backupPreview.warnings || []).join(" ")}</p>
                                            )}
                                            {(backupPreview.sections || []).length > 0 && (
                                                <div className="mt-2 border border-border/70 rounded-lg overflow-hidden">
                                                    <div className="grid grid-cols-12 gap-2 px-2 py-1.5 bg-background/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                                                        <div className="col-span-4">Section</div>
                                                        <div className="col-span-2 text-right">檔案數</div>
                                                        <div className="col-span-2 text-right">大小</div>
                                                        <div className="col-span-2 text-right">跳過</div>
                                                        <div className="col-span-2 text-right">狀態</div>
                                                    </div>
                                                    {(backupPreview.sections || []).map((section) => {
                                                        const riskClass = section.restorable
                                                            ? (section.risk === "partial" ? "text-amber-300" : "text-emerald-300")
                                                            : "text-rose-300";
                                                        const statusText = section.restorable
                                                            ? (section.risk === "partial" ? "部分還原" : "可還原")
                                                            : "不可還原";
                                                        return (
                                                            <div key={section.name} className="grid grid-cols-12 gap-2 px-2 py-1.5 border-t border-border/50 text-[11px]">
                                                                <div className="col-span-4 text-foreground truncate" title={section.name}>{section.name}</div>
                                                                <div className="col-span-2 text-right text-foreground">{section.fileCount}</div>
                                                                <div className="col-span-2 text-right text-foreground">{formatBytes(section.bytes)}</div>
                                                                <div className="col-span-2 text-right text-muted-foreground">{section.skippedCount}</div>
                                                                <div className={`col-span-2 text-right font-medium ${riskClass}`}>{statusText}</div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {isRestoringBackup && (
                                        <div className="p-3 bg-primary/10 border border-primary/30 rounded-xl text-xs text-primary">
                                            正在還原備份檔，請稍候...
                                        </div>
                                    )}
                                    {backupRestoreResult?.success && (
                                        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 leading-relaxed">
                                            還原完成，已還原 {Number(backupRestoreResult.summary?.restoredFiles || 0)} 個檔案。
                                        </div>
                                    )}
                                    {backupRestoreResult && backupRestoreResult.success === false && (
                                        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-300 leading-relaxed">
                                            還原失敗：{backupRestoreResult.error || "未知錯誤"}
                                        </div>
                                    )}
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={handleConfirmRestoreBackup}
                                        disabled={!backupPreview || isRestoringBackup || isPreviewingBackup}
                                        className="w-full"
                                    >
                                        確認還原備份
                                    </Button>
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
