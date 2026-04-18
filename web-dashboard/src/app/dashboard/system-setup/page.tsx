"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
    HardDrive, Brain, AlertTriangle,
    Sparkles, ExternalLink, CheckCircle2, ArrowRight, Lock
} from "lucide-react";
import { useGolem } from "@/components/GolemContext";
import { apiGet, apiPostWrite } from "@/lib/api-client";

type MemoryMode = "lancedb-pro" | "native";
type BackendMode = "gemini" | "ollama";
type EmbeddingProvider = "local" | "ollama";
type SystemConfigResponse = {
    userDataDir?: string;
    golemMemoryMode?: string;
    hasCustomMemoryMode?: boolean;
    golemBackend?: string;
    golemEmbeddingProvider?: string;
    golemLocalEmbeddingModel?: string;
    golemOllamaBaseUrl?: string;
    golemOllamaBrainModel?: string;
    golemOllamaEmbeddingModel?: string;
    golemOllamaRerankModel?: string;
    golemOllamaTimeoutMs?: string | number;
    allowRemoteAccess?: boolean | string;
};
type SystemStatusResponse = {
    runtime?: {
        platform?: string;
        arch?: string;
    };
};

function getErrorMessage(error: unknown, fallback = "儲存失敗，請稍後再試"): string {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
}

function normalizeMemoryMode(value: unknown): MemoryMode {
    const mode = String(value || "").trim().toLowerCase();
    if (mode === "lancedb" || mode === "lancedb-pro" || mode === "lancedb-legacy") {
        return "lancedb-pro";
    }
    if (mode === "native" || mode === "system") {
        return "native";
    }
    return "lancedb-pro";
}

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
    const { isSystemConfigured } = useGolem();

    const [userDataDir, setUserDataDir] = useState("./golem_memory");
    const [memoryMode, setMemoryMode] = useState<MemoryMode>("lancedb-pro");
    const golemMode = "SINGLE";
    const [backend, setBackend] = useState<BackendMode>("gemini");
    const [embeddingProvider, setEmbeddingProvider] = useState<EmbeddingProvider>("local");
    const [localEmbeddingModel, setLocalEmbeddingModel] = useState("Xenova/bge-small-zh-v1.5");
    const [ollamaBaseUrl, setOllamaBaseUrl] = useState("http://127.0.0.1:11434");
    const [ollamaBrainModel, setOllamaBrainModel] = useState("llama3.1:8b");
    const [ollamaEmbeddingModel, setOllamaEmbeddingModel] = useState("nomic-embed-text");
    const [ollamaRerankModel, setOllamaRerankModel] = useState("");
    const [ollamaTimeoutMs, setOllamaTimeoutMs] = useState("60000");
    const [allowRemoteAccess, setAllowRemoteAccess] = useState(false);
    const [remoteAccessPassword, setRemoteAccessPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isFetching, setIsFetching] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isIntelMacRuntime, setIsIntelMacRuntime] = useState(false);

    const activeModelInfo = LOCAL_MODELS.find(m => m.id === localEmbeddingModel);

    // 載入現有設定
    useEffect(() => {
        const loadConfig = async () => {
            try {
                const [data, status] = await Promise.all([
                    apiGet<SystemConfigResponse>("/api/system/config"),
                    apiGet<SystemStatusResponse>("/api/system/status").catch(() => null)
                ]);

                const runtimePlatform = String(status?.runtime?.platform || "").toLowerCase();
                const runtimeArch = String(status?.runtime?.arch || "").toLowerCase();
                const intelMac = runtimePlatform === "darwin" && runtimeArch === "x64";
                setIsIntelMacRuntime(intelMac);

                setUserDataDir(data.userDataDir || "./golem_memory");
                const normalizedMode = normalizeMemoryMode(data.golemMemoryMode);
                const shouldAutoPreferNative = intelMac
                    && normalizedMode === "lancedb-pro"
                    && data.hasCustomMemoryMode !== true;
                setMemoryMode(shouldAutoPreferNative ? "native" : normalizedMode);

                setBackend(data.golemBackend === "ollama" ? "ollama" : "gemini");
                if (data.golemEmbeddingProvider === "ollama") setEmbeddingProvider("ollama");
                else setEmbeddingProvider("local");
                setLocalEmbeddingModel(data.golemLocalEmbeddingModel || "Xenova/bge-small-zh-v1.5");
                setOllamaBaseUrl(data.golemOllamaBaseUrl || "http://127.0.0.1:11434");
                setOllamaBrainModel(data.golemOllamaBrainModel || "llama3.1:8b");
                setOllamaEmbeddingModel(data.golemOllamaEmbeddingModel || "nomic-embed-text");
                setOllamaRerankModel(data.golemOllamaRerankModel || "");
                setOllamaTimeoutMs(String(data.golemOllamaTimeoutMs || "60000"));
                setAllowRemoteAccess(data.allowRemoteAccess === true || data.allowRemoteAccess === "true");
            } catch (fetchError) {
                console.error(fetchError);
            } finally {
                setIsFetching(false);
            }
        };

        loadConfig();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (isIntelMacRuntime && memoryMode === "lancedb-pro") {
            const confirmed = window.confirm(
                "偵測到 Intel Mac (darwin-x64)。\nLanceDB Pro 在此架構目前不支援，系統啟動時會自動降級為 Native。\n\n是否仍要儲存為 lancedb-pro？"
            );
            if (!confirmed) {
                return;
            }
        }

        setIsLoading(true);
        try {
            const data = await apiPostWrite<{ success?: boolean; error?: string }>("/api/system/config", {
                userDataDir: userDataDir.trim(),
                golemBackend: backend,
                golemMemoryMode: memoryMode,
                golemEmbeddingProvider: embeddingProvider,
                golemLocalEmbeddingModel: localEmbeddingModel,
                golemOllamaBaseUrl: ollamaBaseUrl.trim(),
                golemOllamaBrainModel: ollamaBrainModel.trim(),
                golemOllamaEmbeddingModel: ollamaEmbeddingModel.trim(),
                golemOllamaRerankModel: ollamaRerankModel.trim(),
                golemOllamaTimeoutMs: ollamaTimeoutMs.trim(),
                golemMode: golemMode,
                allowRemoteAccess: allowRemoteAccess,
                remoteAccessPassword: remoteAccessPassword
            });

            if (!data.success) {
                throw new Error(data.error || "儲存失敗，請稍後再試");
            }
            window.location.href = "/dashboard/agents/create";
        } catch (error: unknown) {
            setError(getErrorMessage(error));
        } finally {
            setIsLoading(false);
        }
    };

    if (isFetching) {
        return (
            <div className="flex-1 flex items-center justify-center bg-background">
                <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto bg-background p-6 flex flex-col text-foreground">
            <div className="max-w-2xl w-full mx-auto pt-8 pb-16">

                {/* Header */}
                <div className="flex flex-col items-center text-center mb-12 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="inline-flex items-center justify-center p-4 bg-primary/10 border border-primary/20 rounded-2xl mb-5 shadow-[0_0_40px_-8px] shadow-primary/20">
                        <Sparkles className="w-8 h-8 text-primary" />
                    </div>
                    <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-foreground via-foreground/80 to-primary mb-3 tracking-tight">
                        系統初始化設定
                    </h1>
                    <p className="text-lg text-muted-foreground max-w-lg leading-relaxed">
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
                    <div className="bg-card/80 backdrop-blur-sm border border-border rounded-2xl p-6 shadow-xl relative overflow-hidden">
                        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-blue-600 to-primary rounded-t-2xl" />

                        <div className="flex items-center gap-2 mb-5">
                            <Brain className="w-5 h-5 text-primary" />
                            <h2 className="text-base font-semibold text-foreground">記憶引擎設定</h2>
                        </div>

                        {/* Backend */}
                        <div className="mb-5">
                            <label className="block text-sm font-medium text-muted-foreground mb-2">大腦後端 (Brain Backend)</label>
                            <select
                                value={backend}
                                onChange={e => setBackend(e.target.value as BackendMode)}
                                className="w-full bg-secondary/40 border border-border rounded-xl px-4 py-3 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                            >
                                <option value="gemini">Web Gemini (Playwright Browser)</option>
                                <option value="ollama">Ollama API (Local / Self-hosted)</option>
                            </select>
                            <p className="text-xs text-muted-foreground/60 mt-1.5">
                                Ollama 模式不需瀏覽器登入，適合私有化部署；Gemini 模式保留 Browser-in-the-Loop。
                            </p>
                        </div>

                        {backend === "ollama" && (
                            <div className="mb-5 bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-3">
                                <div>
                                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">Ollama Base URL</label>
                                    <input
                                        type="text"
                                        value={ollamaBaseUrl}
                                        onChange={e => setOllamaBaseUrl(e.target.value)}
                                        className="w-full bg-secondary/40 border border-border rounded-lg px-3 py-2 text-foreground font-mono text-xs focus:outline-none focus:border-primary transition-all"
                                        placeholder="http://127.0.0.1:11434"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">Ollama Brain Model</label>
                                    <input
                                        type="text"
                                        value={ollamaBrainModel}
                                        onChange={e => setOllamaBrainModel(e.target.value)}
                                        className="w-full bg-secondary/40 border border-border rounded-lg px-3 py-2 text-foreground font-mono text-xs focus:outline-none focus:border-primary transition-all"
                                        placeholder="llama3.1:8b"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">Ollama Timeout (ms)</label>
                                    <input
                                        type="number"
                                        min={1000}
                                        value={ollamaTimeoutMs}
                                        onChange={e => setOllamaTimeoutMs(e.target.value)}
                                        className="w-full bg-secondary/40 border border-border rounded-lg px-3 py-2 text-foreground font-mono text-xs focus:outline-none focus:border-primary transition-all"
                                        placeholder="60000"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Memory Mode */}
                        <div className="mb-5">
                            <label className="block text-sm font-medium text-muted-foreground mb-3">記憶引擎模式</label>
                            <div className="grid grid-cols-1 gap-3">
                                {([
                                    { value: "lancedb-pro", label: "LanceDB Pro Vector Engine", desc: "高效能語義向量檢索，召回品質最佳。" },
                                    { value: "native", label: "System Native Memory Engine", desc: "關鍵字檢索，跨平台最穩定（含 Intel Mac）。" }
                                ] as { value: MemoryMode; label: string; desc: string }[]).map(opt => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => setMemoryMode(opt.value)}
                                        className={`p-3 rounded-xl border text-sm font-medium transition-all text-left ${
                                            memoryMode === opt.value
                                                ? "bg-primary/10 border-primary/40 text-primary"
                                                : "bg-secondary/30 border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                                        }`}
                                    >
                                        <div className="flex items-center justify-between mb-0.5">
                                            <span className="font-bold text-xs">{opt.label}</span>
                                            {memoryMode === opt.value && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
                                        </div>
                                        <div className="text-[10px] font-normal opacity-70">{opt.desc}</div>
                                    </button>
                                ))}
                            </div>
                            {isIntelMacRuntime && (
                                <div className="mt-3 p-3 bg-amber-950/20 border border-amber-900/30 rounded-lg flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                                    <p className="text-[11px] text-amber-200/80 leading-relaxed">
                                        偵測到目前主機為 Intel Mac (darwin-x64)。建議選擇 <code className="font-mono">native</code>；
                                        若選擇 <code className="font-mono">lancedb-pro</code>，系統啟動時會自動降級為 <code className="font-mono">native</code>。
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* User Data Dir */}
                        <div className="mb-5">
                            <label className="block text-sm font-medium text-muted-foreground mb-2">
                                <HardDrive className="w-3.5 h-3.5 inline mr-1.5 text-muted-foreground/70" />
                                記憶資料儲存路徑
                            </label>
                            <input
                                type="text"
                                value={userDataDir}
                                onChange={e => setUserDataDir(e.target.value)}
                                className="w-full bg-secondary/40 border border-border rounded-xl px-4 py-3 text-foreground font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                                placeholder="./golem_memory"
                            />
                            <p className="text-xs text-muted-foreground/60 mt-1.5">
                                存放 Playwright Session（若使用 Gemini）與長期記憶資料庫。
                            </p>
                        </div>

                        {/* Embedding Config (Only for LanceDB) */}
                        {memoryMode === "lancedb-pro" && (
                            <div className="bg-secondary/20 border border-border rounded-xl p-5 shadow-inner animate-in zoom-in-95 duration-300">
                                <div className="flex items-center gap-2 mb-4">
                                    <Sparkles className="w-4 h-4 text-purple-400" />
                                    <h3 className="text-sm font-semibold text-foreground">向量模型設定 (Embedding)</h3>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-medium text-muted-foreground mb-2">提供者</label>
                                        <select
                                            value={embeddingProvider}
                                            onChange={e => setEmbeddingProvider(e.target.value as EmbeddingProvider)}
                                            className="w-full bg-secondary/30 border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:border-primary transition-all"
                                        >
                                            <option value="local">Local (Transformers.js)</option>
                                            <option value="ollama">Ollama Embedding</option>
                                        </select>
                                    </div>

                                    {embeddingProvider === "local" && (
                                        <>
                                            <div>
                                                <label className="block text-xs font-medium text-muted-foreground mb-2">模型選擇</label>
                                                <select
                                                    value={localEmbeddingModel}
                                                    onChange={e => setLocalEmbeddingModel(e.target.value)}
                                                    className="w-full bg-secondary/30 border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary transition-all"
                                                >
                                                    {LOCAL_MODELS.map(model => (
                                                        <option key={model.id} value={model.id}>{model.name}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            {activeModelInfo && (
                                                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2">
                                                    <div className="text-[11px] text-foreground/80 leading-relaxed">
                                                        <span className="font-bold text-primary">特色：</span> {activeModelInfo.features}
                                                    </div>
                                                    <div className="text-[11px] text-foreground/80 leading-relaxed">
                                                        <span className="font-bold text-primary">推薦：</span> {activeModelInfo.recommendation}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground italic pt-1 border-t border-border/50">
                                                        💡 {activeModelInfo.notes}
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}

                                    {embeddingProvider === "ollama" && (
                                        <div className="space-y-3 bg-primary/5 border border-primary/20 rounded-lg p-3">
                                            <div>
                                                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Embedding Model</label>
                                                <input
                                                    type="text"
                                                    value={ollamaEmbeddingModel}
                                                    onChange={e => setOllamaEmbeddingModel(e.target.value)}
                                                    className="w-full bg-secondary/40 border border-border rounded-lg px-3 py-2 text-foreground font-mono text-xs focus:outline-none focus:border-primary transition-all"
                                                    placeholder="nomic-embed-text"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Rerank Model (選填)</label>
                                                <input
                                                    type="text"
                                                    value={ollamaRerankModel}
                                                    onChange={e => setOllamaRerankModel(e.target.value)}
                                                    className="w-full bg-secondary/40 border border-border rounded-lg px-3 py-2 text-foreground font-mono text-xs focus:outline-none focus:border-primary transition-all"
                                                    placeholder="bge-reranker-v2-m3 (optional)"
                                                />
                                            </div>
                                            <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                                                若填寫 rerank 模型，查詢結果會在向量召回後再重排；若空白則維持原始 hybrid ranking。
                                            </p>
                                        </div>
                                    )}

                                </div>
                            </div>
                        )}
                    </div>

                    {/* Network Config */}
                    <div className="bg-card/80 backdrop-blur-sm border border-border rounded-2xl p-6 shadow-xl relative overflow-hidden">
                        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-500 to-teal-400 rounded-t-2xl" />

                        <div className="flex items-center gap-2 mb-5">
                            <ExternalLink className="w-5 h-5 text-emerald-500" />
                            <h2 className="text-base font-semibold text-foreground">網路連線設定</h2>
                        </div>

                        <div className="flex items-center justify-between p-4 bg-secondary/30 border border-border rounded-xl">
                            <div className="space-y-1">
                                <div className="text-sm font-medium text-foreground">允許遠端存取 (Remote Access)</div>
                                <div className="text-xs text-muted-foreground leading-relaxed">
                                    開啟後可允許區域網路或其他 IP 連線。若關閉則僅限 localhost。
                                </div>
                            </div>
                            <div 
                                onClick={() => setAllowRemoteAccess(!allowRemoteAccess)}
                                className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-colors duration-200 ease-in-out ${allowRemoteAccess ? 'bg-emerald-600' : 'bg-muted'}`}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transform transition-transform duration-200 ease-in-out ${allowRemoteAccess ? 'translate-x-6' : 'translate-x-0'}`} />
                            </div>
                        </div>

                        {allowRemoteAccess && (
                            <>
                                <div className="mt-5 animate-in fade-in zoom-in-95">
                                    <label className="block text-sm font-medium text-muted-foreground mb-2">
                                        <Lock className="w-3.5 h-3.5 inline mr-1.5 text-muted-foreground/70" />
                                        自定義遠端存取密碼 (選填)
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="password"
                                            value={remoteAccessPassword}
                                            onChange={e => setRemoteAccessPassword(e.target.value)}
                                            className="w-full bg-secondary/40 border border-border rounded-xl px-4 py-3 text-foreground font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all pr-10"
                                            placeholder="若留空，則遠端存取不需要密碼"
                                            autoComplete="new-password"
                                        />
                                    </div>
                                    <p className="text-[10px] text-muted-foreground/60 mt-1.5 leading-relaxed">
                                        設定密碼後，非本機連線皆須輸入此密碼才可登入控制台。
                                    </p>
                                </div>
                                <div className="mt-4 p-3 bg-amber-950/20 border border-amber-900/30 rounded-lg flex items-start gap-2 animate-in fade-in zoom-in-95">
                                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                                    <p className="text-[10px] text-amber-200/70 leading-relaxed">
                                        ⚠️ 警告：開啟遠端存取會降低安全性。請確保您在受信任的網路環境中，或已設置適當的密碼保護。
                                    </p>
                                </div>
                            </>
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

                    <p className="text-center text-xs text-muted-foreground/60">
                        設定完成後可隨時從側欄「新增 Golem」加入 Telegram Bot。
                        設定值儲存至 <code className="text-muted-foreground font-mono">.env</code>。
                    </p>
                </form>
            </div>
        </div>
    );
}
