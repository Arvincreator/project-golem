"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    BookHeart,
    Sparkles,
    RefreshCcw,
    UserRound,
    Bot,
    HeartHandshake,
    Send,
    Trash2,
    PenSquare,
    Brain,
    Lightbulb,
    Flame,
    Link2,
    Gauge,
    Reply,
    CalendarDays,
    Trophy,
    ArchiveRestore,
    Download,
    AlertTriangle,
} from "lucide-react";
import { useGolem } from "@/components/GolemContext";
import { apiGet, apiPostWrite, apiWrite } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast-provider";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/I18nProvider";

type DiaryEntryType = "ai_diary" | "ai_thought" | "ai_summary" | "user_diary";
type FeedViewMode = "timeline" | "threads" | "weekly";

type DiaryEntry = {
    id: string;
    golemId: string;
    entryType: DiaryEntryType;
    author: string;
    content: string;
    shared: boolean;
    replyToId?: string | null;
    iteration?: number;
    mood?: string | null;
    tags?: string[];
    createdAt: string;
};

type DiaryStats = {
    totalEntries: number;
    aiEntries: number;
    userEntries: number;
    exchangeReplies: number;
    streakDays: number;
    bondScore: number;
    bondLevel: string;
};

type DiaryRotation = {
    skipped?: boolean;
    reason?: string;
    createdWeekly?: number;
    createdMonthly?: number;
    createdYearly?: number;
    prunedRawEntries?: number;
    prunedWeeklySummaries?: number;
    prunedMonthlySummaries?: number;
    policy?: {
        rawDays?: number;
        weeklyDays?: number;
        monthlyDays?: number;
    };
};

type RotationHistoryItem = {
    id: number;
    timestamp: number;
    mode: string;
    details?: DiaryRotation;
};

type RotationHistoryResponse = {
    success?: boolean;
    history?: RotationHistoryItem[];
    error?: string;
};

type DiaryBackupItem = {
    file: string;
    bytes: number;
    createdAt: string;
    modifiedAt?: string;
};

type DiaryBackupPolicy = {
    maxFiles?: number;
    retentionDays?: number;
};

type DiaryBackupCleanup = {
    removedCount?: number;
    removedFiles?: string[];
    policy?: DiaryBackupPolicy;
};

type DiaryBackupsResponse = {
    success?: boolean;
    backups?: DiaryBackupItem[];
    policy?: DiaryBackupPolicy;
    cleanup?: DiaryBackupCleanup;
    error?: string;
};

type DiarySnapshotSummary = {
    file?: string;
    bytes?: number;
    modifiedAt?: string | null;
    totalEntries?: number;
    userEntries?: number;
    aiDiaryEntries?: number;
    aiThoughtEntries?: number;
    aiSummaryEntries?: number;
    earliestAt?: string | null;
    latestAt?: string | null;
    spanDays?: number;
};

type DiaryRestorePreview = {
    backupFile: string;
    current: DiarySnapshotSummary;
    backup: DiarySnapshotSummary;
    delta: {
        totalEntries?: number;
        userEntries?: number;
        aiDiaryEntries?: number;
        aiThoughtEntries?: number;
        aiSummaryEntries?: number;
    };
    risk?: {
        potentialOverwrite?: boolean;
        currentNewer?: boolean;
        note?: string;
    };
};

type DiaryRestorePreviewResponse = {
    success?: boolean;
    preview?: DiaryRestorePreview;
    error?: string;
};

type DiaryBackupMutationResponse = {
    success?: boolean;
    error?: string;
    backup?: DiaryBackupItem;
    restoredFile?: string;
    stats?: DiaryStats;
    rotation?: DiaryRotation;
    cleanup?: DiaryBackupCleanup;
    backupCleanup?: DiaryBackupCleanup;
};

type DiaryResponse = {
    success?: boolean;
    entries?: DiaryEntry[];
    total?: number;
    stats?: DiaryStats;
    rotation?: DiaryRotation;
    error?: string;
};

type DiaryMutationResponse = {
    success?: boolean;
    entry?: DiaryEntry;
    unlockEntry?: DiaryEntry;
    unlockedBondLevels?: string[];
    error?: string;
    stats?: DiaryStats;
    rotation?: DiaryRotation;
    deletedId?: string;
    deletedCount?: number;
    period?: {
        from?: string;
        to?: string;
    };
};

const ENTRY_TYPE_OPTIONS: Array<{ value: DiaryEntryType; label: string; hint: string }> = [
    { value: "user_diary", label: "使用者日記", hint: "你寫給 AI 的心情與想法" },
    { value: "ai_diary", label: "AI 日記", hint: "AI 以第一人稱記錄今天" },
    { value: "ai_thought", label: "AI 對使用者的想法", hint: "AI 想對你說的話" },
];

const FILTER_OPTIONS: Array<{ value: "all" | DiaryEntryType | "threaded"; label: string }> = [
    { value: "all", label: "全部" },
    { value: "user_diary", label: "使用者日記" },
    { value: "ai_diary", label: "AI 日記" },
    { value: "ai_thought", label: "AI 想法" },
    { value: "ai_summary", label: "AI 摘要" },
    { value: "threaded", label: "迭代串接" },
];

const VIEW_OPTIONS: Array<{ value: FeedViewMode; label: string }> = [
    { value: "timeline", label: "時間軸" },
    { value: "threads", label: "迭代對話樹" },
    { value: "weekly", label: "每週摘要歷史" },
];

function typeBadge(entryType: DiaryEntryType) {
    if (entryType === "ai_diary") {
        return "bg-cyan-500/10 border-cyan-500/30 text-cyan-400";
    }
    if (entryType === "ai_thought") {
        return "bg-amber-500/10 border-amber-500/30 text-amber-300";
    }
    if (entryType === "ai_summary") {
        return "bg-rose-500/10 border-rose-500/30 text-rose-300";
    }
    return "bg-emerald-500/10 border-emerald-500/30 text-emerald-400";
}

function typeLabel(entryType: DiaryEntryType) {
    if (entryType === "ai_diary") return "AI 日記";
    if (entryType === "ai_thought") return "AI 想法";
    if (entryType === "ai_summary") return "AI 摘要";
    return "使用者日記";
}

function emptyStats(): DiaryStats {
    return {
        totalEntries: 0,
        aiEntries: 0,
        userEntries: 0,
        exchangeReplies: 0,
        streakDays: 0,
        bondScore: 0,
        bondLevel: "萌芽",
    };
}

function formatTime(value: string) {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return value;
    return new Date(parsed).toLocaleString("zh-TW", { hour12: false });
}

function formatBytes(bytes: number) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function formatSigned(value: number) {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed) || parsed === 0) return "0";
    return parsed > 0 ? `+${parsed}` : `${parsed}`;
}

function toTimestamp(value: string) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function extractWeekTagLabel(entry: DiaryEntry) {
    const weekTag = Array.isArray(entry.tags)
        ? entry.tags.find((tag) => String(tag).startsWith("week_"))
        : null;
    if (!weekTag) return null;

    const raw = weekTag.slice(5);
    if (!/^\d{8}$/.test(raw)) return null;
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function extractGolemReplyOnly(rawText: string) {
    const text = String(rawText || "").trim();
    if (!text) return "";

    const cleaned = text.replace(/^🤖\s*\[Golem\]\s*說:\s*/i, "").trim();
    const hasTitanTags = /\[GOLEM_(MEMORY|ACTION|REPLY)\]/i.test(cleaned);
    const replyMatch = cleaned.match(/\[GOLEM_REPLY\]([\s\S]*?)(?=\[\/?GOLEM_[A-Z]+\]|$)/i);

    if (replyMatch && replyMatch[1]) {
        return replyMatch[1].trim();
    }
    if (hasTitanTags) {
        return "";
    }
    return cleaned;
}

export default function DiaryPage() {
    const toast = useToast();
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    const { activeGolem } = useGolem();

    const [entries, setEntries] = useState<DiaryEntry[]>([]);
    const [stats, setStats] = useState<DiaryStats>(emptyStats);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isGeneratingDiary, setIsGeneratingDiary] = useState(false);
    const [isGeneratingThought, setIsGeneratingThought] = useState(false);
    const [isGeneratingWeeklySummary, setIsGeneratingWeeklySummary] = useState(false);
    const [isRotating, setIsRotating] = useState(false);
    const [isBackupLoading, setIsBackupLoading] = useState(false);
    const [isCreatingBackup, setIsCreatingBackup] = useState(false);
    const [isCleaningBackups, setIsCleaningBackups] = useState(false);
    const [restoringBackupFile, setRestoringBackupFile] = useState<string | null>(null);
    const [previewingBackupFile, setPreviewingBackupFile] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [replyingEntryId, setReplyingEntryId] = useState<string | null>(null);
    const [rotation, setRotation] = useState<DiaryRotation | null>(null);
    const [rotationHistory, setRotationHistory] = useState<RotationHistoryItem[]>([]);
    const [backupItems, setBackupItems] = useState<DiaryBackupItem[]>([]);
    const [backupPolicy, setBackupPolicy] = useState<DiaryBackupPolicy | null>(null);
    const [restorePreview, setRestorePreview] = useState<DiaryRestorePreview | null>(null);
    const [restoreConfirmFile, setRestoreConfirmFile] = useState<string | null>(null);
    const [backupLabel, setBackupLabel] = useState("");

    const [entryType, setEntryType] = useState<DiaryEntryType>("user_diary");
    const [manualContent, setManualContent] = useState("");
    const [aiTopic, setAiTopic] = useState("");
    const [manualMood, setManualMood] = useState("");
    const [manualTags, setManualTags] = useState("");
    const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
    const [feedView, setFeedView] = useState<FeedViewMode>("timeline");
    const [feedFilter, setFeedFilter] = useState<"all" | DiaryEntryType | "threaded">("all");
    const [selectedWeeklySummaryId, setSelectedWeeklySummaryId] = useState<string | null>(null);

    const entryTypeOptions = useMemo<Array<{ value: DiaryEntryType; label: string; hint: string }>>(() => ([
        {
            value: "user_diary",
            label: isEnglish ? "User Diary" : "使用者日記",
            hint: isEnglish ? "Your thoughts and feelings for AI" : "你寫給 AI 的心情與想法",
        },
        {
            value: "ai_diary",
            label: isEnglish ? "AI Diary" : "AI 日記",
            hint: isEnglish ? "AI records today in first person" : "AI 以第一人稱記錄今天",
        },
        {
            value: "ai_thought",
            label: isEnglish ? "AI Thoughts About User" : "AI 對使用者的想法",
            hint: isEnglish ? "What AI wants to tell you" : "AI 想對你說的話",
        },
    ]), [isEnglish]);

    const filterOptions = useMemo<Array<{ value: "all" | DiaryEntryType | "threaded"; label: string }>>(() => ([
        { value: "all", label: isEnglish ? "All" : "全部" },
        { value: "user_diary", label: isEnglish ? "User Diary" : "使用者日記" },
        { value: "ai_diary", label: isEnglish ? "AI Diary" : "AI 日記" },
        { value: "ai_thought", label: isEnglish ? "AI Thoughts" : "AI 想法" },
        { value: "ai_summary", label: isEnglish ? "AI Summary" : "AI 摘要" },
        { value: "threaded", label: isEnglish ? "Threaded" : "迭代串接" },
    ]), [isEnglish]);

    const viewOptions = useMemo<Array<{ value: FeedViewMode; label: string }>>(() => ([
        { value: "timeline", label: isEnglish ? "Timeline" : "時間軸" },
        { value: "threads", label: isEnglish ? "Conversation Tree" : "迭代對話樹" },
        { value: "weekly", label: isEnglish ? "Weekly Summaries" : "每週摘要歷史" },
    ]), [isEnglish]);

    const resolveTypeLabel = useCallback((entryType: DiaryEntryType) => {
        if (entryType === "ai_diary") return isEnglish ? "AI Diary" : "AI 日記";
        if (entryType === "ai_thought") return isEnglish ? "AI Thoughts" : "AI 想法";
        if (entryType === "ai_summary") return isEnglish ? "AI Summary" : "AI 摘要";
        return isEnglish ? "User Diary" : "使用者日記";
    }, [isEnglish]);

    const withGolemId = useCallback((path: string) => {
        if (!activeGolem) return path;
        const divider = path.includes("?") ? "&" : "?";
        return `${path}${divider}golemId=${encodeURIComponent(activeGolem)}`;
    }, [activeGolem]);

    const loadDiary = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await apiGet<DiaryResponse>(withGolemId("/api/diary"));
            if (data.success && Array.isArray(data.entries)) {
                setEntries(data.entries);
                if (data.stats) setStats(data.stats);
                if (data.rotation) setRotation(data.rotation);
                return;
            }
            setEntries([]);
            setStats(emptyStats());
            setRotation(null);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "讀取失敗";
            toast.error("讀取日記失敗", message);
        } finally {
            setIsLoading(false);
        }
    }, [toast, withGolemId]);

    useEffect(() => {
        loadDiary();
    }, [loadDiary]);

    const loadBackupAndRotation = useCallback(async (silent = true) => {
        if (!activeGolem) {
            setRotationHistory([]);
            setBackupItems([]);
            setBackupPolicy(null);
            setRestorePreview(null);
            return;
        }

        setIsBackupLoading(true);
        try {
            const [historyData, backupsData] = await Promise.all([
                apiGet<RotationHistoryResponse>(withGolemId("/api/diary/rotation/history?limit=40")),
                apiGet<DiaryBackupsResponse>(withGolemId("/api/diary/backups")),
            ]);

            if (historyData.success && Array.isArray(historyData.history)) {
                setRotationHistory(historyData.history);
            } else {
                setRotationHistory([]);
            }

            if (backupsData.success && Array.isArray(backupsData.backups)) {
                setBackupItems(backupsData.backups);
                setBackupPolicy(backupsData.policy || null);
                setRestorePreview((previous) => {
                    if (!previous) return null;
                    return backupsData.backups?.some((item) => item.file === previous.backupFile)
                        ? previous
                        : null;
                });
            } else {
                setBackupItems([]);
                setBackupPolicy(null);
                setRestorePreview(null);
            }
        } catch (error: unknown) {
            if (!silent) {
                const message = error instanceof Error ? error.message : "讀取備份資訊失敗";
                toast.error("讀取日記備份失敗", message);
            }
        } finally {
            setIsBackupLoading(false);
        }
    }, [activeGolem, toast, withGolemId]);

    useEffect(() => {
        loadBackupAndRotation(true);
    }, [loadBackupAndRotation]);

    const applyMutationResult = useCallback(
        (data: DiaryMutationResponse, successTitle: string, successMessage: string) => {
            if (!data.success || !data.entry) {
                toast.error("操作失敗", data.error || "操作失敗，請稍後重試。");
                return false;
            }

            setEntries((prev) => {
                const seen = new Set(prev.map((entry) => entry.id));
                const next = [...prev];
                const prepend: DiaryEntry[] = [];

                for (const candidate of [data.unlockEntry, data.entry]) {
                    if (!candidate || !candidate.id) continue;
                    if (seen.has(candidate.id)) continue;
                    seen.add(candidate.id);
                    prepend.push(candidate as DiaryEntry);
                }

                return prepend.length > 0 ? [...prepend, ...next] : next;
            });

            if (data.stats) setStats(data.stats);
            if (data.rotation) setRotation(data.rotation);

            if (Array.isArray(data.unlockedBondLevels) && data.unlockedBondLevels.length > 0) {
                toast.success(
                    "羈絆等級提升",
                    `已解鎖：${data.unlockedBondLevels.join("、")}`
                );
            }

            toast.success(successTitle, successMessage);
            return true;
        },
        [toast]
    );

    const handleCreateManualEntry = async () => {
        const content = manualContent.trim();
        if (!content) {
            toast.warning("內容是空的", "請先輸入一段日記內容。");
            return;
        }

        setIsSaving(true);
        try {
            const data = await apiPostWrite<DiaryMutationResponse>(
                withGolemId("/api/diary"),
                {
                    entryType,
                    content,
                    shared: true,
                    mood: manualMood || undefined,
                    tags: manualTags || undefined,
                    replyToId: replyTargetId || undefined,
                }
            );
            const created = applyMutationResult(data, "新增成功", "日記已寫入交換牆。");
            if (!created) return;
            setManualContent("");
            setManualMood("");
            setManualTags("");
            setReplyTargetId(null);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "新增失敗";
            toast.error("儲存失敗", message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleGenerateByAi = async (targetType: "ai_diary" | "ai_thought") => {
        if (!activeGolem) {
            toast.warning("尚未選擇 Golem", "請先在側邊欄選擇一個活躍節點，再讓 AI 生成日記。");
            return;
        }
        if (targetType === "ai_diary") setIsGeneratingDiary(true);
        if (targetType === "ai_thought") setIsGeneratingThought(true);
        try {
            const data = await apiPostWrite<DiaryMutationResponse>(
                withGolemId("/api/diary/generate"),
                {
                    entryType: targetType,
                    topic: aiTopic.trim() || undefined,
                    replyToId: replyTargetId || undefined,
                }
            );
            const created = applyMutationResult(
                data,
                "AI 已寫好日記",
                targetType === "ai_diary" ? "已新增 AI 日記。" : "已新增 AI 對你的想法。"
            );
            if (!created) return;
            setReplyTargetId(null);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "生成失敗";
            toast.error("AI 生成失敗", message);
        } finally {
            if (targetType === "ai_diary") setIsGeneratingDiary(false);
            if (targetType === "ai_thought") setIsGeneratingThought(false);
        }
    };

    const handleDeleteEntry = async (entryId: string) => {
        if (!window.confirm("確定要刪除這篇日記嗎？")) return;
        setDeletingId(entryId);
        try {
            const data = await apiWrite<{ success?: boolean; error?: string; stats?: DiaryStats; rotation?: DiaryRotation }>(
                withGolemId(`/api/diary/${encodeURIComponent(entryId)}`),
                { method: "DELETE", retry: { profile: "write" } }
            );
            if (!data.success) {
                toast.error("刪除失敗", data.error || "找不到該日記。");
                return;
            }
            setEntries((prev) => prev.filter((entry) => entry.id !== entryId));
            if (data.stats) setStats(data.stats);
            if (data.rotation) setRotation(data.rotation);
            if (replyTargetId === entryId) setReplyTargetId(null);
            toast.success("刪除完成", "這篇日記已移除。");
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "刪除失敗";
            toast.error("刪除失敗", message);
        } finally {
            setDeletingId(null);
        }
    };

    const handleAiReply = async (entryId: string) => {
        if (!activeGolem) {
            toast.warning("尚未選擇 Golem", "請先在側邊欄選擇活躍節點。");
            return;
        }
        setReplyingEntryId(entryId);
        try {
            const data = await apiPostWrite<DiaryMutationResponse>(
                withGolemId("/api/diary/reply"),
                {
                    targetEntryId: entryId,
                    entryType: "ai_thought",
                    topic: aiTopic.trim() || undefined,
                }
            );
            applyMutationResult(data, "AI 已回信", "已新增一篇接續回覆。");
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "回覆失敗";
            toast.error("AI 回信失敗", message);
        } finally {
            setReplyingEntryId(null);
        }
    };

    const handleGenerateWeeklySummary = async () => {
        if (!activeGolem) {
            toast.warning("尚未選擇 Golem", "請先在側邊欄選擇一個活躍節點。");
            return;
        }

        setIsGeneratingWeeklySummary(true);
        try {
            const data = await apiPostWrite<DiaryMutationResponse>(
                withGolemId("/api/diary/summary/weekly"),
                {
                    topic: aiTopic.trim() || undefined,
                }
            );
            const created = applyMutationResult(data, "每週摘要已生成", "已新增本週羈絆回顧。");
            if (!created) return;

            if (data.period && data.period.from && data.period.to) {
                const fromLabel = formatTime(data.period.from);
                const toLabel = formatTime(data.period.to);
                toast.success("摘要期間", `${fromLabel} - ${toLabel}`);
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "生成失敗";
            toast.error("每週摘要失敗", message);
        } finally {
            setIsGeneratingWeeklySummary(false);
        }
    };

    const handleForceRotate = async () => {
        if (!activeGolem) {
            toast.warning("尚未選擇 Golem", "請先在側邊欄選擇一個活躍節點。");
            return;
        }

        setIsRotating(true);
        try {
            const data = await apiPostWrite<{
                success?: boolean;
                error?: string;
                rotation?: DiaryRotation;
                stats?: DiaryStats;
            }>(withGolemId("/api/diary/rotate"), {});

            if (!data.success) {
                toast.error("Rotate 失敗", data.error || "目前無法執行日記整理。");
                return;
            }

            if (data.rotation) setRotation(data.rotation);
            if (data.stats) setStats(data.stats);
            await loadDiary();
            await loadBackupAndRotation(true);
            toast.success("Rotate 完成", "已執行日記分層整理與清理。");
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Rotate 失敗";
            toast.error("Rotate 失敗", message);
        } finally {
            setIsRotating(false);
        }
    };

    const handleCreateBackup = async () => {
        if (!activeGolem) {
            toast.warning("尚未選擇 Golem", "請先在側邊欄選擇一個活躍節點。");
            return;
        }
        setIsCreatingBackup(true);
        try {
            const data = await apiPostWrite<DiaryBackupMutationResponse>(
                withGolemId("/api/diary/backup"),
                {
                    label: backupLabel.trim() || undefined,
                }
            );
            if (!data.success) {
                toast.error("建立備份失敗", data.error || "無法建立 SQLite 備份。");
                return;
            }
            setBackupLabel("");
            await loadBackupAndRotation(true);
            const removedCount = Number(data.cleanup?.removedCount || 0);
            if (removedCount > 0) {
                toast.success("備份完成", `已建立日記備份，並自動清理 ${removedCount} 份舊備份。`);
            } else {
                toast.success("備份完成", "已建立日記 SQLite 備份。");
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "備份失敗";
            toast.error("建立備份失敗", message);
        } finally {
            setIsCreatingBackup(false);
        }
    };

    const fetchRestorePreview = useCallback(async (file: string, options?: { silent?: boolean }) => {
        if (!activeGolem) {
            if (!options?.silent) {
                toast.warning("尚未選擇 Golem", "請先在側邊欄選擇一個活躍節點。");
            }
            return null;
        }

        setPreviewingBackupFile(file);
        try {
            const data = await apiGet<DiaryRestorePreviewResponse>(
                withGolemId(`/api/diary/restore/preview?file=${encodeURIComponent(file)}`)
            );
            if (!data.success || !data.preview) {
                if (!options?.silent) {
                    toast.error("還原預檢失敗", data.error || "無法取得備份差異資訊。");
                }
                return null;
            }
            setRestorePreview(data.preview);
            if (!options?.silent) {
                if (data.preview.risk?.potentialOverwrite) {
                    toast.warning("還原預檢完成", data.preview.risk.note || "此備份可能覆蓋較新的資料。");
                } else {
                    toast.success("還原預檢完成", "此備份看起來不會覆蓋較新的資料。");
                }
            }
            return data.preview;
        } catch (error: unknown) {
            if (!options?.silent) {
                const message = error instanceof Error ? error.message : "還原預檢失敗";
                toast.error("還原預檢失敗", message);
            }
            return null;
        } finally {
            setPreviewingBackupFile(null);
        }
    }, [activeGolem, toast, withGolemId]);

    const handlePreviewRestore = async (file: string) => {
        await fetchRestorePreview(file, { silent: false });
    };

    const handleOpenRestoreConfirm = async (file: string) => {
        if (!activeGolem) {
            toast.warning("尚未選擇 Golem", "請先在側邊欄選擇一個活躍節點。");
            return;
        }

        let preview = restorePreview && restorePreview.backupFile === file
            ? restorePreview
            : null;
        if (!preview) {
            preview = await fetchRestorePreview(file, { silent: true });
        }
        if (!preview) {
            toast.error("無法還原", "請先完成還原預檢後再試一次。");
            return;
        }
        setRestoreConfirmFile(file);
    };

    const handleConfirmRestore = async () => {
        if (!activeGolem || !restoreConfirmFile) return;

        setRestoringBackupFile(restoreConfirmFile);
        try {
            const data = await apiPostWrite<DiaryBackupMutationResponse>(
                withGolemId("/api/diary/restore"),
                { file: restoreConfirmFile }
            );
            if (!data.success) {
                toast.error("還原失敗", data.error || "無法還原指定備份。");
                return;
            }
            if (data.rotation) setRotation(data.rotation);
            if (data.stats) setStats(data.stats);
            await Promise.all([
                loadDiary(),
                loadBackupAndRotation(true),
            ]);
            const removedCount = Number(data.backupCleanup?.removedCount || 0);
            if (removedCount > 0) {
                toast.success("還原完成", `已還原備份：${data.restoredFile || restoreConfirmFile}，並清理 ${removedCount} 份舊備份。`);
            } else {
                toast.success("還原完成", `已還原備份：${data.restoredFile || restoreConfirmFile}`);
            }
            setRestorePreview(null);
            setRestoreConfirmFile(null);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "還原失敗";
            toast.error("還原失敗", message);
        } finally {
            setRestoringBackupFile(null);
        }
    };

    const handleCleanupBackups = async () => {
        if (!activeGolem) {
            toast.warning("尚未選擇 Golem", "請先在側邊欄選擇一個活躍節點。");
            return;
        }
        setIsCleaningBackups(true);
        try {
            const data = await apiPostWrite<DiaryBackupsResponse>(
                withGolemId("/api/diary/backup/cleanup"),
                {}
            );
            if (!data.success) {
                toast.error("清理失敗", data.error || "無法清理舊備份。");
                return;
            }
            await loadBackupAndRotation(true);
            const removedCount = Number(data.cleanup?.removedCount || 0);
            if (removedCount > 0) {
                toast.success("清理完成", `已清理 ${removedCount} 份舊備份。`);
            } else {
                toast.success("清理完成", "目前沒有可清理的舊備份。");
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "清理失敗";
            toast.error("清理失敗", message);
        } finally {
            setIsCleaningBackups(false);
        }
    };

    const handleDownloadBackup = (file: string) => {
        if (!activeGolem) {
            toast.warning("尚未選擇 Golem", "請先在側邊欄選擇一個活躍節點。");
            return;
        }
        const url = withGolemId(`/api/diary/backup/download?file=${encodeURIComponent(file)}`);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = file;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    };

    const handleRefreshAll = async () => {
        await Promise.all([
            loadDiary(),
            loadBackupAndRotation(true),
        ]);
    };

    const filteredEntries = useMemo(() => {
        if (feedFilter === "all") return entries;
        if (feedFilter === "threaded") return entries.filter((entry) => (entry.iteration || 1) > 1 || Boolean(entry.replyToId));
        return entries.filter((entry) => entry.entryType === feedFilter);
    }, [entries, feedFilter]);

    const entriesById = useMemo(() => {
        return new Map(entries.map((entry) => [entry.id, entry]));
    }, [entries]);

    const threadConversations = useMemo(() => {
        const childrenMap = new Map<string, DiaryEntry[]>();
        for (const entry of entries) {
            if (!entry.replyToId) continue;
            const parentId = entry.replyToId;
            if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
            childrenMap.get(parentId)?.push(entry);
        }

        for (const list of childrenMap.values()) {
            list.sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt));
        }

        const rootIds = new Set<string>();
        for (const entry of entries) {
            if (!entry.replyToId) continue;
            let cursor = entry;
            let parentId = entry.replyToId;
            let guard = 0;

            while (parentId && entriesById.has(parentId) && guard < 64) {
                const parent = entriesById.get(parentId);
                if (!parent) break;
                cursor = parent;
                parentId = parent.replyToId || "";
                guard += 1;
            }
            rootIds.add(cursor.id);
        }

        const conversations = Array.from(rootIds)
            .map((rootId) => {
                const root = entriesById.get(rootId);
                if (!root) return null;

                const nodes: Array<{ entry: DiaryEntry; depth: number }> = [];
                const visited = new Set<string>();
                const walk = (entryId: string, depth: number) => {
                    if (visited.has(entryId)) return;
                    visited.add(entryId);
                    const current = entriesById.get(entryId);
                    if (!current) return;
                    nodes.push({ entry: current, depth });
                    const children = childrenMap.get(entryId) || [];
                    for (const child of children) {
                        walk(child.id, depth + 1);
                    }
                };
                walk(rootId, 0);

                if (nodes.length === 0) return null;
                const updatedAt = nodes.reduce(
                    (latest, node) => Math.max(latest, toTimestamp(node.entry.createdAt)),
                    0
                );

                return {
                    root,
                    nodes,
                    updatedAt,
                };
            })
            .filter(Boolean) as Array<{
                root: DiaryEntry;
                nodes: Array<{ entry: DiaryEntry; depth: number }>;
                updatedAt: number;
            }>;

        conversations.sort((a, b) => b.updatedAt - a.updatedAt);
        return conversations;
    }, [entries, entriesById]);

    const weeklySummaryEntries = useMemo(() => {
        return entries
            .filter(
                (entry) =>
                    entry.entryType === "ai_summary" &&
                    Array.isArray(entry.tags) &&
                    entry.tags.includes("weekly_summary")
            )
            .sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));
    }, [entries]);

    useEffect(() => {
        if (weeklySummaryEntries.length === 0) {
            setSelectedWeeklySummaryId(null);
            return;
        }
        if (!selectedWeeklySummaryId || !weeklySummaryEntries.some((entry) => entry.id === selectedWeeklySummaryId)) {
            setSelectedWeeklySummaryId(weeklySummaryEntries[0].id);
        }
    }, [selectedWeeklySummaryId, weeklySummaryEntries]);

    const selectedWeeklySummary = useMemo(
        () => weeklySummaryEntries.find((entry) => entry.id === selectedWeeklySummaryId) || null,
        [selectedWeeklySummaryId, weeklySummaryEntries]
    );

    const replyTargetEntry = useMemo(
        () => entries.find((entry) => entry.id === replyTargetId) || null,
        [entries, replyTargetId]
    );

    const aiExchangeEntries = useMemo(
        () => entries
            .filter(
                (entry) =>
                    entry.shared &&
                    (entry.entryType === "ai_diary" || entry.entryType === "ai_thought" || entry.entryType === "ai_summary")
            )
            .slice(0, 4),
        [entries]
    );
    const userExchangeEntries = useMemo(
        () => entries.filter((entry) => entry.shared && entry.entryType === "user_diary").slice(0, 4),
        [entries]
    );

    const renderEntryCard = (entry: DiaryEntry, options?: { nestedDepth?: number }) => {
        const nestedDepth = Math.max(0, Math.min(options?.nestedDepth || 0, 6));
        const displayContent = extractGolemReplyOnly(entry.content) || entry.content;
        return (
            <article
                key={entry.id}
                className={cn(
                    "rounded-xl border border-border bg-background/40 p-3.5",
                    nestedDepth > 0 && "border-primary/20 bg-primary/5"
                )}
                style={nestedDepth > 0 ? { marginLeft: `${nestedDepth * 14}px` } : undefined}
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn("text-[10px] uppercase tracking-wider border px-1.5 py-0.5 rounded-md", typeBadge(entry.entryType))}>
                                {resolveTypeLabel(entry.entryType)}
                            </span>
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                                {entry.entryType === "user_diary" ? <UserRound className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                                {entry.author || (entry.entryType === "user_diary" ? "User" : "AI")}
                            </span>
                            <span className="text-[11px] text-muted-foreground/80">
                                {formatTime(entry.createdAt)}
                            </span>
                            <span className="text-[11px] text-muted-foreground/80">
                                迭代 #{Math.max(1, Number(entry.iteration || 1))}
                            </span>
                            {entry.replyToId && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-primary/30 bg-primary/10 text-primary">
                                    回覆串接
                                </span>
                            )}
                            {entry.mood && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-border bg-secondary/40 text-muted-foreground">
                                    心情：{entry.mood}
                                </span>
                            )}
                            {Array.isArray(entry.tags) && entry.tags.length > 0 && (
                                <span className="text-[10px] text-muted-foreground">
                                    #{entry.tags.join(" #")}
                                </span>
                            )}
                            {Array.isArray(entry.tags) && entry.tags.some((tag) => tag.startsWith("bond_unlock")) && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-rose-400/35 bg-rose-500/10 text-rose-300 inline-flex items-center gap-1">
                                    <Trophy className="w-3 h-3" />
                                    {isEnglish ? "Bond Unlocked" : "羈絆解鎖"}
                                </span>
                            )}
                        </div>
                        <p className="text-sm text-foreground/90 leading-relaxed mt-2 whitespace-pre-wrap break-words">
                            {displayContent}
                        </p>
                        <div className="flex items-center gap-1.5 mt-3">
                            <button
                                onClick={() => setReplyTargetId(entry.id)}
                                className="px-2 py-1 text-[11px] rounded-md border border-border bg-secondary/35 text-muted-foreground hover:text-foreground hover:bg-secondary/60 flex items-center gap-1"
                            >
                                <Reply className="w-3 h-3" />
                                {isEnglish ? "Continue Reply" : "接續回覆"}
                            </button>
                            <button
                                onClick={() => handleAiReply(entry.id)}
                                disabled={replyingEntryId === entry.id}
                                className={`px-2 py-1 text-[11px] rounded-md border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1 ${replyingEntryId === entry.id ? "opacity-60 cursor-not-allowed" : ""}`}
                            >
                                <Sparkles className={`w-3 h-3 ${replyingEntryId === entry.id ? "animate-pulse" : ""}`} />
                                {replyingEntryId === entry.id
                                    ? (isEnglish ? "AI replying..." : "AI 回信中...")
                                    : (isEnglish ? "AI Reply" : "AI 回信")}
                            </button>
                        </div>
                    </div>
                    <button
                        onClick={() => handleDeleteEntry(entry.id)}
                        disabled={deletingId === entry.id}
                        className={`p-1.5 rounded-md border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 ${deletingId === entry.id ? "opacity-50 cursor-not-allowed" : ""}`}
                        title={isEnglish ? "Delete this entry" : "刪除這篇日記"}
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                </div>
            </article>
        );
    };

    return (
        <div className="p-6 h-full flex flex-col bg-background text-foreground overflow-hidden">
            <div className="flex items-end justify-between border-b border-border pb-4 mb-5">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center shadow-[0_0_24px_-8px_var(--primary)]">
                        <BookHeart className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary via-cyan-300 to-emerald-300">
                            {isEnglish ? "Bond Journal" : "羈絆日記 (Bond Journal)"}
                        </h1>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            {isEnglish ? "AI and users exchange diaries and thoughts to grow the relationship." : "AI 與使用者互相留下日記與想法，讓關係持續成長。"}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleForceRotate}
                        disabled={isRotating || isLoading}
                        className={`px-3 py-2 text-xs rounded-lg border border-rose-500/35 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 flex items-center gap-1.5 ${isRotating || isLoading ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                        <ArchiveRestore className={`w-3.5 h-3.5 ${isRotating ? "animate-spin" : ""}`} />
                        {isRotating ? (isEnglish ? "Rotating..." : "整理中...") : (isEnglish ? "Rotate Now" : "立即 Rotate")}
                    </button>
                    <button
                        onClick={handleRefreshAll}
                        disabled={isLoading}
                        className={`px-3 py-2 text-xs rounded-lg border border-border bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground flex items-center gap-1.5 ${isLoading ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                        <RefreshCcw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
                        {isEnglish ? "Refresh" : "重新整理"}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-6 gap-3 mb-5">
                <div className="rounded-xl border border-border bg-card/45 p-3">
                    <p className="text-[11px] text-muted-foreground">{isEnglish ? "Bond Level" : "羈絆等級"}</p>
                    <p className="text-sm font-semibold text-primary mt-1 flex items-center gap-1.5">
                        <Gauge className="w-4 h-4" />
                        {stats.bondLevel} ({stats.bondScore})
                    </p>
                </div>
                <div className="rounded-xl border border-border bg-card/45 p-3">
                    <p className="text-[11px] text-muted-foreground">{isEnglish ? "Interaction Streak" : "連續互動天數"}</p>
                    <p className="text-sm font-semibold text-amber-300 mt-1 flex items-center gap-1.5">
                        <Flame className="w-4 h-4" />
                        {stats.streakDays} {isEnglish ? "days" : "天"}
                    </p>
                </div>
                <div className="rounded-xl border border-border bg-card/45 p-3">
                    <p className="text-[11px] text-muted-foreground">{isEnglish ? "Threaded Replies" : "迭代回覆次數"}</p>
                    <p className="text-sm font-semibold text-cyan-300 mt-1 flex items-center gap-1.5">
                        <Link2 className="w-4 h-4" />
                        {stats.exchangeReplies} {isEnglish ? "times" : "次"}
                    </p>
                </div>
                <div className="rounded-xl border border-border bg-card/45 p-3">
                    <p className="text-[11px] text-muted-foreground">{isEnglish ? "AI Diary Count" : "AI 日記總數"}</p>
                    <p className="text-sm font-semibold text-foreground mt-1">{stats.aiEntries}</p>
                </div>
                <div className="rounded-xl border border-border bg-card/45 p-3">
                    <p className="text-[11px] text-muted-foreground">{isEnglish ? "User Diary Count" : "使用者日記總數"}</p>
                    <p className="text-sm font-semibold text-foreground mt-1">{stats.userEntries}</p>
                </div>
                <div className="rounded-xl border border-border bg-card/45 p-3">
                    <p className="text-[11px] text-muted-foreground">{isEnglish ? "Rotate Policy" : "Rotate 策略"}</p>
                    <p className="text-[11px] text-foreground/90 mt-1 leading-relaxed">
                        {isEnglish ? "Raw" : "原文"} {rotation?.policy?.rawDays ?? 7} {isEnglish ? "days" : "天"}
                        <br />
                        {isEnglish ? "Weekly" : "週摘要"} {rotation?.policy?.weeklyDays ?? 365} {isEnglish ? "days" : "天"}
                        <br />
                        {isEnglish ? "Monthly" : "月摘要"} {rotation?.policy?.monthlyDays ?? 1825} {isEnglish ? "days" : "天"}
                    </p>
                </div>
            </div>

            {rotation && !rotation.skipped && (
                <div className="mb-4 rounded-xl border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-xs text-rose-200/90">
                    {isEnglish
                        ? `Rotate result: +weekly ${rotation.createdWeekly ?? 0}, +monthly ${rotation.createdMonthly ?? 0}, +yearly ${rotation.createdYearly ?? 0}; cleaned raw ${rotation.prunedRawEntries ?? 0}, weekly ${rotation.prunedWeeklySummaries ?? 0}, monthly ${rotation.prunedMonthlySummaries ?? 0}.`
                        : `Rotate 結果：新增 週摘要 ${rotation.createdWeekly ?? 0}、月摘要 ${rotation.createdMonthly ?? 0}、年摘要 ${rotation.createdYearly ?? 0}；清理 原文 ${rotation.prunedRawEntries ?? 0}、週摘要 ${rotation.prunedWeeklySummaries ?? 0}、月摘要 ${rotation.prunedMonthlySummaries ?? 0}。`}
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 flex-1 min-h-0">
                <section className="xl:col-span-2 min-h-0 space-y-4 overflow-y-auto pr-1">
                    <div className="rounded-2xl border border-border bg-card/50 p-4 space-y-3">
                        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <PenSquare className="w-4 h-4 text-primary" />
                            {isEnglish ? "New Diary Entry" : "新增日記"}
                        </h2>

                        {replyTargetEntry && (
                            <div className="rounded-xl border border-primary/35 bg-primary/10 p-2.5">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-[11px] text-primary font-medium">{isEnglish ? "Threaded reply mode" : "目前為接續回覆模式"}</p>
                                        <p className="text-xs text-foreground/85 mt-1 line-clamp-2">
                                            {isEnglish ? "Reply target:" : "回覆目標："}{extractGolemReplyOnly(replyTargetEntry.content) || replyTargetEntry.content}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setReplyTargetId(null)}
                                        className="text-[11px] px-2 py-1 rounded-md border border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
                                    >
                                        {isEnglish ? "Cancel" : "取消"}
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 gap-2">
                            {entryTypeOptions.map((option) => (
                                <button
                                    key={option.value}
                                    onClick={() => setEntryType(option.value)}
                                    className={cn(
                                        "text-left rounded-xl border px-3 py-2.5 transition-colors",
                                        entryType === option.value
                                            ? "border-primary/50 bg-primary/10"
                                            : "border-border bg-secondary/20 hover:bg-secondary/40"
                                    )}
                                >
                                    <p className="text-sm font-medium text-foreground">{option.label}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">{option.hint}</p>
                                </button>
                            ))}
                        </div>

                        <textarea
                            value={manualContent}
                            onChange={(event) => setManualContent(event.target.value)}
                            placeholder={isEnglish ? "Write today's diary exchange..." : "寫下今天想交換的一段日記..."}
                            className="w-full min-h-[120px] bg-secondary/40 border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
                        />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <input
                                value={manualMood}
                                onChange={(event) => setManualMood(event.target.value)}
                                placeholder={isEnglish ? "Mood (optional, e.g. gratitude / reflection)" : "情緒（可選，例如：感謝 / 反思）"}
                                className="w-full bg-secondary/40 border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                            <input
                                value={manualTags}
                                onChange={(event) => setManualTags(event.target.value)}
                                placeholder={isEnglish ? "Tags (optional, comma-separated)" : "標籤（可選，逗號分隔）"}
                                className="w-full bg-secondary/40 border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                        </div>

                        <button
                            onClick={handleCreateManualEntry}
                            disabled={isSaving}
                            className={`w-full px-3 py-2.5 rounded-xl border border-primary/40 bg-primary/15 hover:bg-primary/25 text-primary text-sm font-medium flex items-center justify-center gap-2 ${isSaving ? "opacity-60 cursor-not-allowed" : ""}`}
                        >
                            <Send className="w-4 h-4" />
                            {isSaving ? (isEnglish ? "Saving..." : "儲存中...") : (isEnglish ? "Save Exchange Diary" : "寫入交換日記")}
                        </button>
                    </div>

                    <div className="rounded-2xl border border-border bg-card/50 p-4 space-y-3">
                        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-primary" />
                            {isEnglish ? "AI Auto Writing" : "AI 自動書寫"}
                        </h2>
                        <input
                            value={aiTopic}
                            onChange={(event) => setAiTopic(event.target.value)}
                            placeholder={isEnglish ? "Optional: specify a topic (e.g. today's collaboration)" : "可選：指定主題（例如：今天合作開發）"}
                            className="w-full bg-secondary/40 border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        {replyTargetEntry && (
                            <p className="text-xs text-primary/90 bg-primary/10 border border-primary/25 rounded-lg px-2.5 py-2">
                                {isEnglish ? "AI generation will continue from the current target (thread mode)." : "AI 生成將接續回覆目前目標內容（迭代模式）。"}
                            </p>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <button
                                onClick={() => handleGenerateByAi("ai_diary")}
                                disabled={!activeGolem || isGeneratingDiary || isGeneratingThought || isGeneratingWeeklySummary}
                                className={`px-3 py-2.5 rounded-xl border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-sm font-medium flex items-center justify-center gap-2 ${!activeGolem || isGeneratingDiary || isGeneratingThought || isGeneratingWeeklySummary ? "opacity-60 cursor-not-allowed" : ""}`}
                            >
                                <Brain className={`w-4 h-4 ${isGeneratingDiary ? "animate-pulse" : ""}`} />
                                {isGeneratingDiary ? (isEnglish ? "AI writing..." : "AI 寫作中...") : (isEnglish ? "AI Writes a Diary" : "AI 寫一篇日記")}
                            </button>
                            <button
                                onClick={() => handleGenerateByAi("ai_thought")}
                                disabled={!activeGolem || isGeneratingDiary || isGeneratingThought || isGeneratingWeeklySummary}
                                className={`px-3 py-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-sm font-medium flex items-center justify-center gap-2 ${!activeGolem || isGeneratingDiary || isGeneratingThought || isGeneratingWeeklySummary ? "opacity-60 cursor-not-allowed" : ""}`}
                            >
                                <Lightbulb className={`w-4 h-4 ${isGeneratingThought ? "animate-pulse" : ""}`} />
                                {isGeneratingThought ? (isEnglish ? "AI thinking..." : "AI 思考中...") : (isEnglish ? "AI Writes Thoughts for You" : "AI 寫對你的想法")}
                            </button>
                            <button
                                onClick={handleGenerateWeeklySummary}
                                disabled={!activeGolem || isGeneratingDiary || isGeneratingThought || isGeneratingWeeklySummary}
                                className={`px-3 py-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-sm font-medium flex items-center justify-center gap-2 ${!activeGolem || isGeneratingDiary || isGeneratingThought || isGeneratingWeeklySummary ? "opacity-60 cursor-not-allowed" : ""}`}
                            >
                                <CalendarDays className={`w-4 h-4 ${isGeneratingWeeklySummary ? "animate-pulse" : ""}`} />
                                {isGeneratingWeeklySummary ? (isEnglish ? "Summarizing..." : "摘要整理中...") : (isEnglish ? "Generate Weekly Summary" : "生成每週摘要")}
                            </button>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-card/50 p-4 space-y-3">
                        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <ArchiveRestore className="w-4 h-4 text-rose-300" />
                            {isEnglish ? "SQLite Backup & Restore" : "SQLite 備份與還原"}
                        </h2>
                        {backupPolicy && (
                            <p className="text-[11px] text-muted-foreground">
                                {isEnglish
                                    ? `Auto cleanup: keep up to ${backupPolicy.maxFiles ?? "-"} files, and remove backups older than ${backupPolicy.retentionDays ?? "-"} days.`
                                    : `自動清理策略：最多保留 ${backupPolicy.maxFiles ?? "-"} 份，超過 ${backupPolicy.retentionDays ?? "-"} 天的備份會被清理。`}
                            </p>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2">
                            <input
                                value={backupLabel}
                                onChange={(event) => setBackupLabel(event.target.value)}
                                placeholder={isEnglish ? "Backup label (optional, e.g. before_big_refactor)" : "備份標籤（可選，例如：before_big_refactor）"}
                                className="w-full bg-secondary/40 border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                            <button
                                onClick={handleCreateBackup}
                                disabled={isCreatingBackup}
                                className={`px-3 py-2 rounded-xl border border-rose-500/35 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-sm ${isCreatingBackup ? "opacity-60 cursor-not-allowed" : ""}`}
                            >
                                {isCreatingBackup ? (isEnglish ? "Backing up..." : "備份中...") : (isEnglish ? "Create Backup" : "建立備份")}
                            </button>
                            <button
                                onClick={handleCleanupBackups}
                                disabled={isCleaningBackups}
                                className={`px-3 py-2 rounded-xl border border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-sm ${isCleaningBackups ? "opacity-60 cursor-not-allowed" : ""}`}
                            >
                                {isCleaningBackups ? (isEnglish ? "Cleaning..." : "清理中...") : (isEnglish ? "Manual Cleanup" : "手動清理舊備份")}
                            </button>
                        </div>
                        <div className="rounded-xl border border-border bg-background/20 p-2.5">
                            <p className="text-xs text-muted-foreground mb-2">{isEnglish ? `Available Backups (${backupItems.length})` : `可用備份 (${backupItems.length})`}</p>
                            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                                {isBackupLoading && (
                                    <p className="text-xs text-muted-foreground">{isEnglish ? "Loading..." : "讀取中..."}</p>
                                )}
                                {!isBackupLoading && backupItems.length === 0 && (
                                    <p className="text-xs text-muted-foreground">{isEnglish ? "No backups yet." : "目前尚無備份。"}</p>
                                )}
                                {!isBackupLoading && backupItems.map((item) => (
                                    <div key={item.file} className="rounded-lg border border-border bg-card/30 p-2 space-y-2">
                                        <div className="min-w-0">
                                            <p className="text-xs text-foreground truncate">{item.file}</p>
                                            <p className="text-[10px] text-muted-foreground mt-0.5">
                                                {formatBytes(item.bytes)} · {formatTime(item.modifiedAt || item.createdAt)}
                                            </p>
                                        </div>
                                        <div className="flex items-center flex-wrap gap-1.5">
                                            <button
                                                onClick={() => handlePreviewRestore(item.file)}
                                                disabled={previewingBackupFile === item.file}
                                                className={`px-2 py-1 text-[11px] rounded-md border border-cyan-500/35 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 ${previewingBackupFile === item.file ? "opacity-60 cursor-not-allowed" : ""}`}
                                            >
                                                {previewingBackupFile === item.file ? (isEnglish ? "Previewing..." : "預檢中...") : (isEnglish ? "Preview Diff" : "預檢差異")}
                                            </button>
                                            <button
                                                onClick={() => handleDownloadBackup(item.file)}
                                                className="px-2 py-1 text-[11px] rounded-md border border-border bg-secondary/35 text-muted-foreground hover:text-foreground hover:bg-secondary/60 inline-flex items-center gap-1"
                                            >
                                                <Download className="w-3 h-3" />
                                                {isEnglish ? "Download" : "下載"}
                                            </button>
                                            <button
                                                onClick={() => handleOpenRestoreConfirm(item.file)}
                                                disabled={restoringBackupFile === item.file}
                                                className={`px-2 py-1 text-[11px] rounded-md border border-primary/35 bg-primary/10 text-primary hover:bg-primary/20 ${restoringBackupFile === item.file ? "opacity-60 cursor-not-allowed" : ""}`}
                                            >
                                                {restoringBackupFile === item.file ? (isEnglish ? "Restoring..." : "還原中...") : (isEnglish ? "Restore (Confirm)" : "還原（確認）")}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {restorePreview && (
                            <div
                                className={cn(
                                    "rounded-xl border px-3 py-2.5 space-y-2",
                                    restorePreview.risk?.potentialOverwrite
                                        ? "border-amber-500/35 bg-amber-500/10"
                                        : "border-emerald-500/35 bg-emerald-500/10"
                                )}
                            >
                                <div className="flex items-center gap-1.5">
                                    <AlertTriangle
                                        className={cn(
                                            "w-3.5 h-3.5",
                                            restorePreview.risk?.potentialOverwrite ? "text-amber-300" : "text-emerald-300"
                                        )}
                                    />
                                    <p className="text-xs font-medium text-foreground truncate">
                                        {isEnglish ? "Restore Preview:" : "還原預檢："}{restorePreview.backupFile}
                                    </p>
                                </div>
                                <p className="text-[11px] text-muted-foreground">
                                    {restorePreview.risk?.note || (isEnglish ? "Diff analysis completed." : "已完成差異分析。")}
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                    <div className="rounded-lg border border-border/60 bg-background/20 p-2">
                                        <p className="text-[10px] text-muted-foreground">{isEnglish ? "Current Data" : "現行資料"}</p>
                                        <p className="text-xs text-foreground mt-1">{isEnglish ? "Total" : "總數"} {restorePreview.current.totalEntries ?? 0}</p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">
                                            {isEnglish ? "Latest" : "最新"} {restorePreview.current.latestAt ? formatTime(restorePreview.current.latestAt) : (isEnglish ? "N/A" : "無")}
                                        </p>
                                    </div>
                                    <div className="rounded-lg border border-border/60 bg-background/20 p-2">
                                        <p className="text-[10px] text-muted-foreground">{isEnglish ? "Backup Data" : "備份資料"}</p>
                                        <p className="text-xs text-foreground mt-1">{isEnglish ? "Total" : "總數"} {restorePreview.backup.totalEntries ?? 0}</p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">
                                            {isEnglish ? "Latest" : "最新"} {restorePreview.backup.latestAt ? formatTime(restorePreview.backup.latestAt) : (isEnglish ? "N/A" : "無")}
                                        </p>
                                    </div>
                                    <div className="rounded-lg border border-border/60 bg-background/20 p-2">
                                        <p className="text-[10px] text-muted-foreground">{isEnglish ? "Delta (backup - current)" : "差異 (備份 - 現行)"}</p>
                                        <p className="text-xs text-foreground mt-1">{isEnglish ? "Total" : "總數"} {formatSigned(restorePreview.delta.totalEntries ?? 0)}</p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">
                                            {isEnglish ? "User" : "使用者"} {formatSigned(restorePreview.delta.userEntries ?? 0)} / {isEnglish ? "AI Diary" : "AI 日記"} {formatSigned(restorePreview.delta.aiDiaryEntries ?? 0)}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground">
                                            {isEnglish ? "AI Thoughts" : "AI 想法"} {formatSigned(restorePreview.delta.aiThoughtEntries ?? 0)} / {isEnglish ? "AI Summary" : "AI 摘要"} {formatSigned(restorePreview.delta.aiSummaryEntries ?? 0)}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="rounded-2xl border border-border bg-card/50 p-4 space-y-3">
                        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <RefreshCcw className="w-4 h-4 text-cyan-300" />
                            {isEnglish ? "Rotate History" : "Rotate 歷史"}
                        </h2>
                        <div className="rounded-xl border border-border bg-background/20 p-2.5">
                            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                                {isBackupLoading && (
                                    <p className="text-xs text-muted-foreground">{isEnglish ? "Loading..." : "讀取中..."}</p>
                                )}
                                {!isBackupLoading && rotationHistory.length === 0 && (
                                    <p className="text-xs text-muted-foreground">{isEnglish ? "No rotate records yet." : "目前沒有 rotate 紀錄。"}</p>
                                )}
                                {!isBackupLoading && rotationHistory.map((record) => {
                                    const details = record.details || {};
                                    return (
                                        <div key={`${record.id}-${record.timestamp}`} className="rounded-lg border border-border bg-card/30 p-2">
                                            <p className="text-xs text-foreground">
                                                {formatTime(new Date(record.timestamp).toISOString())}
                                            </p>
                                            <p className="text-[10px] text-muted-foreground mt-0.5">
                                                mode: {record.mode} · +週 {details.createdWeekly ?? 0} / +月 {details.createdMonthly ?? 0} / +年 {details.createdYearly ?? 0}
                                            </p>
                                            <p className="text-[10px] text-muted-foreground">
                                                -原文 {details.prunedRawEntries ?? 0} / -週 {details.prunedWeeklySummaries ?? 0} / -月 {details.prunedMonthlySummaries ?? 0}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-card/50 p-4 space-y-3">
                        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <HeartHandshake className="w-4 h-4 text-primary" />
                            {isEnglish ? "Diary Exchange Wall" : "日記交換牆"}
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
                                <p className="text-xs uppercase tracking-wider text-cyan-300 mb-2">{isEnglish ? "From AI to You" : "AI 給你的內容"}</p>
                                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                                    {aiExchangeEntries.length === 0 && (
                                        <p className="text-xs text-muted-foreground">{isEnglish ? "No AI messages yet." : "目前還沒有 AI 留言。"}</p>
                                    )}
                                    {aiExchangeEntries.map((entry) => (
                                        <div key={entry.id} className="text-xs text-foreground/90 border border-cyan-500/20 rounded-lg p-2 bg-background/30">
                                            <p className="line-clamp-3">{extractGolemReplyOnly(entry.content) || entry.content}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                                <p className="text-xs uppercase tracking-wider text-emerald-300 mb-2">{isEnglish ? "From You to AI" : "你給 AI 的內容"}</p>
                                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                                    {userExchangeEntries.length === 0 && (
                                        <p className="text-xs text-muted-foreground">{isEnglish ? "No user diary yet." : "目前還沒有使用者日記。"}</p>
                                    )}
                                    {userExchangeEntries.map((entry) => (
                                        <div key={entry.id} className="text-xs text-foreground/90 border border-emerald-500/20 rounded-lg p-2 bg-background/30">
                                            <p className="line-clamp-3">{extractGolemReplyOnly(entry.content) || entry.content}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="xl:col-span-3 min-h-0 rounded-2xl border border-border bg-card/55 flex flex-col overflow-hidden">
                    <div className="border-b border-border px-4 py-3 space-y-2.5">
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                                {feedView === "timeline" && <BookHeart className="w-4 h-4 text-primary" />}
                                {feedView === "threads" && <Link2 className="w-4 h-4 text-primary" />}
                                {feedView === "weekly" && <CalendarDays className="w-4 h-4 text-primary" />}
                                {feedView === "timeline" && (isEnglish ? "Diary Timeline" : "日記時間軸")}
                                {feedView === "threads" && (isEnglish ? "Conversation Tree" : "迭代對話樹")}
                                {feedView === "weekly" && (isEnglish ? "Weekly Summary History" : "每週摘要歷史")}
                            </h2>
                            <div className="flex items-center gap-1.5 overflow-x-auto">
                                {viewOptions.map((view) => (
                                    <button
                                        key={view.value}
                                        onClick={() => setFeedView(view.value)}
                                        className={cn(
                                            "px-2.5 py-1 text-xs rounded-md border whitespace-nowrap transition-colors",
                                            feedView === view.value
                                                ? "border-primary/50 bg-primary/15 text-primary"
                                                : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                                        )}
                                    >
                                        {view.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {feedView === "timeline" && (
                            <div className="flex items-center gap-1.5 overflow-x-auto">
                                {filterOptions.map((filter) => (
                                    <button
                                        key={filter.value}
                                        onClick={() => setFeedFilter(filter.value)}
                                        className={cn(
                                            "px-2.5 py-1 text-xs rounded-md border whitespace-nowrap transition-colors",
                                            feedFilter === filter.value
                                                ? "border-primary/50 bg-primary/15 text-primary"
                                                : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                                        )}
                                    >
                                        {filter.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-4">
                        {isLoading && (
                            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                                {isEnglish ? "Loading diary..." : "載入日記中..."}
                            </div>
                        )}

                        {!isLoading && feedView === "timeline" && (
                            filteredEntries.length === 0 ? (
                                <div className="h-full rounded-xl border border-dashed border-border/70 bg-secondary/20 flex items-center justify-center text-muted-foreground text-sm">
                                    {isEnglish ? "No diary entries match current filters" : "目前沒有符合條件的日記內容"}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {filteredEntries.map((entry) => renderEntryCard(entry))}
                                </div>
                            )
                        )}

                        {!isLoading && feedView === "threads" && (
                            threadConversations.length === 0 ? (
                                <div className="h-full rounded-xl border border-dashed border-border/70 bg-secondary/20 flex items-center justify-center text-muted-foreground text-sm">
                                    {isEnglish ? "No threaded conversations yet" : "目前還沒有可視覺化的迭代串接"}
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {threadConversations.map((thread, index) => (
                                        <div key={thread.root.id} className="rounded-xl border border-border bg-background/35 p-3">
                                            <div className="flex items-center justify-between gap-2 border-b border-border pb-2 mb-3">
                                                <div>
                                                    <p className="text-xs font-medium text-foreground">
                                                        {isEnglish ? `Thread #${index + 1}` : `串接對話 #${index + 1}`}
                                                    </p>
                                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                                        {isEnglish
                                                            ? `${thread.nodes.length} entries · Last update ${thread.updatedAt > 0 ? formatTime(new Date(thread.updatedAt).toISOString()) : "Unknown"}`
                                                            : `共 ${thread.nodes.length} 則 · 最近更新 ${thread.updatedAt > 0 ? formatTime(new Date(thread.updatedAt).toISOString()) : "未知"}`}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={() => setReplyTargetId(thread.root.id)}
                                                    className="px-2 py-1 text-[11px] rounded-md border border-primary/35 bg-primary/10 text-primary hover:bg-primary/20"
                                                >
                                                    {isEnglish ? "Continue This Thread" : "接續這串"}
                                                </button>
                                            </div>
                                            <div className="space-y-2">
                                                {thread.nodes.map((node) => renderEntryCard(node.entry, { nestedDepth: node.depth }))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )
                        )}

                        {!isLoading && feedView === "weekly" && (
                            weeklySummaryEntries.length === 0 ? (
                                <div className="h-full rounded-xl border border-dashed border-border/70 bg-secondary/20 flex items-center justify-center text-muted-foreground text-sm">
                                    {isEnglish ? "No weekly summaries yet. Click \"Generate Weekly Summary\" to create the first one." : "目前尚無每週摘要，先按下「生成每週摘要」建立第一篇。"}
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 h-full min-h-0">
                                    <div className="xl:col-span-2 rounded-xl border border-border bg-background/25 flex flex-col min-h-0">
                                        <div className="px-3 py-2.5 border-b border-border">
                                            <p className="text-xs text-muted-foreground">{isEnglish ? `Summary List (${weeklySummaryEntries.length})` : `摘要列表 (${weeklySummaryEntries.length})`}</p>
                                        </div>
                                        <div className="p-2 space-y-2 overflow-y-auto">
                                            {weeklySummaryEntries.map((entry, index) => {
                                                const weekLabel = extractWeekTagLabel(entry);
                                                return (
                                                    <button
                                                        key={entry.id}
                                                        onClick={() => setSelectedWeeklySummaryId(entry.id)}
                                                        className={cn(
                                                            "w-full text-left rounded-lg border px-3 py-2 transition-colors",
                                                            selectedWeeklySummaryId === entry.id
                                                                ? "border-primary/45 bg-primary/10"
                                                                : "border-border bg-secondary/20 hover:bg-secondary/45"
                                                        )}
                                                    >
                                                        <p className="text-xs text-muted-foreground">{isEnglish ? `Summary #${weeklySummaryEntries.length - index}` : `摘要 #${weeklySummaryEntries.length - index}`}</p>
                                                        <p className="text-sm font-medium text-foreground mt-0.5 line-clamp-1">
                                                            {weekLabel
                                                                ? (isEnglish ? `Week starts ${weekLabel}` : `週起始 ${weekLabel}`)
                                                                : (isEnglish ? "Weekly Bond Summary" : "本週羈絆摘要")}
                                                        </p>
                                                        <p className="text-[11px] text-muted-foreground mt-1">
                                                            {formatTime(entry.createdAt)}
                                                        </p>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="xl:col-span-3 rounded-xl border border-border bg-background/25 p-4 overflow-y-auto">
                                        {!selectedWeeklySummary && (
                                            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                                                {isEnglish ? "Select a summary from the left to view details" : "請從左側選擇一篇摘要查看詳情"}
                                            </div>
                                        )}
                                        {selectedWeeklySummary && (
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                                    <div>
                                                        <p className="text-xs text-muted-foreground">{isEnglish ? "Summary Created At" : "摘要建立時間"}</p>
                                                        <p className="text-sm font-medium text-foreground mt-0.5">
                                                            {formatTime(selectedWeeklySummary.createdAt)}
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={() => setReplyTargetId(selectedWeeklySummary.id)}
                                                        className="px-2.5 py-1.5 text-[11px] rounded-md border border-primary/35 bg-primary/10 text-primary hover:bg-primary/20"
                                                    >
                                                        {isEnglish ? "Continue Diary from This Summary" : "以此摘要接續日記"}
                                                    </button>
                                                </div>
                                                <div className="rounded-xl border border-border bg-card/40 p-3">
                                                    <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
                                                        {extractGolemReplyOnly(selectedWeeklySummary.content) || selectedWeeklySummary.content}
                                                    </p>
                                                </div>
                                                {Array.isArray(selectedWeeklySummary.tags) && selectedWeeklySummary.tags.length > 0 && (
                                                    <p className="text-xs text-muted-foreground">
                                                        {isEnglish ? "Tags:" : "標籤："}#{selectedWeeklySummary.tags.join(" #")}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )
                        )}
                    </div>
                </section>
            </div>

            {restoreConfirmFile && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] flex items-center justify-center p-4">
                    <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-4 space-y-3 shadow-2xl">
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <ArchiveRestore className="w-4 h-4 text-primary" />
                            {isEnglish ? "Restore Confirmation" : "還原確認"}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                            {isEnglish
                                ? <>You are about to restore backup: <span className="text-foreground">{restoreConfirmFile}</span>. The system will create a `pre_restore` safety backup first.</>
                                : <>你即將還原備份：<span className="text-foreground">{restoreConfirmFile}</span>。系統會先建立 `pre_restore` 保護備份。</>}
                        </p>
                        {restorePreview && restorePreview.backupFile === restoreConfirmFile && (
                            <div
                                className={cn(
                                    "rounded-xl border px-3 py-2.5 space-y-2",
                                    restorePreview.risk?.potentialOverwrite
                                        ? "border-amber-500/35 bg-amber-500/10"
                                        : "border-emerald-500/35 bg-emerald-500/10"
                                )}
                            >
                                <p className="text-[11px] text-muted-foreground">
                                    {restorePreview.risk?.note || (isEnglish ? "Diff analysis completed." : "已完成差異分析。")}
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                    <div className="rounded-lg border border-border/60 bg-background/20 p-2">
                                        <p className="text-[10px] text-muted-foreground">{isEnglish ? "Current Total" : "現行總數"}</p>
                                        <p className="text-sm text-foreground mt-1">{restorePreview.current.totalEntries ?? 0}</p>
                                    </div>
                                    <div className="rounded-lg border border-border/60 bg-background/20 p-2">
                                        <p className="text-[10px] text-muted-foreground">{isEnglish ? "Backup Total" : "備份總數"}</p>
                                        <p className="text-sm text-foreground mt-1">{restorePreview.backup.totalEntries ?? 0}</p>
                                    </div>
                                    <div className="rounded-lg border border-border/60 bg-background/20 p-2">
                                        <p className="text-[10px] text-muted-foreground">{isEnglish ? "Total Delta" : "總數差異"}</p>
                                        <p className="text-sm text-foreground mt-1">{formatSigned(restorePreview.delta.totalEntries ?? 0)}</p>
                                    </div>
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                    {isEnglish ? "User" : "使用者"} {formatSigned(restorePreview.delta.userEntries ?? 0)} / {isEnglish ? "AI Diary" : "AI 日記"} {formatSigned(restorePreview.delta.aiDiaryEntries ?? 0)} / {isEnglish ? "AI Thoughts" : "AI 想法"} {formatSigned(restorePreview.delta.aiThoughtEntries ?? 0)} / {isEnglish ? "AI Summary" : "AI 摘要"} {formatSigned(restorePreview.delta.aiSummaryEntries ?? 0)}
                                </div>
                            </div>
                        )}
                        <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                                onClick={() => setRestoreConfirmFile(null)}
                                disabled={restoringBackupFile === restoreConfirmFile}
                                className={`px-3 py-2 text-xs rounded-lg border border-border bg-secondary/35 text-muted-foreground hover:text-foreground hover:bg-secondary/60 ${restoringBackupFile === restoreConfirmFile ? "opacity-60 cursor-not-allowed" : ""}`}
                            >
                                {isEnglish ? "Cancel" : "取消"}
                            </button>
                            <button
                                onClick={handleConfirmRestore}
                                disabled={restoringBackupFile === restoreConfirmFile}
                                className={`px-3 py-2 text-xs rounded-lg border border-primary/35 bg-primary/10 text-primary hover:bg-primary/20 ${restoringBackupFile === restoreConfirmFile ? "opacity-60 cursor-not-allowed" : ""}`}
                            >
                                {restoringBackupFile === restoreConfirmFile ? (isEnglish ? "Restoring..." : "還原中...") : (isEnglish ? "Confirm Restore" : "確認還原")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
