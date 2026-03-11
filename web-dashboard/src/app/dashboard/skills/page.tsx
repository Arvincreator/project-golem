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
import { BookOpen, AlertCircle, CheckCircle2, RefreshCcw, ChevronRight, Zap, TriangleAlert, Plus, Pencil, X, Search, Download, Store, Tags } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

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
            <DialogContent showCloseButton={!isLoading} className="bg-gray-900 border-gray-700 text-white max-w-sm">
                <DialogHeader>
                    <div className="w-12 h-12 rounded-xl border bg-cyan-500/10 border-cyan-500/20 flex items-center justify-center mb-2">
                        <Zap className="w-5 h-5 text-cyan-400" />
                    </div>
                    <DialogTitle className="text-white text-base">注入技能書？</DialogTitle>
                    <DialogDescription className="text-gray-400 text-sm leading-relaxed">
                        系統將依據目前配置，重新開啟全新的 Gemini 對話視窗進行注入。過往設定的人格與歷史記憶將會完整保留。
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    <div className="flex items-start gap-2 rounded-lg bg-gray-800/60 border border-gray-700/50 px-3 py-2.5">
                        <TriangleAlert className="w-3.5 h-3.5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-gray-500">此動作將暫時開新視窗中斷目前對話，但人格設定與長期記憶不受影響。</p>
                    </div>
                    <div className="rounded-lg bg-gray-800/40 border border-gray-700/30 px-3 py-2">
                        <p className="text-[11px] text-gray-500 mb-1 font-medium">確認後將自動執行：</p>
                        <ol className="text-[11px] text-gray-400 space-y-0.5 list-decimal list-inside">
                            <li>清除技能快取</li>
                            <li>重新開啟 Gemini 通訊視窗</li>
                            <li>自存檔載入人格，並注入所有技能記憶</li>
                        </ol>
                    </div>
                </div>
                <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="outline" className="flex-1 bg-transparent border-gray-800 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                        onClick={() => onOpenChange(false)} disabled={isLoading}>取消</Button>
                    <Button className="flex-1 bg-cyan-700 hover:bg-cyan-600 text-white" onClick={onConfirm} disabled={isLoading}>
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
            <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm" showCloseButton={false}>
                <DialogHeader>
                    <div className="w-12 h-12 rounded-xl border bg-green-500/10 border-green-500/20 flex items-center justify-center mb-2">
                        <CheckCircle2 className="w-5 h-5 text-green-400" />
                    </div>
                    <DialogTitle className="text-white text-base">技能注入完成 ✅</DialogTitle>
                    <DialogDescription className="text-gray-400 text-sm">
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
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: id.trim(), content }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                onOpenChange(false);
                onSaved();
            } else {
                setError(data.error || "儲存失敗");
            }
        } catch {
            setError("請求發送失敗");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={isLoading ? undefined : onOpenChange}>
            <DialogContent showCloseButton={!isLoading} className="bg-gray-900 border-gray-700 text-white max-w-2xl max-h-[90vh] flex flex-col">
                <DialogHeader className="flex-shrink-0">
                    <div className="w-10 h-10 rounded-xl border bg-cyan-500/10 border-cyan-500/20 flex items-center justify-center mb-2">
                        {mode === "create" ? <Plus className="w-5 h-5 text-cyan-400" /> : <Pencil className="w-5 h-5 text-cyan-400" />}
                    </div>
                    <DialogTitle className="text-white text-base">
                        {mode === "create" ? "新增自訂技能" : "編輯自訂技能"}
                    </DialogTitle>
                    <DialogDescription className="text-gray-400 text-sm">
                        編輯 Markdown 格式的技能提示詞。將自動存為 <code>src/skills/lib/{id || '<id>'}.md</code>
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto space-y-4 py-2 min-h-[300px] flex flex-col">
                    <div className="flex-shrink-0">
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">檔案 ID (英文數字底線)</label>
                        <input
                            value={id}
                            onChange={e => setId(e.target.value)}
                            disabled={mode === "edit"}
                            placeholder="my_custom_skill"
                            className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-mono"
                        />
                    </div>
                    <div className="flex-1 flex flex-col min-h-[200px]">
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">提示詞內容 (Markdown)</label>
                        <textarea
                            value={content}
                            onChange={e => setContent(e.target.value)}
                            className="w-full flex-1 bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-sm text-gray-300 font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 transition-all resize-none"
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
                    <Button variant="outline" className="flex-1 bg-transparent border-gray-800 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                        onClick={() => onOpenChange(false)} disabled={isLoading}>取消</Button>
                    <Button className="flex-1 bg-cyan-700 hover:bg-cyan-600 text-white" onClick={handleSubmit} disabled={isLoading}>
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


// ── Main Page ───────────────────────────────────────────────────────────────
export default function SkillsPage() {
    const [activeTab, setActiveTab] = useState<"installed" | "marketplace">("installed");

    // Installed Skills
    const [skills, setSkills] = useState<any[]>([]);
    const [selectedSkill, setSelectedSkill] = useState<any | null>(null);
    const [hasUnsyncedChanges, setHasUnsyncedChanges] = useState(false);

    // Marketplace
    const [marketSkills, setMarketSkills] = useState<any[]>([]);
    const [selectedMarketSkill, setSelectedMarketSkill] = useState<any | null>(null);
    const [marketTotal, setMarketTotal] = useState(0);
    const [marketPage, setMarketPage] = useState(1);
    const [marketSearchText, setMarketSearchText] = useState("");
    const [marketSearchQuery, setMarketSearchQuery] = useState("");
    const [isMarketLoading, setIsMarketLoading] = useState(false);
    const [installingId, setInstallingId] = useState<string | null>(null);

    const [isInjecting, setIsInjecting] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [showDone, setShowDone] = useState(false);

    // Editor state
    const [showEditor, setShowEditor] = useState(false);
    const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
    const [editTarget, setEditTarget] = useState<{ id: string, content: string }>({ id: "", content: "" });

    const loadSkills = useCallback(() => {
        fetch("/api/skills")
            .then((res) => res.json())
            .then((data) => {
                if (Array.isArray(data)) {
                    setSkills(data);
                    // Update selected skill if it exists
                    if (selectedSkill) {
                        const updated = data.find(s => s.id === selectedSkill.id);
                        if (updated) setSelectedSkill(updated);
                    } else if (data.length > 0) {
                        setSelectedSkill(data[0]);
                    }
                }
            })
            .catch((err) => console.error(err));
    }, [selectedSkill]);

    const loadMarketplace = useCallback(async (page = 1, search = marketSearchQuery) => {
        setIsMarketLoading(true);
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: "20",
                search,
                category: "all"
            });
            const res = await fetch(`/api/skills/marketplace?${params.toString()}`);
            const data = await res.json();
            setMarketSkills(data.skills || []);
            setMarketTotal(data.total || 0);

            if (data.skills && data.skills.length > 0 && !selectedMarketSkill) {
                setSelectedMarketSkill(data.skills[0]);
            }
        } catch (err) {
            console.error("Failed to load marketplace:", err);
        } finally {
            setIsMarketLoading(false);
        }
    }, [marketSearchQuery, selectedMarketSkill]);

    useEffect(() => {
        loadSkills();
        loadMarketplace(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Re-fetch marketplace when page or search query changes
    useEffect(() => {
        loadMarketplace(marketPage, marketSearchQuery);
    }, [marketPage, marketSearchQuery]);

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setMarketPage(1);
        setMarketSearchQuery(marketSearchText);
    };

    const toggleSkill = async (id: string, enabled: boolean) => {
        try {
            const res = await fetch("/api/skills/toggle", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, enabled }),
            });
            const data = await res.json();
            if (data.success) {
                setSkills((prev) =>
                    prev.map((s) => (s.id === id ? { ...s, isEnabled: enabled } : s))
                );
                if (selectedSkill?.id === id) {
                    setSelectedSkill((prev: any) => prev ? { ...prev, isEnabled: enabled } : null);
                }
                setHasUnsyncedChanges(true);
            }
        } catch (err) {
            console.error(err);
        }
    };

    const installSkill = async (skill: any) => {
        setInstallingId(skill.id);
        try {
            const res = await fetch("/api/skills/marketplace/install", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: skill.id, repoUrl: skill.repoUrl }),
            });
            const data = await res.json();
            if (data.success) {
                setHasUnsyncedChanges(true);
                loadSkills();
            }
        } catch (err) {
            console.error("Install failed:", err);
        } finally {
            setInstallingId(null);
        }
    };

    const handleInject = async () => {
        setIsInjecting(true);
        try {
            const res = await fetch("/api/skills/inject", { method: "POST" });
            const data = await res.json();
            if (data.success) {
                setShowConfirm(false);
                setHasUnsyncedChanges(false);
                setShowDone(true);
                setTimeout(() => {
                    setShowDone(false);
                    setIsInjecting(false);
                    loadSkills();
                }, 3000);
            } else {
                setIsInjecting(false);
            }
        } catch (err) {
            console.error(err);
            setIsInjecting(false);
        }
    };

    const handleCreateSkill = () => {
        setEditorMode("create");
        setEditTarget({ id: "", content: "" });
        setShowEditor(true);
    };

    const handleEditSkill = (e: React.MouseEvent, skill: any) => {
        e.stopPropagation();
        setEditorMode("edit");
        setEditTarget({ id: skill.id, content: skill.content });
        setShowEditor(true);
    };

    return (
        <>
            <div className="flex-1 overflow-hidden bg-gray-950 p-6 flex flex-col text-white">
                <div className="max-w-6xl w-full mx-auto h-full flex flex-col pt-4">

                    {/* Header */}
                    <div className="flex items-center justify-between mb-8 animate-in fade-in slide-in-from-top-4 duration-500">
                        <div className="flex items-center gap-4">
                            <div className="inline-flex items-center justify-center p-3 bg-cyan-950/50 border border-cyan-800/50 rounded-xl shadow-[0_0_20px_-5px_rgba(6,182,212,0.4)]">
                                <BookOpen className="w-6 h-6 text-cyan-400" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-cyan-100 to-cyan-400 tracking-tight">
                                    技能說明書 (Skills)
                                </h1>
                                <p className="text-sm text-gray-500 mt-0.5">管理 Golem 的核心能力與開放技能市場</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 bg-gray-900 border border-gray-800 p-1 rounded-xl mr-auto ml-8 shadow-inner">
                            <button
                                onClick={() => setActiveTab("installed")}
                                className={`px-4 py-1.5 text-sm font-medium rounded-lg flex items-center gap-2 transition-all ${activeTab === "installed"
                                        ? "bg-gray-800 text-white shadow-sm"
                                        : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
                                    }`}
                            >
                                <BookOpen className="w-4 h-4" />
                                已載入模組
                            </button>
                            <button
                                onClick={() => setActiveTab("marketplace")}
                                className={`px-4 py-1.5 text-sm font-medium rounded-lg flex items-center gap-2 transition-all ${activeTab === "marketplace"
                                        ? "bg-gray-800 text-cyan-400 shadow-sm"
                                        : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
                                    }`}
                            >
                                <Store className="w-4 h-4" />
                                技能市場
                            </button>
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleCreateSkill}
                                className="px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 transition-all bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 hover:text-white"
                            >
                                <Plus className="w-4 h-4" />
                                新增技能
                            </button>
                            <button
                                onClick={() => setShowConfirm(true)}
                                disabled={isInjecting}
                                className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 transition-all ${hasUnsyncedChanges
                                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/50 hover:bg-amber-500/30 animate-pulse"
                                    : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20"
                                    } ${isInjecting ? "opacity-60 cursor-not-allowed" : ""}`}
                            >
                                <Zap className={`w-4 h-4 ${isInjecting ? "animate-pulse" : ""}`} />
                                {isInjecting ? "注入中..." : "注入技能書"}
                            </button>
                        </div>
                    </div>

                    {/* Main Content */}
                    <div className="flex flex-1 min-h-0 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
                        {/* Detail View (Left) */}
                        <Card className="flex-[2] bg-gray-900/40 border-gray-800 shadow-2xl flex flex-col min-h-0 rounded-2xl overflow-hidden backdrop-blur-sm">
                            <CardHeader className="flex-shrink-0 border-b border-gray-800 bg-gray-900/60 p-5 px-6">
                                {activeTab === "installed" ? (
                                    selectedSkill ? (
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center shadow-inner">
                                                    <BookOpen className="w-5 h-5 text-cyan-400/80" />
                                                </div>
                                                <div>
                                                    <h3 className="text-lg font-bold text-gray-100 leading-tight">
                                                        {selectedSkill.title}
                                                    </h3>
                                                    <p className="text-xs text-gray-500 font-mono mt-0.5">
                                                        {selectedSkill.id}.md
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                {!selectedSkill.isOptional && (
                                                    <div className="flex items-center gap-1.5 px-3 py-1 bg-gray-800/80 border border-gray-700 text-gray-400 text-[11px] uppercase tracking-wider font-bold rounded-lg select-none">
                                                        <AlertCircle className="w-3.5 h-3.5 opacity-70" />
                                                        常駐核心技能
                                                    </div>
                                                )}
                                                {selectedSkill.isOptional && (
                                                    <button
                                                        onClick={(e) => handleEditSkill(e, selectedSkill)}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:bg-gray-700 text-xs font-medium rounded-lg transition-colors"
                                                    >
                                                        <Pencil className="w-3.5 h-3.5" /> 編輯
                                                    </button>
                                                )}
                                                {selectedSkill.isOptional && (
                                                    <label className="relative inline-flex items-center cursor-pointer ml-1">
                                                        <input
                                                            type="checkbox"
                                                            className="sr-only peer"
                                                            checked={selectedSkill.isEnabled}
                                                            onChange={(e) => toggleSkill(selectedSkill.id, e.target.checked)}
                                                        />
                                                        <div className="w-11 h-6 bg-gray-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 peer-checked:after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all border border-gray-700 peer-checked:bg-cyan-600 peer-checked:border-cyan-500 shadow-inner"></div>
                                                    </label>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="h-[46px] flex items-center text-gray-500 text-sm">請選擇一個技能以檢視內容</div>
                                    )
                                ) : (
                                    selectedMarketSkill ? (
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center shadow-inner">
                                                    <Store className="w-5 h-5 text-cyan-400/80" />
                                                </div>
                                                <div>
                                                    <h3 className="text-lg font-bold text-gray-100 leading-tight">
                                                        {selectedMarketSkill.title}
                                                    </h3>
                                                    <p className="text-xs text-gray-500 font-mono mt-0.5">
                                                        {selectedMarketSkill.id}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                {skills.some(s => s.id === selectedMarketSkill.id) ? (
                                                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-950/30 border border-green-900/50 text-green-400 text-xs tracking-wider font-bold rounded-lg cursor-default">
                                                        <CheckCircle2 className="w-4 h-4" />
                                                        已安裝
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => installSkill(selectedMarketSkill)}
                                                        disabled={installingId === selectedMarketSkill.id}
                                                        className="flex items-center gap-1.5 px-4 py-2 bg-cyan-700 border border-cyan-600 hover:bg-cyan-600 text-white text-sm font-medium rounded-lg transition-colors shadow-lg disabled:opacity-50"
                                                    >
                                                        {installingId === selectedMarketSkill.id ? (
                                                            <><RefreshCcw className="w-4 h-4 animate-spin" /> 安裝中...</>
                                                        ) : (
                                                            <><Download className="w-4 h-4" /> 一鍵安裝</>
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="h-[46px] flex items-center text-gray-500 text-sm">請在右側選擇技能以檢視詳細</div>
                                    )
                                )}
                            </CardHeader>
                            <CardContent className="flex-1 overflow-y-auto p-0 scroll-smooth">
                                {activeTab === "installed" ? (
                                    selectedSkill ? (
                                        <div className="prose prose-invert prose-cyan max-w-none p-6 text-gray-300/90 text-[15px] leading-relaxed 
                                            prose-headings:text-gray-100 prose-headings:font-bold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg
                                            prose-a:text-cyan-400 hover:prose-a:text-cyan-300 prose-code:text-cyan-300 prose-code:bg-cyan-950/30 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none
                                            prose-pre:bg-gray-900 prose-pre:border prose-pre:border-gray-800 prose-pre:shadow-lg
                                            prose-blockquote:border-l-cyan-500 prose-blockquote:bg-cyan-950/10 prose-blockquote:px-4 prose-blockquote:py-1 prose-blockquote:rounded-r-lg prose-blockquote:not-italic prose-blockquote:text-gray-400
                                            prose-strong:text-cyan-50 prose-li:marker:text-gray-600"
                                        >
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                {selectedSkill.content.replace(/<SkillModule[^>]*>([\s\S]*?)<\/SkillModule>/g, '$1').trim()}
                                            </ReactMarkdown>
                                        </div>
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center text-gray-600 space-y-4">
                                            <BookOpen className="w-12 h-12 opacity-20" />
                                            <p>在右側列表中選擇技能</p>
                                        </div>
                                    )
                                ) : (
                                    selectedMarketSkill ? (
                                        <div className="p-8">
                                            <div className="flex gap-4 items-start mb-6">
                                                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 flex items-center justify-center shadow-lg">
                                                    <Store className="w-8 h-8 text-cyan-400/80" />
                                                </div>
                                                <div>
                                                    <h2 className="text-2xl font-bold text-white mb-2">{selectedMarketSkill.title}</h2>
                                                    <div className="flex gap-2">
                                                        <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-gray-800 text-gray-300 rounded-md border border-gray-700">
                                                            <Tags className="w-3 h-3 text-cyan-400" /> {selectedMarketSkill.category}
                                                        </span>
                                                        <a href={selectedMarketSkill.repoUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs px-2.5 py-1 bg-gray-800 text-gray-300 rounded-md border border-gray-700 hover:text-white hover:border-gray-500 transition-colors">
                                                            View on GitHub
                                                        </a>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="prose prose-invert prose-cyan max-w-none text-gray-300/90 text-[15px] leading-relaxed">
                                                <h3>Description</h3>
                                                <p>{selectedMarketSkill.description}</p>
                                                <div className="p-4 mt-6 bg-gray-900 border border-gray-800 rounded-xl relative overflow-hidden">
                                                    <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-700/10 rounded-bl-full pointer-events-none"></div>
                                                    <h4 className="flex items-center gap-2 text-cyan-400 text-sm font-bold uppercase tracking-wide mt-0 mb-3"><Zap className="w-4 h-4" />如何安裝</h4>
                                                    <p className="text-sm text-gray-400 mt-0 m-0">
                                                        點擊右上角的「一鍵安裝」，Golem 會自動從 GitHub 抓取這個技能的指令集並註冊到本地端。接著切換回「已載入模組」將其開啟，最後透過注入功能讓 Golem 學會新能力！
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center text-gray-600 space-y-4">
                                            <Store className="w-12 h-12 opacity-20" />
                                            <p>在市場列表中選擇技能</p>
                                        </div>
                                    )
                                )}
                            </CardContent>
                        </Card>

                        {/* List (Right) */}
                        <div className="flex-1 flex flex-col min-h-0 bg-gray-900/30 border border-gray-800/80 rounded-2xl overflow-hidden shadow-xl">
                            {activeTab === "installed" ? (
                                <>
                                    <div className="p-4 border-b border-gray-800/80 bg-gray-900/50 backdrop-blur-sm flex justify-between items-center shrink-0">
                                        <h2 className="text-sm font-bold text-gray-200 uppercase tracking-widest flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></div>
                                            已載入模組 ({skills.length})
                                        </h2>
                                    </div>
                                    <div className="flex-1 overflow-y-auto p-2 space-y-1 scroll-smooth">
                                        {skills.map((skill) => (
                                            <button
                                                key={skill.id}
                                                onClick={() => setSelectedSkill(skill)}
                                                className={`w-full text-left px-4 py-3 rounded-xl flex items-center justify-between transition-all duration-200 group relative overflow-hidden ${selectedSkill?.id === skill.id
                                                    ? "bg-cyan-950/40 border border-cyan-800/50 shadow-lg"
                                                    : "hover:bg-gray-800/50 border border-transparent"
                                                    }`}
                                            >
                                                {/* Highlight accent on selected */}
                                                {selectedSkill?.id === skill.id && (
                                                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-cyan-500 shadow-[0_0_12px_rgba(6,182,212,0.6)] rounded-r-full"></div>
                                                )}

                                                <div className="flex flex-col gap-1 pr-4 z-10 w-full overflow-hidden">
                                                    <span className={`font-semibold text-[15px] truncate ${selectedSkill?.id === skill.id ? "text-cyan-100" : "text-gray-300"
                                                        }`}>
                                                        {skill.title}
                                                    </span>
                                                    <div className="flex items-center gap-2">
                                                        {!skill.isOptional ? (
                                                            <span className="text-[9px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 rounded-md uppercase tracking-wider font-bold shadow-[0_0_10px_-2px_rgba(99,102,241,0.2)]">
                                                                常駐核心
                                                            </span>
                                                        ) : skill.isEnabled ? (
                                                            <span className="flex items-center gap-1 text-[10px] text-cyan-400 uppercase tracking-wider font-bold">
                                                                <CheckCircle2 className="w-3 h-3" /> 已啟用
                                                            </span>
                                                        ) : (
                                                            <span className="text-[10px] text-gray-600 uppercase tracking-wider font-bold">未啟用</span>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2 z-10 shrink-0">
                                                    {skill.isOptional && (
                                                        <div
                                                            onClick={(e) => handleEditSkill(e, skill)}
                                                            className={`p-1.5 rounded-md transition-colors ${selectedSkill?.id === skill.id
                                                                ? "text-cyan-400 hover:bg-cyan-900/50"
                                                                : "text-gray-500 opacity-0 group-hover:opacity-100 hover:bg-gray-700 hover:text-gray-300"
                                                                }`}
                                                        >
                                                            <Pencil className="w-3.5 h-3.5" />
                                                        </div>
                                                    )}
                                                    <ChevronRight className={`w-4 h-4 transition-transform ${selectedSkill?.id === skill.id ? "text-cyan-400 translate-x-1" : "text-gray-600 group-hover:text-gray-400 group-hover:translate-x-0.5"
                                                        }`} />
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="p-4 border-b border-gray-800/80 bg-gray-900/50 backdrop-blur-sm shrink-0">
                                        <form onSubmit={handleSearchSubmit} className="relative w-full">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                                            <input
                                                type="text"
                                                value={marketSearchText}
                                                onChange={(e) => setMarketSearchText(e.target.value)}
                                                placeholder="搜尋市場技能..."
                                                className="w-full bg-gray-950/60 border border-gray-800 rounded-lg pl-9 pr-4 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all placeholder-gray-600"
                                            />
                                        </form>
                                    </div>
                                    <div className="flex-1 overflow-y-auto p-2 space-y-1 scroll-smooth">
                                        {isMarketLoading ? (
                                            <div className="p-8 flex flex-col items-center justify-center text-gray-500">
                                                <RefreshCcw className="w-6 h-6 animate-spin mb-4" />
                                                <p className="text-sm">載入技能資料中...</p>
                                            </div>
                                        ) : marketSkills.length === 0 ? (
                                            <div className="p-8 text-center text-gray-500 text-sm">找不到相關技能</div>
                                        ) : (
                                            marketSkills.map((skill) => (
                                                <button
                                                    key={skill.id}
                                                    onClick={() => setSelectedMarketSkill(skill)}
                                                    className={`w-full text-left px-4 py-3 rounded-xl flex items-center justify-between transition-all duration-200 group relative overflow-hidden ${selectedMarketSkill?.id === skill.id
                                                        ? "bg-cyan-950/40 border border-cyan-800/50 shadow-lg"
                                                        : "hover:bg-gray-800/50 border border-transparent"
                                                        }`}
                                                >
                                                    {selectedMarketSkill?.id === skill.id && (
                                                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-cyan-500 shadow-[0_0_12px_rgba(6,182,212,0.6)] rounded-r-full"></div>
                                                    )}
                                                    <div className="flex flex-col gap-1 pr-4 z-10 w-full overflow-hidden">
                                                        <span className={`font-semibold text-sm truncate w-full ${selectedMarketSkill?.id === skill.id ? "text-cyan-100" : "text-gray-300"
                                                            }`}>
                                                            {skill.title}
                                                        </span>
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[10px] text-gray-500 truncate w-3/4">
                                                                {skill.description}
                                                            </span>
                                                            {skills.some(installedSkill => installedSkill.id === skill.id) && (
                                                                <span className="text-[9px] bg-green-500/10 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded-md uppercase tracking-wider font-bold">
                                                                    已安裝
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                    {/* Pagination Controls */}
                                    <div className="p-3 border-t border-gray-800/80 bg-gray-900/50 shrink-0 flex items-center justify-between text-sm">
                                        <button
                                            onClick={() => setMarketPage(p => Math.max(1, p - 1))}
                                            disabled={marketPage === 1}
                                            className="px-3 py-1 bg-gray-800 border border-gray-700 rounded text-gray-300 disabled:opacity-50 hover:bg-gray-700 transition"
                                        >
                                            上頁
                                        </button>
                                        <span className="text-gray-500 text-xs">
                                            {marketPage} / {Math.ceil(marketTotal / 20) || 1}
                                        </span>
                                        <button
                                            onClick={() => setMarketPage(p => p + 1)}
                                            disabled={marketPage >= Math.ceil(marketTotal / 20)}
                                            className="px-3 py-1 bg-gray-800 border border-gray-700 rounded text-gray-300 disabled:opacity-50 hover:bg-gray-700 transition"
                                        >
                                            下頁
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Dialogs */}
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
        </>
    );
}
