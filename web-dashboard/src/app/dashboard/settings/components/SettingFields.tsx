"use client";

import { useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";

export const LOCAL_MODELS = [
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

export const SettingField = ({
    label, desc = "", keyName,
    isReadOnly = false, isSecret = false, value = "", onChange,
    type = "text", placeholder = ""
}: {
    label: string,
    desc?: string,
    isReadOnly?: boolean, isSecret?: boolean, value?: string, onChange?: (val: string) => void,
    type?: string, placeholder?: string, keyName?: string
}) => {
    const { t } = useI18n();
    const [isVisible, setIsVisible] = useState(false);
    const inputType = (isSecret && !isVisible) ? "password" : type;

    return (
        <div className="flex flex-col mb-4">
            <label className="text-sm font-medium text-muted-foreground mb-1 flex items-center justify-between gap-1 overflow-hidden">
                <span className="truncate mr-1" title={label}>{label}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                    {isReadOnly && (
                        <span className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded border border-border flex items-center gap-1 whitespace-nowrap">
                            <Lock className="w-3 h-3" /> {t("settingField.readOnly")}
                        </span>
                    )}
                </div>
            </label>
            <div className="relative">
                <input
                    type={inputType}
                    value={value}
                    onChange={(e) => {
                        if (onChange) {
                            onChange(e.target.value);
                        }
                    }}
                    placeholder={placeholder}
                    disabled={isReadOnly}
                    className={`w-full bg-secondary/30 border border-border focus:border-primary rounded-lg px-3 py-2 text-sm text-foreground font-mono transition-colors ${isReadOnly ? "opacity-70 cursor-not-allowed bg-muted" : ""} ${isSecret ? "pr-10" : ""}`}
                    spellCheck={false}
                    data-keyname={keyName}
                />
                {isSecret && (
                    <button
                        type="button"
                        onClick={() => setIsVisible(!isVisible)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                        title={isVisible ? t("settingField.hideContent") : t("settingField.showContent")}
                    >
                        {isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                )}
            </div>
            {desc && <p className="text-xs text-muted-foreground mt-1">{desc}</p>}
        </div>
    );
};

export const SettingSelectField = ({
    label, desc = "", value = "", onChange, options = []
}: {
    label: string,
    desc?: string,
    value?: string,
    onChange?: (val: string) => void,
    options: { value: string, label: string }[]
}) => {
    return (
        <div className="flex flex-col mb-4">
            <label className="text-sm font-medium text-muted-foreground mb-1 flex items-center justify-between gap-1 overflow-hidden">
                <span className="truncate mr-1" title={label}>{label}</span>
            </label>
            <select
                value={value}
                onChange={(e) => {
                    if (onChange) onChange(e.target.value);
                }}
                className="w-full bg-secondary/30 border border-border focus:border-primary rounded-lg px-3 py-2 text-sm text-foreground transition-colors"
            >
                {options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
            {desc && <p className="text-xs text-muted-foreground mt-1">{desc}</p>}
        </div>
    );
};
