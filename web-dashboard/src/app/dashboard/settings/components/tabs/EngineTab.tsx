"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { LOCAL_MODELS, SettingField, SettingSelectField } from "../SettingFields";
import { useI18n } from "@/components/I18nProvider";
import { apiPostWrite } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast-provider";

type EngineTabProps = {
    env: Record<string, string>;
    onChangeEnv: (key: string, value: string) => void;
};

type BackendKind = "ollama" | "lmstudio";
type TestScope = "backend-ollama" | "backend-lmstudio" | "embedding-ollama";

const getEmbeddingProvider = (provider?: string) => {
    if (provider === "local" || provider === "ollama") {
        return provider;
    }
    return "local";
};

const getMemoryMode = (mode?: string) => {
    const normalized = String(mode || "").trim().toLowerCase();
    if (normalized === "native" || normalized === "system") {
        return "native";
    }
    return "lancedb-pro";
};

export default function EngineTab({ env, onChangeEnv }: EngineTabProps) {
    const { t } = useI18n();
    const toast = useToast();
    const [activeTestScope, setActiveTestScope] = useState<TestScope | null>(null);
    const [testErrorDetail, setTestErrorDetail] = useState<{ scope: TestScope; detail: string } | null>(null);
    const localizedModels = LOCAL_MODELS.map((model) => {
        if (model.id === "Xenova/bge-small-zh-v1.5") {
            return {
                ...model,
                name: t("settings.engine.model.bgeSmall.name"),
                features: t("settings.engine.model.bgeSmall.features"),
                recommendation: t("settings.engine.model.bgeSmall.recommendation"),
            };
        }
        if (model.id === "Xenova/bge-base-zh-v1.5") {
            return {
                ...model,
                name: t("settings.engine.model.bgeBase.name"),
                features: t("settings.engine.model.bgeBase.features"),
                recommendation: t("settings.engine.model.bgeBase.recommendation"),
            };
        }
        if (model.id === "Xenova/paraphrase-multilingual-MiniLM-L12-v2") {
            return {
                ...model,
                name: t("settings.engine.model.minilmL12.name"),
                features: t("settings.engine.model.minilmL12.features"),
                recommendation: t("settings.engine.model.minilmL12.recommendation"),
            };
        }
        if (model.id === "Xenova/nomic-embed-text-v1.5") {
            return {
                ...model,
                name: t("settings.engine.model.nomic.name"),
                features: t("settings.engine.model.nomic.features"),
                recommendation: t("settings.engine.model.nomic.recommendation"),
            };
        }
        if (model.id === "Xenova/all-MiniLM-L6-v2") {
            return {
                ...model,
                name: t("settings.engine.model.minilmL6.name"),
                features: t("settings.engine.model.minilmL6.features"),
                recommendation: t("settings.engine.model.minilmL6.recommendation"),
            };
        }
        return model;
    });
    const memoryMode = getMemoryMode(env.GOLEM_MEMORY_MODE);

    const copyErrorDetail = async () => {
        if (!testErrorDetail?.detail) return;
        try {
            if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
                throw new Error("Clipboard API is not available.");
            }
            await navigator.clipboard.writeText(testErrorDetail.detail);
            toast.success(t("settings.engine.connectionTest.copySuccess"));
        } catch {
            toast.error(t("settings.engine.connectionTest.copyFailed"));
        }
    };

    const runConnectionTest = async (
        scope: TestScope,
        payload: Record<string, unknown>,
        successTitle: string,
        failTitle: string
    ) => {
        setActiveTestScope(scope);
        setTestErrorDetail(null);

        try {
            const data = await apiPostWrite<{
                success?: boolean;
                backend?: string;
                purpose?: string;
                baseUrl?: string;
                model?: string;
                embeddingModel?: string;
                message?: string;
                error?: string;
                latencyMs?: number;
                preview?: string;
                dimension?: number;
            }>("/api/system/backend/test", payload);

            if (!data.success) {
                throw new Error(data.error || data.message || t("settings.engine.connectionTest.failed"));
            }

            const metaParts: string[] = [];
            if (data.backend && data.purpose) metaParts.push(`${data.backend}/${data.purpose}`);
            if (data.baseUrl) metaParts.push(`url=${data.baseUrl}`);
            if (data.model) metaParts.push(`model=${data.model}`);
            if (data.embeddingModel) metaParts.push(`embeddingModel=${data.embeddingModel}`);
            if (typeof data.latencyMs === "number") metaParts.push(`${data.latencyMs}ms`);
            if (typeof data.dimension === "number") metaParts.push(`dim=${data.dimension}`);
            if (data.preview) metaParts.push(data.preview);
            toast.success(successTitle, metaParts.join(" · "));
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : t("settings.engine.connectionTest.failed");
            const detailPayload = { ...payload, apiKey: payload.apiKey ? "***" : payload.apiKey };
            const detail = [
                `time=${new Date().toISOString()}`,
                `scope=${scope}`,
                `message=${message}`,
                `payload=${JSON.stringify(detailPayload)}`
            ].join("\n");
            setTestErrorDetail({
                scope,
                detail
            });
            toast.error(failTitle, message);
        } finally {
            setActiveTestScope(null);
        }
    };

    const testBackendConnection = async (backend: BackendKind) => {
        const timeoutRaw = backend === "ollama" ? env.GOLEM_OLLAMA_TIMEOUT_MS : env.GOLEM_LMSTUDIO_TIMEOUT_MS;
        const parsedTimeout = Number(timeoutRaw);
        const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 60000;

        if (backend === "ollama") {
            await runConnectionTest(
                "backend-ollama",
                {
                    backend: "ollama",
                    purpose: "brain",
                    baseUrl: env.GOLEM_OLLAMA_BASE_URL || "http://127.0.0.1:11434",
                    model: env.GOLEM_OLLAMA_BRAIN_MODEL || "",
                    timeoutMs
                },
                t("settings.engine.connectionTest.success"),
                t("settings.engine.connectionTest.failed")
            );
            return;
        }

        await runConnectionTest(
            "backend-lmstudio",
            {
                backend: "lmstudio",
                purpose: "brain",
                baseUrl: env.GOLEM_LMSTUDIO_BASE_URL || "http://127.0.0.1:1234/v1",
                model: env.GOLEM_LMSTUDIO_BRAIN_MODEL || "",
                timeoutMs,
                apiKey: env.GOLEM_LMSTUDIO_API_KEY || ""
            },
            t("settings.engine.connectionTest.success"),
            t("settings.engine.connectionTest.failed")
        );
    };

    const testOllamaEmbeddingConnection = async () => {
        const parsedTimeout = Number(env.GOLEM_OLLAMA_TIMEOUT_MS);
        const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 60000;
        await runConnectionTest(
            "embedding-ollama",
            {
                backend: "ollama",
                purpose: "embedding",
                baseUrl: env.GOLEM_OLLAMA_BASE_URL || "http://127.0.0.1:11434",
                embeddingModel: env.GOLEM_OLLAMA_EMBEDDING_MODEL || "",
                timeoutMs
            },
            t("settings.engine.connectionTest.embeddingSuccess"),
            t("settings.engine.connectionTest.embeddingFailed")
        );
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-6">
                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                            {t("settings.engine.aiBackendTitle")}
                        </h2>
                        <div className="flex flex-col mb-4">
                            <label className="text-sm font-medium text-muted-foreground mb-1 flex items-center justify-between gap-1 overflow-hidden">
                                <span className="truncate mr-1" title={t("settings.engine.primaryEngine")}>{t("settings.engine.primaryEngine")}</span>
                            </label>
                            <select
                                value={env.GOLEM_BACKEND || "gemini"}
                                onChange={(e) => onChangeEnv("GOLEM_BACKEND", e.target.value)}
                                className="w-full bg-secondary/30 border border-border focus:border-primary rounded-lg px-3 py-2 text-sm text-foreground transition-colors"
                            >
                                <option value="gemini">{t("settings.engine.backend.gemini")}</option>
                                <option value="ollama">{t("settings.engine.backend.ollama")}</option>
                                <option value="lmstudio">{t("settings.engine.backend.lmstudio")}</option>
                            </select>
                        </div>

                        {env.GOLEM_BACKEND === "ollama" && (
                            <div className="bg-primary/5 p-4 rounded-xl border border-primary/20 space-y-4 animate-in zoom-in-95">
                                <SettingField
                                    label="Ollama Base URL"
                                    keyName="GOLEM_OLLAMA_BASE_URL"
                                    placeholder="http://127.0.0.1:11434"
                                    desc={t("settings.engine.ollama.baseUrl.desc")}
                                    value={env.GOLEM_OLLAMA_BASE_URL || ""}
                                    onChange={(val) => onChangeEnv("GOLEM_OLLAMA_BASE_URL", val)}
                                />
                                <SettingField
                                    label="Ollama Brain Model"
                                    keyName="GOLEM_OLLAMA_BRAIN_MODEL"
                                    placeholder="llama3.1:8b"
                                    desc={t("settings.engine.ollama.brainModel.desc")}
                                    value={env.GOLEM_OLLAMA_BRAIN_MODEL || ""}
                                    onChange={(val) => onChangeEnv("GOLEM_OLLAMA_BRAIN_MODEL", val)}
                                />
                                <SettingField
                                    label="Ollama Timeout (ms)"
                                    keyName="GOLEM_OLLAMA_TIMEOUT_MS"
                                    placeholder="60000"
                                    desc={t("settings.engine.ollama.timeout.desc")}
                                    value={env.GOLEM_OLLAMA_TIMEOUT_MS || ""}
                                    onChange={(val) => onChangeEnv("GOLEM_OLLAMA_TIMEOUT_MS", val)}
                                />
                                <div className="pt-1 space-y-2">
                                    <button
                                        type="button"
                                        onClick={() => testBackendConnection("ollama")}
                                        disabled={activeTestScope !== null}
                                        className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                                            activeTestScope !== null
                                                ? "bg-muted text-muted-foreground border-border cursor-not-allowed"
                                                : "bg-primary/15 text-primary border-primary/40 hover:bg-primary/25"
                                        }`}
                                    >
                                        {activeTestScope !== null ? t("settings.engine.connectionTest.testing") : t("settings.engine.connectionTest.button")}
                                    </button>
                                    {testErrorDetail?.scope === "backend-ollama" && (
                                        <div className="space-y-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                                            <p className="text-xs text-red-300 font-semibold">{t("settings.engine.connectionTest.errorDetails")}</p>
                                            <textarea
                                                readOnly
                                                value={testErrorDetail.detail}
                                                className="w-full h-24 resize-y bg-background/70 border border-border rounded-md px-2 py-1 text-[11px] text-foreground font-mono"
                                            />
                                            <button
                                                type="button"
                                                onClick={copyErrorDetail}
                                                className="px-2 py-1 rounded border border-red-400/40 text-red-200 text-[11px] hover:bg-red-500/20 transition-colors"
                                            >
                                                {t("settings.engine.connectionTest.copyError")}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {env.GOLEM_BACKEND === "lmstudio" && (
                            <div className="bg-primary/5 p-4 rounded-xl border border-primary/20 space-y-4 animate-in zoom-in-95">
                                <SettingField
                                    label="LM Studio Base URL"
                                    keyName="GOLEM_LMSTUDIO_BASE_URL"
                                    placeholder="http://127.0.0.1:1234/v1"
                                    desc={t("settings.engine.lmstudio.baseUrl.desc")}
                                    value={env.GOLEM_LMSTUDIO_BASE_URL || ""}
                                    onChange={(val) => onChangeEnv("GOLEM_LMSTUDIO_BASE_URL", val)}
                                />
                                <SettingField
                                    label="LM Studio Brain Model"
                                    keyName="GOLEM_LMSTUDIO_BRAIN_MODEL"
                                    placeholder="local-model"
                                    desc={t("settings.engine.lmstudio.brainModel.desc")}
                                    value={env.GOLEM_LMSTUDIO_BRAIN_MODEL || ""}
                                    onChange={(val) => onChangeEnv("GOLEM_LMSTUDIO_BRAIN_MODEL", val)}
                                />
                                <SettingField
                                    label="LM Studio Timeout (ms)"
                                    keyName="GOLEM_LMSTUDIO_TIMEOUT_MS"
                                    placeholder="60000"
                                    desc={t("settings.engine.lmstudio.timeout.desc")}
                                    value={env.GOLEM_LMSTUDIO_TIMEOUT_MS || ""}
                                    onChange={(val) => onChangeEnv("GOLEM_LMSTUDIO_TIMEOUT_MS", val)}
                                />
                                <SettingField
                                    label="LM Studio API Key (Optional)"
                                    keyName="GOLEM_LMSTUDIO_API_KEY"
                                    isSecret
                                    placeholder="lm-studio-api-key"
                                    desc={t("settings.engine.lmstudio.apiKey.desc")}
                                    value={env.GOLEM_LMSTUDIO_API_KEY || ""}
                                    onChange={(val) => onChangeEnv("GOLEM_LMSTUDIO_API_KEY", val)}
                                />
                                <div className="pt-1 space-y-2">
                                    <button
                                        type="button"
                                        onClick={() => testBackendConnection("lmstudio")}
                                        disabled={activeTestScope !== null}
                                        className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                                            activeTestScope !== null
                                                ? "bg-muted text-muted-foreground border-border cursor-not-allowed"
                                                : "bg-primary/15 text-primary border-primary/40 hover:bg-primary/25"
                                        }`}
                                    >
                                        {activeTestScope !== null ? t("settings.engine.connectionTest.testing") : t("settings.engine.connectionTest.button")}
                                    </button>
                                    {testErrorDetail?.scope === "backend-lmstudio" && (
                                        <div className="space-y-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                                            <p className="text-xs text-red-300 font-semibold">{t("settings.engine.connectionTest.errorDetails")}</p>
                                            <textarea
                                                readOnly
                                                value={testErrorDetail.detail}
                                                className="w-full h-24 resize-y bg-background/70 border border-border rounded-md px-2 py-1 text-[11px] text-foreground font-mono"
                                            />
                                            <button
                                                type="button"
                                                onClick={copyErrorDetail}
                                                className="px-2 py-1 rounded border border-red-400/40 text-red-200 text-[11px] hover:bg-red-500/20 transition-colors"
                                            >
                                                {t("settings.engine.connectionTest.copyError")}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                            {t("settings.engine.responseStyleTitle")}
                        </h2>
                        <SettingField
                            label={t("settings.engine.maxResponseWords.label")}
                            keyName="GOLEM_MAX_RESPONSE_WORDS"
                            placeholder="0"
                            desc={t("settings.engine.maxResponseWords.desc")}
                            value={env.GOLEM_MAX_RESPONSE_WORDS || ""}
                            onChange={(val) => onChangeEnv("GOLEM_MAX_RESPONSE_WORDS", val)}
                        />
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                            {t("settings.engine.memoryEmbeddingTitle")}
                        </h2>
                        <div className="space-y-6">
                            <SettingSelectField
                                label={t("settings.engine.memoryMode.label")}
                                desc={t("settings.engine.memoryMode.desc")}
                                value={memoryMode}
                                onChange={(val) => onChangeEnv("GOLEM_MEMORY_MODE", val)}
                                options={[
                                    { value: "lancedb-pro", label: t("settings.engine.memoryMode.option.lancedbPro") },
                                    { value: "native", label: t("settings.engine.memoryMode.option.native") }
                                ]}
                            />

                            {memoryMode === "lancedb-pro" ? (
                                <div className="pt-4 border-t border-border/50">
                                    <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
                                        <Sparkles className="w-4 h-4 text-primary" /> {t("settings.engine.embeddingConfigTitle")}
                                    </h3>

                                    <SettingSelectField
                                        label={t("settings.engine.provider.label")}
                                        desc={t("settings.engine.provider.desc")}
                                        value={getEmbeddingProvider(env.GOLEM_EMBEDDING_PROVIDER)}
                                        onChange={(val) => onChangeEnv("GOLEM_EMBEDDING_PROVIDER", val)}
                                        options={[
                                            { value: "local", label: t("settings.engine.provider.option.local") },
                                            { value: "ollama", label: t("settings.engine.provider.option.ollama") }
                                        ]}
                                    />

                                    {env.GOLEM_EMBEDDING_PROVIDER === "local" && (
                                        <div className="bg-primary/5 p-4 rounded-xl border border-primary/20 space-y-4 animate-in zoom-in-95">
                                            <SettingSelectField
                                                label={t("settings.engine.localModelSelection.label")}
                                                desc={t("settings.engine.localModelSelection.desc")}
                                                value={env.GOLEM_LOCAL_EMBEDDING_MODEL}
                                                onChange={(val) => onChangeEnv("GOLEM_LOCAL_EMBEDDING_MODEL", val)}
                                                options={localizedModels.map((model) => ({ value: model.id, label: model.name }))}
                                            />

                                            {(() => {
                                                const activeModelInfo = localizedModels.find((model) => model.id === env.GOLEM_LOCAL_EMBEDDING_MODEL);
                                                if (!activeModelInfo) return null;
                                                return (
                                                    <div className="bg-background/50 border border-border/40 rounded-lg p-3 space-y-2">
                                                        <div className="text-[11px] text-foreground/80 leading-relaxed">
                                                            <span className="font-bold text-primary">{t("settings.engine.model.featureLabel")}</span> {activeModelInfo.features}
                                                        </div>
                                                        <div className="text-[11px] text-foreground/80 leading-relaxed">
                                                            <span className="font-bold text-primary">{t("settings.engine.model.recommendationLabel")}</span> {activeModelInfo.recommendation}
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}

                                    {env.GOLEM_EMBEDDING_PROVIDER === "ollama" && (
                                        <div className="bg-cyan-500/5 p-4 rounded-xl border border-cyan-500/20 space-y-4 animate-in zoom-in-95">
                                            <SettingField
                                                label="Ollama Base URL"
                                                keyName="GOLEM_OLLAMA_BASE_URL"
                                                placeholder="http://127.0.0.1:11434"
                                                desc={t("settings.engine.ollamaEmbedding.baseUrl.desc")}
                                                value={env.GOLEM_OLLAMA_BASE_URL || ""}
                                                onChange={(val) => onChangeEnv("GOLEM_OLLAMA_BASE_URL", val)}
                                            />
                                            <SettingField
                                                label="Ollama Embedding Model"
                                                keyName="GOLEM_OLLAMA_EMBEDDING_MODEL"
                                                placeholder="nomic-embed-text"
                                                desc={t("settings.engine.ollamaEmbedding.model.desc")}
                                                value={env.GOLEM_OLLAMA_EMBEDDING_MODEL || ""}
                                                onChange={(val) => onChangeEnv("GOLEM_OLLAMA_EMBEDDING_MODEL", val)}
                                            />
                                            <SettingField
                                                label="Ollama Rerank Model (Optional)"
                                                keyName="GOLEM_OLLAMA_RERANK_MODEL"
                                                placeholder="bge-reranker-v2-m3"
                                                desc={t("settings.engine.ollamaEmbedding.rerank.desc")}
                                                value={env.GOLEM_OLLAMA_RERANK_MODEL || ""}
                                                onChange={(val) => onChangeEnv("GOLEM_OLLAMA_RERANK_MODEL", val)}
                                            />
                                            <div className="pt-1 space-y-2">
                                                <button
                                                    type="button"
                                                    onClick={testOllamaEmbeddingConnection}
                                                    disabled={activeTestScope !== null}
                                                    className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                                                        activeTestScope !== null
                                                            ? "bg-muted text-muted-foreground border-border cursor-not-allowed"
                                                            : "bg-cyan-500/15 text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/25"
                                                    }`}
                                                >
                                                    {activeTestScope !== null ? t("settings.engine.connectionTest.testing") : t("settings.engine.connectionTest.embeddingButton")}
                                                </button>
                                                {testErrorDetail?.scope === "embedding-ollama" && (
                                                    <div className="space-y-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                                                        <p className="text-xs text-red-300 font-semibold">{t("settings.engine.connectionTest.errorDetails")}</p>
                                                        <textarea
                                                            readOnly
                                                            value={testErrorDetail.detail}
                                                            className="w-full h-24 resize-y bg-background/70 border border-border rounded-md px-2 py-1 text-[11px] text-foreground font-mono"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={copyErrorDetail}
                                                            className="px-2 py-1 rounded border border-red-400/40 text-red-200 text-[11px] hover:bg-red-500/20 transition-colors"
                                                        >
                                                            {t("settings.engine.connectionTest.copyError")}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="pt-4 border-t border-border/50">
                                    <div className="bg-amber-500/5 p-4 rounded-xl border border-amber-500/20 text-xs text-amber-200/90">
                                        {t("settings.engine.embeddingConfig.nativeNotice")}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
