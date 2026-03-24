"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    Brain,
    CheckCircle2,
    Cpu,
    Database,
    ExternalLink,
    Gauge,
    Globe,
    HardDrive,
    Lock,
    ShieldCheck,
    Sparkles
} from "lucide-react";
import { useGolem } from "@/components/GolemContext";
import { apiGet, apiPostWrite } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast-provider";

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
type SystemSetupDraft = {
    userDataDir: string;
    memoryMode: MemoryMode;
    backend: BackendMode;
    embeddingProvider: EmbeddingProvider;
    localEmbeddingModel: string;
    ollamaBaseUrl: string;
    ollamaBrainModel: string;
    ollamaEmbeddingModel: string;
    ollamaRerankModel: string;
    ollamaTimeoutMs: string;
    allowRemoteAccess: boolean;
    remoteAccessPassword: string;
    updatedAt: number;
};
type SystemHealthStatus = "pass" | "warn" | "fail";
type SystemHealthItem = {
    id: string;
    label: string;
    status: SystemHealthStatus;
    hint: string;
    fixLabel?: string;
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

const MEMORY_MODE_OPTIONS: { value: MemoryMode; label: string; desc: string }[] = [
    {
        value: "lancedb-pro",
        label: "LanceDB Pro Vector Engine",
        desc: "高效能語義向量檢索，召回品質最佳。"
    },
    {
        value: "native",
        label: "System Native Memory Engine",
        desc: "關鍵字檢索，跨平台最穩定（含 Intel Mac）。"
    }
];
const SYSTEM_SETUP_DRAFT_KEY = "system_setup_draft_v1";
const SYSTEM_SETUP_DRAFT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

export default function SystemSetupPage() {
    const { isSystemConfigured } = useGolem();
    const toast = useToast();

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
    const [isDraftRestored, setIsDraftRestored] = useState(false);
    const [isDraftReady, setIsDraftReady] = useState(false);
    const [healthCheckTriggered, setHealthCheckTriggered] = useState(false);

    const activeModelInfo = LOCAL_MODELS.find(m => m.id === localEmbeddingModel);
    const isOllamaBackend = backend === "ollama";
    const isLanceMode = memoryMode === "lancedb-pro";
    const isOllamaEmbedding = embeddingProvider === "ollama";
    const timeoutMsNumber = Number(ollamaTimeoutMs);
    const isTimeoutValid = !isOllamaBackend || (Number.isFinite(timeoutMsNumber) && timeoutMsNumber >= 1000);
    const isStoragePathValid = Boolean(userDataDir.trim());

    const hasBackendConfig = !isOllamaBackend || (
        Boolean(ollamaBaseUrl.trim())
        && Boolean(ollamaBrainModel.trim())
        && isTimeoutValid
    );
    const hasEmbeddingConfig = !isLanceMode || (
        !isOllamaEmbedding
            ? Boolean(localEmbeddingModel)
            : Boolean(ollamaEmbeddingModel.trim()) && Boolean(ollamaBaseUrl.trim())
    );
    const hasRemotePassword = Boolean(remoteAccessPassword.trim());
    const hasRemoteRisk = allowRemoteAccess && !hasRemotePassword;
    const canSubmit = !isLoading && isStoragePathValid && hasBackendConfig && hasEmbeddingConfig;
    const validationChecks = [
        { label: "記憶資料路徑不可空白", done: isStoragePathValid },
        { label: "後端設定完整", done: hasBackendConfig },
        { label: "向量模型設定完整", done: hasEmbeddingConfig },
        { label: "遠端安全策略已確認", done: !hasRemoteRisk }
    ];
    const healthItems: SystemHealthItem[] = [
        {
            id: "storage",
            label: "記憶資料路徑不可空白",
            status: isStoragePathValid ? "pass" : "fail",
            hint: isStoragePathValid ? "儲存路徑已設定" : "請指定 .env 中 USER_DATA_DIR 的儲存位置",
            fixLabel: isStoragePathValid ? undefined : "填入預設路徑"
        },
        {
            id: "backend",
            label: "後端設定完整",
            status: hasBackendConfig ? "pass" : "fail",
            hint: hasBackendConfig ? "後端連線參數已完成" : "請補齊 Ollama URL、模型與 timeout",
            fixLabel: hasBackendConfig ? undefined : "套用 Ollama 預設"
        },
        {
            id: "embedding",
            label: "向量模型設定完整",
            status: hasEmbeddingConfig ? "pass" : "fail",
            hint: hasEmbeddingConfig ? "Embedding 設定可用" : "請補齊 embedding provider 與模型參數",
            fixLabel: hasEmbeddingConfig ? undefined : "修復 embedding 設定"
        },
        {
            id: "remote",
            label: "遠端存取風險",
            status: hasRemoteRisk ? "warn" : "pass",
            hint: hasRemoteRisk ? "目前開啟遠端但未設密碼，建議加上保護" : "遠端策略安全性正常",
            fixLabel: hasRemoteRisk ? "填入安全密碼" : undefined
        },
        {
            id: "intel",
            label: "Intel Mac 與記憶引擎相容",
            status: isIntelMacRuntime && memoryMode === "lancedb-pro" ? "warn" : "pass",
            hint: isIntelMacRuntime && memoryMode === "lancedb-pro"
                ? "此組合會在啟動時降級，建議直接改為 Native"
                : "平台與記憶引擎相容",
            fixLabel: isIntelMacRuntime && memoryMode === "lancedb-pro" ? "切換為 Native" : undefined
        }
    ];
    const healthFailCount = healthItems.filter(item => item.status === "fail").length;
    const healthWarnCount = healthItems.filter(item => item.status === "warn").length;

    const setupScore = Math.min(
        100,
        (userDataDir.trim() ? 15 : 0)
        + (backend ? 10 : 0)
        + (hasBackendConfig ? 20 : 0)
        + (memoryMode ? 15 : 0)
        + (hasEmbeddingConfig ? 25 : 0)
        + (hasRemoteRisk ? 8 : 15)
    );
    const readinessLabel = setupScore >= 85 ? "部署就緒" : setupScore >= 60 ? "接近完成" : "需補設定";
    const readinessGradient = setupScore >= 85
        ? "from-emerald-400 via-teal-400 to-cyan-400"
        : setupScore >= 60
            ? "from-amber-400 via-orange-400 to-rose-400"
            : "from-slate-500 via-slate-400 to-zinc-400";
    const setupSteps = [
        {
            title: "引擎與記憶模式",
            description: "確認後端與記憶引擎，建立核心運作基礎。",
            done: Boolean(backend && memoryMode),
            icon: Cpu
        },
        {
            title: "向量模型配置",
            description: "若使用 LanceDB，完成 embedding provider 與模型設定。",
            done: hasEmbeddingConfig,
            icon: Database
        },
        {
            title: "網路與安全",
            description: "決定遠端策略，開啟遠端時建議加入密碼保護。",
            done: !hasRemoteRisk,
            icon: ShieldCheck
        },
        {
            title: "完成初始化",
            description: "儲存後進入建立 Golem 流程。",
            done: setupScore >= 85,
            icon: Sparkles
        }
    ];

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

                if (typeof window !== "undefined") {
                    const rawDraft = window.localStorage.getItem(SYSTEM_SETUP_DRAFT_KEY);
                    if (rawDraft) {
                        try {
                            const parsed = JSON.parse(rawDraft) as Partial<SystemSetupDraft>;
                            const updatedAt = Number(parsed.updatedAt || 0);
                            const isExpired = updatedAt > 0 && Date.now() - updatedAt > SYSTEM_SETUP_DRAFT_MAX_AGE_MS;

                            if (isExpired) {
                                window.localStorage.removeItem(SYSTEM_SETUP_DRAFT_KEY);
                            } else {
                                if (typeof parsed.userDataDir === "string") setUserDataDir(parsed.userDataDir);
                                if (parsed.memoryMode === "lancedb-pro" || parsed.memoryMode === "native") setMemoryMode(parsed.memoryMode);
                                if (parsed.backend === "gemini" || parsed.backend === "ollama") setBackend(parsed.backend);
                                if (parsed.embeddingProvider === "local" || parsed.embeddingProvider === "ollama") setEmbeddingProvider(parsed.embeddingProvider);
                                if (typeof parsed.localEmbeddingModel === "string") setLocalEmbeddingModel(parsed.localEmbeddingModel);
                                if (typeof parsed.ollamaBaseUrl === "string") setOllamaBaseUrl(parsed.ollamaBaseUrl);
                                if (typeof parsed.ollamaBrainModel === "string") setOllamaBrainModel(parsed.ollamaBrainModel);
                                if (typeof parsed.ollamaEmbeddingModel === "string") setOllamaEmbeddingModel(parsed.ollamaEmbeddingModel);
                                if (typeof parsed.ollamaRerankModel === "string") setOllamaRerankModel(parsed.ollamaRerankModel);
                                if (typeof parsed.ollamaTimeoutMs === "string") setOllamaTimeoutMs(parsed.ollamaTimeoutMs);
                                if (typeof parsed.allowRemoteAccess === "boolean") setAllowRemoteAccess(parsed.allowRemoteAccess);
                                if (typeof parsed.remoteAccessPassword === "string") setRemoteAccessPassword(parsed.remoteAccessPassword);
                                setIsDraftRestored(true);
                            }
                        } catch {
                            window.localStorage.removeItem(SYSTEM_SETUP_DRAFT_KEY);
                        }
                    }
                }
            } catch (fetchError) {
                console.error(fetchError);
            } finally {
                setIsFetching(false);
                setIsDraftReady(true);
            }
        };

        loadConfig();
    }, []);

    useEffect(() => {
        if (typeof window === "undefined" || !isDraftReady || isFetching) return;

        const draft: SystemSetupDraft = {
            userDataDir,
            memoryMode,
            backend,
            embeddingProvider,
            localEmbeddingModel,
            ollamaBaseUrl,
            ollamaBrainModel,
            ollamaEmbeddingModel,
            ollamaRerankModel,
            ollamaTimeoutMs,
            allowRemoteAccess,
            remoteAccessPassword,
            updatedAt: Date.now()
        };
        window.localStorage.setItem(SYSTEM_SETUP_DRAFT_KEY, JSON.stringify(draft));
    }, [
        userDataDir,
        memoryMode,
        backend,
        embeddingProvider,
        localEmbeddingModel,
        ollamaBaseUrl,
        ollamaBrainModel,
        ollamaEmbeddingModel,
        ollamaRerankModel,
        ollamaTimeoutMs,
        allowRemoteAccess,
        remoteAccessPassword,
        isDraftReady,
        isFetching
    ]);

    const clearDraft = () => {
        if (typeof window === "undefined") return;
        window.localStorage.removeItem(SYSTEM_SETUP_DRAFT_KEY);
        setIsDraftRestored(false);
        toast.info("草稿已清除", "重新整理後將不再還原先前未送出的設定。");
    };

    const applyHealthFix = (itemId: string) => {
        if (itemId === "storage") {
            setUserDataDir("./golem_memory");
            return;
        }
        if (itemId === "backend") {
            setBackend("ollama");
            setOllamaBaseUrl("http://127.0.0.1:11434");
            setOllamaBrainModel("llama3.1:8b");
            setOllamaTimeoutMs("60000");
            return;
        }
        if (itemId === "embedding") {
            if (!isLanceMode) setMemoryMode("lancedb-pro");
            setEmbeddingProvider("local");
            setLocalEmbeddingModel("Xenova/bge-small-zh-v1.5");
            setOllamaEmbeddingModel("nomic-embed-text");
            return;
        }
        if (itemId === "remote") {
            setRemoteAccessPassword("change-me-strong-password");
            return;
        }
        if (itemId === "intel") {
            setMemoryMode("native");
        }
    };

    const runHealthCheck = () => {
        setHealthCheckTriggered(true);
        if (healthFailCount === 0 && healthWarnCount === 0) {
            toast.success("健康檢查完成", "系統設定狀態良好，可直接初始化。");
            return;
        }
        if (healthFailCount === 0) {
            toast.warning("健康檢查完成", `有 ${healthWarnCount} 項風險提醒，建議先修正。`);
            return;
        }
        toast.warning("健康檢查未通過", `尚有 ${healthFailCount} 項必修設定。`);
    };

    const submitConfig = async () => {
        setError(null);

        if (!canSubmit) {
            toast.warning("設定尚未完成", "請先完成檢查清單中的項目，再送出初始化設定。");
            return;
        }

        if (hasRemoteRisk) {
            const keepGoing = window.confirm(
                "目前已開啟遠端存取但未設密碼，存在安全風險。\n\n是否仍要繼續儲存設定？"
            );
            if (!keepGoing) {
                return;
            }
        }

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
            if (typeof window !== "undefined") {
                window.localStorage.removeItem(SYSTEM_SETUP_DRAFT_KEY);
            }
            window.location.href = "/dashboard/launchpad?from=system-setup";
        } catch (error: unknown) {
            setError(getErrorMessage(error));
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await submitConfig();
    };
    const submitConfigRef = useRef(submitConfig);
    submitConfigRef.current = submitConfig;

    useEffect(() => {
        if (typeof window === "undefined") return;

        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void submitConfigRef.current();
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    if (isFetching) {
        return (
            <div className="flex-1 flex items-center justify-center bg-background">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10">
                    <div className="h-7 w-7 rounded-full border-2 border-cyan-300/30 border-t-cyan-200 animate-spin" />
                </div>
            </div>
        );
    }

    return (
        <div className="relative flex-1 overflow-auto bg-[radial-gradient(circle_at_12%_0%,rgba(45,212,191,0.14),transparent_40%),radial-gradient(circle_at_90%_16%,rgba(14,165,233,0.12),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(251,191,36,0.1),transparent_42%)] text-foreground">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-24 left-[7%] h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl" />
                <div className="absolute top-1/3 right-[9%] h-80 w-80 rounded-full bg-emerald-400/10 blur-3xl" />
                <div className="absolute -bottom-28 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-amber-400/10 blur-3xl" />
            </div>

            <div className="relative mx-auto w-full max-w-[1320px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
                <section className="mb-6 overflow-hidden rounded-3xl border border-border/80 bg-card/75 p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.85)] backdrop-blur-md sm:p-8">
                    <div className="pointer-events-none absolute inset-0">
                        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-cyan-400/0 via-cyan-300/80 to-cyan-400/0" />
                    </div>

                    <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                        <div className="max-w-3xl">
                            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-300/35 bg-cyan-300/10 px-3 py-1 text-xs font-semibold tracking-wide text-cyan-100">
                                <Sparkles className="h-3.5 w-3.5" />
                                System Initialization Studio
                            </div>
                            <h1 className="text-3xl font-semibold leading-tight text-white sm:text-4xl lg:text-[2.6rem]">
                                打造穩定、可擴充的
                                <span className="bg-gradient-to-r from-cyan-200 via-emerald-200 to-teal-300 bg-clip-text text-transparent"> Golem 基礎系統</span>
                            </h1>
                            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">
                                這是第一次啟動前最關鍵的配置區。把後端、記憶引擎與網路策略設定好，後續新增 Golem 節點就會非常順暢。
                            </p>
                            <div className="mt-5 flex flex-wrap gap-2.5">
                                <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/25 bg-sky-300/10 px-3 py-1 text-xs text-sky-100">
                                    <Cpu className="h-3.5 w-3.5" />
                                    Backend: {backend === "ollama" ? "Ollama" : "Web Gemini"}
                                </div>
                                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1 text-xs text-emerald-100">
                                    <Database className="h-3.5 w-3.5" />
                                    Memory: {memoryMode === "lancedb-pro" ? "LanceDB Pro" : "Native"}
                                </div>
                                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100">
                                    <Gauge className="h-3.5 w-3.5" />
                                    就緒度 {setupScore}%
                                </div>
                            </div>
                        </div>

                        <div className="grid w-full gap-3 sm:grid-cols-3 lg:max-w-md">
                            <div className="rounded-2xl border border-border/70 bg-background/60 px-4 py-3">
                                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Runtime</div>
                                <div className="mt-1 text-sm font-semibold text-foreground">{isIntelMacRuntime ? "Intel Mac" : "Standard"}</div>
                            </div>
                            <div className="rounded-2xl border border-border/70 bg-background/60 px-4 py-3">
                                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Remote Access</div>
                                <div className="mt-1 text-sm font-semibold text-foreground">{allowRemoteAccess ? "Enabled" : "Local Only"}</div>
                            </div>
                            <div className="rounded-2xl border border-border/70 bg-background/60 px-4 py-3">
                                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</div>
                                <div className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
                                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                    {readinessLabel}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="relative mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        {setupSteps.map((step, idx) => {
                            const IconComponent = step.icon;
                            return (
                                <div
                                    key={step.title}
                                    className={cn(
                                        "rounded-2xl border px-4 py-3 transition-all",
                                        step.done
                                            ? "border-emerald-400/35 bg-emerald-400/10"
                                            : "border-border/70 bg-background/55"
                                    )}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                                            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border/70 bg-background/80 text-xs">
                                                {idx + 1}
                                            </span>
                                            {step.title}
                                        </div>
                                        <IconComponent className={cn("h-4 w-4", step.done ? "text-emerald-300" : "text-muted-foreground")} />
                                    </div>
                                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{step.description}</p>
                                </div>
                            );
                        })}
                    </div>
                </section>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {error && (
                        <div className="flex items-start gap-3 rounded-2xl border border-red-400/35 bg-red-400/10 p-4 text-red-100">
                            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-300" />
                            <p className="text-sm">{error}</p>
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                        <section className="space-y-6 xl:col-span-8">
                            <div className="overflow-hidden rounded-3xl border border-border/80 bg-card/80 p-6 shadow-xl backdrop-blur-sm">
                                <div className="mb-5 flex items-center gap-2">
                                    <Brain className="h-5 w-5 text-cyan-300" />
                                    <h2 className="text-base font-semibold text-foreground">核心引擎與記憶配置</h2>
                                </div>

                                <div className="space-y-5">
                                    <div>
                                        <label className="mb-2 block text-sm font-medium text-muted-foreground">大腦後端 (Brain Backend)</label>
                                        <select
                                            value={backend}
                                            onChange={e => setBackend(e.target.value as BackendMode)}
                                            className="w-full rounded-xl border border-border bg-background/70 px-4 py-3 text-sm text-foreground transition-all focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
                                        >
                                            <option value="gemini">Web Gemini (Playwright Browser)</option>
                                            <option value="ollama">Ollama API (Local / Self-hosted)</option>
                                        </select>
                                        <p className="mt-1.5 text-xs text-muted-foreground">
                                            Ollama 適合私有化部署；Gemini 保留 Browser-in-the-Loop。
                                        </p>
                                    </div>

                                    {isOllamaBackend && (
                                        <div className="rounded-2xl border border-cyan-300/25 bg-cyan-300/10 p-4 space-y-3">
                                            <div>
                                                <label className="mb-1.5 block text-xs font-medium text-cyan-100/90">Ollama Base URL</label>
                                                <input
                                                    type="text"
                                                    value={ollamaBaseUrl}
                                                    onChange={e => setOllamaBaseUrl(e.target.value)}
                                                    className="w-full rounded-lg border border-border bg-background/80 px-3 py-2 font-mono text-xs text-foreground transition-all focus:border-cyan-300 focus:outline-none"
                                                    placeholder="http://127.0.0.1:11434"
                                                />
                                            </div>
                                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                <div>
                                                    <label className="mb-1.5 block text-xs font-medium text-cyan-100/90">Ollama Brain Model</label>
                                                    <input
                                                        type="text"
                                                        value={ollamaBrainModel}
                                                        onChange={e => setOllamaBrainModel(e.target.value)}
                                                        className="w-full rounded-lg border border-border bg-background/80 px-3 py-2 font-mono text-xs text-foreground transition-all focus:border-cyan-300 focus:outline-none"
                                                        placeholder="llama3.1:8b"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="mb-1.5 block text-xs font-medium text-cyan-100/90">Ollama Timeout (ms)</label>
                                                    <input
                                                        type="number"
                                                        min={1000}
                                                        value={ollamaTimeoutMs}
                                                        onChange={e => setOllamaTimeoutMs(e.target.value)}
                                                        className="w-full rounded-lg border border-border bg-background/80 px-3 py-2 font-mono text-xs text-foreground transition-all focus:border-cyan-300 focus:outline-none"
                                                        placeholder="60000"
                                                    />
                                                    {!isTimeoutValid && (
                                                        <p className="mt-1 text-[10px] text-amber-200">Timeout 建議至少 1000ms。</p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div>
                                        <label className="mb-3 block text-sm font-medium text-muted-foreground">記憶引擎模式</label>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            {MEMORY_MODE_OPTIONS.map(opt => (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    onClick={() => setMemoryMode(opt.value)}
                                                    className={cn(
                                                        "rounded-xl border p-3 text-left transition-all",
                                                        memoryMode === opt.value
                                                            ? "border-cyan-300/45 bg-cyan-300/15"
                                                            : "border-border bg-background/55 hover:border-cyan-300/35 hover:bg-cyan-300/10"
                                                    )}
                                                >
                                                    <div className="mb-0.5 flex items-center justify-between">
                                                        <span className="text-xs font-semibold text-foreground">{opt.label}</span>
                                                        {memoryMode === opt.value && <CheckCircle2 className="h-3.5 w-3.5 text-cyan-300" />}
                                                    </div>
                                                    <div className="text-[11px] leading-relaxed text-muted-foreground">{opt.desc}</div>
                                                </button>
                                            ))}
                                        </div>
                                        {isIntelMacRuntime && (
                                            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/35 bg-amber-400/10 p-3">
                                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                                                <p className="text-[11px] leading-relaxed text-amber-100/90">
                                                    偵測到 Intel Mac (darwin-x64)。建議選擇 <code className="font-mono">native</code>；
                                                    若選擇 <code className="font-mono">lancedb-pro</code>，系統啟動時會自動降級為 <code className="font-mono">native</code>。
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <label className="mb-2 block text-sm font-medium text-muted-foreground">
                                            <HardDrive className="mr-1.5 inline h-3.5 w-3.5 text-muted-foreground" />
                                            記憶資料儲存路徑
                                        </label>
                                        <input
                                            type="text"
                                            value={userDataDir}
                                            onChange={e => setUserDataDir(e.target.value)}
                                            className="w-full rounded-xl border border-border bg-background/70 px-4 py-3 font-mono text-sm text-foreground transition-all focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
                                            placeholder="./golem_memory"
                                        />
                                        <p className="mt-1.5 text-xs text-muted-foreground">
                                            存放 Playwright Session（若使用 Gemini）與長期記憶資料庫。
                                        </p>
                                    </div>

                                    {isLanceMode && (
                                        <div className="rounded-2xl border border-sky-300/25 bg-sky-300/10 p-5">
                                            <div className="mb-4 flex items-center gap-2">
                                                <Sparkles className="h-4 w-4 text-sky-200" />
                                                <h3 className="text-sm font-semibold text-foreground">向量模型設定 (Embedding)</h3>
                                            </div>

                                            <div className="space-y-4">
                                                <div>
                                                    <label className="mb-2 block text-xs font-medium text-sky-100/90">提供者</label>
                                                    <select
                                                        value={embeddingProvider}
                                                        onChange={e => setEmbeddingProvider(e.target.value as EmbeddingProvider)}
                                                        className="w-full rounded-lg border border-border bg-background/75 px-3 py-2 text-sm text-foreground transition-all focus:border-sky-300 focus:outline-none"
                                                    >
                                                        <option value="local">Local (Transformers.js)</option>
                                                        <option value="ollama">Ollama Embedding</option>
                                                    </select>
                                                </div>

                                                {!isOllamaEmbedding && (
                                                    <>
                                                        <div>
                                                            <label className="mb-2 block text-xs font-medium text-sky-100/90">模型選擇</label>
                                                            <select
                                                                value={localEmbeddingModel}
                                                                onChange={e => setLocalEmbeddingModel(e.target.value)}
                                                                className="w-full rounded-lg border border-border bg-background/75 px-3 py-2 font-mono text-sm text-foreground transition-all focus:border-sky-300 focus:outline-none"
                                                            >
                                                                {LOCAL_MODELS.map(model => (
                                                                    <option key={model.id} value={model.id}>{model.name}</option>
                                                                ))}
                                                            </select>
                                                        </div>

                                                        {activeModelInfo && (
                                                            <div className="space-y-2 rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-3">
                                                                <div className="text-[11px] leading-relaxed text-cyan-50/90">
                                                                    <span className="font-semibold text-cyan-200">特色：</span> {activeModelInfo.features}
                                                                </div>
                                                                <div className="text-[11px] leading-relaxed text-cyan-50/90">
                                                                    <span className="font-semibold text-cyan-200">推薦：</span> {activeModelInfo.recommendation}
                                                                </div>
                                                                <div className="border-t border-cyan-300/20 pt-1 text-[10px] italic text-cyan-100/80">
                                                                    {activeModelInfo.notes}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </>
                                                )}

                                                {isOllamaEmbedding && (
                                                    <div className="space-y-3 rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-3">
                                                        {!isOllamaBackend && (
                                                            <div>
                                                                <label className="mb-1.5 block text-xs font-medium text-cyan-100/90">Ollama Base URL (Embedding)</label>
                                                                <input
                                                                    type="text"
                                                                    value={ollamaBaseUrl}
                                                                    onChange={e => setOllamaBaseUrl(e.target.value)}
                                                                    className="w-full rounded-lg border border-border bg-background/80 px-3 py-2 font-mono text-xs text-foreground transition-all focus:border-cyan-300 focus:outline-none"
                                                                    placeholder="http://127.0.0.1:11434"
                                                                />
                                                            </div>
                                                        )}
                                                        <div>
                                                            <label className="mb-1.5 block text-xs font-medium text-cyan-100/90">Embedding Model</label>
                                                            <input
                                                                type="text"
                                                                value={ollamaEmbeddingModel}
                                                                onChange={e => setOllamaEmbeddingModel(e.target.value)}
                                                                className="w-full rounded-lg border border-border bg-background/80 px-3 py-2 font-mono text-xs text-foreground transition-all focus:border-cyan-300 focus:outline-none"
                                                                placeholder="nomic-embed-text"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="mb-1.5 block text-xs font-medium text-cyan-100/90">Rerank Model (選填)</label>
                                                            <input
                                                                type="text"
                                                                value={ollamaRerankModel}
                                                                onChange={e => setOllamaRerankModel(e.target.value)}
                                                                className="w-full rounded-lg border border-border bg-background/80 px-3 py-2 font-mono text-xs text-foreground transition-all focus:border-cyan-300 focus:outline-none"
                                                                placeholder="bge-reranker-v2-m3 (optional)"
                                                            />
                                                        </div>
                                                        <p className="text-[10px] leading-relaxed text-cyan-100/85">
                                                            若填寫 rerank 模型，查詢結果會在向量召回後再重排；若空白則維持原始 hybrid ranking。
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="overflow-hidden rounded-3xl border border-border/80 bg-card/80 p-6 shadow-xl backdrop-blur-sm">
                                <div className="mb-5 flex items-center gap-2">
                                    <ExternalLink className="h-5 w-5 text-emerald-300" />
                                    <h2 className="text-base font-semibold text-foreground">網路連線與安全策略</h2>
                                </div>

                                <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-background/55 p-4">
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium text-foreground">允許遠端存取 (Remote Access)</div>
                                        <div className="text-xs leading-relaxed text-muted-foreground">
                                            開啟後可允許區域網路或其他 IP 連線。若關閉則僅限 localhost。
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setAllowRemoteAccess(value => !value)}
                                        aria-pressed={allowRemoteAccess}
                                        className={cn(
                                            "relative h-7 w-14 rounded-full border p-1 transition-colors",
                                            allowRemoteAccess
                                                ? "border-emerald-300/45 bg-emerald-400/45"
                                                : "border-border bg-secondary/70"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
                                                allowRemoteAccess ? "translate-x-7" : "translate-x-0"
                                            )}
                                        />
                                    </button>
                                </div>

                                {allowRemoteAccess && (
                                    <>
                                        <div className="mt-5 rounded-2xl border border-emerald-300/30 bg-emerald-300/10 p-4">
                                            <label className="mb-2 block text-sm font-medium text-emerald-100">
                                                <Lock className="mr-1.5 inline h-3.5 w-3.5 text-emerald-200" />
                                                自定義遠端存取密碼 (選填)
                                            </label>
                                            <input
                                                type="password"
                                                value={remoteAccessPassword}
                                                onChange={e => setRemoteAccessPassword(e.target.value)}
                                                className="w-full rounded-xl border border-border bg-background/80 px-4 py-3 font-mono text-sm text-foreground transition-all focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/20"
                                                placeholder="若留空，則遠端存取不需要密碼"
                                                autoComplete="new-password"
                                            />
                                            <p className="mt-1.5 text-[10px] leading-relaxed text-emerald-100/80">
                                                設定密碼後，非本機連線皆須輸入此密碼才可登入控制台。
                                            </p>
                                        </div>
                                        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/35 bg-amber-400/10 p-3">
                                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                                            <p className="text-[10px] leading-relaxed text-amber-100/90">
                                                開啟遠端存取會提高暴露風險。請搭配強密碼、可信任網路與防火牆策略。
                                            </p>
                                        </div>
                                    </>
                                )}
                            </div>
                        </section>

                        <aside className="space-y-6 xl:col-span-4 xl:sticky xl:top-6 h-fit">
                            <div className="rounded-3xl border border-border/80 bg-card/85 p-6 shadow-xl backdrop-blur-sm">
                                <div className="mb-3 flex items-center justify-between">
                                    <div className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                                        <Gauge className="h-4 w-4 text-cyan-300" />
                                        初始化就緒度
                                    </div>
                                    <div className="text-sm font-semibold text-foreground">{setupScore}%</div>
                                </div>
                                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary/70">
                                    <div
                                        className={cn("h-full bg-gradient-to-r transition-all duration-500", readinessGradient)}
                                        style={{ width: `${setupScore}%` }}
                                    />
                                </div>
                                <p className="mt-2 text-xs text-muted-foreground">
                                    狀態：{readinessLabel}。建議至少 85% 再進行首次部署。
                                </p>

                                <div className="mt-4 space-y-2">
                                    <div className="flex items-center justify-between rounded-xl border border-border/70 bg-background/55 px-3 py-2 text-xs">
                                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                            <Cpu className="h-3.5 w-3.5" />
                                            大腦後端
                                        </span>
                                        <span className="font-semibold text-foreground">{backend === "ollama" ? "Ollama" : "Gemini"}</span>
                                    </div>
                                    <div className="flex items-center justify-between rounded-xl border border-border/70 bg-background/55 px-3 py-2 text-xs">
                                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                            <Database className="h-3.5 w-3.5" />
                                            記憶模式
                                        </span>
                                        <span className="font-semibold text-foreground">{memoryMode === "lancedb-pro" ? "LanceDB Pro" : "Native"}</span>
                                    </div>
                                    <div className="flex items-center justify-between rounded-xl border border-border/70 bg-background/55 px-3 py-2 text-xs">
                                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                            <Globe className="h-3.5 w-3.5" />
                                            遠端策略
                                        </span>
                                        <span className="font-semibold text-foreground">{allowRemoteAccess ? "Remote On" : "Local Only"}</span>
                                    </div>
                                    <div className="flex items-center justify-between rounded-xl border border-border/70 bg-background/55 px-3 py-2 text-xs">
                                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                            <Activity className="h-3.5 w-3.5" />
                                            設定檔狀態
                                        </span>
                                        <span className="font-semibold text-foreground">{isSystemConfigured ? "已存在" : "首次初始化"}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-3xl border border-border/80 bg-card/85 p-6 shadow-xl backdrop-blur-sm">
                                <div className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                                    <ShieldCheck className="h-4 w-4 text-emerald-300" />
                                    送出設定
                                </div>
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                    儲存完成後會進入建立 Golem 節點流程。設定值會寫入 <code className="font-mono text-foreground/90">.env</code>。
                                </p>

                                <div className="mt-4 rounded-2xl border border-border/70 bg-background/55 p-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                            <ShieldCheck className="h-3.5 w-3.5 text-cyan-300" />
                                            初始化健康檢查
                                        </div>
                                        <button
                                            type="button"
                                            onClick={runHealthCheck}
                                            className="rounded-lg border border-cyan-300/35 bg-cyan-300/15 px-2.5 py-1 text-[11px] text-cyan-100 transition-colors hover:bg-cyan-300/25"
                                        >
                                            一鍵檢查
                                        </button>
                                    </div>
                                    <p className="mt-2 text-[11px] text-muted-foreground">可先檢查引擎、向量模型與安全策略是否有風險。</p>

                                    {healthCheckTriggered && (
                                        <div className="mt-3 space-y-2">
                                            {healthItems.map((item) => (
                                                <div
                                                    key={item.id}
                                                    className={cn(
                                                        "rounded-xl border px-2.5 py-2",
                                                        item.status === "pass"
                                                            ? "border-emerald-300/30 bg-emerald-300/10"
                                                            : item.status === "warn"
                                                                ? "border-amber-300/30 bg-amber-300/10"
                                                                : "border-red-300/35 bg-red-300/10"
                                                    )}
                                                >
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div>
                                                            <div className={cn(
                                                                "text-[11px] font-medium",
                                                                item.status === "pass"
                                                                    ? "text-emerald-100"
                                                                    : item.status === "warn"
                                                                        ? "text-amber-100"
                                                                        : "text-red-100"
                                                            )}>
                                                                {item.label}
                                                            </div>
                                                            <p className="mt-1 text-[10px] text-muted-foreground">{item.hint}</p>
                                                        </div>
                                                        {item.fixLabel && item.status !== "pass" && (
                                                            <button
                                                                type="button"
                                                                onClick={() => applyHealthFix(item.id)}
                                                                className="shrink-0 rounded-md border border-border/70 bg-background/60 px-2 py-1 text-[10px] text-foreground hover:border-cyan-300/40 hover:text-cyan-100"
                                                            >
                                                                {item.fixLabel}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="mt-4 space-y-2">
                                    {validationChecks.map((check) => (
                                        <div
                                            key={check.label}
                                            className="flex items-center justify-between rounded-xl border border-border/70 bg-background/55 px-3 py-2 text-xs"
                                        >
                                            <span className={cn("inline-flex items-center gap-1.5", check.done ? "text-emerald-200" : "text-muted-foreground")}>
                                                <CheckCircle2 className={cn("h-3.5 w-3.5", check.done ? "text-emerald-300" : "text-muted-foreground/60")} />
                                                {check.label}
                                            </span>
                                            <span className={cn("font-semibold", check.done ? "text-emerald-200" : "text-muted-foreground")}>
                                                {check.done ? "完成" : "待補"}
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-4 rounded-xl border border-border/70 bg-background/55 px-3 py-2.5 text-xs text-muted-foreground">
                                    {isDraftRestored ? "已自動還原上次系統設定草稿。" : "此頁會自動保存草稿，避免中途中斷造成設定遺失。"}
                                    <button
                                        type="button"
                                        onClick={clearDraft}
                                        className="ml-2 text-cyan-200 hover:text-cyan-100 hover:underline"
                                    >
                                        清除草稿
                                    </button>
                                </div>

                                <Button
                                    type="submit"
                                    disabled={!canSubmit}
                                    className="mt-5 h-14 w-full rounded-2xl border-none bg-gradient-to-r from-cyan-500 via-emerald-500 to-teal-500 text-base font-semibold text-white shadow-[0_20px_50px_-25px_rgba(16,185,129,0.9)] transition-all hover:scale-[1.01] hover:from-cyan-400 hover:via-emerald-400 hover:to-teal-400 active:scale-[0.99]"
                                >
                                    {isLoading ? (
                                        <span className="flex items-center gap-2">
                                            <div className="h-5 w-5 rounded-full border-2 border-white/35 border-t-white animate-spin" />
                                            正在儲存設定...
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-2">
                                            {isSystemConfigured ? "更新系統設定" : "完成設定，進入控制台"}
                                            <ArrowRight className="h-5 w-5" />
                                        </span>
                                    )}
                                </Button>
                                <p className="mt-2 text-center text-[11px] text-muted-foreground">快捷鍵：Cmd/Ctrl + Enter</p>
                            </div>
                        </aside>
                    </div>
                </form>
            </div>
        </div>
    );
}
