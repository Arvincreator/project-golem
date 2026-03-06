"use client";

import { useEffect, useState, useCallback } from "react";
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
import { BookOpen, AlertCircle, CheckCircle2, RefreshCcw, ChevronRight, Zap, TriangleAlert, Plus, Pencil, X } from "lucide-react";
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
    const [skills, setSkills] = useState<any[]>([]);
    const [selectedSkill, setSelectedSkill] = useState<any | null>(null);
    const [hasUnsyncedChanges, setHasUnsyncedChanges] = useState(false);

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

    useEffect(() => {
        loadSkills();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
                // ✅ 同步更新右側詳情目前選擇的技能狀態，避免 UI 按鈕卡住不變
                if (selectedSkill?.id === id) {
                    setSelectedSkill((prev: any) => prev ? { ...prev, isEnabled: enabled } : null);
                }
                setHasUnsyncedChanges(true);
            }
        } catch (err) {
            console.error(err);
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
                // ✅ [修復] 不再重啟整個程序（會導致 golem 狀態重置到 pending_setup）
                // reloadSkills() 現在直接對 Gemini 重注入，技能即時生效
                // 3 秒後關閉 "完成" Dialog 並刷新技能列表
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
                                <p className="text-sm text-gray-500 mt-0.5">管理 Golem 的核心能力與選配模組</p>
                            </div>
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
                        {/* Selected Skill Detail (Left) */}
                        <Card className="flex-[2] bg-gray-900/40 border-gray-800 shadow-2xl flex flex-col min-h-0 rounded-2xl overflow-hidden backdrop-blur-sm">
                            <CardHeader className="flex-shrink-0 border-b border-gray-800 bg-gray-900/60 p-5 px-6">
                                {selectedSkill ? (
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
                                )}
                            </CardHeader>
                            <CardContent className="flex-1 overflow-y-auto p-0 scroll-smooth">
                                {selectedSkill ? (
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
                                )}
                            </CardContent>
                        </Card>

                        {/* Skill List (Right) */}
                        <div className="flex-1 flex flex-col min-h-0 bg-gray-900/30 border border-gray-800/80 rounded-2xl overflow-hidden shadow-xl">
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

                                        <div className="flex flex-col gap-1 pr-4 z-10">
                                            <span className={`font-semibold text-[15px] ${selectedSkill?.id === skill.id ? "text-cyan-100" : "text-gray-300"
                                                }`}>
                                                {skill.title}
                                            </span>
                                            <div className="flex items-center gap-2">
                                                {!skill.isOptional ? (
                                                    <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">常駐核心</span>
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
