"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast-provider";
import { Copy, Plus, RefreshCw, Trash2, Search, Filter, Database, Download, Upload, ChevronDown, ChevronUp } from "lucide-react";
import { useGolem } from "@/components/GolemContext";
import { cn } from "@/lib/utils";
import { apiDeleteWrite, apiGet, apiPost } from "@/lib/api-client";
import { useI18n } from "@/components/I18nProvider";

interface MemoryItem {
    text: string;
    metadata?: Record<string, unknown>;
    score?: number;
}

function getErrorMessage(error: unknown, locale: "zh-TW" | "en"): string {
    if (error instanceof Error && error.message) return error.message;
    return locale === "en" ? "Unknown error" : "未知錯誤";
}

function getMemoryType(metadata?: Record<string, unknown>): string {
    const type = metadata?.type;
    return typeof type === "string" && type.trim() ? type : "general";
}

function ExpandableText({ text, limit = 150 }: { text: string; limit?: number }) {
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    const [isExpanded, setIsExpanded] = useState(false);
    const shouldTruncate = text.length > limit;
    
    if (!shouldTruncate) return <div className="whitespace-pre-wrap">{text}</div>;
    
    return (
        <div className="space-y-2">
            <div className={cn(
                "whitespace-pre-wrap transition-all duration-300",
                !isExpanded && "line-clamp-3 overflow-hidden"
            )}>
                {text}
            </div>
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-1 text-[10px] font-bold text-primary hover:text-primary/80 uppercase tracking-wider bg-primary/5 px-2 py-1 rounded-md border border-primary/20 transition-all hover:scale-105 active:scale-95"
            >
                {isExpanded ? (
                    <><ChevronUp className="w-3 h-3" /> {isEnglish ? "Collapse" : "收起內容 (Collapse)"}</>
                ) : (
                    <><ChevronDown className="w-3 h-3" /> {isEnglish ? "Expand" : "展開完整內容 (Expand)"}</>
                )}
            </button>
        </div>
    );
}

export function MemoryTable() {
    const toast = useToast();
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    const { activeGolem } = useGolem();
    const [memories, setMemories] = useState<MemoryItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [newMemory, setNewMemory] = useState("");
    const [isWiping, setIsWiping] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterType, setFilterType] = useState<string>("all");
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchMemories = useCallback(async () => {
        if (!activeGolem) return;
        setLoading(true);
        try {
            const data = await apiGet<MemoryItem[] | { avoidList?: string[] }>(
                `/api/memory?golemId=${encodeURIComponent(activeGolem)}`,
                undefined,
                { profile: "none" }
            );
            const list = Array.isArray(data)
                ? data
                : (Array.isArray(data?.avoidList)
                    ? data.avoidList.map((t: string) => ({ text: t, metadata: { type: 'avoid' } }))
                    : []);
            setMemories(list);
        } catch (e) {
            console.error("Failed to fetch memories", e);
        } finally {
            setLoading(false);
        }
    }, [activeGolem]);

    const addMemory = async () => {
        if (!newMemory.trim() || !activeGolem) return;
        try {
            await apiPost(`/api/memory?golemId=${encodeURIComponent(activeGolem)}`, {
                text: newMemory,
                metadata: { type: "manual", source: "dashboard" },
            });
            setNewMemory("");
            // Optimistically fetch
            fetchMemories();
        } catch (e) {
            console.error("Failed to add memory", e);
        }
    };

    const wipeMemory = async () => {
        if (!activeGolem) return;
        if (!confirm(
            isEnglish
                ? `Core warning: Are you sure you want to wipe all memories for ${activeGolem}? This action cannot be undone.`
                : `核心警告：您確定要清除 ${activeGolem} 的所有記憶嗎？此動作不可撤銷。`
        )) {
            return;
        }
        setIsWiping(true);
        try {
            await apiDeleteWrite(`/api/memory?golemId=${encodeURIComponent(activeGolem)}`);
            setMemories([]);
        } catch (e: unknown) {
            console.error("Failed to wipe memory", e);
            toast.error(isEnglish ? "Wipe failed" : "清除失敗", getErrorMessage(e, locale));
        } finally {
            setIsWiping(false);
        }
    };

    const exportMemory = () => {
        if (!activeGolem) return;
        window.location.href = `/api/memory/export?golemId=${encodeURIComponent(activeGolem)}`;
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !activeGolem) return;

        setIsImporting(true);
        try {
            const text = await file.text();
            let parsed;
            try {
                parsed = JSON.parse(text);
                if (!Array.isArray(parsed)) throw new Error("Must be an array");
            } catch {
                toast.error(
                    isEnglish ? "Import failed" : "匯入失敗",
                    isEnglish ? "Invalid JSON file format." : "無效的 JSON 檔案格式。"
                );
                setIsImporting(false);
                return;
            }

            const data = await apiPost<{ count?: number }>(
                `/api/memory/import?golemId=${encodeURIComponent(activeGolem)}`,
                parsed
            );
            toast.success(
                isEnglish ? "Import successful" : "匯入成功",
                isEnglish
                    ? `Imported ${data.count ?? parsed.length} memories successfully.`
                    : `成功匯入 ${data.count ?? parsed.length} 條記憶。`
            );
            fetchMemories();
        } catch (e: unknown) {
            console.error("Import failed:", e);
            toast.error(isEnglish ? "Import error" : "匯入錯誤", getErrorMessage(e, locale));
        } finally {
            setIsImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    useEffect(() => {
        fetchMemories();
        setSearchQuery("");
        setFilterType("all");
    }, [activeGolem, fetchMemories]);

    const uniqueTypes = useMemo(() => {
        const types = new Set<string>();
        memories.forEach((memory) => types.add(getMemoryType(memory.metadata)));
        return Array.from(types);
    }, [memories]);

    const filteredMemories = useMemo(() => {
        return memories.filter((memory) => {
            const matchesSearch = memory.text.toLowerCase().includes(searchQuery.toLowerCase());
            const type = getMemoryType(memory.metadata);
            const matchesType = filterType === "all" || type === filterType;
            return matchesSearch && matchesType;
        });
    }, [memories, searchQuery, filterType]);

    if (!activeGolem) {
        return (
            <div className="text-muted-foreground italic p-4 text-sm animate-pulse">
                {isEnglish ? "Waiting for target node..." : "正在等待目標節點指令..."}
            </div>
        );
    }

    return (
        <div className="space-y-6 flex flex-col h-full">

            {/* Top Toolbar */}
            <div className="flex flex-wrap gap-3 items-center">
                {/* Add Memory Input */}
                <div className="flex-1 min-w-[300px] flex bg-secondary/30 rounded-lg p-1 border border-border focus-within:border-primary/50 transition-colors shadow-inner h-10">
                    <input
                        type="text"
                        value={newMemory}
                        onChange={(e) => setNewMemory(e.target.value)}
                        placeholder={isEnglish ? "Type a new memory and inject into core..." : "在此輸入新的記憶內容並注入核心..."}
                        className="flex-1 bg-transparent border-none px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0"
                        onKeyDown={(e) => e.key === 'Enter' && addMemory()}
                    />
                    <Button
                        onClick={addMemory}
                        disabled={!newMemory.trim()}
                        className="bg-primary/10 text-primary hover:bg-primary/20 shadow-none h-full px-3 rounded-md transition-colors border border-primary/20"
                        size="sm"
                    >
                        <Plus className="w-4 h-4 mr-1" />
                        {isEnglish ? "Inject" : "注入核心"}
                    </Button>
                </div>

                {/* Operations Group */}
                <div className="flex items-center gap-2 flex-wrap">
                    {/* Search */}
                    <div className="relative w-48 sm:w-64">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={isEnglish ? "Filter records..." : "過濾紀錄..."}
                            className="w-full bg-secondary/30 border border-border rounded-lg pl-9 pr-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors h-10 shadow-inner"
                        />
                    </div>

                    {/* Filter */}
                    <div className="relative">
                        <select
                            value={filterType}
                            onChange={(e) => setFilterType(e.target.value)}
                            className="appearance-none bg-secondary/30 border border-border rounded-lg pl-9 pr-8 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors h-10 shadow-inner cursor-pointer"
                        >
                            <option value="all">{isEnglish ? "All types" : "所有類別"}</option>
                            {uniqueTypes.map(t => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                        <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>

                    {/* Refresh */}
                    <Button
                        variant="outline"
                        onClick={fetchMemories}
                        disabled={loading}
                        className="bg-card border-border text-muted-foreground hover:text-foreground hover:bg-accent h-10 w-10 p-0"
                    >
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-primary")} />
                    </Button>
                </div>
            </div>

            {/* Main Table */}
            <div className="flex-1 border border-border rounded-xl overflow-hidden bg-card/40 shadow-inner flex flex-col">
                <div className="overflow-y-auto flex-1 custom-scrollbar">
                    <table className="w-full text-sm text-left text-muted-foreground relative">
                        <thead className="text-xs text-muted-foreground uppercase bg-secondary/80 sticky top-0 backdrop-blur-md z-10 border-b border-border font-bold">
                            <tr>
                                <th scope="col" className="px-5 py-3 tracking-wider w-16 text-center">{isEnglish ? "No." : "序號"}</th>
                                <th scope="col" className="px-4 py-3 tracking-wider w-32 text-center">{isEnglish ? "Type" : "類型 (Type)"}</th>
                                <th scope="col" className="px-4 py-3 tracking-wider">{isEnglish ? "Neural Content" : "數據核心內容 (Neural Content)"}</th>
                                <th scope="col" className="px-4 py-3 tracking-wider w-16 text-center">{isEnglish ? "Action" : "動作"}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                            {filteredMemories.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-6 py-20 text-center text-muted-foreground/50">
                                        <Database className="w-10 h-10 mx-auto mb-3 opacity-20" />
                                        <p className="text-sm">{isEnglish ? "No memory records found" : "未發現任何記憶紀錄"}</p>
                                    </td>
                                </tr>
                            ) : (
                                // Show newest first
                                [...filteredMemories].reverse().map((mem, index) => {
                                    const displayIndex = filteredMemories.length - index;
                                    const memoryType = getMemoryType(mem.metadata);
                                    return (
                                        <tr key={index} className="hover:bg-accent/40 transition-colors group">
                                            <td className="px-5 py-4 text-xs text-muted-foreground/40 font-mono text-center">
                                                #{displayIndex}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={cn(
                                                    "px-2 py-0.5 rounded text-[10px] uppercase font-bold border",
                                                    (memoryType === "manual" || memoryType === "dashboard")
                                                        ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
                                                        : memoryType === "avoid"
                                                            ? "bg-red-500/10 text-red-400 border-red-500/20"
                                                            : "bg-blue-500/10 text-blue-400 border-blue-500/20 shadow-[0_0_10px_rgba(59,130,246,0.1)]"
                                                )}>
                                                    {memoryType}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 text-foreground/90 text-sm leading-relaxed min-w-[300px]">
                                                <ExpandableText text={mem.text} />
                                            </td>
                                            <td className="px-4 py-4 text-center">
                                                <button
                                                    className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all opacity-0 group-hover:opacity-100"
                                                    title={isEnglish ? "Copy to clipboard" : "複製到剪貼簿"}
                                                    onClick={() => navigator.clipboard.writeText(mem.text)}
                                                >
                                                    <Copy className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Footer Toolbar */}
            <div className="flex justify-between items-center pt-2 border-t border-border/50">
                <div className="text-xs text-muted-foreground font-mono flex items-center">
                    {isEnglish
                        ? `Total memories: ${filteredMemories.length}`
                        : `記憶總量：${filteredMemories.length}`}{" "}
                    {searchQuery && (isEnglish
                        ? `(filtered, original: ${memories.length})`
                        : `(已過濾，原始總量：${memories.length})`)}
                </div>

                <div className="flex space-x-2">
                    <input
                        type="file"
                        accept="application/json"
                        ref={fileInputRef}
                        className="hidden"
                        onChange={handleFileChange}
                    />
                    <Button
                        variant="ghost"
                        onClick={handleImportClick}
                        disabled={isImporting}
                        className="h-8 text-xs text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors"
                        size="sm"
                    >
                        <Upload className={cn("w-3.5 h-3.5 mr-1.5", isImporting && "animate-bounce")} />
                        {isImporting ? (isEnglish ? "Importing..." : "注入中...") : (isEnglish ? "Import Database" : "匯入資料庫 (Import)")}
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={exportMemory}
                        disabled={memories.length === 0}
                        className="h-8 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 transition-colors"
                        size="sm"
                    >
                        <Download className="w-3.5 h-3.5 mr-1.5" />
                        {isEnglish ? "Export Database" : "匯出資料庫 (Export)"}
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={wipeMemory}
                        disabled={isWiping || memories.length === 0}
                        className="h-8 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                        size="sm"
                    >
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                        {isWiping ? (isEnglish ? "Wiping..." : "正在清洗...") : (isEnglish ? "Wipe Database" : "清除整個資料庫 (Wipe)")}
                    </Button>
                </div>
            </div>
        </div>
    );
}
