"use client";

import { Sparkles } from "lucide-react";
import { LOCAL_MODELS, SettingField, SettingSelectField } from "../SettingFields";
import { useI18n } from "@/components/I18nProvider";

type EngineTabProps = {
    env: Record<string, string>;
    onChangeEnv: (key: string, value: string) => void;
};

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
