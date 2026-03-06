"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    BrainCircuit,
    Cpu,
    Palette,
    Sparkles,
    User,
    Settings2,
    Search,
    Tag,
    X,
    Filter,
    Zap,
    RefreshCcw,
    TriangleAlert,
    Plus,
    AlertCircle,
    Pencil,
    Check,
    RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

interface PersonaData {
    aiName: string;
    userName: string;
    currentRole: string;
    tone: string;
    skills: string[];
    isNew?: boolean;
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    BrainCircuit, Cpu, Palette, Sparkles, User, Settings2,
};
const ICON_OPTIONS = ["BrainCircuit", "Cpu", "Palette", "Sparkles", "User", "Settings2"];

// ── Confirm Restart Dialog ───────────────────────────────────────────────────
function RestartConfirmDialog({
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
                    <div className="w-12 h-12 rounded-xl border bg-purple-500/10 border-purple-500/20 flex items-center justify-center mb-2">
                        <Zap className="w-5 h-5 text-purple-400" />
                    </div>
                    <DialogTitle className="text-white text-base">儲存人格並開啟新對話窗口？</DialogTitle>
                    <DialogDescription className="text-gray-400 text-sm leading-relaxed">
                        人格設定將寫入檔案，並重新開啟 Golem 對話窗口使新設定正式生效。
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    <div className="flex items-start gap-2 rounded-lg bg-gray-800/60 border border-gray-700/50 px-3 py-2.5">
                        <TriangleAlert className="w-3.5 h-3.5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-gray-500">進行中的對話將被中斷，此動作將為 Golem 開啟全新的對話視窗。</p>
                    </div>
                    <div className="rounded-lg bg-gray-800/40 border border-gray-700/30 px-3 py-2">
                        <p className="text-[11px] text-gray-500 mb-1 font-medium">確認後將自動執行：</p>
                        <ol className="text-[11px] text-gray-400 space-y-0.5 list-decimal list-inside">
                            <li>將人格設定寫入 persona.json</li>
                            <li>重新開啟 Gemini 對話視窗</li>
                            <li>載入新的人格與歷史記憶</li>
                        </ol>
                    </div>
                </div>
                <DialogFooter className="gap-2 sm:gap-2">
                    <Button
                        variant="outline"
                        className="flex-1 bg-transparent border-gray-800 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                        onClick={() => onOpenChange(false)}
                        disabled={isLoading}
                    >取消</Button>
                    <Button
                        className="flex-1 bg-purple-700 hover:bg-purple-600 text-white"
                        onClick={onConfirm}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <span className="flex items-center gap-1.5">
                                <RefreshCcw className="w-3.5 h-3.5 animate-spin" />儲存並重啟視窗中...
                            </span>
                        ) : (
                            <span className="flex items-center gap-1.5">
                                <Zap className="w-3.5 h-3.5" />確認開啟
                            </span>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Restarting Dialog ────────────────────────────────────────────────────────
function RestartingDialog({ open }: { open: boolean }) {
    return (
        <Dialog open={open} onOpenChange={() => { }}>
            <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm" showCloseButton={false}>
                <DialogHeader>
                    <div className="w-12 h-12 rounded-xl border bg-green-500/10 border-green-500/20 flex items-center justify-center mb-2">
                        <Check className="w-5 h-5 text-green-400" />
                    </div>
                    <DialogTitle className="text-white text-base">人格設定已儲存 ✅</DialogTitle>
                    <DialogDescription className="text-gray-400 text-sm">
                        人格已更新，Golem 正在新視窗載入您的設定。頁面將在 3 秒後自動重新整理。
                    </DialogDescription>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
}

// ── Create Persona Dialog ────────────────────────────────────────────────────
function CreatePersonaDialog({
    open, onOpenChange, onCreated,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onCreated: () => void;
}) {
    const [id, setId] = useState("");
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [icon, setIcon] = useState("BrainCircuit");
    const [aiName, setAiName] = useState("Golem");
    const [userName, setUserName] = useState("Traveler");
    const [role, setRole] = useState("");
    const [tone, setTone] = useState("");
    const [tags, setTags] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reset = () => {
        setId(""); setName(""); setDescription(""); setIcon("BrainCircuit");
        setAiName("Golem"); setUserName("Traveler"); setRole(""); setTone(""); setTags("");
        setError(null);
    };

    const handleClose = (v: boolean) => { if (!v) reset(); onOpenChange(v); };

    const handleSubmit = async () => {
        if (!id.trim() || !name.trim()) { setError("請填寫 ID 與名稱"); return; }
        setIsLoading(true); setError(null);
        try {
            const res = await fetch("/api/persona/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: id.trim(), name: name.trim(), description, icon, aiName, userName, role, tone, tags }),
            });
            const data = await res.json();
            if (res.ok && data.success) { reset(); onOpenChange(false); onCreated(); }
            else setError(data.error || "建立失敗");
        } catch { setError("請求發送失敗"); }
        finally { setIsLoading(false); }
    };

    const fieldCls = "w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 transition-all placeholder:text-gray-600";

    return (
        <Dialog open={open} onOpenChange={isLoading ? undefined : handleClose}>
            <DialogContent showCloseButton={!isLoading} className="bg-gray-900 border-gray-700 text-white max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <div className="w-10 h-10 rounded-xl border bg-purple-500/10 border-purple-500/20 flex items-center justify-center mb-2">
                        <Plus className="w-5 h-5 text-purple-400" />
                    </div>
                    <DialogTitle className="text-white text-base">新增人格樣板</DialogTitle>
                    <DialogDescription className="text-gray-400 text-sm">建立新的 persona .md 樣板。</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1.5">檔案 ID <span className="text-red-400">*</span></label>
                            <input value={id} onChange={e => setId(e.target.value)} placeholder="my_persona" className={fieldCls} />
                            <p className="text-[10px] text-gray-600 mt-1">英數字與底線，自動轉小寫</p>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1.5">顯示名稱 <span className="text-red-400">*</span></label>
                            <input value={name} onChange={e => setName(e.target.value)} placeholder="我的人格" className={fieldCls} />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">簡短描述</label>
                        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="一句話描述這個人格的特色" className={fieldCls} />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">圖示</label>
                        <div className="flex flex-wrap gap-2">
                            {ICON_OPTIONS.map(opt => {
                                const Ico = ICON_MAP[opt];
                                return (
                                    <button key={opt} onClick={() => setIcon(opt)}
                                        className={cn("p-2.5 rounded-xl border transition-all",
                                            icon === opt ? "bg-purple-500/20 border-purple-500/50 text-purple-300" : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600")}
                                        title={opt}><Ico className="w-4 h-4" /></button>
                                );
                            })}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1.5">AI 名稱</label>
                            <input value={aiName} onChange={e => setAiName(e.target.value)} placeholder="Golem" className={fieldCls} />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1.5">使用者稱呼</label>
                            <input value={userName} onChange={e => setUserName(e.target.value)} placeholder="Traveler" className={fieldCls} />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">任務定位 &amp; 人設背景</label>
                        <textarea value={role} onChange={e => setRole(e.target.value)}
                            placeholder="描述這個人格的身份背景、任務與個性..."
                            className={`${fieldCls} resize-y min-h-[90px]`} />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">語言風格 &amp; 語氣</label>
                        <input value={tone} onChange={e => setTone(e.target.value)} placeholder="例如：活潑幽默、直接果斷" className={fieldCls} />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">標籤（逗號分隔）</label>
                        <input value={tags} onChange={e => setTags(e.target.value)} placeholder="生產力, 助手, 專業" className={fieldCls} />
                    </div>
                    {error && (
                        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-2 pt-2">
                    <Button variant="outline" className="flex-1 bg-transparent border-gray-800 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                        onClick={() => handleClose(false)} disabled={isLoading}>取消</Button>
                    <Button className="flex-1 bg-purple-700 hover:bg-purple-600 text-white" onClick={handleSubmit} disabled={isLoading}>
                        {isLoading
                            ? <span className="flex items-center gap-1.5"><RefreshCcw className="w-3.5 h-3.5 animate-spin" />建立中...</span>
                            : <span className="flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" />建立人格</span>}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Inline field component ───────────────────────────────────────────────────
function EditField({
    label, value, onChange, multiline = false, placeholder = "",
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    multiline?: boolean;
    placeholder?: string;
}) {
    const base = "w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500 transition-all placeholder:text-gray-600";
    return (
        <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
            {multiline
                ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
                    className={`${base} resize-y min-h-[100px]`} />
                : <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
                    className={base} />}
        </div>
    );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function PersonaPage() {
    const [saved, setSaved] = useState<PersonaData | null>(null);  // last-saved state
    const [aiName, setAiName] = useState("Golem");
    const [userName, setUserName] = useState("Traveler");
    const [role, setRole] = useState("");
    const [tone, setTone] = useState("");

    const [isEditing, setIsEditing] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [isInjecting, setIsInjecting] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [showDone, setShowDone] = useState(false);
    const [showCreate, setShowCreate] = useState(false);

    const [templates, setTemplates] = useState<Preset[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [activePresetId, setActivePresetId] = useState("");

    const [statusMsg, setStatusMsg] = useState<{ type: "error" | "info"; text: string } | null>(null);

    const applyToForm = (data: PersonaData) => {
        setAiName(data.aiName || "Golem");
        setUserName(data.userName || "Traveler");
        setRole(data.currentRole || "");
        setTone(data.tone || "");
    };

    // Load current persona
    useEffect(() => {
        fetch("/api/persona")
            .then(r => r.json())
            .then(data => {
                if (data && !data.error) {
                    setSaved(data);
                    applyToForm(data);
                }
            })
            .catch(() => { });
    }, []);

    const loadTemplates = useCallback(() => {
        fetch("/api/golems/templates")
            .then(r => r.json())
            .then(d => { if (d.templates) setTemplates(d.templates); })
            .catch(() => { });
    }, []);

    useEffect(() => { loadTemplates(); }, [loadTemplates]);

    // Detect dirty state
    useEffect(() => {
        if (!saved) return;
        const changed = aiName !== saved.aiName || userName !== saved.userName
            || role !== saved.currentRole || tone !== saved.tone;
        setIsDirty(changed);
    }, [aiName, userName, role, tone, saved]);

    const handleDiscard = () => {
        if (saved) applyToForm(saved);
        setIsEditing(false);
        setIsDirty(false);
        setActivePresetId("");
        setStatusMsg(null);
    };

    const handleInject = async () => {
        setIsInjecting(true);
        setStatusMsg(null);
        try {
            const res = await fetch("/api/persona/inject", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ aiName, userName, currentRole: role, tone }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setShowConfirm(false);
                setIsEditing(false);
                setIsDirty(false);
                setShowDone(true);
                // 不再呼叫 /api/system/reload，因為這會殺掉整個 node process
                // 而是直接等待 3 秒讓前端狀態重置
                setTimeout(() => window.location.reload(), 3000);
            } else {
                setShowConfirm(false);
                setStatusMsg({ type: "error", text: data.message || data.error || "注入失敗" });
            }
        } catch {
            setShowConfirm(false);
            setStatusMsg({ type: "error", text: "注入請求發送失敗" });
        } finally {
            setIsInjecting(false);
        }
    };

    const applyPreset = (preset: Preset) => {
        setActivePresetId(preset.id);
        setAiName(preset.aiName);
        setUserName(preset.userName);
        setRole(preset.role);
        setTone(preset.tone);
        setIsEditing(true);
        setStatusMsg({ type: "info", text: `已套用樣板「${preset.name}」，確認後請點擊「儲存並重啟」。` });
    };

    const allTags = Array.from(new Set(templates.flatMap(t => t.tags || [])));
    const filteredTemplates = templates.filter(t => {
        const s = t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            t.description.toLowerCase().includes(searchTerm.toLowerCase());
        const tg = !selectedTag || (t.tags && t.tags.includes(selectedTag));
        return s && tg;
    });

    const inputCls = "w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500 transition-all placeholder:text-gray-600";

    return (
        <>
            <div className="flex-1 overflow-auto bg-gray-950 p-6 text-white">
                <div className="max-w-5xl w-full mx-auto pb-12 pt-4 space-y-6">

                    {/* ── Page Header ─────────────────────────────────── */}
                    <div className="flex items-center gap-4 animate-in fade-in slide-in-from-top-4 duration-500">
                        <div className="inline-flex items-center justify-center p-3 bg-purple-950/50 border border-purple-800/50 rounded-xl shadow-[0_0_20px_-5px_rgba(168,85,247,0.4)]">
                            <User className="w-6 h-6 text-purple-400" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-purple-100 to-purple-400 tracking-tight">
                                人格設定 (Persona)
                            </h1>
                            <p className="text-sm text-gray-500 mt-0.5">管理 Golem 的身份、人設與語言風格</p>
                        </div>
                    </div>

                    {/* ── Current Persona Edit Card ────────────────────── */}
                    <div className="animate-in fade-in slide-in-from-top-2 duration-500 delay-100">
                        <div className={cn(
                            "bg-gray-900/70 backdrop-blur-sm border rounded-2xl relative overflow-hidden transition-all duration-300",
                            isEditing ? "border-purple-600/50 shadow-[0_0_30px_-8px_rgba(168,85,247,0.35)]" : "border-gray-800"
                        )}>
                            {/* Top accent bar */}
                            <div className={cn("absolute inset-x-0 top-0 h-[2px] transition-all duration-300",
                                isEditing
                                    ? "bg-gradient-to-r from-purple-600 via-blue-500 to-cyan-400"
                                    : "bg-gradient-to-r from-gray-700 via-gray-600 to-gray-700")} />

                            {/* Card Header */}
                            <div className="flex items-center justify-between px-6 pt-6 pb-4">
                                <div className="flex items-center gap-3">
                                    <div className={cn(
                                        "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                                        isEditing ? "bg-purple-900/50 border border-purple-700/40" : "bg-gray-800 border border-gray-700"
                                    )}>
                                        <User className={cn("w-5 h-5 transition-colors", isEditing ? "text-purple-300" : "text-gray-400")} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">目前人格</p>
                                        <p className="text-lg font-bold text-white leading-tight">{aiName}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {isDirty && !isEditing && (
                                        <span className="text-xs text-amber-400 bg-amber-900/20 border border-amber-700/30 rounded-full px-2.5 py-1">
                                            未儲存的變更
                                        </span>
                                    )}
                                    {isEditing ? (
                                        <button onClick={handleDiscard}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-all">
                                            <RotateCcw className="w-3.5 h-3.5" />捨棄變更
                                        </button>
                                    ) : (
                                        <button onClick={() => setIsEditing(true)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-purple-300 hover:text-white bg-purple-900/20 hover:bg-purple-900/40 border border-purple-700/40 rounded-lg transition-all">
                                            <Pencil className="w-3.5 h-3.5" />編輯人格
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* View Mode */}
                            {!isEditing && (
                                <div className="px-6 pb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="bg-gray-950/60 border border-gray-800/60 rounded-xl px-4 py-3">
                                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-medium">稱呼你為</p>
                                        <p className="text-sm text-gray-200">「{userName}」</p>
                                    </div>
                                    <div className="bg-gray-950/60 border border-gray-800/60 rounded-xl px-4 py-3">
                                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-medium">語言風格</p>
                                        <p className="text-sm text-gray-200 line-clamp-1">{tone || "—"}</p>
                                    </div>
                                    <div className="bg-gray-950/60 border border-gray-800/60 rounded-xl px-4 py-3 sm:col-span-2">
                                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-medium">任務定位 &amp; 人設背景</p>
                                        <p className="text-sm text-gray-200 line-clamp-3">{role || "—"}</p>
                                    </div>
                                </div>
                            )}

                            {/* Edit Mode */}
                            {isEditing && (
                                <div className="px-6 pb-6 space-y-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <EditField label="AI 名稱" value={aiName} onChange={setAiName} placeholder="例如：Friday, Golem" />
                                        <EditField label="你的稱呼" value={userName} onChange={setUserName} placeholder="例如：Boss, Commander" />
                                    </div>
                                    <EditField label="語言風格 & 語氣" value={tone} onChange={setTone}
                                        placeholder="例如：活潑幽默、直接果斷" />
                                    <EditField label="任務定位 & 人設背景" value={role} onChange={setRole} multiline
                                        placeholder="描述這個人格的身份背景、任務與個性..." />

                                    {/* Status msg inside edit card */}
                                    {statusMsg && (
                                        <div className={cn("flex items-start gap-2 text-sm rounded-lg px-3 py-2.5 border",
                                            statusMsg.type === "info"
                                                ? "bg-blue-950/30 border-blue-900/40 text-blue-300"
                                                : "bg-red-950/30 border-red-900/40 text-red-400")}>
                                            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                            <p>{statusMsg.text}</p>
                                        </div>
                                    )}

                                    {/* Save & Restart CTA */}
                                    <div className="pt-1">
                                        <Button
                                            onClick={() => setShowConfirm(true)}
                                            disabled={isInjecting}
                                            className="w-full h-12 font-bold bg-gradient-to-r from-purple-600 to-blue-500 hover:from-purple-500 hover:to-blue-400 border-none shadow-xl shadow-purple-900/20 transition-all hover:scale-[1.01] active:scale-95 rounded-2xl text-base"
                                        >
                                            <span className="flex items-center gap-2">
                                                <Zap className="w-5 h-5" />
                                                儲存人格並開啟新對話窗口
                                            </span>
                                        </Button>
                                        <p className="text-center text-xs text-gray-600 mt-2">
                                            重開視窗後新設定正式生效，前端將自動重新整理
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Templates Section ────────────────────────────── */}
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200 space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-base font-semibold text-gray-300 flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-purple-400" />
                                人格樣板庫
                            </h2>
                            <button
                                onClick={() => setShowCreate(true)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-900/30 border border-purple-700/40 text-purple-300 hover:bg-purple-900/50 text-xs font-medium rounded-lg transition-all"
                            >
                                <Plus className="w-3.5 h-3.5" />新增人格
                            </button>
                        </div>

                        {/* Search + Tags */}
                        <div className="bg-gray-900/40 border border-gray-800 rounded-2xl p-4">
                            <div className="flex gap-3 mb-4">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                                    <input
                                        type="text"
                                        placeholder="搜尋樣板..."
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                        className="w-full bg-gray-950 border border-gray-800 rounded-xl pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/30 transition-all placeholder:text-gray-600"
                                    />
                                    {searchTerm && (
                                        <button onClick={() => setSearchTerm("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                                            <X className="w-3 h-3 text-gray-500" />
                                        </button>
                                    )}
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                                    <Filter className="w-3.5 h-3.5" />
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button onClick={() => setSelectedTag(null)}
                                    className={cn("px-3 py-1 rounded-lg text-xs font-medium transition-all",
                                        selectedTag === null ? "bg-purple-500 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white")}>
                                    全部
                                </button>
                                {allTags.map(tag => (
                                    <button key={tag} onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                                        className={cn("px-3 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1",
                                            selectedTag === tag ? "bg-blue-500 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white")}>
                                        <Tag className="w-3 h-3" />{tag}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredTemplates.length > 0 ? filteredTemplates.map(preset => (
                                <button
                                    key={preset.id}
                                    onClick={() => applyPreset(preset)}
                                    className={cn(
                                        "text-left p-4 rounded-2xl border transition-all duration-300 group relative overflow-hidden flex flex-col",
                                        activePresetId === preset.id
                                            ? "bg-purple-950/25 border-purple-500/50 ring-1 ring-purple-500/30"
                                            : "bg-gray-900 border-gray-800 hover:border-gray-700 hover:bg-gray-800/70"
                                    )}
                                >
                                    <div className="flex items-start justify-between mb-3">
                                        <div className={cn("p-2.5 rounded-xl transition-colors",
                                            activePresetId === preset.id
                                                ? "bg-purple-500 text-white"
                                                : "bg-gray-800 text-gray-400 group-hover:text-purple-400")}>
                                            {(() => { const I = ICON_MAP[preset.icon] || ICON_MAP.BrainCircuit; return <I className="w-5 h-5" />; })()}
                                        </div>
                                        {activePresetId === preset.id && (
                                            <div className="flex items-center gap-1 bg-purple-500/20 border border-purple-500/30 text-purple-300 text-[9px] font-bold px-2 py-0.5 rounded-full">
                                                <Check className="w-2.5 h-2.5" />套用中
                                            </div>
                                        )}
                                    </div>
                                    <h4 className={cn("font-bold mb-1 text-sm transition-colors",
                                        activePresetId === preset.id ? "text-white" : "text-gray-200 group-hover:text-white")}>
                                        {preset.name}
                                    </h4>
                                    <p className="text-xs text-gray-500 leading-relaxed flex-1">{preset.description}</p>
                                    <div className="flex flex-wrap gap-1 mt-3">
                                        {preset.tags?.map(t => (
                                            <span key={t} className="px-1.5 py-0.5 bg-gray-950/50 border border-gray-800 text-[9px] text-gray-600 rounded">
                                                #{t}
                                            </span>
                                        ))}
                                    </div>
                                </button>
                            )) : (
                                <div className="col-span-full py-16 text-center bg-gray-900/20 border border-dashed border-gray-800 rounded-2xl flex flex-col items-center">
                                    <Search className="w-8 h-8 text-gray-700 mb-2" />
                                    <p className="text-gray-500 text-sm">找不到符合條件的樣板</p>
                                    <button onClick={() => { setSearchTerm(""); setSelectedTag(null); }}
                                        className="text-purple-500 text-xs mt-2 hover:underline">清除過濾條件</button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <RestartConfirmDialog open={showConfirm} onOpenChange={setShowConfirm} onConfirm={handleInject} isLoading={isInjecting} />
            <RestartingDialog open={showDone} />
            <CreatePersonaDialog open={showCreate} onOpenChange={setShowCreate} onCreated={loadTemplates} />
        </>
    );
}
