"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
    Key, HardDrive, Brain, Eye, EyeOff, AlertTriangle,
    Sparkles, ExternalLink, CheckCircle2, ArrowRight
} from "lucide-react";
import Link from "next/link";
import { useGolem } from "@/components/GolemContext";

type MemoryMode = "lancedb";

const LOCAL_MODELS = [
    {
        id: "Xenova/bge-small-zh-v1.5",
        name: "BGE-Small (繁簡中文最佳，推薦)",
        features: "🏆 中文王者：開序社群中文檢索榜首，語義捕捉極佳。",
        notes: "體積約 90MB，推論極快，適合大部分中文場景。",
        recommendation: "Golem 記憶體高達 80% 以上是中文時首選。"
    },
    {
        id: "Xenova/bge-base-zh-v1.5",
        name: "BGE-Base (高精確度版)",
        features: "精準細膩：比 Small 版本有更深層的語義理解能力。",
        notes: "體積較大，對硬體資源要求略高，載入較慢。",
        recommendation: "需要極高語義精確度且記憶體資源充裕時使用。"
    },
    {
        id: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
        name: "MiniLM-L12 (多語系守門員)",
        features: "🥈 跨語言專家：支援 50+ 語言，對中英夾雜句子理解極佳。",
        notes: "支援「蘋果」與「Apple」的跨語言語義對齊。",
        recommendation: "對話中頻繁夾雜程式碼、英文術語時推薦。"
    },
    {
        id: "Xenova/nomic-embed-text-v1.5",
        name: "Nomic Embed (長文本專家)",
        features: "🥉 超大視窗：支援高達 8192 Token 長度，不截斷訊息。",
        notes: "能將整篇長文壓縮成向量而不遺失細節。",
        recommendation: "記憶單位多為長篇大論或完整網頁草稿時推薦。"
    },
    {
        id: "Xenova/all-MiniLM-L6-v2",
        name: "MiniLM-L6 (輕量多語)",
        features: "極致輕快：最經典的嵌入模型，效能與速度平衡。",
        notes: "支援多國語言，是大多數向量應用的基準模型。",
        recommendation: "一般性用途且希望資源消耗最小化時使用。"
    }
];

export default function SystemSetupPage() {
    const router = useRouter();
    const { isSystemConfigured } = useGolem();

    const [userDataDir, setUserDataDir] = useState("./golem_memory");
    const [memoryMode, setMemoryMode] = useState<MemoryMode>("lancedb");
    const golemMode = "SINGLE";
    const [embeddingProvider, setEmbeddingProvider] = useState<"gemini" | "local">("local");
    const [localEmbeddingModel, setLocalEmbeddingModel] = useState("Xenova/bge-small-zh-v1.5");
    const [isLoading, setIsLoading] = useState(false);
    const [isFetching, setIsFetching] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const activeModelInfo = LOCAL_MODELS.find(m => m.id === localEmbeddingModel);

    // 載入現有設定
    useEffect(() => {
        fetch("/api/system/config")
            .then(r => r.json())
            .then(data => {
                setUserDataDir(data.userDataDir || "./golem_memory");
                setMemoryMode("lancedb");
                setEmbeddingProvider("local");
                setLocalEmbeddingModel(data.golemLocalEmbeddingModel || "Xenova/bge-small-zh-v1.5");
            })
            .catch(console.error)
            .finally(() => setIsFetching(false));
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        setIsLoading(true);
        try {
            const res = await fetch("/api/system/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userDataDir: userDataDir.trim(),
                    golemMemoryMode: memoryMode,
                    golemEmbeddingProvider: "local",
                    golemLocalEmbeddingModel: localEmbeddingModel,
                    golemMode: golemMode
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "儲存失敗，請稍後再試");
            }
            window.location.href = "/dashboard/agents/create";
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    if (isFetching) {
        return (
            <div className="flex-1 flex items-center justify-center bg-gray-950">
                <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto bg-gray-950 p-6 flex flex-col text-white">
            <div className="max-w-2xl w-full mx-auto pt-8 pb-16">

                {/* Header */}
                <div className="flex flex-col items-center text-center mb-12 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="inline-flex items-center justify-center p-4 bg-emerald-950/50 border border-emerald-800/40 rounded-2xl mb-5 shadow-[0_0_40px_-8px_theme(colors.emerald.900)]">
                        <Sparkles className="w-8 h-8 text-emerald-400" />
                    </div>
                    <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-white via-emerald-100 to-emerald-400 mb-3 tracking-tight">
                        系統初始化設定
                    </h1>
                    <p className="text-lg text-gray-400 max-w-lg leading-relaxed">
                        在開始使用 Golem 之前，請完成核心參數設定。<br />
                        Golem Bot 可以在設定完成後隨時從 Dashboard 新增。
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150">

                    {error && (
                        <div className="flex items-start gap-3 p-4 bg-red-950/30 border border-red-900/40 rounded-xl text-red-400">
                            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                            <p className="text-sm">{error}</p>
                        </div>
                    )}


                    {/* Memory Config */}
                    <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 to-indigo-400 rounded-t-2xl" />

                        <div className="flex items-center gap-2 mb-5">
                            <Brain className="w-5 h-5 text-blue-400" />
                            <h2 className="text-base font-semibold text-white">記憶引擎設定</h2>
                        </div>

                        {/* Memory Mode */}
                        <div className="mb-5">
                            <label className="block text-sm font-medium text-gray-400 mb-3">記憶引擎模式</label>
                            <div className="grid grid-cols-1 gap-3">
                                {([
                                    { value: "lancedb", label: "LanceDB Vector Engine", desc: "高效能向量資料庫，支援 Hybrid Search (效能最強)" },
                                ] as { value: MemoryMode; label: string; desc: string }[]).map(opt => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        className="p-3 rounded-xl border text-sm font-medium transition-all text-left bg-blue-950/30 border-blue-600/50 text-blue-300 cursor-default"
                                    >
                                        <div className="flex items-center justify-between mb-0.5">
                                            <span className="font-bold text-xs">{opt.label}</span>
                                            <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                                        </div>
                                        <div className="text-[10px] font-normal opacity-70">{opt.desc}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* User Data Dir */}
                        <div className="mb-5">
                            <label className="block text-sm font-medium text-gray-400 mb-2">
                                <HardDrive className="w-3.5 h-3.5 inline mr-1.5 text-gray-500" />
                                記憶資料儲存路徑
                            </label>
                            <input
                                type="text"
                                value={userDataDir}
                                onChange={e => setUserDataDir(e.target.value)}
                                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                                placeholder="./golem_memory"
                            />
                            <p className="text-xs text-gray-600 mt-1.5">
                                存放 Puppeteer Login Session 與長期記憶。
                            </p>
                        </div>

                        {/* Embedding Config (Only for LanceDB) */}
                        {memoryMode === "lancedb" && (
                            <div className="bg-gray-950 border border-gray-800 rounded-xl p-5 shadow-inner animate-in zoom-in-95 duration-300">
                                <div className="flex items-center gap-2 mb-4">
                                    <Sparkles className="w-4 h-4 text-purple-400" />
                                    <h3 className="text-sm font-semibold text-white">本地向量模型設定 (Local Embedding)</h3>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-2">模型選擇</label>
                                        <select
                                            value={localEmbeddingModel}
                                            onChange={e => setLocalEmbeddingModel(e.target.value)}
                                            className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-purple-500 transition-all"
                                        >
                                            {LOCAL_MODELS.map(model => (
                                                <option key={model.id} value={model.id}>{model.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {activeModelInfo && (
                                        <div className="bg-purple-950/20 border border-purple-900/30 rounded-lg p-3 space-y-2">
                                            <div className="text-[11px] text-gray-300 leading-relaxed">
                                                <span className="font-bold text-purple-400">特色：</span> {activeModelInfo.features}
                                            </div>
                                            <div className="text-[11px] text-gray-300 leading-relaxed">
                                                <span className="font-bold text-purple-400">推薦：</span> {activeModelInfo.recommendation}
                                            </div>
                                            <div className="text-[10px] text-gray-500 italic pt-1 border-t border-purple-900/20">
                                                💡 {activeModelInfo.notes}
                                            </div>
                                        </div>
                                    )}

                                    <p className="text-[10px] text-gray-600 leading-relaxed">
                                        模型將在第一次啟動時自動下載至本地端。具備極佳隱私性與回應速度。
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Submit */}
                    <Button
                        type="submit"
                        disabled={isLoading}
                        className="w-full h-14 text-base font-bold bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 border-none shadow-xl shadow-emerald-900/20 transition-all hover:scale-[1.02] active:scale-95 rounded-2xl group"
                    >
                        {isLoading ? (
                            <span className="flex items-center gap-2">
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                正在儲存設定...
                            </span>
                        ) : (
                            <span className="flex items-center gap-2">
                                {isSystemConfigured ? "更新系統設定" : "完成設定，進入控制台"}
                                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </span>
                        )}
                    </Button>

                    <p className="text-center text-xs text-gray-600">
                        設定完成後可隨時從側欄「新增 Golem」加入 Telegram Bot。
                        設定值儲存至 <code className="text-gray-500 font-mono">.env</code>。
                    </p>
                </form>
            </div>
        </div>
    );
}
