"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Plus, RefreshCw, Trash2, Search, Filter, Database, Download, Upload } from "lucide-react";
import { useGolem } from "@/components/GolemContext";
import { cn } from "@/lib/utils";

interface MemoryItem {
    text: string;
    metadata?: any;
    score?: number;
}

export function MemoryTable() {
    const { activeGolem } = useGolem();
    const [memories, setMemories] = useState<MemoryItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [newMemory, setNewMemory] = useState("");
    const [isWiping, setIsWiping] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterType, setFilterType] = useState<string>("all");
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchMemories = async () => {
        if (!activeGolem) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/memory?golemId=${encodeURIComponent(activeGolem)}`);
            if (res.ok) {
                const data = await res.json();
                const list = Array.isArray(data) ? data : (data.avoidList ? data.avoidList.map((t: string) => ({ text: t, metadata: { type: 'avoid' } })) : []);
                setMemories(list);
            }
        } catch (e) {
            console.error("Failed to fetch memories", e);
        } finally {
            setLoading(false);
        }
    };

    const addMemory = async () => {
        if (!newMemory.trim() || !activeGolem) return;
        try {
            await fetch(`/api/memory?golemId=${encodeURIComponent(activeGolem)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: newMemory, metadata: { type: "manual", source: "dashboard" } }),
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
        if (!confirm(`CRITICAL WARNING: Are you sure you want to WIPE all memories for ${activeGolem}? This action cannot be undone.`)) {
            return;
        }
        setIsWiping(true);
        try {
            const res = await fetch(`/api/memory?golemId=${encodeURIComponent(activeGolem)}`, {
                method: "DELETE"
            });
            if (res.ok) {
                setMemories([]);
            } else {
                const data = await res.json();
                alert(`Wipe Failed: ${data.error}`);
            }
        } catch (e) {
            console.error("Failed to wipe memory", e);
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
            } catch (e) {
                alert("Invalid JSON file format.");
                setIsImporting(false);
                return;
            }

            const res = await fetch(`/api/memory/import?golemId=${encodeURIComponent(activeGolem)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(parsed)
            });
            const data = await res.json();
            if (res.ok) {
                alert(`Successfully imported ${data.count} memories.`);
                fetchMemories();
            } else {
                alert(`Import failed: ${data.error}`);
            }
        } catch (e: any) {
            console.error("Import failed:", e);
            alert(`Import error: ${e.message}`);
        } finally {
            setIsImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    useEffect(() => {
        fetchMemories();
        setSearchQuery("");
        setFilterType("all");
    }, [activeGolem]);

    const uniqueTypes = useMemo(() => {
        const types = new Set<string>();
        memories.forEach(m => types.add(m.metadata?.type || 'general'));
        return Array.from(types);
    }, [memories]);

    const filteredMemories = useMemo(() => {
        return memories.filter(m => {
            const matchesSearch = m.text.toLowerCase().includes(searchQuery.toLowerCase());
            const type = m.metadata?.type || 'general';
            const matchesType = filterType === 'all' || type === filterType;
            return matchesSearch && matchesType;
        });
    }, [memories, searchQuery, filterType]);

    if (!activeGolem) {
        return <div className="text-gray-500 italic p-4 text-sm animate-pulse">Awaiting active node target...</div>;
    }

    return (
        <div className="space-y-6 flex flex-col h-full">

            {/* Top Toolbar */}
            <div className="flex flex-col xl:flex-row space-y-3 xl:space-y-0 xl:space-x-3">
                {/* Add Memory Input */}
                <div className="flex-1 flex bg-gray-950/50 rounded-lg p-1 border border-gray-800 focus-within:border-cyan-500/50 transition-colors shadow-inner">
                    <input
                        type="text"
                        value={newMemory}
                        onChange={(e) => setNewMemory(e.target.value)}
                        placeholder="Inject new memory context..."
                        className="flex-1 bg-transparent border-none px-3 py-1.5 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-0"
                        onKeyDown={(e) => e.key === 'Enter' && addMemory()}
                    />
                    <Button
                        onClick={addMemory}
                        disabled={!newMemory.trim()}
                        className="bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 shadow-none h-8 px-3 rounded-md transition-colors border border-cyan-500/20"
                        size="sm"
                    >
                        <Plus className="w-4 h-4 mr-1" />
                        Inject
                    </Button>
                </div>

                {/* Search & Filter */}
                <div className="flex space-x-2">
                    <div className="relative flex-1 xl:w-48">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Filter records..."
                            className="w-full bg-gray-950/50 border border-gray-800 rounded-lg pl-9 pr-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-cyan-500/50 transition-colors h-10 shadow-inner"
                        />
                    </div>

                    <div className="relative">
                        <select
                            value={filterType}
                            onChange={(e) => setFilterType(e.target.value)}
                            className="appearance-none bg-gray-950/50 border border-gray-800 rounded-lg pl-9 pr-8 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-cyan-500/50 transition-colors h-10 shadow-inner cursor-pointer"
                        >
                            <option value="all">All Types</option>
                            {uniqueTypes.map(t => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                        <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                    </div>

                    <Button
                        variant="outline"
                        onClick={fetchMemories}
                        disabled={loading}
                        className="bg-gray-900 border-gray-800 text-gray-400 hover:text-white hover:bg-gray-800 h-10 w-10 p-0"
                    >
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-cyan-400")} />
                    </Button>
                </div>
            </div>

            {/* Main Table */}
            <div className="flex-1 border border-gray-800/80 rounded-xl overflow-hidden bg-black/40 shadow-inner flex flex-col">
                <div className="overflow-y-auto flex-1 custom-scrollbar">
                    <table className="w-full text-sm text-left text-gray-400 relative">
                        <thead className="text-xs text-gray-500 uppercase bg-gray-900/80 sticky top-0 backdrop-blur-md z-10 border-b border-gray-800">
                            <tr>
                                <th scope="col" className="px-5 py-3 font-medium tracking-wider w-8">#</th>
                                <th scope="col" className="px-4 py-3 font-medium tracking-wider w-32 text-center">Type</th>
                                <th scope="col" className="px-4 py-3 font-medium tracking-wider">Content</th>
                                <th scope="col" className="px-4 py-3 font-medium tracking-wider w-16 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800/50">
                            {filteredMemories.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-6 py-12 text-center text-gray-600">
                                        <Database className="w-8 h-8 mx-auto mb-3 opacity-20" />
                                        <p>No memory records found.</p>
                                    </td>
                                </tr>
                            ) : (
                                filteredMemories.map((mem, index) => (
                                    <tr key={index} className="hover:bg-cyan-950/10 transition-colors group">
                                        <td className="px-5 py-4 text-xs text-gray-600 font-mono">
                                            {index + 1}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={cn(
                                                "px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold border",
                                                (mem.metadata?.type === 'manual' || mem.metadata?.type === 'dashboard')
                                                    ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
                                                    : mem.metadata?.type === 'avoid'
                                                        ? "bg-red-500/10 text-red-400 border-red-500/20"
                                                        : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                            )}>
                                                {mem.metadata?.type || 'general'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-gray-300 break-words max-w-xl text-sm leading-relaxed">
                                            {mem.text}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <button
                                                className="text-gray-600 hover:text-cyan-400 transition-colors opacity-0 group-hover:opacity-100"
                                                title="Copy to clipboard"
                                                onClick={() => navigator.clipboard.writeText(mem.text)}
                                            >
                                                <Copy className="w-4 h-4 mx-auto" />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Footer Toolbar */}
            <div className="flex justify-between items-center pt-2 border-t border-gray-800/50">
                <div className="text-xs text-gray-500 font-mono flex items-center">
                    Total Records: {filteredMemories.length} {searchQuery && `(Filtered from ${memories.length})`}
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
                        {isImporting ? "Importing..." : "Import DB"}
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={exportMemory}
                        disabled={memories.length === 0}
                        className="h-8 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 transition-colors"
                        size="sm"
                    >
                        <Download className="w-3.5 h-3.5 mr-1.5" />
                        Export DB
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={wipeMemory}
                        disabled={isWiping || memories.length === 0}
                        className="h-8 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                        size="sm"
                    >
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                        {isWiping ? "Purging..." : "Wipe Database"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
