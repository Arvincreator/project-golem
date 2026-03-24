"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast-provider";
import { apiDeleteWrite, apiGet, apiPostWrite, apiWrite } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Keyboard, Plus, Pencil, Trash2, Loader2, Save, X, Copy, Sparkles, RefreshCcw, TriangleAlert, Wand2, Activity } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";

type PromptPoolItem = {
    id: string;
    shortcut: string;
    prompt: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    recentUseCount?: number;
    lastUsedAt?: string;
};

type PromptPoolResponse = {
    success?: boolean;
    items?: PromptPoolItem[];
    item?: PromptPoolItem;
    legacyConflicts?: PromptPoolLegacyConflict[];
    hasLegacyConflicts?: boolean;
    error?: string;
};

type PromptPoolLegacyConflict = {
    id: string;
    shortcut: string;
    reason: "reserved_system_command" | "invalid_shortcut_format" | "duplicate_shortcut" | string;
};

type PromptPoolRepairItem = {
    id: string;
    oldShortcut: string;
    newShortcut: string;
    reason: string;
};

type PromptPoolRepairResponse = PromptPoolResponse & {
    repaired?: PromptPoolRepairItem[];
    repairedCount?: number;
};

type PromptPoolAuditRecord = {
    ts: string;
    event: string;
    actorIp?: string;
    details?: Record<string, unknown>;
};

type PromptPoolAuditResponse = {
    success?: boolean;
    records?: PromptPoolAuditRecord[];
};

type CommandsResponse = {
    success?: boolean;
    commands?: { command?: string }[];
};

type PromptPoolForm = {
    shortcut: string;
    prompt: string;
    note: string;
};

const EMPTY_FORM: PromptPoolForm = {
    shortcut: "",
    prompt: "",
    note: "",
};

function getErrorMessage(error: unknown, fallback: string) {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
}

function normalizeShortcutInput(input: string) {
    return String(input || "").trim().replace(/\s+/g, "");
}

function normalizeShortcutKey(input: string) {
    return String(input || "")
        .trim()
        .replace(/^((?:\/)?[a-z0-9_]{1,32})@[a-z0-9_]{3,}$/i, "$1")
        .toLowerCase()
        .replace(/^\/+/, "");
}

export default function PromptPoolPage() {
    const toast = useToast();
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    const router = useRouter();

    const [items, setItems] = useState<PromptPoolItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeletingId, setIsDeletingId] = useState<string>("");
    const [editingId, setEditingId] = useState<string>("");
    const [form, setForm] = useState<PromptPoolForm>(EMPTY_FORM);
    const [reservedCommands, setReservedCommands] = useState<Set<string>>(new Set());
    const [legacyConflicts, setLegacyConflicts] = useState<PromptPoolLegacyConflict[]>([]);
    const [isRepairing, setIsRepairing] = useState(false);
    const [auditRecords, setAuditRecords] = useState<PromptPoolAuditRecord[]>([]);
    const [isAuditLoading, setIsAuditLoading] = useState(false);

    const isEditing = Boolean(editingId);

    const loadPromptPool = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await apiGet<PromptPoolResponse>("/api/prompt-pool");
            setItems(Array.isArray(data.items) ? data.items : []);
            setLegacyConflicts(Array.isArray(data.legacyConflicts) ? data.legacyConflicts : []);
        } catch (error) {
            toast.error(
                isEnglish ? "Load failed" : "讀取失敗",
                getErrorMessage(error, isEnglish ? "Unable to load prompt pool" : "無法讀取 Prompt 指令池")
            );
        } finally {
            setIsLoading(false);
        }
    }, [isEnglish, toast]);

    const loadAuditRecords = useCallback(async () => {
        setIsAuditLoading(true);
        try {
            const data = await apiGet<PromptPoolAuditResponse>("/api/prompt-pool/audit?limit=20");
            setAuditRecords(Array.isArray(data.records) ? data.records : []);
        } catch (error) {
            console.error("Failed to fetch prompt pool audit records:", error);
        } finally {
            setIsAuditLoading(false);
        }
    }, []);

    useEffect(() => {
        loadPromptPool();
        loadAuditRecords();
    }, [loadPromptPool, loadAuditRecords]);

    useEffect(() => {
        const fetchCommands = async () => {
            try {
                const data = await apiGet<CommandsResponse>("/api/commands");
                const set = new Set<string>();
                if (Array.isArray(data.commands)) {
                    for (const item of data.commands) {
                        const command = normalizeShortcutKey(String(item.command || ""));
                        if (command) set.add(command);
                    }
                }
                setReservedCommands(set);
            } catch (error) {
                console.error("Failed to fetch commands for prompt pool validation:", error);
            }
        };
        fetchCommands();
    }, []);

    const resetForm = () => {
        setForm(EMPTY_FORM);
        setEditingId("");
    };

    const sortedItems = useMemo(
        () => [...items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
        [items]
    );

    const conflictReasonById = useMemo(() => {
        const map = new Map<string, string>();
        for (const conflict of legacyConflicts) {
            map.set(conflict.id, conflict.reason);
        }
        return map;
    }, [legacyConflicts]);

    const conflictReasonLabel = (reason: string) => {
        if (reason === "reserved_system_command") return isEnglish ? "Conflicts with system command" : "與系統指令衝突";
        if (reason === "invalid_shortcut_format") return isEnglish ? "Invalid format" : "格式不合法";
        if (reason === "duplicate_shortcut") return isEnglish ? "Duplicate shortcut" : "重複快捷指令";
        return isEnglish ? "Needs repair" : "需修復";
    };

    const describeAuditRecord = (record: PromptPoolAuditRecord) => {
        const details = (record.details && typeof record.details === "object")
            ? record.details as Record<string, unknown>
            : {};
        if (record.event === "prompt_pool_create") {
            return isEnglish
                ? `Created ${String(details.shortcut || "")}`
                : `新增 ${String(details.shortcut || "")}`;
        }
        if (record.event === "prompt_pool_update") {
            return isEnglish
                ? `Updated ${String(details.previousShortcut || "")} -> ${String(details.nextShortcut || "")}`
                : `更新 ${String(details.previousShortcut || "")} -> ${String(details.nextShortcut || "")}`;
        }
        if (record.event === "prompt_pool_delete") {
            return isEnglish
                ? `Deleted ${String(details.shortcut || "")}`
                : `刪除 ${String(details.shortcut || "")}`;
        }
        if (record.event === "prompt_pool_repair_conflicts") {
            return isEnglish
                ? `Auto-repaired ${Number(details.repairedCount || 0)} conflicts`
                : `一鍵修復 ${Number(details.repairedCount || 0)} 筆衝突`;
        }
        return record.event || "unknown";
    };

    const buildSuggestedShortcut = useCallback((sourceShortcut: string, targetId: string) => {
        const source = String(sourceShortcut || "").trim() || "/prompt";
        const base = source.endsWith("_pp") ? source : `${source}_pp`;
        const isTaken = (candidate: string) => {
            const key = normalizeShortcutKey(candidate);
            if (reservedCommands.has(key)) return true;
            return items.some((item) => item.id !== targetId && normalizeShortcutKey(item.shortcut) === key);
        };

        if (!isTaken(base)) return base;

        for (let i = 2; i <= 99; i += 1) {
            const candidate = `${base}_${i}`;
            if (!isTaken(candidate)) return candidate;
        }
        return `${base}_${Date.now().toString(36).slice(-4)}`;
    }, [items, reservedCommands]);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const shortcut = normalizeShortcutInput(form.shortcut);
        const prompt = String(form.prompt || "").trim();
        const note = String(form.note || "").trim();

        if (!shortcut) {
            toast.warning(
                isEnglish ? "Please enter a shortcut" : "請輸入快捷指令",
                isEnglish ? "Example: /daily, /summary, /meeting_notes" : "例如：/daily、/summary、/會議筆記"
            );
            return;
        }
        if (!prompt) {
            toast.warning(isEnglish ? "Please enter prompt content" : "請輸入 Prompt 內容");
            return;
        }

        const normalizedShortcut = normalizeShortcutKey(shortcut);
        if (reservedCommands.has(normalizedShortcut)) {
            toast.warning(
                isEnglish ? "Shortcut conflicts with system command" : "快捷指令與系統指令衝突",
                isEnglish ? `${shortcut} is reserved by system commands` : `${shortcut} 已被系統保留，請改用其他名稱`
            );
            return;
        }

        const hasDup = items.some((item) =>
            normalizeShortcutKey(item.shortcut) === normalizedShortcut && item.id !== editingId
        );
        if (hasDup) {
            toast.warning(
                isEnglish ? "Duplicate shortcut" : "快捷指令重複",
                isEnglish ? `${shortcut} already exists` : `${shortcut} 已存在，請改用其他名稱`
            );
            return;
        }

        setIsSaving(true);
        try {
            const payload = { shortcut, prompt, note };
            const data = isEditing
                ? await apiWrite<PromptPoolResponse>(`/api/prompt-pool/${encodeURIComponent(editingId)}`, {
                    method: "PUT",
                    body: payload,
                })
                : await apiPostWrite<PromptPoolResponse>("/api/prompt-pool", payload);

            const nextItems = Array.isArray(data.items) ? data.items : [];
            setItems(nextItems);
            resetForm();
            toast.success(isEditing ? (isEnglish ? "Prompt updated" : "已更新 Prompt") : (isEnglish ? "Prompt created" : "已新增 Prompt"));
            loadAuditRecords();
            if (isEditing) {
                setLegacyConflicts((prev) => prev.filter((item) => item.id !== editingId));
            }
        } catch (error) {
            toast.error(
                isEnglish ? "Save failed" : "儲存失敗",
                getErrorMessage(error, isEnglish ? "Unable to save prompt" : "無法儲存 Prompt")
            );
        } finally {
            setIsSaving(false);
        }
    };

    const handleEdit = (item: PromptPoolItem) => {
        setEditingId(item.id);
        setForm({
            shortcut: item.shortcut,
            prompt: item.prompt,
            note: item.note || "",
        });
    };

    const handleDelete = async (item: PromptPoolItem) => {
        const confirmed = window.confirm(
            isEnglish
                ? `Delete shortcut ${item.shortcut}?`
                : `確定要刪除快捷指令 ${item.shortcut} 嗎？`
        );
        if (!confirmed) return;

        setIsDeletingId(item.id);
        try {
            const data = await apiDeleteWrite<PromptPoolResponse>(`/api/prompt-pool/${encodeURIComponent(item.id)}`);
            setItems(Array.isArray(data.items) ? data.items : []);
            if (editingId === item.id) {
                resetForm();
            }
            toast.success(isEnglish ? "Shortcut deleted" : "已刪除快捷指令");
            loadAuditRecords();
        } catch (error) {
            toast.error(
                isEnglish ? "Delete failed" : "刪除失敗",
                getErrorMessage(error, isEnglish ? "Unable to delete this shortcut" : "無法刪除該快捷指令")
            );
        } finally {
            setIsDeletingId("");
        }
    };

    const handleCopyShortcut = async (shortcut: string) => {
        try {
            await navigator.clipboard.writeText(shortcut);
            toast.info(isEnglish ? "Shortcut copied" : "已複製快捷指令", shortcut);
        } catch {
            toast.warning(
                isEnglish ? "Copy failed" : "複製失敗",
                isEnglish ? "Clipboard permission may be blocked by your browser" : "你的瀏覽器可能封鎖了剪貼簿權限"
            );
        }
    };

    const handleApplySuggestedShortcut = (item: PromptPoolItem) => {
        const suggested = buildSuggestedShortcut(item.shortcut, item.id);
        setEditingId(item.id);
        setForm({
            shortcut: suggested,
            prompt: item.prompt,
            note: item.note || "",
        });
        toast.info(
            isEnglish ? "Applied suggested rename" : "已套用建議改名",
            `${item.shortcut} → ${suggested}`
        );
    };

    const handleRepairConflicts = async () => {
        if (isRepairing) return;
        setIsRepairing(true);
        try {
            const data = await apiPostWrite<PromptPoolRepairResponse>("/api/prompt-pool/repair-conflicts");
            setItems(Array.isArray(data.items) ? data.items : []);
            setLegacyConflicts(Array.isArray(data.legacyConflicts) ? data.legacyConflicts : []);

            const repairedCount = Number(data.repairedCount || 0);
            if (repairedCount > 0) {
                toast.success(
                    isEnglish ? "Conflicts repaired" : "衝突修復完成",
                    isEnglish ? `Auto-repaired ${repairedCount} shortcuts` : `已自動修復 ${repairedCount} 筆快捷指令`
                );
            } else if (data.hasLegacyConflicts) {
                toast.warning(
                    isEnglish ? "Conflicts remain" : "仍有衝突未修復",
                    isEnglish ? "Please review and fix manually" : "請逐筆檢查並手動調整"
                );
            } else {
                toast.info(isEnglish ? "No conflicts to repair" : "目前沒有可修復的衝突");
            }
            loadAuditRecords();

            if (editingId) {
                const edited = Array.isArray(data.items)
                    ? data.items.find((item) => item.id === editingId)
                    : null;
                if (edited) {
                    setForm({
                        shortcut: edited.shortcut,
                        prompt: edited.prompt,
                        note: edited.note || "",
                    });
                }
            }
        } catch (error) {
            toast.error(
                isEnglish ? "Repair failed" : "修復失敗",
                getErrorMessage(error, isEnglish ? "Unable to repair legacy conflicts" : "無法自動修復舊資料衝突")
            );
        } finally {
            setIsRepairing(false);
        }
    };

    const openTrendView = (shortcut: string = "") => {
        const safeShortcut = String(shortcut || "").trim();
        if (!safeShortcut) {
            router.push("/dashboard/prompt-trends");
            return;
        }
        router.push(`/dashboard/prompt-trends?shortcut=${encodeURIComponent(safeShortcut)}`);
    };

    return (
        <div className="flex flex-col h-full bg-background p-6 gap-6 overflow-auto">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-cyan-400">
                        {isEnglish ? "Prompt Pool" : "Prompt 指令池"}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                        {isEnglish
                            ? "Manage the mapping from shortcuts to reusable prompts. Trend analysis has moved to a dedicated Prompt Trends page."
                            : "專注在管理「快捷指令 → 常用 Prompt」映射。趨勢分析已移到獨立的「Prompt 趨勢視圖」。"}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() => openTrendView()}
                        className="gap-2"
                    >
                        <Activity className="w-4 h-4" />
                        {isEnglish ? "Trends" : "趨勢視圖"}
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={loadPromptPool}
                        disabled={isLoading}
                        className="gap-2"
                    >
                        <RefreshCcw className={cn("w-4 h-4", isLoading && "animate-spin")} />
                        {isEnglish ? "Refresh" : "重新整理"}
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,420px)_1fr] gap-6">
                <Card className="border-border/80">
                    <CardHeader className="pb-4">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Sparkles className="w-4 h-4 text-primary" />
                            {isEditing
                                ? (isEnglish ? "Edit Prompt Shortcut" : "編輯 Prompt 指令")
                                : (isEnglish ? "Create Prompt Shortcut" : "新增 Prompt 指令")}
                        </CardTitle>
                        <CardDescription>
                            {isEnglish
                                ? "Shortcut cannot contain spaces, e.g. `/daily`, `/weekly_report`, `#brainstorm`"
                                : "快捷指令不能有空白，例如：`/daily`、`/寫週報`、`#brainstorm`"}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs uppercase tracking-wide text-muted-foreground">{isEnglish ? "Shortcut" : "快捷指令"}</label>
                                <input
                                    value={form.shortcut}
                                    onChange={(e) => setForm((prev) => ({ ...prev, shortcut: e.target.value }))}
                                    placeholder="/daily"
                                    className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50"
                                    maxLength={64}
                                    disabled={isSaving}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs uppercase tracking-wide text-muted-foreground">{isEnglish ? "Prompt Content" : "Prompt 內容"}</label>
                                <textarea
                                    value={form.prompt}
                                    onChange={(e) => setForm((prev) => ({ ...prev, prompt: e.target.value }))}
                                    placeholder={isEnglish ? "Example: You are a senior PM. Summarize requirements, then provide 3 actionable plans..." : "例如：你是一位資深產品經理，請先整理需求重點，再提供 3 個可執行方案..."}
                                    className="w-full min-h-[180px] rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50"
                                    maxLength={8000}
                                    disabled={isSaving}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs uppercase tracking-wide text-muted-foreground">{isEnglish ? "Note (Optional)" : "備註 (可選)"}</label>
                                <input
                                    value={form.note}
                                    onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                                    placeholder={isEnglish ? "Example: Weekly report / Code review / Meeting summary" : "例如：週報模板 / Code Review / 會議摘要"}
                                    className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50"
                                    maxLength={240}
                                    disabled={isSaving}
                                />
                            </div>

                            <div className="flex items-center gap-2 pt-2">
                                <Button type="submit" disabled={isSaving} className="gap-2">
                                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : isEditing ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                                    {isEditing ? (isEnglish ? "Update Prompt" : "更新 Prompt") : (isEnglish ? "Create Prompt" : "新增 Prompt")}
                                </Button>
                                {isEditing && (
                                    <Button type="button" variant="ghost" onClick={resetForm} disabled={isSaving} className="gap-2">
                                        <X className="w-4 h-4" />
                                        {isEnglish ? "Cancel Edit" : "取消編輯"}
                                    </Button>
                                )}
                            </div>
                        </form>
                    </CardContent>
                </Card>

                <Card className="border-border/80 min-h-[420px]">
                    <CardHeader className="pb-4">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Keyboard className="w-4 h-4 text-primary" />
                            {isEnglish ? `Saved Shortcuts (${sortedItems.length})` : `已儲存快捷指令 (${sortedItems.length})`}
                        </CardTitle>
                        <CardDescription>
                            {isEnglish
                                ? "Type a shortcut in direct chat and press Tab/Enter to inject the full prompt."
                                : "在直接交談輸入快捷指令並按 Tab/Enter，即可把完整 Prompt 帶入對話框。"}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {legacyConflicts.length > 0 && (
                            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 flex items-start gap-2">
                                <TriangleAlert className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-300" />
                                <div className="leading-relaxed">
                                    {isEnglish
                                        ? `Detected ${legacyConflicts.length} legacy conflicts. These shortcuts may not inject correctly in chat. Run auto-repair first, then review one by one.`
                                        : `偵測到 ${legacyConflicts.length} 筆舊資料衝突。這些快捷指令可能不會在聊天注入生效，可先用「一鍵修復」，再逐筆確認。`}
                                </div>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    onClick={handleRepairConflicts}
                                    disabled={isRepairing}
                                    className="ml-auto flex-shrink-0 gap-1.5 h-7 px-2 text-[11px]"
                                >
                                    {isRepairing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                                    {isEnglish ? "Auto Repair" : "一鍵修復"}
                                </Button>
                            </div>
                        )}
                        {isLoading ? (
                            <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                {isEnglish ? "Loading..." : "讀取中..."}
                            </div>
                        ) : sortedItems.length === 0 ? (
                            <div className="h-56 flex items-center justify-center text-muted-foreground text-sm italic">
                                {isEnglish ? "No prompt shortcuts yet" : "尚未建立任何 Prompt 快捷指令"}
                            </div>
                        ) : (
                            sortedItems.map((item) => (
                                <div key={item.id} className="rounded-xl border border-border bg-card/60 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                                                    {item.shortcut}
                                                </span>
                                                {conflictReasonById.has(item.id) && (
                                                    <span className="inline-flex items-center rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                                                        {conflictReasonLabel(String(conflictReasonById.get(item.id) || ""))}
                                                    </span>
                                                )}
                                                {item.note && (
                                                    <span className="text-xs text-muted-foreground truncate">{item.note}</span>
                                                )}
                                                <span className="inline-flex items-center rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
                                                    {isEnglish
                                                        ? `Recent uses ${Number(item.recentUseCount || 0)}`
                                                        : `近期使用 ${Number(item.recentUseCount || 0)} 次`}
                                                </span>
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-2 line-clamp-3 whitespace-pre-wrap">
                                                {item.prompt}
                                            </p>
                                            <p className="text-[10px] text-muted-foreground/80 mt-2">
                                                {isEnglish ? "Updated: " : "最後更新："}{new Date(item.updatedAt).toLocaleString()}
                                            </p>
                                            {item.lastUsedAt && (
                                                <p className="text-[10px] text-muted-foreground/70 mt-1">
                                                    {isEnglish ? "Last used: " : "最近使用："}{new Date(item.lastUsedAt).toLocaleString()}
                                                </p>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            <button
                                                onClick={() => handleCopyShortcut(item.shortcut)}
                                                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                                                title={isEnglish ? "Copy shortcut" : "複製快捷指令"}
                                            >
                                                <Copy className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleEdit(item)}
                                                className={cn(
                                                    "p-2 rounded-lg text-muted-foreground hover:text-blue-300 hover:bg-blue-500/10 transition-colors",
                                                    editingId === item.id && "text-blue-300 bg-blue-500/10"
                                                )}
                                                title={isEnglish ? "Edit" : "編輯"}
                                            >
                                                <Pencil className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => openTrendView(item.shortcut)}
                                                className="p-2 rounded-lg text-muted-foreground hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors"
                                                title={isEnglish ? "View in trends" : "到趨勢視圖查看"}
                                            >
                                                <Activity className="w-4 h-4" />
                                            </button>
                                            {conflictReasonById.has(item.id) && (
                                                <button
                                                    onClick={() => handleApplySuggestedShortcut(item)}
                                                    className="p-2 rounded-lg text-muted-foreground hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
                                                title={isEnglish ? "Apply suggested rename" : "套用建議改名"}
                                            >
                                                    <Wand2 className="w-4 h-4" />
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleDelete(item)}
                                                disabled={isDeletingId === item.id}
                                                className="p-2 rounded-lg text-muted-foreground hover:text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-60"
                                                title={isEnglish ? "Delete" : "刪除"}
                                            >
                                                {isDeletingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}

                        <div className="rounded-lg border border-border bg-secondary/30 p-3 mt-2">
                            <div className="flex items-center justify-between mb-2">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    {isEnglish ? "Recent Activity" : "最近異動記錄"}
                                </p>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={loadAuditRecords}
                                    disabled={isAuditLoading}
                                    className="h-7 px-2 text-[11px]"
                                >
                                    {isAuditLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : (isEnglish ? "Refresh" : "更新")}
                                </Button>
                            </div>
                            {auditRecords.length === 0 ? (
                                <p className="text-[11px] text-muted-foreground italic">{isEnglish ? "No activity records yet" : "尚無異動記錄"}</p>
                            ) : (
                                <div className="space-y-1.5">
                                    {auditRecords.slice(0, 8).map((record, idx) => (
                                        <div key={`${record.ts}-${idx}`} className="text-[11px] text-muted-foreground flex items-center justify-between gap-2">
                                            <span className="truncate">{describeAuditRecord(record)}</span>
                                            <span className="text-[10px] text-muted-foreground/80 whitespace-nowrap">
                                                {new Date(record.ts).toLocaleString()}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
