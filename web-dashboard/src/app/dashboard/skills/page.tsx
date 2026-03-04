"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { BookOpen, AlertCircle, CheckCircle2, RefreshCcw, ChevronRight, Power } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Skill {
    id: string;
    title: string;
    isOptional: boolean;
    isEnabled: boolean;
    content: string;
}

export default function SkillsPage() {
    const [skills, setSkills] = useState<Skill[]>([]);
    const [loading, setLoading] = useState(true);
    const [isReloading, setIsReloading] = useState(false);
    const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

    const loadSkills = () => {
        setLoading(true);
        fetch("/api/skills")
            .then(res => res.json())
            .then(data => {
                setSkills(data);
                if (data.length > 0) {
                    setSelectedSkill(data.find((s: Skill) => s.isEnabled) || data[0]);
                }
                setLoading(false);
                setIsReloading(false);
            })
            .catch(err => {
                console.error("Failed to fetch skills:", err);
                setLoading(false);
                setIsReloading(false);
            });
    };

    const handleHotReload = async () => {
        setIsReloading(true);
        try {
            await fetch("/api/skills/reload", { method: "POST" });
            loadSkills();
        } catch (e) {
            console.error("Hot reload failed:", e);
            setIsReloading(false);
        }
    };

    const handleToggleSkill = async (skill: Skill) => {
        if (!skill.isOptional) return;

        // Optimistic UI update
        const newEnabledState = !skill.isEnabled;
        setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, isEnabled: newEnabledState } : s));
        if (selectedSkill?.id === skill.id) {
            setSelectedSkill({ ...selectedSkill, isEnabled: newEnabledState });
        }

        try {
            await fetch("/api/skills/toggle", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: skill.id, enabled: newEnabledState })
            });
        } catch (e) {
            console.error("Toggle failed", e);
            // Revert on failure
            loadSkills();
        }
    };

    useEffect(() => {
        loadSkills();
    }, []);

    return (
        <div className="p-6 h-full flex flex-col space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                    <BookOpen className="w-6 h-6 text-cyan-400" />
                    技能說明書 (Skills)
                    <button
                        onClick={handleHotReload} disabled={isReloading}
                        className="ml-2 p-1.5 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1 group"
                        title="熱加載技能庫 (Hot Reload)"
                    >
                        <RefreshCcw className={`w-4 h-4 ${isReloading ? 'animate-spin' : 'group-hover:animate-spin-once'}`} />
                        <span className="text-xs font-normal">Hot Reload</span>
                    </button>
                </h1>
                <div className="flex space-x-2">
                    <span className="px-3 py-1 bg-gray-900/50 text-gray-400 text-xs rounded-full border border-gray-800">
                        Total Modules: {skills.length}
                    </span>
                    <span className="px-3 py-1 bg-green-900/30 text-green-400 text-xs rounded-full border border-green-800">
                        Active: {skills.filter(s => s.isEnabled).length}
                    </span>
                </div>
            </div>

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0">
                {/* Left Panel: Skill List */}
                <div className="lg:col-span-1 flex flex-col min-h-0 space-y-2 overflow-y-auto pr-2 custom-scrollbar">
                    {loading ? (
                        <div className="text-center text-gray-500 py-10 animate-pulse">Scanning Neural Modules...</div>
                    ) : (
                        skills.map(skill => (
                            <button
                                key={skill.id}
                                onClick={() => setSelectedSkill(skill)}
                                className={`text-left w-full transition-all duration-200 ${selectedSkill?.id === skill.id
                                    ? "ring-1 ring-cyan-500/50 bg-cyan-950/20"
                                    : "hover:bg-gray-900/40 opacity-80 hover:opacity-100"
                                    }`}
                            >
                                <Card className={`bg-gray-950 border-gray-800 rounded-xl overflow-hidden shadow-lg ${!skill.isEnabled ? 'grayscale opacity-70' : ''}`}>
                                    <div className="p-4 flex items-center justify-between gap-3 relative">
                                        {selectedSkill?.id === skill.id && (
                                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-cyan-500 rounded-r-full shadow-[0_0_10px_rgba(6,182,212,0.8)]" />
                                        )}
                                        <div className="flex items-center gap-3">
                                            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${skill.isEnabled ? 'bg-green-500/10' : 'bg-gray-800/30'}`}>
                                                {skill.isEnabled ? (
                                                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                                                ) : (
                                                    <AlertCircle className="w-4 h-4 text-gray-500" />
                                                )}
                                            </div>
                                            <div>
                                                <h3 className={`font-semibold text-sm ${selectedSkill?.id === skill.id ? 'text-cyan-50' : 'text-gray-300'}`}>
                                                    {skill.title}
                                                </h3>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-[10px] text-gray-500 font-mono">
                                                        {skill.id}.md
                                                    </span>
                                                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${skill.isOptional ? 'bg-blue-900/30 text-blue-400' : 'bg-purple-900/30 text-purple-400'}`}>
                                                        {skill.isOptional ? 'Optional' : 'Core System'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <ChevronRight className={`w-4 h-4 transition-transform ${selectedSkill?.id === skill.id ? 'text-cyan-500 translate-x-1' : 'text-gray-700'}`} />
                                    </div>
                                </Card>
                            </button>
                        ))
                    )}
                </div>

                {/* Right Panel: Markdown Content Rendered as Terminal */}
                <div className="lg:col-span-2 flex flex-col min-h-0">
                    <Card className="flex-1 flex flex-col bg-black border-gray-800 overflow-hidden relative group">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <CardHeader className="py-3 px-4 border-b border-gray-900 bg-gray-950 font-mono flex flex-row items-center justify-between">
                            <span className="text-gray-400 text-xs">
                                root@golem:~# cat /src/skills/lib/{selectedSkill?.id || '*'}.md
                            </span>
                            <div className="flex items-center gap-3">
                                {selectedSkill && (
                                    <span className={`px-2 py-0.5 rounded text-[10px] ${selectedSkill.isEnabled ? 'bg-green-950 text-green-400' : 'bg-gray-800 text-gray-400'}`}>
                                        {selectedSkill.isEnabled ? 'ACTIVE' : 'INACTIVE'}
                                    </span>
                                )}
                                {selectedSkill?.isOptional && (
                                    <button
                                        onClick={() => handleToggleSkill(selectedSkill)}
                                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${selectedSkill.isEnabled ? 'bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.6)]' : 'bg-gray-700'}`}
                                    >
                                        <span className="sr-only">Toggle skill</span>
                                        <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${selectedSkill.isEnabled ? 'translate-x-2' : '-translate-x-2'}`} />
                                    </button>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent className="flex-1 p-0 overflow-y-auto custom-scrollbar relative">
                            {selectedSkill ? (
                                <div className="absolute inset-0 p-8">
                                    <article className="prose prose-invert prose-cyan max-w-none 
                                        prose-headings:font-bold prose-headings:tracking-tight
                                        prose-h1:text-3xl prose-h1:mb-6 prose-h1:pb-4 prose-h1:border-b prose-h1:border-gray-800
                                        prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-4
                                        prose-p:text-gray-300 prose-p:leading-relaxed
                                        prose-a:text-cyan-400 prose-a:no-underline hover:prose-a:underline
                                        prose-code:text-cyan-300 prose-code:bg-cyan-950/30 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
                                        prose-pre:bg-gray-950 prose-pre:border prose-pre:border-gray-800 prose-pre:shadow-lg
                                        prose-strong:text-cyan-100 prose-strong:font-semibold
                                        prose-ul:text-gray-300 prose-li:marker:text-cyan-500">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {selectedSkill.content}
                                        </ReactMarkdown>
                                    </article>
                                </div>
                            ) : (
                                <div className="h-full flex items-center justify-center text-gray-600 font-mono text-xs">
                                    No skill module selected.
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
