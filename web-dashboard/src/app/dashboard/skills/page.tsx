"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { BookOpen, AlertCircle, CheckCircle2, RefreshCcw, ChevronRight, Zap, TriangleAlert, Plus, Pencil, X, Search, Download, Upload, Store, Tags, Trash2, Activity, Database, Globe, ArrowUpDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast-provider";
import { apiGet, apiPost, apiPostWrite } from "@/lib/api-client";
import { useI18n } from "@/components/I18nProvider";

type InstalledSkill = {
    id: string;
    title: string;
    content: string;
    isOptional: boolean;
    isDeletable?: boolean;
    isEnabled: boolean;
};

type MarketplaceSkill = {
    id: string;
    title: string;
    description: string;
    original_description?: string;
    description_zh?: string;
    category?: string;
    category_name?: {
        zh?: string;
        en?: string;
    };
    repoUrl?: string;
};

type MarketplaceResponse = {
    skills?: MarketplaceSkill[];
    total?: number;
    categoryCounts?: Record<string, number>;
};

type SkillImportResponse = {
    success?: boolean;
    importedCount?: number;
    totalReceived?: number;
    enabledAdded?: number;
    skippedMandatory?: string[];
    skippedExisting?: string[];
    skippedInvalid?: string[];
    error?: string;
};

type ImportConflictStrategy = "overwrite" | "skip" | "new_only";

type BaseImportedSkill = {
    id: string;
    title: string;
    content: string;
    category: string;
    isEnabled: boolean;
    isOptional: boolean;
};

type ImportedSkillPreview = BaseImportedSkill & {
    isExisting: boolean;
    isMandatoryConflict: boolean;
};

type ImportDraft = {
    fileName: string;
    format: "json" | "markdown" | "auto";
    rawText: string;
    skills: ImportedSkillPreview[];
    total: number;
    newCount: number;
    existingCount: number;
    mandatoryConflictCount: number;
};

type InstalledListFilter = "all" | "enabled" | "core";
type InstalledSortMode = "enabled_first" | "core_first" | "title_asc" | "title_desc";

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
}

function parseFilenameFromDisposition(disposition: string | null): string | null {
    if (!disposition) return null;

    const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (encodedMatch && encodedMatch[1]) {
        try {
            return decodeURIComponent(encodedMatch[1].trim());
        } catch {
            return encodedMatch[1].trim();
        }
    }

    const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
    if (plainMatch && plainMatch[1]) {
        return plainMatch[1].trim();
    }

    return null;
}

async function parseExportError(response: Response): Promise<string> {
    const raw = await response.text();
    if (!raw) return `匯出失敗 (${response.status})`;

    try {
        const parsed = JSON.parse(raw) as { error?: string; message?: string };
        if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
        if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message;
    } catch {
        // 非 JSON 回應時直接回傳文字
    }
    return raw;
}

function detectImportFormat(fileName: string): "json" | "markdown" | "auto" {
    const lower = fileName.trim().toLowerCase();
    if (lower.endsWith(".json")) return "json";
    if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
    return "auto";
}

function toSafeSkillId(input: string, fallback: string): string {
    const normalized = String(input || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return normalized || fallback;
}

function normalizeImportedSkill(raw: unknown, index: number): BaseImportedSkill | null {
    if (!raw || typeof raw !== "object") return null;
    const record = raw as Record<string, unknown>;
    const title = String(record.title || record.name || `Imported Skill ${index + 1}`).trim();
    const idSeed = String(record.id || title || "").trim();
    const id = toSafeSkillId(idSeed, `imported_skill_${index + 1}`);
    const content = String(record.content || "").trim();
    if (!content) return null;

    return {
        id,
        title: title || id,
        content,
        category: String(record.category || "lib").trim().toLowerCase() || "lib",
        isEnabled: record.isEnabled === true,
        isOptional: record.isOptional !== false,
    };
}

function parseImportedSkillsFromJson(rawText: string): BaseImportedSkill[] {
    const parsed = JSON.parse(rawText) as unknown;
    const list = Array.isArray(parsed)
        ? parsed
        : (parsed && typeof parsed === "object" && Array.isArray((parsed as { skills?: unknown[] }).skills)
            ? (parsed as { skills: unknown[] }).skills
            : null);
    if (!list) {
        throw new Error("JSON 檔案格式不符合技能備份結構");
    }

    const entries: BaseImportedSkill[] = [];
    for (let i = 0; i < list.length; i += 1) {
        const normalized = normalizeImportedSkill(list[i], i);
        if (normalized) entries.push(normalized);
    }
    return entries;
}

function parseImportedSkillsFromMarkdown(rawText: string): BaseImportedSkill[] {
    const raw = String(rawText || "").replace(/^\uFEFF/, "").trim();
    if (!raw) return [];

    const sectionPattern = /(?:^|\n)---\n\n## ([^\n]+)\n\n- ID: ([^\n]+)\n- Category: ([^\n]+)\n- Enabled: (true|false)\n- Optional: (true|false)\n\n([\s\S]*?)(?=\n---\n\n## |\s*$)/g;
    const entries: BaseImportedSkill[] = [];
    let match: RegExpExecArray | null = null;
    while ((match = sectionPattern.exec(raw)) !== null) {
        const normalized = normalizeImportedSkill({
            title: String(match[1] || "").trim(),
            id: String(match[2] || "").trim(),
            category: String(match[3] || "").trim().toLowerCase(),
            isEnabled: String(match[4] || "").trim().toLowerCase() === "true",
            isOptional: String(match[5] || "").trim().toLowerCase() === "true",
            content: String(match[6] || "").trim(),
        }, entries.length);
        if (normalized) entries.push(normalized);
    }

    if (entries.length > 0) return entries;

    const headingMatch = raw.match(/^#+\s+(.+)$/m);
    const bracketMatch = raw.match(/^【已載入技能：(.+?)】/m);
    const inferredTitle = headingMatch?.[1]?.trim() || bracketMatch?.[1]?.trim() || "Imported Skill";
    const single = normalizeImportedSkill({
        id: inferredTitle,
        title: inferredTitle,
        content: raw,
        category: "lib",
        isEnabled: false,
        isOptional: true,
    }, 0);
    return single ? [single] : [];
}

function buildImportDraft(
    fileName: string,
    rawText: string,
    currentSkills: InstalledSkill[]
): ImportDraft {
    const format = detectImportFormat(fileName);

    let imported: BaseImportedSkill[] = [];
    if (format === "json") {
        imported = parseImportedSkillsFromJson(rawText);
    } else if (format === "markdown") {
        imported = parseImportedSkillsFromMarkdown(rawText);
    } else {
        try {
            imported = parseImportedSkillsFromJson(rawText);
        } catch {
            imported = parseImportedSkillsFromMarkdown(rawText);
        }
    }

    if (imported.length === 0) {
        throw new Error("找不到可匯入的技能內容");
    }

    const existingById = new Map(currentSkills.map((skill) => [skill.id, skill]));
    const deduped = new Map<string, BaseImportedSkill>();
    for (const item of imported) {
        if (!deduped.has(item.id)) {
            deduped.set(item.id, item);
        }
    }

    const skills = Array.from(deduped.values()).map<ImportedSkillPreview>((entry) => {
        const existing = existingById.get(entry.id);
        const isExisting = Boolean(existing);
        const isMandatoryConflict = Boolean(existing && !existing.isOptional);
        return {
            ...entry,
            isExisting,
            isMandatoryConflict,
        };
    });

    const total = skills.length;
    const existingCount = skills.filter((item) => item.isExisting).length;
    const mandatoryConflictCount = skills.filter((item) => item.isMandatoryConflict).length;
    const newCount = skills.filter((item) => !item.isExisting && !item.isMandatoryConflict).length;

    return {
        fileName,
        format,
        rawText,
        skills,
        total,
        newCount,
        existingCount,
        mandatoryConflictCount,
    };
}

// ── Inject Confirm Dialog ───────────────────────────────────────────────────
function InjectConfirmDialog({
    open, onOpenChange, onConfirm, isLoading,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onConfirm: () => void;
    isLoading: boolean;
}) {
    return (
        <Dialog open={open} onOpenChange={isLoading ? undefined : onOpenChange}>
            <DialogContent showCloseButton={!isLoading} className="bg-card border-border text-foreground max-w-sm">
                <DialogHeader>
                    <div className="w-12 h-12 rounded-xl border bg-primary/10 border-primary/20 flex items-center justify-center mb-2">
                        <Zap className="w-5 h-5 text-primary" />
                    </div>
                    <DialogTitle className="text-foreground text-base">注入技能書？</DialogTitle>
                    <DialogDescription className="text-muted-foreground text-sm leading-relaxed">
                        系統將依據目前配置，重新開啟全新的 Gemini 對話視窗進行注入。過往設定的人格與歷史記憶將會完整保留。
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    <div className="flex items-start gap-2 rounded-lg bg-secondary/60 border border-border/50 px-3 py-2.5">
                        <TriangleAlert className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-muted-foreground">此動作將暫時開新視窗中斷目前對話，但人格設定與長期記憶不受影響。</p>
                    </div>
                    <div className="rounded-lg bg-secondary/40 border border-border/30 px-3 py-2">
                        <p className="text-[11px] text-muted-foreground mb-1 font-medium">確認後將自動執行：</p>
                        <ol className="text-[11px] text-muted-foreground/80 space-y-0.5 list-decimal list-inside">
                            <li>清除技能快取</li>
                            <li>重新開啟 Gemini 通訊視窗</li>
                            <li>自存檔載入人格，並注入所有技能記憶</li>
                        </ol>
                    </div>
                </div>
                <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="outline" className="flex-1 bg-transparent border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                        onClick={() => onOpenChange(false)} disabled={isLoading}>取消</Button>
                    <Button className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={onConfirm} disabled={isLoading}>
                        {isLoading ? (
                            <span className="flex items-center gap-1.5"><RefreshCcw className="w-3.5 h-3.5 animate-spin" />注入中...</span>
                        ) : (
                            <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" />確認注入</span>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Inject Done Dialog ──────────────────────────────────────────────────────
function InjectDoneDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="bg-card border-border text-foreground max-w-sm" showCloseButton={false}>
                <DialogHeader>
                    <div className="w-12 h-12 rounded-xl border bg-green-500/10 border-green-500/20 flex items-center justify-center mb-2">
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                    </div>
                    <DialogTitle className="text-foreground text-base">技能注入完成 ✅</DialogTitle>
                    <DialogDescription className="text-muted-foreground text-sm">
                        已於新的 Gemini 對話視窗中完成注入。人格設定與歷史記憶已從存檔完整還原，3 秒後自動關閉。
                    </DialogDescription>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
}

// ── Skill Editor Dialog ─────────────────────────────────────────────────────
function SkillEditorDialog({
    open, onOpenChange, mode, initialId = "", initialContent = "", onSaved,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    mode: "create" | "edit";
    initialId?: string;
    initialContent?: string;
    onSaved: () => void;
}) {
    const [id, setId] = useState(initialId);
    const [content, setContent] = useState(initialContent);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setId(initialId);
            setContent(initialContent || "# 新技能\n\n在這裡輸入 Markdown 格式的提示詞...");
            setError(null);
        }
    }, [open, initialId, initialContent]);

    const handleSubmit = async () => {
        if (!id.trim()) { setError("請填寫技能 ID"); return; }
        if (!content.trim()) { setError("請填寫技能內容"); return; }

        setIsLoading(true); setError(null);
        try {
            const endpoint = mode === "create" ? "/api/skills/create" : "/api/skills/update";
            const data = await apiPost<{ success?: boolean; error?: string }>(endpoint, {
                id: id.trim(),
                content,
            });
            if (data.success) {
                onOpenChange(false);
                onSaved();
            } else {
                setError(data.error || "儲存失敗");
            }
        } catch (error: unknown) {
            setError(getErrorMessage(error, "請求發送失敗"));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={isLoading ? undefined : onOpenChange}>
            <DialogContent showCloseButton={!isLoading} className="bg-card border-border text-foreground max-w-2xl max-h-[90vh] flex flex-col">
                <DialogHeader className="flex-shrink-0">
                    <div className="w-10 h-10 rounded-xl border bg-primary/10 border-primary/20 flex items-center justify-center mb-2">
                        {mode === "create" ? <Plus className="w-5 h-5 text-primary" /> : <Pencil className="w-5 h-5 text-primary" />}
                    </div>
                    <DialogTitle className="text-foreground text-base">
                        {mode === "create" ? "新增自訂技能" : "編輯自訂技能"}
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground text-sm">
                        編輯 Markdown 格式的技能提示詞。將自動存為 <code>src/skills/lib/{id || '<id>'}.md</code>
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto space-y-4 py-2 min-h-[300px] flex flex-col">
                    <div className="flex-shrink-0">
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">檔案 ID (英文數字底線)</label>
                        <input
                            value={id}
                            onChange={e => setId(e.target.value)}
                            disabled={mode === "edit"}
                            placeholder="my_custom_skill"
                            className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all font-mono"
                        />
                    </div>
                    <div className="flex-1 flex flex-col min-h-[200px]">
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">提示詞內容 (Markdown)</label>
                        <textarea
                            value={content}
                            onChange={e => setContent(e.target.value)}
                            className="w-full flex-1 bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm text-foreground/90 font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all resize-none"
                            placeholder="# 標題\n\n對 AI 的系統指令..."
                        />
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2 flex-shrink-0">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-2 flex-shrink-0 pt-2">
                    <Button variant="outline" className="flex-1 bg-transparent border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                        onClick={() => onOpenChange(false)} disabled={isLoading}>取消</Button>
                    <Button className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleSubmit} disabled={isLoading}>
                        {isLoading ? (
                            <span className="flex items-center gap-1.5"><RefreshCcw className="w-3.5 h-3.5 animate-spin" />儲存中...</span>
                        ) : (
                            <span className="flex items-center gap-1.5">
                                {mode === "create" ? <Plus className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                儲存技能
                            </span>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Install Success Dialog ──────────────────────────────────────────────────
function InstallSuccessDialog({
    open, onOpenChange
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
}) {
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="bg-card border-border text-foreground max-w-sm sm:max-w-[425px]">
                <DialogHeader className="flex flex-col items-center gap-2 pt-2">
                    <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex flex-col items-center justify-center">
                        <CheckCircle2 className="w-8 h-8 text-primary" />
                    </div>
                    <DialogTitle className="text-foreground text-lg mt-2 font-bold">
                        {isEnglish ? "Skill Installed Successfully" : "技能已安裝成功"}
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground text-sm text-center leading-relaxed mt-2" asChild>
                        <div>
                            {isEnglish ? (
                                <>
                                    The new skill has been added to <strong>Loaded Modules</strong>.<br />
                                    Switch to <strong>Loaded Modules</strong>, enable it manually,<br />
                                    then click <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 mx-1 font-medium"><Zap className="w-3 h-3" />Inject Skills</span> in the top-right.
                                </>
                            ) : (
                                <>
                                    新技能已經加入「已載入模組」標籤中囉！<br />
                                    請記得切換至 <strong>「已載入模組」</strong> 並將其 <strong>手動啟用</strong>，<br />
                                    最後再點擊右上角的 <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 mx-1 font-medium"><Zap className="w-3 h-3" />注入技能書</span> 即可。
                                </>
                            )}
                        </div>
                    </DialogDescription>
                </DialogHeader>
                <div className="flex justify-center mt-4">
                    <Button
                        className="bg-primary hover:bg-primary/90 text-primary-foreground w-full focus:ring-2 focus:ring-primary/50 outline-none"
                        onClick={() => onOpenChange(false)}
                    >
                        {isEnglish ? "Got it" : "我知道了"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Delete Confirm Dialog ───────────────────────────────────────────────────
function DeleteConfirmDialog({
    open, onOpenChange, onConfirm, isLoading, skillTitle
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onConfirm: () => void;
    isLoading: boolean;
    skillTitle: string;
}) {
    return (
        <Dialog open={open} onOpenChange={isLoading ? undefined : onOpenChange}>
            <DialogContent showCloseButton={!isLoading} className="bg-card border-border text-foreground max-w-sm">
                <DialogHeader>
                    <div className="w-12 h-12 rounded-xl border bg-red-500/10 border-red-500/20 flex items-center justify-center mb-2">
                        <Trash2 className="w-5 h-5 text-red-500" />
                    </div>
                    <DialogTitle className="text-foreground text-base">刪除技能？</DialogTitle>
                    <DialogDescription className="text-muted-foreground text-sm leading-relaxed">
                        您確定要刪除「<span className="text-red-500 font-medium">{skillTitle}</span>」嗎？此動作將永久移除該技能的 Markdown 檔案，且無法復原。
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="outline" className="flex-1 bg-transparent border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                        onClick={() => onOpenChange(false)} disabled={isLoading}>取消</Button>
                    <Button className="flex-1 bg-destructive hover:bg-destructive/90 text-destructive-foreground" onClick={onConfirm} disabled={isLoading}>
                        {isLoading ? (
                            <span className="flex items-center gap-1.5"><RefreshCcw className="w-3.5 h-3.5 animate-spin" />刪除中...</span>
                        ) : (
                            <span className="flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" />確認刪除</span>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Import Preview Dialog ───────────────────────────────────────────────────
function ImportPreviewDialog({
    open,
    onOpenChange,
    draft,
    strategy,
    onStrategyChange,
    onConfirm,
    isLoading,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    draft: ImportDraft | null;
    strategy: ImportConflictStrategy;
    onStrategyChange: (value: ImportConflictStrategy) => void;
    onConfirm: () => void;
    isLoading: boolean;
}) {
    if (!draft) return null;

    const importableCount = strategy === "overwrite"
        ? Math.max(0, draft.total - draft.mandatoryConflictCount)
        : draft.newCount;
    const previewSkills = draft.skills.slice(0, 12);

    return (
        <Dialog open={open} onOpenChange={isLoading ? undefined : onOpenChange}>
            <DialogContent showCloseButton={!isLoading} className="relative bg-card border-border text-foreground max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
                <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
                <DialogHeader className="flex-shrink-0 pb-1">
                    <div className="w-11 h-11 rounded-2xl border bg-primary/10 border-primary/30 flex items-center justify-center mb-2 shadow-[0_0_20px_-10px_var(--primary)]">
                        <Upload className="w-5 h-5 text-primary" />
                    </div>
                    <DialogTitle className="text-foreground text-lg tracking-tight">匯入預覽與衝突策略</DialogTitle>
                    <DialogDescription className="text-muted-foreground text-sm">
                        匯入前先確認內容與策略，避免覆蓋到不該變動的技能。
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
                    <div className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2.5">
                        <p className="text-[11px] text-muted-foreground mb-1">來源檔案</p>
                        <p className="text-xs font-mono text-foreground truncate">{draft.fileName}</p>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="rounded-xl border border-border bg-secondary/30 px-3 py-2.5">
                            <p className="text-[11px] text-muted-foreground">總技能數</p>
                            <p className="text-sm font-semibold text-foreground">{draft.total}</p>
                        </div>
                        <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-3 py-2.5">
                            <p className="text-[11px] text-green-600/80 dark:text-green-300/80">新技能</p>
                            <p className="text-sm font-semibold text-green-600 dark:text-green-300">{draft.newCount}</p>
                        </div>
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
                            <p className="text-[11px] text-amber-600/80 dark:text-amber-300/80">重複項目</p>
                            <p className="text-sm font-semibold text-amber-600 dark:text-amber-300">{draft.existingCount}</p>
                        </div>
                        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5">
                            <p className="text-[11px] text-red-600/80 dark:text-red-300/80">核心衝突</p>
                            <p className="text-sm font-semibold text-red-600 dark:text-red-300">{draft.mandatoryConflictCount}</p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">衝突策略</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <label className={`rounded-xl border px-3 py-3 cursor-pointer transition-all ${strategy === "new_only" ? "border-primary/60 bg-primary/10 shadow-sm" : "border-border bg-secondary/20 hover:bg-secondary/40"}`}>
                                <input
                                    type="radio"
                                    className="sr-only"
                                    checked={strategy === "new_only"}
                                    onChange={() => onStrategyChange("new_only")}
                                />
                                <div className="flex items-start gap-2">
                                    <CheckCircle2 className={`w-4 h-4 mt-0.5 ${strategy === "new_only" ? "text-primary" : "text-muted-foreground"}`} />
                                    <div>
                                        <p className="text-xs font-semibold text-foreground">只新增（建議）</p>
                                        <p className="text-[11px] text-muted-foreground mt-0.5">僅匯入新技能，不處理重複項目。</p>
                                        <p className="text-[11px] text-primary mt-1">預計匯入 {draft.newCount}</p>
                                    </div>
                                </div>
                            </label>

                            <label className={`rounded-xl border px-3 py-3 cursor-pointer transition-all ${strategy === "skip" ? "border-primary/60 bg-primary/10 shadow-sm" : "border-border bg-secondary/20 hover:bg-secondary/40"}`}>
                                <input
                                    type="radio"
                                    className="sr-only"
                                    checked={strategy === "skip"}
                                    onChange={() => onStrategyChange("skip")}
                                />
                                <div className="flex items-start gap-2">
                                    <ChevronRight className={`w-4 h-4 mt-0.5 ${strategy === "skip" ? "text-primary" : "text-muted-foreground"}`} />
                                    <div>
                                        <p className="text-xs font-semibold text-foreground">略過重複</p>
                                        <p className="text-[11px] text-muted-foreground mt-0.5">送完整檔案，後端略過同 ID。</p>
                                        <p className="text-[11px] text-primary mt-1">預計匯入 {draft.newCount}</p>
                                    </div>
                                </div>
                            </label>

                            <label className={`rounded-xl border px-3 py-3 cursor-pointer transition-all ${strategy === "overwrite" ? "border-primary/60 bg-primary/10 shadow-sm" : "border-border bg-secondary/20 hover:bg-secondary/40"}`}>
                                <input
                                    type="radio"
                                    className="sr-only"
                                    checked={strategy === "overwrite"}
                                    onChange={() => onStrategyChange("overwrite")}
                                />
                                <div className="flex items-start gap-2">
                                    <AlertCircle className={`w-4 h-4 mt-0.5 ${strategy === "overwrite" ? "text-primary" : "text-muted-foreground"}`} />
                                    <div>
                                        <p className="text-xs font-semibold text-foreground">覆蓋既有</p>
                                        <p className="text-[11px] text-muted-foreground mt-0.5">同 ID 直接更新為備份內容。</p>
                                        <p className="text-[11px] text-primary mt-1">預計匯入 {Math.max(0, draft.total - draft.mandatoryConflictCount)}</p>
                                    </div>
                                </div>
                            </label>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                            匯入預覽（前 {previewSkills.length} 筆）
                        </p>
                        <div className="rounded-xl border border-border bg-secondary/20 p-2 space-y-1.5 max-h-[220px] overflow-y-auto">
                            {previewSkills.map((item) => (
                                <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 bg-card/70 border border-border/50">
                                    <div className="min-w-0">
                                        <p className="text-xs font-semibold text-foreground truncate">{item.title}</p>
                                        <p className="text-[11px] text-muted-foreground font-mono truncate">{item.id}</p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        {item.isMandatoryConflict && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-red-500/15 text-red-500 border border-red-500/30">核心衝突</span>
                                        )}
                                        {!item.isMandatoryConflict && item.isExisting && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-500 border border-amber-500/30">重複</span>
                                        )}
                                        {!item.isExisting && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-green-500/15 text-green-500 border border-green-500/30">新增</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {draft.total > previewSkills.length && (
                                <p className="text-[11px] text-muted-foreground text-center pt-1">
                                    尚有 {draft.total - previewSkills.length} 筆未顯示
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-2 flex-shrink-0 pt-2 border-t border-border/60 mt-1">
                    <Button
                        variant="outline"
                        className="flex-1 bg-transparent border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                        onClick={() => onOpenChange(false)}
                        disabled={isLoading}
                    >
                        取消
                    </Button>
                    <Button
                        className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
                        onClick={onConfirm}
                        disabled={isLoading || importableCount <= 0}
                    >
                        {isLoading ? (
                            <span className="flex items-center gap-1.5"><RefreshCcw className="w-3.5 h-3.5 animate-spin" />匯入中...</span>
                        ) : (
                            <span className="flex items-center gap-1.5"><Upload className="w-3.5 h-3.5" />開始匯入 ({importableCount})</span>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

const MARKET_CATEGORIES = [
    { id: 'all', name: '全部類別', name_en: 'All Categories' },
    { id: 'ai-and-llms', name: '人工智慧與模型', name_en: 'AI & LLMs' },
    { id: 'apple-apps-and-services', name: 'Apple 應用與服務', name_en: 'Apple Apps' },
    { id: 'browser-and-automation', name: '瀏覽器與自動化', name_en: 'Browser Automation' },
    { id: 'calendar-and-scheduling', name: '行事曆與排程', name_en: 'Calendar' },
    { id: 'clawdbot-tools', name: 'Clawdbot 工具', name_en: 'Clawdbot Tools' },
    { id: 'cli-utilities', name: '命令列工具', name_en: 'CLI Utilities' },
    { id: 'coding-agents-and-ides', name: '程式碼代理與 IDE', name_en: 'Coding Agents' },
    { id: 'communication', name: '通訊聯絡', name_en: 'Communication' },
    { id: 'data-and-analytics', name: '數據與分析', name_en: 'Data Analytics' },
    { id: 'devops-and-cloud', name: 'DevOps 與雲端', name_en: 'DevOps & Cloud' },
    { id: 'finance', name: '金融理財', name_en: 'Finance' },
    { id: 'gaming', name: '遊戲娛樂', name_en: 'Gaming' },
    { id: 'git-and-github', name: 'Git & GitHub', name_en: 'Git & GitHub' },
    { id: 'health-and-fitness', name: '健康與健身', name_en: 'Health & Fitness' },
    { id: 'image-and-video-generation', name: '圖像與影片生成', name_en: 'Image & Video' },
    { id: 'ios-and-macos-development', name: 'iOS/macOS 開發', name_en: 'iOS/macOS Dev' },
    { id: 'marketing-and-sales', name: '行銷與銷售', name_en: 'Marketing & Sales' },
    { id: 'media-and-streaming', name: '媒體與串流', name_en: 'Media' },
    { id: 'moltbook', name: 'Moltbook', name_en: 'Moltbook' },
    { id: 'notes-and-pkm', name: '筆記與知識管理', name_en: 'Notes & PKM' },
    { id: 'pdf-and-documents', name: 'PDF 與文件', name_en: 'PDF & Docs' },
    { id: 'personal-development', name: '個人成長', name_en: 'Personal Dev' },
    { id: 'productivity-and-tasks', name: '生產力與任務', name_en: 'Productivity' },
    { id: 'search-and-research', name: '搜索與研究', name_en: 'Search & Research' },
    { id: 'security-and-passwords', name: '安全與密碼', name_en: 'Security' },
    { id: 'self-hosted-and-automation', name: '自託管與自動化', name_en: 'Self-Hosted' },
    { id: 'shopping-and-e-commerce', name: '購物與電商', name_en: 'E-commerce' },
    { id: 'smart-home-and-iot', name: '智慧家庭與物聯網', name_en: 'Smart Home' },
    { id: 'speech-and-transcription', name: '語音與逐字稿', name_en: 'Speech' },
    { id: 'transportation', name: '交通運輸', name_en: 'Transportation' },
    { id: 'web-and-frontend-development', name: '網頁與前端開發', name_en: 'Web Dev' }
];

// ── Main Page ───────────────────────────────────────────────────────────────
export default function SkillsPage() {
    const toast = useToast();
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    const [activeTab, setActiveTab] = useState<"installed" | "marketplace">("installed");

    // Installed Skills
    const [skills, setSkills] = useState<InstalledSkill[]>([]);
    const [selectedSkill, setSelectedSkill] = useState<InstalledSkill | null>(null);
    const [hasUnsyncedChanges, setHasUnsyncedChanges] = useState(false);

    // Marketplace
    const [marketSkills, setMarketSkills] = useState<MarketplaceSkill[]>([]);
    const [selectedMarketSkill, setSelectedMarketSkill] = useState<MarketplaceSkill | null>(null);
    const [marketTotal, setMarketTotal] = useState(0);
    const [marketPage, setMarketPage] = useState(1);
    const [marketSearchText, setMarketSearchText] = useState("");
    const [marketSearchQuery, setMarketSearchQuery] = useState("");
    const [marketCategory, setMarketCategory] = useState("all");
    const [isMarketLoading, setIsMarketLoading] = useState(false);
    const [marketCategoryCounts, setMarketCategoryCounts] = useState<Record<string, number>>({});
    const [installingId, setInstallingId] = useState<string | null>(null);

    const [isInjecting, setIsInjecting] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [showDone, setShowDone] = useState(false);

    // Editor state
    const [showEditor, setShowEditor] = useState(false);
    const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
    const [editTarget, setEditTarget] = useState<{ id: string, content: string }>({ id: "", content: "" });

    // Success dialog
    const [showInstallSuccess, setShowInstallSuccess] = useState(false);

    // Delete dialog
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // Sync hint
    const [showSyncHint, setShowSyncHint] = useState(false);
    const [syncHintType, setSyncHintType] = useState<"enable" | "delete">("enable");
    const [exportingTarget, setExportingTarget] = useState<"all" | "selected" | "checked" | null>(null);
    const [checkedSkillIds, setCheckedSkillIds] = useState<string[]>([]);
    const [installedSearchText, setInstalledSearchText] = useState("");
    const [installedListFilter, setInstalledListFilter] = useState<InstalledListFilter>("all");
    const [installedSortMode, setInstalledSortMode] = useState<InstalledSortMode>("enabled_first");
    const [isPreparingImport, setIsPreparingImport] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [showImportPreview, setShowImportPreview] = useState(false);
    const [importDraft, setImportDraft] = useState<ImportDraft | null>(null);
    const [importStrategy, setImportStrategy] = useState<ImportConflictStrategy>("new_only");
    const importFileInputRef = useRef<HTMLInputElement | null>(null);

    const loadSkills = useCallback(() => {
        apiGet<InstalledSkill[]>("/api/skills")
            .then((data) => {
                if (Array.isArray(data)) {
                    setSkills(data);
                    setSelectedSkill((previousSelected) => {
                        const fallback = data[0] ?? null;
                        if (!previousSelected) return fallback;
                        const updated = data.find((skill) => skill.id === previousSelected.id);
                        return updated ?? fallback;
                    });
                    setCheckedSkillIds((prev) => {
                        if (prev.length === 0) return prev;
                        const idSet = new Set(data.map((skill) => skill.id));
                        return prev.filter((id) => idSet.has(id));
                    });
                }
            })
            .catch((err) => console.error(err));
    }, []);

    const loadMarketplace = useCallback(async (page: number, search: string, category: string) => {
        setIsMarketLoading(true);
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: "20",
                search,
                category
            });
            const data = await apiGet<MarketplaceResponse>(`/api/skills/marketplace?${params.toString()}`);
            setMarketSkills(data.skills || []);
            setMarketTotal(data.total || 0);
            if (data.categoryCounts) {
                setMarketCategoryCounts(data.categoryCounts);
            }

        } catch (err) {
            console.error("Failed to load marketplace:", err);
        } finally {
            setIsMarketLoading(false);
        }
    }, []);

    useEffect(() => {
        loadSkills();
    }, [loadSkills]);

    // Re-fetch marketplace when page or search query changes
    useEffect(() => {
        loadMarketplace(marketPage, marketSearchQuery, marketCategory);
    }, [loadMarketplace, marketPage, marketSearchQuery, marketCategory]);

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setMarketPage(1);
        setMarketSearchQuery(marketSearchText);
    };

    const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setMarketCategory(e.target.value);
        setMarketPage(1);
    };

    const toggleSkill = async (id: string, enabled: boolean) => {
        try {
            const data = await apiPostWrite<{ success?: boolean; error?: string }>("/api/skills/toggle", {
                id,
                enabled,
            });
            if (data.success) {
                setSkills((prev) =>
                    prev.map((s) => (s.id === id ? { ...s, isEnabled: enabled } : s))
                );
                if (selectedSkill?.id === id) {
                    setSelectedSkill((prev) => prev ? { ...prev, isEnabled: enabled } : null);
                }
                if (enabled) {
                    setSyncHintType("enable");
                    setShowSyncHint(true);
                }
                setHasUnsyncedChanges(true);
            }
        } catch (err) {
            console.error(err);
        }
    };

    const installSkill = async (skill: MarketplaceSkill) => {
        if (!skill.repoUrl) {
            toast.error("安裝失敗", "技能來源缺少 repo URL。");
            return;
        }
        setInstallingId(skill.id);
        try {
            const data = await apiPost<{ success?: boolean; error?: string }>("/api/skills/marketplace/install", {
                id: skill.id,
                repoUrl: skill.repoUrl,
            });
            if (data.success) {
                setHasUnsyncedChanges(true);
                loadSkills();
                setShowInstallSuccess(true);
            }
        } catch (err) {
            console.error("Install failed:", err);
            toast.error("安裝失敗", "技能安裝失敗，請稍後再試。");
        } finally {
            setInstallingId(null);
        }
    };

    const handleInject = async () => {
        setIsInjecting(true);
        try {
            const data = await apiPost<{ success?: boolean; message?: string; error?: string }>("/api/skills/inject");

            if (data.success) {
                setShowConfirm(false);
                setHasUnsyncedChanges(false);
                setShowDone(true);
                setTimeout(() => {
                    setShowDone(false);
                    setIsInjecting(false);
                    setShowSyncHint(false);
                    loadSkills();
                }, 3000);
            } else {
                console.error("Injection failed:", data.message || data.error);
                toast.error("注入失敗", data.message || data.error || "未知伺服器錯誤");
                setIsInjecting(false);
            }
        } catch (error: unknown) {
            console.error(error);
            toast.error("請求失敗", getErrorMessage(error, "請檢查網路連線或伺服器狀態"));
            setIsInjecting(false);
        }
    };

    const handleDeleteSkill = async () => {
        if (!selectedSkill) return;
        setIsDeleting(true);
        try {
            const data = await apiPost<{ success?: boolean; error?: string }>("/api/skills/delete", {
                id: selectedSkill.id,
            });
            if (data.success) {
                setShowDeleteConfirm(false);
                setHasUnsyncedChanges(true); // 檔案刪除後也需要重新注入以同步內部狀態
                
                // ── [v9.1.13] 優化：僅在刪除「已啟用」的技能時顯示提示 ──
                if (selectedSkill.isEnabled) {
                    setSyncHintType("delete");
                    setShowSyncHint(true);
                }
                
                // 從列表中移除
                const updatedSkills = skills.filter(s => s.id !== selectedSkill.id);
                setSkills(updatedSkills);
                
                // 選取下一個或清空
                if (updatedSkills.length > 0) {
                    setSelectedSkill(updatedSkills[0]);
                } else {
                    setSelectedSkill(null);
                }
                setCheckedSkillIds((prev) => prev.filter((id) => id !== selectedSkill.id));
            } else {
                toast.error("刪除失敗", data.error || "刪除失敗");
            }
        } catch (err) {
            console.error(err);
            toast.error("請求失敗", "請求發送失敗");
        } finally {
            setIsDeleting(false);
        }
    };

    const handleCreateSkill = () => {
        setEditorMode("create");
        setEditTarget({ id: "", content: "" });
        setShowEditor(true);
    };

    const handleEditSkill = (e: React.MouseEvent, skill: InstalledSkill) => {
        e.stopPropagation();
        setEditorMode("edit");
        setEditTarget({ id: skill.id, content: skill.content });
        setShowEditor(true);
    };

    const toggleCheckedSkill = (id: string, checked: boolean) => {
        setCheckedSkillIds((prev) => {
            if (checked) {
                if (prev.includes(id)) return prev;
                return [...prev, id];
            }
            return prev.filter((item) => item !== id);
        });
    };

    const toggleAllCheckedSkills = (checked: boolean, targetSkills: InstalledSkill[]) => {
        const targetIds = targetSkills.map((skill) => skill.id);
        if (targetIds.length === 0) return;

        setCheckedSkillIds((prev) => {
            if (checked) {
                const merged = new Set([...prev, ...targetIds]);
                return [...merged];
            }
            const removeSet = new Set(targetIds);
            return prev.filter((id) => !removeSet.has(id));
        });
    };

    const downloadSkillsBook = async (target: "all" | "selected" | "checked") => {
        if (target === "selected" && !selectedSkill) {
            toast.error("匯出失敗", "請先選擇要匯出的技能。");
            return;
        }
        if (target === "checked" && checkedSkillIds.length === 0) {
            toast.error("匯出失敗", "請先勾選要匯出的技能。");
            return;
        }

        setExportingTarget(target);
        try {
            const query = new URLSearchParams();
            if (target === "selected" && selectedSkill) {
                query.set("id", selectedSkill.id);
            } else if (target === "checked") {
                query.set("ids", checkedSkillIds.join(","));
                query.set("format", "markdown");
            } else {
                query.set("format", "markdown");
            }

            const requestUrl = `/api/skills/export?${query.toString()}`;
            const response = await fetch(requestUrl, { method: "GET" });

            if (!response.ok) {
                throw new Error(await parseExportError(response));
            }

            const blob = await response.blob();
            const fileName = parseFilenameFromDisposition(response.headers.get("content-disposition"))
                || (target === "selected" && selectedSkill
                    ? `skill_${selectedSkill.id}.md`
                    : target === "checked"
                        ? `skills_selected_${checkedSkillIds.length}_${Date.now()}.md`
                        : `skills_book_${Date.now()}.md`);

            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = blobUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(blobUrl);

            toast.success(
                "匯出完成",
                target === "selected"
                    ? "已下載目前技能。"
                    : target === "checked"
                        ? `已下載 ${checkedSkillIds.length} 個勾選技能。`
                        : "已下載完整技能書。"
            );
        } catch (error: unknown) {
            toast.error("匯出失敗", getErrorMessage(error, "技能匯出失敗，請稍後再試。"));
        } finally {
            setExportingTarget(null);
        }
    };

    const handleImportClick = () => {
        if (isImporting || isPreparingImport) return;
        importFileInputRef.current?.click();
    };

    const handleImportFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsPreparingImport(true);
        try {
            const rawText = await file.text();
            const draft = buildImportDraft(file.name, rawText, skills);
            setImportDraft(draft);
            setImportStrategy(draft.existingCount > 0 ? "new_only" : "overwrite");
            setShowImportPreview(true);
        } catch (error: unknown) {
            toast.error("匯入預覽失敗", getErrorMessage(error, "無法解析技能書，請確認檔案格式。"));
        } finally {
            setIsPreparingImport(false);
            if (importFileInputRef.current) {
                importFileInputRef.current.value = "";
            }
        }
    };

    const handleConfirmImport = async () => {
        if (!importDraft) return;

        const overwriteExisting = importStrategy === "overwrite";
        const selectedSkills = importStrategy === "new_only"
            ? importDraft.skills.filter((item) => !item.isExisting && !item.isMandatoryConflict)
            : importDraft.skills;

        if (selectedSkills.length === 0) {
            toast.error("匯入取消", "目前策略下沒有可匯入的技能。");
            return;
        }

        const payload = importStrategy === "new_only"
            ? JSON.stringify({
                skills: selectedSkills.map((item) => ({
                    id: item.id,
                    title: item.title,
                    content: item.content,
                    category: item.category,
                    isEnabled: item.isEnabled,
                    isOptional: item.isOptional,
                }))
            })
            : importDraft.rawText;

        const format = importStrategy === "new_only" ? "json" : importDraft.format;

        setIsImporting(true);
        try {
            const data = await apiPostWrite<SkillImportResponse>("/api/skills/import", {
                format,
                payload,
                restoreEnabled: true,
                overwriteExisting,
            });

            if (!data.success) {
                toast.error("匯入失敗", data.error || "技能書匯入失敗");
                return;
            }

            const importedCount = data.importedCount || 0;
            const enabledAdded = data.enabledAdded || 0;
            const skippedMandatory = data.skippedMandatory?.length || 0;
            const skippedExisting = data.skippedExisting?.length || 0;

            setHasUnsyncedChanges(true);
            setSyncHintType("enable");
            setShowSyncHint(true);
            setShowImportPreview(false);
            setImportDraft(null);
            loadSkills();

            const detail = [
                `已匯入 ${importedCount} 項`,
                enabledAdded > 0 ? `新增啟用 ${enabledAdded} 項` : "",
                skippedMandatory > 0 ? `略過核心技能 ${skippedMandatory} 項` : "",
                skippedExisting > 0 ? `略過既有技能 ${skippedExisting} 項` : ""
            ].filter(Boolean).join("，");

            toast.success("匯入完成", detail || "技能書已匯入。");
        } catch (error: unknown) {
            toast.error("匯入失敗", getErrorMessage(error, "技能書匯入失敗，請稍後再試。"));
        } finally {
            setIsImporting(false);
        }
    };

    const installedSearchTerm = installedSearchText.trim().toLowerCase();
    const isCoreSkill = (skill: InstalledSkill): boolean => skill.isDeletable === false;
    const canDeleteSkill = (skill: InstalledSkill): boolean => skill.isDeletable !== false;
    const filteredSkills = skills.filter((skill) => {
        if (installedListFilter === "enabled" && !skill.isEnabled) return false;
        if (installedListFilter === "core" && !isCoreSkill(skill)) return false;
        if (!installedSearchTerm) return true;
        const title = String(skill.title || "").toLowerCase();
        const id = String(skill.id || "").toLowerCase();
        return title.includes(installedSearchTerm) || id.includes(installedSearchTerm);
    });
    const sortedFilteredSkills = [...filteredSkills].sort((a, b) => {
        const titleCompare = a.title.localeCompare(b.title, "zh-Hant-u-co-stroke");
        if (installedSortMode === "title_asc") return titleCompare;
        if (installedSortMode === "title_desc") return -titleCompare;
        if (installedSortMode === "core_first") {
            const aIsCore = isCoreSkill(a);
            const bIsCore = isCoreSkill(b);
            if (aIsCore !== bIsCore) return aIsCore ? -1 : 1;
            if (a.isEnabled !== b.isEnabled) return a.isEnabled ? -1 : 1;
            return titleCompare;
        }
        if (a.isEnabled !== b.isEnabled) return a.isEnabled ? -1 : 1;
        const aIsCore = isCoreSkill(a);
        const bIsCore = isCoreSkill(b);
        if (aIsCore !== bIsCore) return aIsCore ? -1 : 1;
        return titleCompare;
    });
    const allVisibleSkillsChecked = sortedFilteredSkills.length > 0
        && sortedFilteredSkills.every((skill) => checkedSkillIds.includes(skill.id));

    return (
        <>
            <div className="flex-1 overflow-hidden bg-background p-6 flex flex-col text-foreground">
                <div className="max-w-7xl w-full mx-auto h-full flex flex-col pt-4">
 
                    {/* Header */}
                    <div className="mb-6 space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                            <div className="flex items-start gap-4">
                                <div className="inline-flex items-center justify-center p-3 bg-primary/10 border border-primary/20 rounded-xl shadow-[0_0_20px_-5px_var(--primary)] shadow-primary/40">
                                    <BookOpen className="w-6 h-6 text-primary" />
                                </div>
                                <div>
                                    <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-foreground via-foreground/80 to-primary tracking-tight">
                                        {isEnglish ? "Skills Handbook" : "技能說明書 (Skills)"}
                                    </h1>
                                    <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5">
                                        {activeTab === "marketplace" ? (
                                            <>
                                                {isEnglish ? "Data source:" : "數據來源："}
                                                <a
                                                    href="https://github.com/ComposioHQ/awesome-claude-skills"
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-primary hover:underline flex items-center gap-1"
                                                >
                                                    ComposioHQ/awesome-claude-skills
                                                    <Globe className="w-3 h-3" />
                                                </a>
                                            </>
                                        ) : (isEnglish ? "Manage Golem core capabilities and open skills marketplace" : "管理 Golem 的核心能力與開放技能市場")}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 bg-card/70 border border-border p-1.5 rounded-xl shadow-inner w-full xl:w-auto">
                                <button
                                    onClick={() => setActiveTab("installed")}
                                    className={`flex-1 xl:flex-none px-4 py-2 text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-all ${activeTab === "installed"
                                        ? "bg-secondary text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                                        }`}
                                >
                                    <BookOpen className="w-4 h-4" />
                                    {isEnglish ? "Loaded Modules" : "已載入模組"}
                                </button>
                                <button
                                    onClick={() => setActiveTab("marketplace")}
                                    className={`flex-1 xl:flex-none px-4 py-2 text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-all ${activeTab === "marketplace"
                                        ? "bg-secondary text-primary shadow-sm"
                                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                                        }`}
                                >
                                    <Store className="w-4 h-4" />
                                    {isEnglish ? "Skill Market" : "技能市場"}
                                </button>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-border bg-card/35 p-2.5">
                            <div className="flex flex-wrap items-center gap-2.5">
                                <button
                                    onClick={handleCreateSkill}
                                    className="px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 transition-all bg-secondary text-muted-foreground border border-border hover:bg-accent hover:text-foreground"
                                >
                                    <Plus className="w-4 h-4" />
                                    {isEnglish ? "New Skill" : "新增技能"}
                                </button>
                                {activeTab === "installed" && (
                                    <button
                                        onClick={handleImportClick}
                                        disabled={isImporting || isPreparingImport || exportingTarget !== null}
                                        className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 transition-all bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 ${isImporting || isPreparingImport || exportingTarget !== null ? "opacity-60 cursor-not-allowed" : ""}`}
                                    >
                                        <Upload className={`w-4 h-4 ${isImporting || isPreparingImport ? "animate-pulse" : ""}`} />
                                        {isPreparingImport
                                            ? (isEnglish ? "Analyzing..." : "分析中...")
                                            : isImporting
                                                ? (isEnglish ? "Importing..." : "匯入中...")
                                                : (isEnglish ? "Import Skill Book" : "匯入技能書")}
                                    </button>
                                )}
                                {activeTab === "installed" && (
                                    <button
                                        onClick={() => downloadSkillsBook("checked")}
                                        disabled={checkedSkillIds.length === 0 || exportingTarget !== null || isImporting || isPreparingImport}
                                        className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 transition-all bg-primary text-primary-foreground border border-primary hover:bg-primary/90 ${checkedSkillIds.length === 0 || exportingTarget !== null || isImporting || isPreparingImport ? "opacity-60 cursor-not-allowed" : ""}`}
                                    >
                                        <Download className={`w-4 h-4 ${exportingTarget === "checked" ? "animate-pulse" : ""}`} />
                                        {exportingTarget === "checked"
                                            ? (isEnglish ? "Exporting..." : "匯出中...")
                                            : (isEnglish ? `Export Checked (${checkedSkillIds.length})` : `匯出已勾選 (${checkedSkillIds.length})`)}
                                    </button>
                                )}
                                {activeTab === "installed" && (
                                    <button
                                        onClick={() => downloadSkillsBook("all")}
                                        disabled={exportingTarget !== null || isImporting || isPreparingImport}
                                        className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 transition-all bg-secondary text-muted-foreground border border-border hover:bg-accent hover:text-foreground ${exportingTarget !== null || isImporting || isPreparingImport ? "opacity-60 cursor-not-allowed" : ""}`}
                                    >
                                        <Download className={`w-4 h-4 ${exportingTarget === "all" ? "animate-pulse" : ""}`} />
                                        {exportingTarget === "all" ? (isEnglish ? "Exporting..." : "匯出中...") : (isEnglish ? "Export All" : "匯出全部")}
                                    </button>
                                )}
                                {activeTab === "installed" && (
                                    <button
                                        onClick={() => setShowConfirm(true)}
                                        disabled={isInjecting || exportingTarget !== null || isImporting || isPreparingImport}
                                        className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 transition-all ${hasUnsyncedChanges
                                            ? "bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/50 hover:bg-amber-500/30 animate-pulse"
                                            : "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
                                            } ${isInjecting || exportingTarget !== null || isImporting || isPreparingImport ? "opacity-60 cursor-not-allowed" : ""}`}
                                    >
                                        <Zap className={`w-4 h-4 ${isInjecting ? "animate-pulse" : ""}`} />
                                        {isInjecting ? (isEnglish ? "Injecting..." : "注入中...") : (isEnglish ? "Inject Skills" : "注入技能書")}
                                    </button>
                                )}
                                {activeTab === "installed" && (
                                    <span className="text-xs text-muted-foreground px-2 py-1 rounded-md bg-secondary/40 border border-border/60 ml-auto">
                                        {isEnglish
                                            ? `Checked ${checkedSkillIds.length} / ${skills.length}`
                                            : `已勾選 ${checkedSkillIds.length} / ${skills.length}`}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 min-h-0 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 flex flex-col">
                        {activeTab === "installed" ? (
                            <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(390px,44%)_1fr] gap-5">
                                {/* List View (Left) */}
                                <Card className="min-h-0 bg-card/35 border-border shadow-xl rounded-2xl overflow-hidden flex flex-col">
                                    <CardHeader className="shrink-0 border-b border-border bg-card/55 px-5 py-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <h2 className="text-sm font-bold text-foreground uppercase tracking-widest flex items-center gap-2">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.8)]"></div>
                                                    {isEnglish
                                                        ? `Loaded Modules (${sortedFilteredSkills.length}/${skills.length})`
                                                        : `已載入模組 (${sortedFilteredSkills.length}/${skills.length})`}
                                                </h2>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    {isEnglish ? "Check items on the left for batch export. Click a row for details." : "左側勾選後可批次匯出，點擊列可查看詳情。"}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => toggleAllCheckedSkills(!allVisibleSkillsChecked, sortedFilteredSkills)}
                                                    disabled={sortedFilteredSkills.length === 0}
                                                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors ${sortedFilteredSkills.length === 0 ? "opacity-50 cursor-not-allowed bg-secondary/40 border-border text-muted-foreground" : "bg-secondary border-border text-muted-foreground hover:text-foreground hover:bg-accent"}`}
                                                >
                                                    {allVisibleSkillsChecked
                                                        ? (isEnglish ? "Uncheck Visible" : "取消可見項目")
                                                        : (isEnglish ? "Check Visible" : "全選可見項目")}
                                                </button>
                                                <button
                                                    onClick={() => setCheckedSkillIds([])}
                                                    disabled={checkedSkillIds.length === 0}
                                                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors ${checkedSkillIds.length === 0 ? "opacity-50 cursor-not-allowed bg-secondary/40 border-border text-muted-foreground" : "bg-secondary border-border text-muted-foreground hover:text-foreground hover:bg-accent"}`}
                                                >
                                                    {isEnglish ? "Clear" : "清除"}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="mt-3 space-y-2">
                                            <div className="relative">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                                                <input
                                                    type="text"
                                                    value={installedSearchText}
                                                    onChange={(event) => setInstalledSearchText(event.target.value)}
                                                    placeholder={isEnglish ? "Search skill name or ID..." : "搜尋技能名稱或 ID..."}
                                                    className="w-full bg-secondary/45 border border-border/70 rounded-lg pl-9 pr-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                                                />
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                {[
                                                    { key: "all" as const, label: isEnglish ? "All" : "全部" },
                                                    { key: "enabled" as const, label: isEnglish ? "Enabled" : "已啟用" },
                                                    { key: "core" as const, label: isEnglish ? "Core" : "核心技能" },
                                                ].map((filterOption) => (
                                                    <button
                                                        key={filterOption.key}
                                                        onClick={() => setInstalledListFilter(filterOption.key)}
                                                        className={cn(
                                                            "px-2.5 py-1 text-xs rounded-md border transition-colors",
                                                            installedListFilter === filterOption.key
                                                                ? "bg-primary/15 text-primary border-primary/40"
                                                                : "bg-secondary/45 text-muted-foreground border-border hover:bg-secondary hover:text-foreground"
                                                        )}
                                                    >
                                                        {filterOption.label}
                                                    </button>
                                                ))}
                                            </div>
                                            <div className="relative">
                                                <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                                                <select
                                                    value={installedSortMode}
                                                    onChange={(event) => setInstalledSortMode(event.target.value as InstalledSortMode)}
                                                    className="w-full appearance-none bg-secondary/45 border border-border/70 rounded-lg pl-9 pr-9 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                                                >
                                                    <option value="enabled_first">{isEnglish ? "Sort: Enabled First" : "排序：已啟用優先"}</option>
                                                    <option value="core_first">{isEnglish ? "Sort: Core First" : "排序：核心技能優先"}</option>
                                                    <option value="title_asc">{isEnglish ? "Sort: Name A → Z" : "排序：名稱 A → Z"}</option>
                                                    <option value="title_desc">{isEnglish ? "Sort: Name Z → A" : "排序：名稱 Z → A"}</option>
                                                </select>
                                                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground rotate-90" />
                                                </div>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
                                        {sortedFilteredSkills.map((skill) => {
                                            const isRowSelected = selectedSkill?.id === skill.id;
                                            const isRowChecked = checkedSkillIds.includes(skill.id);
                                            return (
                                                <div
                                                    key={skill.id}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => setSelectedSkill(skill)}
                                                    onKeyDown={(event) => {
                                                        if (event.key === "Enter" || event.key === " ") {
                                                            event.preventDefault();
                                                            setSelectedSkill(skill);
                                                        }
                                                    }}
                                                    className={cn(
                                                        "w-full text-left rounded-xl border px-3.5 py-3 transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30",
                                                        isRowSelected
                                                            ? "bg-primary/10 border-primary/50 shadow-sm"
                                                            : "bg-card/50 border-border/50 hover:bg-secondary/60 hover:border-border"
                                                    )}
                                                >
                                                    <div className="flex items-start gap-3">
                                                        <input
                                                            type="checkbox"
                                                            checked={isRowChecked}
                                                            onChange={(event) => toggleCheckedSkill(skill.id, event.target.checked)}
                                                            onClick={(event) => event.stopPropagation()}
                                                            className="mt-0.5 h-4 w-4 rounded border-border bg-secondary text-primary focus:ring-primary/30"
                                                            aria-label={isEnglish ? `Select skill ${skill.title}` : `選擇技能 ${skill.title}`}
                                                        />
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-start justify-between gap-3">
                                                                <div className="min-w-0">
                                                                    <p className={`text-[15px] font-semibold truncate ${isRowSelected ? "text-primary" : "text-foreground"}`}>
                                                                        {skill.title}
                                                                    </p>
                                                                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">
                                                                        {skill.id}.md
                                                                    </p>
                                                                </div>
                                                                <ChevronRight className={`w-4 h-4 mt-0.5 shrink-0 transition-transform ${isRowSelected ? "text-primary translate-x-0.5" : "text-muted-foreground"}`} />
                                                            </div>
                                                            <div className="mt-2 flex items-center gap-2">
                                                                {isCoreSkill(skill) ? (
                                                                    <span className="text-[10px] bg-indigo-500/10 text-indigo-500 border border-indigo-500/30 px-1.5 py-0.5 rounded-md uppercase tracking-wider font-bold">
                                                                        {isEnglish ? "Core" : "常駐核心"}
                                                                    </span>
                                                                ) : skill.isEnabled ? (
                                                                    <span className="flex items-center gap-1 text-[10px] text-primary uppercase tracking-wider font-bold">
                                                                        <CheckCircle2 className="w-3 h-3" /> {isEnglish ? "Enabled" : "已啟用"}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">{isEnglish ? "Disabled" : "未啟用"}</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {skills.length === 0 && (
                                            <div className="h-48 rounded-xl border border-dashed border-border/60 bg-card/40 flex flex-col items-center justify-center text-muted-foreground/70 gap-2">
                                                <BookOpen className="w-8 h-8 opacity-30" />
                                                <p className="text-sm">{isEnglish ? "No loaded skills yet" : "目前尚無已載入技能"}</p>
                                            </div>
                                        )}
                                        {skills.length > 0 && sortedFilteredSkills.length === 0 && (
                                            <div className="h-48 rounded-xl border border-dashed border-border/60 bg-card/40 flex flex-col items-center justify-center text-muted-foreground/70 gap-2">
                                                <Search className="w-8 h-8 opacity-30" />
                                                <p className="text-sm">{isEnglish ? "No skills match current filters" : "目前篩選條件下沒有符合的技能"}</p>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>

                                {/* Detail View (Right) */}
                                <Card className="min-w-0 bg-card border-border shadow-2xl flex flex-col min-h-0 rounded-2xl overflow-hidden backdrop-blur-sm">
                                    <CardHeader className="flex-shrink-0 border-b border-border bg-card/60 p-5 px-6">
                                        {selectedSkill ? (
                                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="w-10 h-10 rounded-xl bg-secondary border border-border flex items-center justify-center shadow-inner shrink-0">
                                                        <BookOpen className="w-5 h-5 text-primary/80" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <h3 className="text-lg font-bold text-foreground leading-tight truncate">
                                                            {selectedSkill.title}
                                                        </h3>
                                                        <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                                                            {selectedSkill.id}.md
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-secondary/40 text-xs text-muted-foreground">
                                                        <input
                                                            type="checkbox"
                                                            checked={checkedSkillIds.includes(selectedSkill.id)}
                                                            onChange={(event) => toggleCheckedSkill(selectedSkill.id, event.target.checked)}
                                                            className="h-3.5 w-3.5 rounded border-border bg-secondary text-primary focus:ring-primary/30"
                                                        />
                                                        {isEnglish ? "Include in batch export" : "納入批次匯出"}
                                                    </label>
                                                    <button
                                                        onClick={() => downloadSkillsBook("selected")}
                                                        disabled={exportingTarget !== null || isImporting || isPreparingImport}
                                                        className={`flex items-center gap-1.5 px-3 py-1.5 bg-secondary border border-border text-muted-foreground hover:text-foreground hover:bg-accent text-xs font-medium rounded-lg transition-colors ${exportingTarget !== null || isImporting || isPreparingImport ? "opacity-60 cursor-not-allowed" : ""}`}
                                                    >
                                                        <Download className={`w-3.5 h-3.5 ${exportingTarget === "selected" ? "animate-pulse" : ""}`} />
                                                        {exportingTarget === "selected" ? (isEnglish ? "Exporting..." : "匯出中...") : (isEnglish ? "Export Single" : "匯出單一")}
                                                    </button>
                                                    {isCoreSkill(selectedSkill) && (
                                                        <div className="flex items-center gap-1.5 px-3 py-1 bg-secondary border border-border text-muted-foreground text-[11px] uppercase tracking-wider font-bold rounded-lg select-none">
                                                            <AlertCircle className="w-3.5 h-3.5 opacity-70" />
                                                            {isEnglish ? "Core Skill" : "常駐核心技能"}
                                                        </div>
                                                    )}
                                                    <div className="flex items-center gap-2">
                                                        {canDeleteSkill(selectedSkill) && (
                                                            <button
                                                                onClick={() => setShowDeleteConfirm(true)}
                                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 hover:text-red-500 hover:bg-red-500/20 text-xs font-medium rounded-lg transition-colors"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" /> {isEnglish ? "Delete" : "刪除"}
                                                            </button>
                                                        )}
                                                        {selectedSkill.isOptional && (
                                                            <button
                                                                onClick={(e) => handleEditSkill(e, selectedSkill)}
                                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary border border-border text-muted-foreground hover:text-foreground hover:bg-accent text-xs font-medium rounded-lg transition-colors"
                                                            >
                                                                <Pencil className="w-3.5 h-3.5" /> {isEnglish ? "Edit" : "編輯"}
                                                            </button>
                                                        )}
                                                    </div>
                                                    {selectedSkill.isOptional && (
                                                        <label className="relative inline-flex items-center cursor-pointer ml-1">
                                                            <input
                                                                type="checkbox"
                                                                className="sr-only peer"
                                                                checked={selectedSkill.isEnabled}
                                                                onChange={(e) => toggleSkill(selectedSkill.id, e.target.checked)}
                                                            />
                                                            <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-primary-foreground after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground peer-checked:after:bg-primary-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all border border-border peer-checked:bg-primary peer-checked:border-primary shadow-inner"></div>
                                                        </label>
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="h-[46px] flex items-center text-muted-foreground text-sm">
                                                {isEnglish ? "Select a skill on the left to view details" : "請先在左側列表選擇一個技能查看詳情"}
                                            </div>
                                        )}
                                    </CardHeader>
                                    <CardContent className="flex-1 overflow-y-auto p-0 scroll-smooth">
                                        {selectedSkill ? (
                                            <div className="prose prose-slate dark:prose-invert prose-cyan max-w-none p-6 text-foreground/80 text-[15px] leading-relaxed break-words
                                                prose-headings:text-foreground prose-headings:font-bold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg
                                                prose-a:text-primary hover:prose-a:text-primary/80 prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none
                                                prose-pre:bg-secondary prose-pre:border prose-pre:border-border prose-pre:shadow-lg prose-pre:max-w-full prose-pre:overflow-x-auto
                                                prose-blockquote:border-l-primary prose-blockquote:bg-primary/5 prose-blockquote:px-4 prose-blockquote:py-1 prose-blockquote:rounded-r-lg prose-blockquote:not-italic prose-blockquote:text-muted-foreground
                                                prose-strong:text-foreground prose-li:marker:text-muted-foreground/50"
                                            >
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                    {selectedSkill.content.replace(/<SkillModule[^>]*>([\s\S]*?)<\/SkillModule>/g, '$1').trim()}
                                                </ReactMarkdown>
                                            </div>
                                        ) : (
                                            <div className="h-full flex flex-col items-center justify-center text-muted-foreground/50 space-y-4">
                                                <BookOpen className="w-12 h-12 opacity-20" />
                                                <p>{isEnglish ? "Select a skill from the left list" : "在左側列表中選擇技能"}</p>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </div>
                        ) : (
                            <div className="flex flex-col h-full space-y-6">
                                {/* Marketplace Top Bar */}
                                <div className="bg-card/40 backdrop-blur-md border border-border p-4 rounded-2xl shadow-xl flex flex-col md:flex-row gap-4 items-center animate-in zoom-in-95 duration-500">
                                    <form onSubmit={handleSearchSubmit} className="relative flex-1 group">
                                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                        <input
                                            type="text"
                                            value={marketSearchText}
                                            onChange={(e) => setMarketSearchText(e.target.value)}
                                            placeholder={isEnglish ? "Search 5,000+ AI skills in the market..." : "搜尋市場中的 5,000+ 個 AI 技能..."}
                                            className="w-full bg-secondary/50 border border-border/50 rounded-xl pl-10 pr-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/5 transition-all placeholder:text-muted-foreground/60 shadow-inner"
                                        />
                                    </form>
                                    <div className="flex items-center gap-3 w-full md:w-auto">
                                        <div className="relative flex-1 md:w-64 group">
                                            <Tags className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground group-focus-within:text-primary transition-colors z-10" />
                                            <select
                                                value={marketCategory}
                                                onChange={handleCategoryChange}
                                                className="w-full appearance-none bg-secondary/50 border border-border/50 rounded-xl pl-10 pr-10 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/5 transition-all cursor-pointer shadow-inner relative z-0"
                                            >
                                                {MARKET_CATEGORIES.map(cat => {
                                                    const count = marketCategoryCounts[cat.id];
                                                    return (
                                                        <option key={cat.id} value={cat.id} className="bg-card py-2">
                                                            {cat.name} {cat.name_en ? `(${cat.name_en})` : ''}
                                                            {count !== undefined ? ` (${count})` : ''}
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10">
                                                <ChevronRight className="w-4 h-4 text-muted-foreground rotate-90" />
                                            </div>
                                        </div>
                                        <div className="h-10 w-[1px] bg-border mx-1 hidden md:block"></div>
                                        <div className="flex items-center gap-1 bg-secondary/30 p-1 rounded-lg border border-border/30">
                                            <button
                                                onClick={() => setMarketPage(p => Math.max(1, p - 1))}
                                                disabled={marketPage === 1}
                                                className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                                            >
                                                {isEnglish ? "Prev" : "上頁"}
                                            </button>
                                            <span className="text-[10px] font-bold text-muted-foreground px-2 border-x border-border/30">
                                                {marketPage} / {Math.ceil(marketTotal / 20) || 1}
                                            </span>
                                            <button
                                                onClick={() => setMarketPage(p => p + 1)}
                                                disabled={marketPage >= Math.ceil(marketTotal / 20)}
                                                className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                                            >
                                                {isEnglish ? "Next" : "下頁"}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Marketplace Grid */}
                                <div className="flex-1 overflow-hidden relative">
                                    <div className="absolute inset-0 overflow-y-auto pr-2 custom-scrollbar">
                                        {isMarketLoading ? (
                                            <div className="h-64 flex flex-col items-center justify-center text-muted-foreground gap-4">
                                                <RefreshCcw className="w-8 h-8 animate-spin text-primary/50" />
                                                <p className="text-sm font-medium animate-pulse">{isEnglish ? "Curating top skills..." : "正在精挑細選優質技能..."}</p>
                                            </div>
                                        ) : marketSkills.length === 0 ? (
                                            <div className="h-64 flex flex-col items-center justify-center text-muted-foreground/50 gap-4">
                                                <Search className="w-12 h-12 opacity-10" />
                                                <p className="text-sm">{isEnglish ? "No skills found in this category" : "在此類別中找不到相關技能"}</p>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-20">
                                                {marketSkills.map((skill) => {
                                                    const isInstalled = skills.some(s => s.id === skill.id);
                                                    const marketDescription = skill.original_description || skill.description;
                                                    const marketCategory = skill.category_name?.en || skill.category || "uncategorized";
                                                    return (
                                                        <button
                                                            key={skill.id}
                                                            onClick={() => setSelectedMarketSkill(skill)}
                                                            className={cn(
                                                                "group relative flex flex-col bg-card/40 border rounded-2xl p-4 text-left transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 overflow-hidden",
                                                                selectedMarketSkill?.id === skill.id
                                                                    ? "border-primary shadow-[0_0_20px_rgba(var(--primary),0.15)] bg-primary/5"
                                                                    : "border-border hover:border-primary/50 hover:bg-card/60"
                                                            )}
                                                        >
                                                            {/* Background Glow */}
                                                            <div className="absolute -right-4 -top-4 w-20 h-20 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors"></div>
                                                            
                                                            <div className="flex items-start justify-between mb-3 z-10">
                                                                <div className="w-10 h-10 rounded-xl bg-secondary border border-border flex items-center justify-center group-hover:border-primary/30 group-hover:bg-primary/5 transition-all shadow-inner">
                                                                    {/* Mapping specific icons to categories could go here, for now generic Store icon */}
                                                                    <Store className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                                                                </div>
                                                                {isInstalled && (
                                                                    <span className="flex items-center gap-1 text-[9px] bg-green-500/10 text-green-500 border border-green-500/30 px-1.5 py-0.5 rounded-md uppercase tracking-wider font-bold">
                                                                        <CheckCircle2 className="w-3.5 h-3.5" /> {isEnglish ? "Installed" : "已安裝"}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            
                                                            <div className="space-y-2 z-10">
                                                                <h4 className="font-bold text-foreground text-sm group-hover:text-primary transition-colors truncate" title={skill.title}>
                                                                    {skill.title}
                                                                </h4>
                                                                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 h-8">
                                                                    {marketDescription}
                                                                </p>
                                                            </div>
                                                            
                                                            <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between z-10">
                                                                <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1.5 max-w-[120px] truncate">
                                                                    <Tags className="w-3 h-3" /> {marketCategory}
                                                                </span>
                                                                <span className="text-[10px] text-primary/80 font-bold group-hover:translate-x-1 transition-transform flex items-center">
                                                                    {isEnglish ? "Details" : "詳情"} <ChevronRight className="w-3 h-3" />
                                                                </span>
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    {/* Marketplace Detail Drawer Overlay */}
                                    <div className={cn(
                                        "fixed inset-0 z-50 transition-opacity duration-300 pointer-events-none bg-black/60 backdrop-blur-sm",
                                        selectedMarketSkill ? "opacity-100 pointer-events-auto" : "opacity-0"
                                    )} onClick={() => setSelectedMarketSkill(null)} />

                                    <aside className={cn(
                                        "fixed inset-y-0 right-0 w-full sm:w-[450px] bg-card border-l border-border shadow-2xl z-50 transition-transform duration-500 ease-out flex flex-col overflow-hidden",
                                        selectedMarketSkill ? "translate-x-0" : "translate-x-full"
                                    )}>
                                        {selectedMarketSkill && (
                                            <>
                                                {(() => {
                                                    const detailDescription = selectedMarketSkill.original_description || selectedMarketSkill.description;
                                                    const detailCategory = selectedMarketSkill.category_name?.en || selectedMarketSkill.category || "uncategorized";
                                                    return (
                                                        <>
                                                <div className="flex items-center justify-between p-6 border-b border-border bg-accent/10">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center border border-primary/30">
                                                            <Store className="w-6 h-6 text-primary" />
                                                        </div>
                                                        <div>
                                                            <h2 className="text-xl font-bold text-foreground truncate max-w-[200px]">
                                                                {selectedMarketSkill.title}
                                                            </h2>
                                                            <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mt-0.5">
                                                                {isEnglish ? "SKILL DETAILS & INSTALL" : "技能詳情 & 安裝"}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => setSelectedMarketSkill(null)}
                                                        className="p-2.5 rounded-xl hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                                                    >
                                                        <X className="w-5 h-5" />
                                                    </button>
                                                </div>

                                                <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide">
                                                    <div className="space-y-4">
                                                        <h3 className="text-xs font-bold text-primary flex items-center gap-2 uppercase tracking-wider">
                                                            <BookOpen className="w-3.5 h-3.5" /> {isEnglish ? "Overview" : "技能簡介"}
                                                        </h3>
                                                        <div className="bg-secondary/40 border border-border/50 rounded-2xl p-5 shadow-inner">
                                                            <p className="text-sm leading-relaxed text-foreground">
                                                                {detailDescription}
                                                            </p>
                                                        </div>
                                                        <div className="flex flex-wrap gap-2">
                                                            <span className="px-2 py-0.5 rounded-md bg-secondary border border-border text-[10px] text-muted-foreground font-medium flex items-center gap-1 capitalize">
                                                                <Tags className="w-2.5 h-2.5" /> {detailCategory}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div className="space-y-4">
                                                        <h3 className="text-xs font-bold text-primary flex items-center gap-2 uppercase tracking-wider">
                                                            <Activity className="w-3.5 h-3.5" /> {isEnglish ? "Integration & Install" : "整合與安裝"}
                                                        </h3>
                                                        <div className="p-5 bg-primary/5 border border-primary/20 rounded-2xl relative overflow-hidden group">
                                                            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-bl-full pointer-events-none group-hover:scale-110 transition-transform"></div>
                                                            <h5 className="flex items-center gap-2 text-primary text-sm font-bold uppercase tracking-wide mt-0 mb-4">
                                                                <Zap className="w-4 h-4" /> {isEnglish ? "One-click Integration" : "一鍵式整合"}
                                                            </h5>
                                                            <p className="text-sm text-muted-foreground/90 leading-relaxed mb-6">
                                                                {isEnglish
                                                                    ? "This skill will be integrated into your Golem core automatically and synced with the latest prompt techniques from the open-source GitHub repository."
                                                                    : "此技能將自動整合至您的 Golem 核心，並從開源 GitHub 倉庫同步最新的提示詞技術。"}
                                                            </p>
                                                            
                                                            {skills.some(s => s.id === selectedMarketSkill.id) ? (
                                                                <Button disabled className="w-full h-12 rounded-xl bg-green-500/10 text-green-500 border border-green-500/30 font-bold">
                                                                    <CheckCircle2 className="w-5 h-5 mr-2" /> {isEnglish ? "Skill Ready" : "該技能已就緒"}
                                                                </Button>
                                                            ) : (
                                                                <Button
                                                                    onClick={() => installSkill(selectedMarketSkill)}
                                                                    disabled={installingId === selectedMarketSkill.id}
                                                                    className="w-full h-12 font-bold bg-primary hover:bg-primary/90 text-primary-foreground border-none shadow-xl shadow-primary/25 transition-all hover:scale-[1.02] active:scale-95 rounded-xl text-sm"
                                                                >
                                                                    {installingId === selectedMarketSkill.id ? (
                                                                        <><RefreshCcw className="w-5 h-5 mr-3 animate-spin" /> {isEnglish ? "Fetching..." : "正在抓取..."}</>
                                                                    ) : (
                                                                        <><Download className="w-5 h-5 mr-3" /> {isEnglish ? "Install This Skill" : "一鍵安裝此技能"}</>
                                                                    )}
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="pt-4 border-t border-border/50">
                                                        <a 
                                                            href={selectedMarketSkill.repoUrl} 
                                                            target="_blank" 
                                                            rel="noreferrer" 
                                                            className="flex items-center justify-between p-4 bg-secondary/60 border border-border rounded-xl hover:bg-secondary hover:border-primary/30 transition-all text-sm group"
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center group-hover:scale-110 transition-transform">
                                                                    <Database className="w-4 h-4 text-muted-foreground" />
                                                                </div>
                                                                <span className="text-muted-foreground font-medium group-hover:text-foreground">{isEnglish ? "View Source on GitHub" : "在 GitHub 上檢視原始碼"}</span>
                                                            </div>
                                                            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all" />
                                                        </a>
                                                    </div>
                                                </div>
                                                
                                                <div className="p-6 bg-accent/5 border-t border-border">
                                                    <p className="text-center text-[10px] text-muted-foreground opacity-60">
                                                        {isEnglish ? "Data source: ComposioHQ/awesome-claude-skills" : "數據來源於 ComposioHQ/awesome-claude-skills"}
                                                    </p>
                                                </div>
                                                        </>
                                                    );
                                                })()}
                                            </>
                                        )}
                                    </aside>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Floating Sync Hint */}
                {showSyncHint && (
                    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-8 duration-500">
                        <div className="bg-amber-500/10 border border-amber-500/30 backdrop-blur-xl px-6 py-4 rounded-2xl shadow-[0_10px_40px_-10px_rgba(245,158,11,0.3)] flex items-center gap-4 text-foreground">
                            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                                <Zap className="w-5 h-5 text-amber-600 dark:text-amber-400 animate-pulse" />
                            </div>
                            <div className="flex flex-col">
                                <p className="text-sm font-bold text-amber-700 dark:text-amber-200">
                                    {syncHintType === "enable"
                                        ? (isEnglish ? "Skill enabled!" : "技能已啟用！")
                                        : (isEnglish ? "Skill deleted!" : "技能已刪除！")}
                                </p>
                                <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
                                    {isEnglish
                                        ? "Remember to click \"Inject Skills\" in the top-right to sync AI capabilities."
                                        : "請記得點擊右上方「注入技能書」按鈕，讓 AI 同步最新的能力。"}
                                </p>
                            </div>
                            <Button 
                                size="sm" 
                                variant="ghost" 
                                className="h-8 w-8 p-0 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
                                onClick={() => setShowSyncHint(false)}
                            >
                                <X className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            <input
                ref={importFileInputRef}
                type="file"
                accept=".md,.markdown,.json,text/markdown,application/json"
                className="hidden"
                onChange={handleImportFileChange}
            />
            
            {/* Dialogs */}
            <ImportPreviewDialog
                open={showImportPreview}
                onOpenChange={(nextOpen) => {
                    setShowImportPreview(nextOpen);
                    if (!nextOpen && !isImporting) {
                        setImportDraft(null);
                    }
                }}
                draft={importDraft}
                strategy={importStrategy}
                onStrategyChange={setImportStrategy}
                onConfirm={handleConfirmImport}
                isLoading={isImporting}
            />
            <InjectConfirmDialog open={showConfirm} onOpenChange={setShowConfirm} onConfirm={handleInject} isLoading={isInjecting} />
            <InjectDoneDialog open={showDone} onOpenChange={setShowDone} />
            <SkillEditorDialog
                open={showEditor}
                onOpenChange={setShowEditor}
                mode={editorMode}
                initialId={editTarget.id}
                initialContent={editTarget.content}
                onSaved={() => {
                    setHasUnsyncedChanges(true);
                    loadSkills();
                }}
            />
            <InstallSuccessDialog
                open={showInstallSuccess}
                onOpenChange={setShowInstallSuccess}
            />

            <DeleteConfirmDialog
                open={showDeleteConfirm}
                onOpenChange={setShowDeleteConfirm}
                onConfirm={handleDeleteSkill}
                isLoading={isDeleting}
                skillTitle={selectedSkill?.title || ""}
            />
        </>
    );
}
