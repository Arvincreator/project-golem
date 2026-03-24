"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
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
    Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast-provider";
import { apiGet, apiPost } from "@/lib/api-client";
import { useQuery } from "@/hooks/useQuery";
import { useI18n } from "@/components/I18nProvider";

interface Preset {
    id: string;
    name: string;
    name_zh?: string;
    description: string;
    description_zh?: string;
    icon: string;
    aiName: string;
    userName: string;
    role: string;
    role_zh?: string;
    tone: string;
    tags: string[];
    skills: string[];
    category?: string;
    category_name?: { en: string, zh: string };
}

interface PersonaData {
    aiName: string;
    userName: string;
    currentRole: string;
    tone: string;
    skills: string[];
    isNew?: boolean;
}

type PersonaTemplatesResponse = {
    templates?: Preset[];
};

type PersonaMarketResponse = {
    personas?: Preset[];
    total?: number;
    error?: string;
};

function getErrorMessage(error: unknown, fallback = "請求發送失敗"): string {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
}

function hasCJKText(value: string): boolean {
    return /[\u3400-\u9FFF]/.test(value);
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
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    return (
        <Dialog open={open} onOpenChange={isLoading ? undefined : onOpenChange}>
            <DialogContent showCloseButton={!isLoading} className="bg-card border-border text-foreground max-w-sm">
                <DialogHeader>
                    <div className="w-12 h-12 rounded-xl border bg-primary/10 border-primary/20 flex items-center justify-center mb-2">
                        <Zap className="w-5 h-5 text-primary" />
                    </div>
                    <DialogTitle className="text-foreground text-base">{isEnglish ? "Save persona and open a new chat window?" : "儲存人格並開啟新對話窗口？"}</DialogTitle>
                    <DialogDescription className="text-muted-foreground text-sm leading-relaxed">
                        {isEnglish
                            ? "Persona settings will be written to file, and a fresh Golem chat window will open to apply the new profile."
                            : "人格設定將寫入檔案，並重新開啟 Golem 對話窗口使新設定正式生效。"}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    <div className="flex items-start gap-2 rounded-lg bg-muted border border-border px-3 py-2.5">
                        <TriangleAlert className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-muted-foreground">
                            {isEnglish ? "Current conversations will be interrupted and a new Golem chat window will be opened." : "進行中的對話將被中斷，此動作將為 Golem 開啟全新的對話視窗。"}
                        </p>
                    </div>
                    <div className="rounded-lg bg-secondary/30 border border-border px-3 py-2">
                        <p className="text-[11px] text-muted-foreground mb-1 font-medium">{isEnglish ? "After confirmation, the system will:" : "確認後將自動執行："}</p>
                        <ol className="text-[11px] text-muted-foreground/80 space-y-0.5 list-decimal list-inside">
                            <li>{isEnglish ? "Write persona settings to persona.json" : "將人格設定寫入 persona.json"}</li>
                            <li>{isEnglish ? "Reopen Gemini chat window" : "重新開啟 Gemini 對話視窗"}</li>
                            <li>{isEnglish ? "Load new persona and memory history" : "載入新的人格與歷史記憶"}</li>
                        </ol>
                    </div>
                </div>
                <DialogFooter className="gap-2 sm:gap-2">
                    <Button
                        variant="outline"
                        className="flex-1 bg-transparent border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={() => onOpenChange(false)}
                        disabled={isLoading}
                    >{isEnglish ? "Cancel" : "取消"}</Button>
                    <Button
                        className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
                        onClick={onConfirm}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <span className="flex items-center gap-1.5">
                                <RefreshCcw className="w-3.5 h-3.5 animate-spin" />{isEnglish ? "Saving and restarting..." : "儲存並重啟視窗中..."}
                            </span>
                        ) : (
                            <span className="flex items-center gap-1.5">
                                <Zap className="w-3.5 h-3.5" />{isEnglish ? "Confirm" : "確認開啟"}
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
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    return (
        <Dialog open={open} onOpenChange={() => { }}>
            <DialogContent className="bg-card border-border text-foreground max-w-sm" showCloseButton={false}>
                <DialogHeader>
                    <div className="w-12 h-12 rounded-xl border bg-green-500/10 border-green-500/20 flex items-center justify-center mb-2">
                        <Check className="w-5 h-5 text-green-600 dark:text-green-400" />
                    </div>
                    <DialogTitle className="text-foreground text-base">{isEnglish ? "Persona saved ✅" : "人格設定已儲存 ✅"}</DialogTitle>
                    <DialogDescription className="text-muted-foreground text-sm">
                        {isEnglish
                            ? "Persona updated. Golem is loading your settings in a new window. This page will refresh in 3 seconds."
                            : "人格已更新，Golem 正在新視窗載入您的設定。頁面將在 3 秒後自動重新整理。"}
                    </DialogDescription>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
}

// ── Persona Delete Confirm Dialog ──────────────────────────────────────────
function PersonaDeleteConfirmDialog({
    open, onOpenChange, onConfirm, isLoading, personaName,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onConfirm: () => void;
    isLoading: boolean;
    personaName: string;
}) {
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    return (
        <Dialog open={open} onOpenChange={isLoading ? undefined : onOpenChange}>
            <DialogContent showCloseButton={!isLoading} className="bg-card border-border text-foreground max-w-sm">
                <DialogHeader>
                    <div className="w-12 h-12 rounded-xl border bg-destructive/10 border-destructive/20 flex items-center justify-center mb-2">
                        <Trash2 className="w-5 h-5 text-destructive" />
                    </div>
                    <DialogTitle className="text-foreground text-base">{isEnglish ? "Delete this persona?" : "確定要刪除此人格嗎？"}</DialogTitle>
                    <DialogDescription className="text-muted-foreground text-sm leading-relaxed">
                        {isEnglish ? (
                            <>You are deleting template "<span className="text-foreground font-medium">{personaName}</span>". This cannot be undone.</>
                        ) : (
                            <>您即將刪除樣板「<span className="text-foreground font-medium">{personaName}</span>」。此動作無法復原。</>
                        )}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2 sm:gap-2 pt-2">
                    <Button
                        variant="outline"
                        className="flex-1 bg-transparent border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={() => onOpenChange(false)}
                        disabled={isLoading}
                    >{isEnglish ? "Cancel" : "取消"}</Button>
                    <Button
                        className="flex-1 bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                        onClick={onConfirm}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <span className="flex items-center gap-1.5">
                                <RefreshCcw className="w-3.5 h-3.5 animate-spin" />{isEnglish ? "Deleting..." : "刪除中..."}
                            </span>
                        ) : (
                            <span className="flex items-center gap-1.5">
                                <Trash2 className="w-3.5 h-3.5" />{isEnglish ? "Confirm delete" : "確認刪除"}
                            </span>
                        )}
                    </Button>
                </DialogFooter>
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
    const { locale } = useI18n();
    const isEnglish = locale === "en";
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
        if (!id.trim() || !name.trim()) { setError(isEnglish ? "Please fill in ID and Name" : "請填寫 ID 與名稱"); return; }
        setIsLoading(true); setError(null);
        try {
            const data = await apiPost<{ success?: boolean; error?: string }>("/api/persona/create", {
                id: id.trim(),
                name: name.trim(),
                description,
                icon,
                aiName,
                userName,
                role,
                tone,
                tags
            });
            if (data.success) { reset(); onOpenChange(false); onCreated(); }
            else setError(data.error || (isEnglish ? "Create failed" : "建立失敗"));
        } catch (error: unknown) {
            setError(getErrorMessage(error, isEnglish ? "Request failed" : "請求發送失敗"));
        }
        finally { setIsLoading(false); }
    };

    const fieldCls = "w-full bg-secondary/30 border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all placeholder:text-muted-foreground";

    return (
        <Dialog open={open} onOpenChange={isLoading ? undefined : handleClose}>
            <DialogContent showCloseButton={!isLoading} className="bg-card border-border text-foreground max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <div className="w-10 h-10 rounded-xl border bg-primary/10 border-primary/20 flex items-center justify-center mb-2">
                        <Plus className="w-5 h-5 text-primary" />
                    </div>
                    <DialogTitle className="text-foreground text-base">{isEnglish ? "Create Persona Template" : "新增人格樣板"}</DialogTitle>
                    <DialogDescription className="text-muted-foreground text-sm">{isEnglish ? "Create a new persona template (.md)." : "建立新的 persona .md 樣板。"}</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">{isEnglish ? "File ID" : "檔案 ID"} <span className="text-destructive">*</span></label>
                            <input value={id} onChange={e => setId(e.target.value)} placeholder="my_persona" className={fieldCls} />
                            <p className="text-[10px] text-muted-foreground mt-1">{isEnglish ? "Letters, numbers, underscore. Auto-lowercased." : "英數字與底線，自動轉小寫"}</p>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">{isEnglish ? "Display Name" : "顯示名稱"} <span className="text-destructive">*</span></label>
                            <input value={name} onChange={e => setName(e.target.value)} placeholder={isEnglish ? "My Persona" : "我的人格"} className={fieldCls} />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">{isEnglish ? "Short Description" : "簡短描述"}</label>
                        <input value={description} onChange={e => setDescription(e.target.value)} placeholder={isEnglish ? "One-line description of this persona" : "一句話描述這個人格的特色"} className={fieldCls} />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">{isEnglish ? "Icon" : "圖示"}</label>
                        <div className="flex flex-wrap gap-2">
                            {ICON_OPTIONS.map(opt => {
                                const Ico = ICON_MAP[opt];
                                return (
                                    <button key={opt} onClick={() => setIcon(opt)}
                                        className={cn("p-2.5 rounded-xl border transition-all",
                                            icon === opt ? "bg-primary/20 border-primary/50 text-primary" : "bg-secondary border-border text-muted-foreground hover:border-gray-400")}
                                        title={opt}><Ico className="w-4 h-4" /></button>
                                );
                            })}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">{isEnglish ? "AI Name" : "AI 名稱"}</label>
                            <input value={aiName} onChange={e => setAiName(e.target.value)} placeholder="Golem" className={fieldCls} />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">{isEnglish ? "User Name" : "使用者稱呼"}</label>
                            <input value={userName} onChange={e => setUserName(e.target.value)} placeholder="Traveler" className={fieldCls} />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">{isEnglish ? "Role & Persona Background" : "任務定位 &amp; 人設背景"}</label>
                        <textarea value={role} onChange={e => setRole(e.target.value)}
                            placeholder={isEnglish ? "Describe this persona's background, mission, and personality..." : "描述這個人格的身份背景、任務與個性..."}
                            className={`${fieldCls} resize-y min-h-[90px]`} />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">{isEnglish ? "Language Style & Tone" : "語言風格 &amp; 語氣"}</label>
                        <input value={tone} onChange={e => setTone(e.target.value)} placeholder={isEnglish ? "e.g. lively and humorous, direct and decisive" : "例如：活潑幽默、直接果斷"} className={fieldCls} />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">{isEnglish ? "Tags (comma-separated)" : "標籤（逗號分隔）"}</label>
                        <input value={tags} onChange={e => setTags(e.target.value)} placeholder={isEnglish ? "productivity, assistant, professional" : "生產力, 助手, 專業"} className={fieldCls} />
                    </div>
                    {error && (
                        <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-2 pt-2">
                    <Button variant="outline" className="flex-1 bg-transparent border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                        onClick={() => handleClose(false)} disabled={isLoading}>{isEnglish ? "Cancel" : "取消"}</Button>
                    <Button className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleSubmit} disabled={isLoading}>
                        {isLoading
                            ? <span className="flex items-center gap-1.5"><RefreshCcw className="w-3.5 h-3.5 animate-spin" />{isEnglish ? "Creating..." : "建立中..."}</span>
                            : <span className="flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" />{isEnglish ? "Create Persona" : "建立人格"}</span>}
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
    const base = "w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all placeholder:text-muted-foreground/60";
    return (
        <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</label>
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
    const toast = useToast();
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    const [saved, setSaved] = useState<PersonaData | null>(null);  // last-saved state
    const [aiName, setAiName] = useState("Golem");
    const [userName, setUserName] = useState("Traveler");
    const [role, setRole] = useState("");
    const [tone, setTone] = useState("");

    const [isDirty, setIsDirty] = useState(false);
    const [isInjecting, setIsInjecting] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [showDone, setShowDone] = useState(false);
    const [showCreate, setShowCreate] = useState(false);

    const [templates, setTemplates] = useState<Preset[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedTag, setSelectedTag] = useState<string | null>(null);

    // Market / Tab states
    const [activeTab, setActiveTab] = useState<"local" | "market">("local");
    const [marketPersonas, setMarketPersonas] = useState<Preset[]>([]);
    const [marketTotal, setMarketTotal] = useState(0);
    const [marketPage, setMarketPage] = useState(1);
    const [searchMarketTerm, setSearchMarketTerm] = useState("");
    const [marketCategory, setMarketCategory] = useState("all");
    const [isMarketLoading, setIsMarketLoading] = useState(false);

    // Drawer state
    const [selectedPersona, setSelectedPersona] = useState<Preset | null>(null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    // Delete state
    const [personaToDelete, setPersonaToDelete] = useState<Preset | null>(null);
    const [isDeletingPersona, setIsDeletingPersona] = useState(false);

    const [statusMsg, setStatusMsg] = useState<{ type: "error" | "info"; text: string } | null>(null);
    const hasHydratedPersonaRef = useRef(false);

    const applyToForm = (data: PersonaData) => {
        setAiName(data.aiName || "Golem");
        setUserName(data.userName || "Traveler");
        setRole(data.currentRole || "");
        setTone(data.tone || "");
    };

    const fetchPersona = useCallback(() => apiGet<PersonaData>("/api/persona"), []);
    const fetchTemplates = useCallback(() => apiGet<PersonaTemplatesResponse>("/api/golems/templates"), []);

    const {
        data: personaData,
    } = useQuery<PersonaData>(fetchPersona, []);

    const {
        data: templatesData,
        refetch: refetchTemplates,
    } = useQuery<PersonaTemplatesResponse>(fetchTemplates, []);

    useEffect(() => {
        if (!personaData) return;
        setSaved(personaData);
        if (!hasHydratedPersonaRef.current) {
            applyToForm(personaData);
            hasHydratedPersonaRef.current = true;
        }
    }, [personaData]);

    useEffect(() => {
        if (templatesData?.templates) {
            setTemplates(templatesData.templates);
        }
    }, [templatesData]);

    useEffect(() => {
        if (activeTab === "market") {
            setIsMarketLoading(true);
            const delayDebounceFn = setTimeout(() => {
                const loadMarket = async () => {
                    try {
                        const data = await apiGet<PersonaMarketResponse>(
                            `/api/persona/market?search=${encodeURIComponent(searchMarketTerm)}&category=${encodeURIComponent(marketCategory)}&page=${marketPage}&limit=20`
                        );
                        if (!data.error) {
                            setMarketPersonas(data.personas || []);
                            setMarketTotal(data.total || 0);
                        }
                    } catch (error) {
                        console.error("Error fetching market personas", error);
                    } finally {
                        setIsMarketLoading(false);
                    }
                };

                void loadMarket();
            }, 300); // debounce search
            return () => clearTimeout(delayDebounceFn);
        }
    }, [activeTab, searchMarketTerm, marketCategory, marketPage]);

    // Detect dirty state
    useEffect(() => {
        if (!saved) return;
        const changed = aiName !== saved.aiName || userName !== saved.userName
            || role !== saved.currentRole || tone !== saved.tone;
        setIsDirty(changed);
    }, [aiName, userName, role, tone, saved]);

    const handleDiscard = () => {
        if (saved) applyToForm(saved);
        setIsDirty(false);
        setSelectedPersona(null);
        setIsDrawerOpen(false);
        setStatusMsg(null);
    };

    const handleInject = async () => {
        setIsInjecting(true);
        setStatusMsg(null);
        try {
            const data = await apiPost<{ success?: boolean; message?: string; error?: string }>("/api/persona/inject", {
                aiName,
                userName,
                currentRole: role,
                tone,
            });
            if (data.success) {
                setShowConfirm(false);
                setIsDirty(false);
                setShowDone(true);
                // 不再呼叫 /api/system/reload，因為這會殺掉整個 node process
                // 而是直接等待 3 秒讓前端狀態重置
                setTimeout(() => window.location.reload(), 3000);
            } else {
                setShowConfirm(false);
                setStatusMsg({ type: "error", text: data.message || data.error || (isEnglish ? "Inject failed" : "注入失敗") });
            }
        } catch {
            setShowConfirm(false);
            setStatusMsg({ type: "error", text: isEnglish ? "Failed to send inject request" : "注入請求發送失敗" });
        } finally {
            setIsInjecting(false);
        }
    };

    const applyPreset = (preset: Preset, options?: { preferOriginal?: boolean }) => {
        const preferOriginal = Boolean(options?.preferOriginal);
        const preferZh = !isEnglish && !options?.preferOriginal && (preset.tags?.includes('zh') || !!preset.name_zh);

        setSelectedPersona(preset);

        if (preferOriginal) {
            const originalAiName = (preset.aiName || preset.name || "Golem").trim();
            const originalUserNameRaw = (preset.userName || "").trim();
            const originalRoleRaw = (preset.role || "").trim();
            const originalDescription = (preset.description || "").trim();
            const originalToneRaw = (preset.tone || "").trim();

            const originalUserName = originalUserNameRaw && !hasCJKText(originalUserNameRaw) ? originalUserNameRaw : "User";
            const originalRole = originalRoleRaw && !hasCJKText(originalRoleRaw)
                ? originalRoleRaw
                : (originalDescription || "A thoughtful AI assistant that helps the user effectively.");
            const originalTone = originalToneRaw && !hasCJKText(originalToneRaw)
                ? originalToneRaw
                : "Professional, natural, and friendly";

            setAiName(originalAiName);
            setUserName(originalUserName);
            setRole(originalRole);
            setTone(originalTone);
        } else {
            setAiName(preferZh ? (preset.name_zh || preset.aiName || preset.name) : (preset.aiName || preset.name));
            setUserName(preferZh && (preset.userName === "User" || !preset.userName) ? "使用者" : (preset.userName || "User"));
            setRole(preferZh
                ? (preset.role_zh || preset.role || preset.description_zh || preset.description)
                : (preset.role || preset.description));
            setTone(preferZh && (preset.tone === "Professional" || !preset.tone) ? "專業" : (preset.tone || "Professional"));
        }
        
        setIsDrawerOpen(true);
        setStatusMsg(null);
    };

    const handleDeletePersona = async () => {
        if (!personaToDelete) return;
        setIsDeletingPersona(true);
        try {
            const data = await apiPost<{ success?: boolean; error?: string }>("/api/persona/delete", {
                id: personaToDelete.id,
            });
            if (data.success) {
                setPersonaToDelete(null);
                await refetchTemplates(); // 重新整理列表
                if (selectedPersona?.id === personaToDelete.id) {
                    setSelectedPersona(null);
                    setIsDrawerOpen(false);
                }
            } else {
                toast.error(isEnglish ? "Delete failed" : "刪除失敗", data.error || (isEnglish ? "Delete failed" : "刪除失敗"));
            }
        } catch (err) {
            console.error(err);
            toast.error(isEnglish ? "Request failed" : "請求失敗", isEnglish ? "Request failed" : "請求發送失敗");
        } finally {
            setIsDeletingPersona(false);
        }
    };

    const allTags = Array.from(new Set(templates.flatMap(t => t.tags || [])));
    const filteredTemplates = templates.filter(t => {
        const s = t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            t.description.toLowerCase().includes(searchTerm.toLowerCase());
        const tg = !selectedTag || (t.tags && t.tags.includes(selectedTag));
        return s && tg;
    });

    return (
        <div className="flex h-full overflow-hidden bg-background">
            <div className="flex-1 overflow-auto p-6 scrollbar-hide">
                <div className="max-w-6xl w-full mx-auto pb-12 pt-4 space-y-8">

                    {/* ── Page Header & Current Status ─────────────────── */}
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 animate-in fade-in slide-in-from-top-4 duration-500">
                        <div className="flex items-center gap-4">
                            <div className="inline-flex items-center justify-center p-3 bg-primary/10 border border-primary/20 shadow-[0_0_20px_-5px_rgba(var(--primary),0.4)] rounded-2xl">
                                <User className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                                <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-foreground via-foreground/90 to-primary tracking-tight">
                                    {isEnglish ? "Persona Settings" : "人格設定 (Persona)"}
                                </h1>
                                <p className="text-sm text-muted-foreground mt-1.5 flex items-center gap-2">
                                    <Sparkles className="w-3.5 h-3.5 text-primary/60" />
                                    {isEnglish ? "Manage Golem identity, role positioning, and language style" : "管理 Golem 的身份、任務定位與語言風格"}
                                </p>
                            </div>
                        </div>

                        {/* Current Persona Mini Card */}
                        {saved && (
                            <div 
                                onClick={() => {
                                    applyToForm(saved);
                                    setSelectedPersona({
                                        id: 'current',
                                        name: saved.aiName,
                                        description: isEnglish ? "Currently active settings" : '目前正在運行的設定',
                                        icon: 'User',
                                        aiName: saved.aiName,
                                        userName: saved.userName,
                                        role: saved.currentRole,
                                        tone: saved.tone,
                                        tags: [],
                                        skills: []
                                    });
                                    setIsDrawerOpen(true);
                                }}
                                className="group flex items-center gap-4 bg-card/40 backdrop-blur-md border border-border/50 rounded-2xl p-3 pl-4 pr-6 cursor-pointer hover:border-primary/40 hover:bg-card/60 transition-all duration-300 shadow-sm"
                            >
                                <div className="relative">
                                    <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center border border-primary/30 group-hover:scale-110 transition-transform duration-500">
                                        <User className="w-5 h-5 text-primary" />
                                    </div>
                                    <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-green-500 border-2 border-background animate-pulse" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest leading-none mb-1.5 opacity-70">
                                        {isEnglish ? "ACTIVE" : "執行中 (Active)"}
                                    </p>
                                    <h3 className="text-sm font-bold text-foreground truncate group-hover:text-primary transition-colors">
                                        {saved.aiName}
                                    </h3>
                                </div>
                                <div className="ml-2 p-1.5 rounded-lg bg-secondary/30 text-muted-foreground group-hover:text-primary transition-colors">
                                    <Pencil className="w-3.5 h-3.5" />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Templates Section ────────────────────────────── */}
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
                        <div className="flex items-center gap-6 border-b border-border mb-6">
                            <button
                                onClick={() => { setActiveTab("local"); setSearchTerm(""); setSelectedTag(null); }}
                                className={cn("pb-3 text-sm font-medium transition-all relative",
                                    activeTab === "local" ? "text-primary" : "text-muted-foreground hover:text-foreground")}
                            >
                                <div className="flex items-center gap-2">
                                    <User className="w-4 h-4" /> {isEnglish ? "My Templates (Local)" : "我的樣板 (Local)"}
                                </div>
                                {activeTab === "local" && (
                                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
                                )}
                            </button>
                            <button
                                onClick={() => { setActiveTab("market"); setSearchTerm(""); }}
                                className={cn("pb-3 text-sm font-medium transition-all relative",
                                    activeTab === "market" ? "text-primary" : "text-muted-foreground hover:text-foreground")}
                            >
                                <div className="flex items-center gap-2">
                                    <Sparkles className="w-4 h-4" /> {isEnglish ? "Persona Market" : "人格市集 (Market)"}
                                </div>
                                {activeTab === "market" && (
                                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
                                )}
                            </button>
                        </div>

                        {activeTab === "local" && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-sm font-medium text-muted-foreground">{isEnglish ? "Local custom and preset templates" : "本地自訂與預設樣板"}</h2>
                                    <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 text-xs font-medium rounded-lg transition-all">
                                        <Plus className="w-3.5 h-3.5" />{isEnglish ? "Add Persona" : "新增人格"}
                                    </button>
                                </div>
                                {/* Search + Tags */}
                                <div className="bg-card/40 border border-border rounded-2xl p-4">
                                    <div className="flex gap-3 mb-4">
                                        <div className="relative flex-1">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                            <input
                                                type="text"
                                                placeholder={isEnglish ? "Search templates..." : "搜尋樣板..."}
                                                value={searchTerm}
                                                onChange={e => setSearchTerm(e.target.value)}
                                                className="w-full bg-secondary/30 border border-border rounded-xl pl-9 pr-4 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all placeholder:text-muted-foreground"
                                            />
                                            {searchTerm && (
                                                <button onClick={() => setSearchTerm("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                                                    <X className="w-3 h-3 text-muted-foreground/60" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <button onClick={() => setSelectedTag(null)}
                                            className={cn("px-3 py-1 rounded-lg text-xs font-medium transition-all",
                                                selectedTag === null ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground")}>
                                            {isEnglish ? "All" : "全部"}
                                        </button>
                                        {allTags.map(tag => (
                                            <button key={tag} onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                                                className={cn("px-3 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1",
                                                    selectedTag === tag ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground")}>
                                                <Tag className="w-3 h-3" />{tag}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Local Grid */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {filteredTemplates.length > 0 ? filteredTemplates.map(preset => (
                                        <div
                                            key={preset.id}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => applyPreset(preset)}
                                            onKeyDown={(e) => e.key === 'Enter' && applyPreset(preset)}
                                            className={cn(
                                                "text-left p-4 rounded-2xl border transition-all duration-300 group relative overflow-hidden flex flex-col cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary",
                                                selectedPersona?.id === preset.id
                                                    ? "bg-primary/5 border-primary/50 ring-1 ring-primary/30"
                                                    : "bg-card border-border hover:border-primary/50 hover:bg-accent/50"
                                            )}
                                        >
                                            <div className="flex items-start justify-between mb-3">
                                                <div className={cn("p-2.5 rounded-xl transition-colors",
                                                    selectedPersona?.id === preset.id
                                                        ? "bg-primary text-primary-foreground dark:text-primary-foreground"
                                                        : "bg-secondary text-muted-foreground group-hover:text-primary")}>
                                                    {(() => { const I = ICON_MAP[preset.icon] || ICON_MAP.BrainCircuit; return <I className="w-5 h-5" />; })()}
                                                </div>
                                                {selectedPersona?.id === preset.id && (
                                                    <div className="flex items-center gap-1 bg-primary/20 border border-primary/30 text-primary text-[9px] font-bold px-2 py-0.5 rounded-full">
                                                        <Check className="w-2.5 h-2.5" />{isEnglish ? "Applied" : "套用中"}
                                                    </div>
                                                )}
                                            </div>
                                            <h4 className={cn("font-bold mb-1 text-sm transition-colors",
                                                selectedPersona?.id === preset.id ? "text-primary dark:text-primary-foreground text-base" : "text-foreground group-hover:text-primary text-sm")}>
                                                {preset.name}
                                            </h4>
                                            <p className="text-xs text-muted-foreground leading-relaxed flex-1">{preset.description}</p>
                                            
                                            {/* Delete Button (only for custom ones) */}
                                            {activeTab === "local" && !['standard', 'expert', 'analyst', 'coach', 'creative', 'storyteller', 'translator'].includes(preset.id) && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setPersonaToDelete(preset);
                                                    }}
                                                    className="absolute bottom-3 right-3 p-2 bg-background/50 border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 rounded-lg opacity-0 group-hover:opacity-100 transition-all z-10"
                                                    title={isEnglish ? "Delete persona template" : "刪除人格樣板"}
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                        </div>
                                    )) : (
                                        <div className="col-span-full py-16 text-center bg-secondary/20 border border-dashed border-border rounded-2xl flex flex-col items-center">
                                            <Search className="w-8 h-8 text-muted-foreground/40 mb-2" />
                                            <p className="text-muted-foreground text-sm">{isEnglish ? "No templates found" : "找不到符合條件的樣板"}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === "market" && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-sm font-medium text-muted-foreground">
                                        {isEnglish ? "Massive personas from Awesome ChatGPT Prompts" : "來自 Awesome ChatGPT Prompts 的海量人格"}
                                    </h2>
                                </div>
                                <div className="bg-card/40 border border-border rounded-2xl p-4">
                                    <div className="flex gap-3 mb-4">
                                        <div className="relative flex-1">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                            <input
                                                type="text"
                                                placeholder={isEnglish ? "Search market personas..." : "搜尋市集人格..."}
                                                value={searchMarketTerm}
                                                onChange={e => { setSearchMarketTerm(e.target.value); setMarketPage(1); }}
                                                className="w-full bg-secondary/30 border border-border rounded-xl pl-9 pr-4 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all placeholder:text-muted-foreground"
                                            />
                                            {searchMarketTerm && (
                                                <button onClick={() => { setSearchMarketTerm(""); setMarketPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2">
                                                    <X className="w-3 h-3 text-muted-foreground" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {[
                                            { id: 'all', zh: '全部', en: 'All' },
                                            { id: 'coding-and-dev', zh: '寫程式與開發', en: 'Coding & Dev' },
                                            { id: 'writing-and-language', zh: '寫作與語言', en: 'Writing & Language' },
                                            { id: 'business-and-marketing', zh: '商業與行銷', en: 'Business & Marketing' },
                                            { id: 'education', zh: '教育與學習', en: 'Education' },
                                            { id: 'health-and-fitness', zh: '健康與塑身', en: 'Health & Fitness' },
                                            { id: 'gaming-and-rpg', zh: '遊戲與角色扮演', en: 'Gaming & RPG' },
                                            { id: 'data-and-research', zh: '數據與研究', en: 'Data & Research' },
                                            { id: 'creative-arts', zh: '創意與藝術', en: 'Creative Arts' },
                                            { id: 'other', zh: '其他角色', en: 'Other' }
                                        ].map(cat => (
                                            <button key={cat.id} onClick={() => { setMarketCategory(cat.id); setMarketPage(1); }}
                                                className={cn("px-3 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1",
                                                    marketCategory === cat.id ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground")}>
                                                <Filter className="w-3 h-3" />{isEnglish ? cat.en : cat.zh}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {isMarketLoading ? (
                                    <div className="py-20 flex justify-center items-center">
                                        <RefreshCcw className="w-8 h-8 text-primary animate-spin" />
                                    </div>
                                ) : (
                                    <>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {marketPersonas.length > 0 ? marketPersonas.map(preset => (
                                                <div
                                                    key={preset.id}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => applyPreset({ ...preset, icon: "Sparkles", aiName: preset.name, userName: "User", tone: "Professional", skills: [] }, { preferOriginal: true })}
                                                    onKeyDown={(e) => e.key === 'Enter' && applyPreset({ ...preset, icon: "Sparkles", aiName: preset.name, userName: "User", tone: "Professional", skills: [] }, { preferOriginal: true })}
                                                    className={cn(
                                                        "text-left p-4 rounded-2xl border transition-all duration-300 group relative overflow-hidden flex flex-col cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary",
                                                        selectedPersona?.id === preset.id
                                                            ? "bg-primary/5 border-primary/50 ring-1 ring-primary/30"
                                                            : "bg-card border-border hover:border-primary/50 hover:bg-accent/50"
                                                    )}
                                                >
                                                    <div className="flex items-start justify-between mb-3">
                                                        <div className={cn("p-2.5 rounded-xl transition-colors",
                                                            selectedPersona?.id === preset.id
                                                                ? "bg-primary text-primary-foreground"
                                                                : "bg-secondary text-muted-foreground group-hover:text-primary")}>
                                                            <Sparkles className="w-5 h-5" />
                                                        </div>
                                                        {selectedPersona?.id === preset.id && (
                                                            <div className="flex items-center gap-1 bg-primary/20 border border-primary/30 text-primary text-[9px] font-bold px-2 py-0.5 rounded-full">
                                                                <Check className="w-2.5 h-2.5" />{isEnglish ? "Applied" : "套用中"}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <h4 className={cn("font-bold mb-1 text-sm transition-colors",
                                                        selectedPersona?.id === preset.id ? "text-primary-foreground" : "text-foreground group-hover:text-primary")}>
                                                        {preset.name}
                                                    </h4>
                                                    <p className="text-xs text-muted-foreground leading-relaxed flex-1 line-clamp-3">
                                                        {preset.description}
                                                    </p>
                                                    {preset.category_name && (
                                                        <div className="mt-3 pt-3 border-t border-border/50 flex justify-between items-center w-full">
                                                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                                                <Tag className="w-3 h-3" /> {preset.category_name.en || preset.category_name.zh}
                                                            </span>
                                                        </div>
                                                    )}
                                                    <div className="flex flex-wrap gap-1 mt-3">
                                                        <span className="px-1.5 py-0.5 bg-secondary/50 border border-border text-[9px] text-muted-foreground rounded">
                                                            #market
                                                        </span>
                                                    </div>
                                                </div>
                                            )) : (
                                                <div className="col-span-full py-16 text-center bg-secondary/20 border border-dashed border-border rounded-2xl flex flex-col items-center">
                                                    <Search className="w-8 h-8 text-muted-foreground/40 mb-2" />
                                                    <p className="text-muted-foreground text-sm">{isEnglish ? "No personas found" : "找不到符合條件的人格"}</p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Pagination Controls */}
                                        {marketTotal > 0 && (
                                            <div className="flex items-center justify-between mt-6 bg-secondary/40 p-3 rounded-xl border border-border">
                                                <p className="text-xs text-muted-foreground">
                                                    {isEnglish
                                                        ? `Showing ${(marketPage - 1) * 20 + 1} to ${Math.min(marketPage * 20, marketTotal)} of ${marketTotal}`
                                                        : `顯示 ${(marketPage - 1) * 20 + 1} 到 ${Math.min(marketPage * 20, marketTotal)}，共 ${marketTotal} 筆`}
                                                </p>
                                                <div className="flex items-center gap-2">
                                                    <Button
                                                        variant="outline" size="sm"
                                                        className="bg-secondary border-border text-muted-foreground hover:bg-secondary/80 hover:text-foreground h-8"
                                                        onClick={() => setMarketPage(p => Math.max(1, p - 1))}
                                                        disabled={marketPage === 1}
                                                    >
                                                        {isEnglish ? "Prev" : "上一頁"}
                                                    </Button>
                                                    <div className="flex items-center gap-1">
                                                        {Array.from({ length: Math.min(5, Math.ceil(marketTotal / 20)) }, (_, i) => {
                                                            let pageNum = marketPage;
                                                            if (marketPage < 3) pageNum = i + 1;
                                                            else if (marketPage > Math.ceil(marketTotal / 20) - 2) pageNum = Math.ceil(marketTotal / 20) - 4 + i;
                                                            else pageNum = marketPage - 2 + i;
                                                            
                                                            if (pageNum > 0 && pageNum <= Math.ceil(marketTotal / 20)) {
                                                                return (
                                                                    <button
                                                                        key={pageNum}
                                                                        onClick={() => setMarketPage(pageNum)}
                                                                        className={cn("w-8 h-8 rounded-lg text-xs font-medium transition-all",
                                                                            marketPage === pageNum ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}
                                                                    >
                                                                        {pageNum}
                                                                    </button>
                                                                );
                                                            }
                                                            return null;
                                                        })}
                                                    </div>
                                                    <Button
                                                        variant="outline" size="sm"
                                                        className="bg-secondary border-border text-muted-foreground hover:bg-secondary/80 hover:text-foreground h-8"
                                                        onClick={() => setMarketPage(p => Math.min(Math.ceil(marketTotal / 20), p + 1))}
                                                        disabled={marketPage === Math.ceil(marketTotal / 20)}
                                                    >
                                                        {isEnglish ? "Next" : "下一頁"}
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Detail Drawer ─────────────────────────────────────────── */}
            <div className={cn(
                "fixed inset-0 z-50 transition-opacity duration-300 pointer-events-none",
                isDrawerOpen ? "bg-black/60 backdrop-blur-sm opacity-100 pointer-events-auto" : "opacity-0"
            )} onClick={() => setIsDrawerOpen(false)} />

            <aside className={cn(
                "fixed inset-y-0 right-0 w-full sm:w-[450px] bg-card border-l border-border shadow-2xl z-50 transition-transform duration-500 ease-out flex flex-col overflow-hidden",
                isDrawerOpen ? "translate-x-0" : "translate-x-full"
            )}>
                {selectedPersona && (
                    <>
                        {(() => {
                            const selectedIsMarket = Array.isArray(selectedPersona.tags) && selectedPersona.tags.includes("market");
                            const displaySelectedName = selectedIsMarket ? selectedPersona.name : (selectedPersona.name_zh || selectedPersona.name);
                            const displaySelectedDescription = selectedIsMarket
                                ? selectedPersona.description
                                : (selectedPersona.description_zh || selectedPersona.description);
                            return (
                                <>
                        <div className="flex items-center justify-between p-6 border-b border-border bg-accent/10">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center border border-primary/30">
                                    {(() => { const I = ICON_MAP[selectedPersona.icon] || ICON_MAP.BrainCircuit; return <I className="w-6 h-6 text-primary" />; })()}
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-foreground truncate max-w-[200px]">
                                        {displaySelectedName}
                                    </h2>
                                    <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mt-0.5">
                                        {isEnglish ? "Template Details & Settings" : "樣板詳情 & 設定"}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsDrawerOpen(false)}
                                className="p-2.5 rounded-xl hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide">
                            <div className="space-y-4">
                                <h3 className="text-xs font-bold text-primary flex items-center gap-2 uppercase tracking-wider">
                                    <Sparkles className="w-3.5 h-3.5" /> {isEnglish ? "Description" : "角色描述"}
                                </h3>
                                <div className="bg-secondary/40 border border-border/50 rounded-2xl p-5 shadow-inner">
                                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap italic opacity-90">
                                        「{displaySelectedDescription}」
                                    </p>
                                </div>
                                {selectedPersona.tags && selectedPersona.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {selectedPersona.tags.map(t => (
                                            <span key={t} className="px-2 py-0.5 rounded-md bg-secondary border border-border text-[10px] text-muted-foreground font-medium flex items-center gap-1 capitalize">
                                                <Tag className="w-2.5 h-2.5" /> {t}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-6">
                                <h3 className="text-xs font-bold text-primary flex items-center gap-2 uppercase tracking-wider border-b border-border pb-2">
                                    <Settings2 className="w-3.5 h-3.5" /> {isEnglish ? "Persona Details" : "人格詳細設定"}
                                </h3>
                                
                                <div className="grid grid-cols-2 gap-4">
                                    <EditField label={isEnglish ? "AI Name" : "AI 名稱"} value={aiName} onChange={setAiName} placeholder={isEnglish ? "e.g. Friday, Golem" : "例如：Friday, Golem"} />
                                    <EditField label={isEnglish ? "Your Name" : "你的稱呼"} value={userName} onChange={setUserName} placeholder={isEnglish ? "e.g. Boss, Commander" : "例如：Boss, Commander"} />
                                </div>

                                <EditField 
                                    label={isEnglish ? "Language Style & Tone" : "語言風格 & 語氣"} 
                                    value={tone} 
                                    onChange={setTone}
                                    placeholder={isEnglish ? "e.g. lively and humorous, direct and decisive" : "例如：活潑幽默、直接果斷"} 
                                />

                                <EditField 
                                    label={isEnglish ? "Role & Persona Background" : "任務定位 & 人設背景"} 
                                    value={role} 
                                    onChange={setRole} 
                                    multiline
                                    placeholder={isEnglish ? "Describe this persona's background, mission, and personality..." : "描述這個人格的身份背景、任務與個性..."} 
                                />
                            </div>

                            {statusMsg && (
                                <div className={cn(
                                    "flex items-start gap-3 text-sm rounded-xl px-4 py-3 border animate-in fade-in zoom-in-95",
                                    statusMsg.type === "info"
                                        ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                                        : "bg-red-500/10 border-red-500/30 text-red-400"
                                )}>
                                    <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                                    <p>{statusMsg.text}</p>
                                </div>
                            )}
                        </div>

                        <div className="p-6 border-t border-border bg-accent/5">
                            <div className="flex gap-3">
                                <Button
                                    variant="outline"
                                    onClick={() => handleDiscard()}
                                    className="flex-1 h-12 rounded-xl border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                                >
                                    {isEnglish ? "Discard Changes" : "放棄修改"}
                                </Button>
                                <Button
                                    onClick={() => setShowConfirm(true)}
                                    disabled={isInjecting || !isDirty}
                                    className="flex-[2] h-12 font-bold bg-primary hover:bg-primary/90 text-primary-foreground border-none shadow-xl shadow-primary/20 transition-all hover:scale-[1.02] active:scale-95 rounded-xl text-sm"
                                >
                                    <Zap className="w-4 h-4 mr-2" />
                                    {isEnglish ? "Save & Restart Window" : "儲存並重啟視窗"}
                                </Button>
                            </div>
                            <p className="text-center text-[10px] text-muted-foreground mt-3 opacity-60">
                                {isEnglish
                                    ? "After clicking save & restart, settings will be written to file and a new Gemini window will open."
                                    : "點擊「儲存並重啟」後設定將寫入檔案並開啟全新 Gemini 視窗"}
                            </p>
                        </div>
                                </>
                            );
                        })()}
                    </>
                )}
            </aside>

            {/* ── Dialogs ─────────────────────────────────────────────────── */}
            <RestartConfirmDialog
                open={showConfirm}
                onOpenChange={setShowConfirm}
                onConfirm={handleInject}
                isLoading={isInjecting}
            />
            <RestartingDialog open={showDone} />
            <CreatePersonaDialog
                open={showCreate}
                onOpenChange={setShowCreate}
                onCreated={() => { void refetchTemplates(); }}
            />
            <PersonaDeleteConfirmDialog
                open={!!personaToDelete}
                onOpenChange={(open) => !open && setPersonaToDelete(null)}
                onConfirm={handleDeletePersona}
                isLoading={isDeletingPersona}
                personaName={personaToDelete?.name || ""}
            />
        </div>
    );
}
