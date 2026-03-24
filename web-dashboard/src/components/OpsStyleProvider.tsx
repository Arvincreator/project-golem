"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type OpsStylePreset = {
    id: string;
    rank: number;
    name: {
        zh: string;
        en: string;
    };
    profile: {
        zh: string;
        en: string;
    };
    description: {
        zh: string;
        en: string;
    };
    swatches: [string, string, string];
};

const STORAGE_KEY = "golem-ops-style";
const DEFAULT_PRESET_ID = "ops-command";

export const OPS_STYLE_PRESETS: OpsStylePreset[] = [
    {
        id: "ops-command",
        rank: 1,
        name: { zh: "指揮中心藍", en: "Ops Command Blue" },
        profile: { zh: "最佳實踐 · 綜合平衡", en: "Best Practice · Balanced" },
        description: { zh: "維運團隊首選，對比清晰、警示明確、長時間觀看最穩定。", en: "Recommended for NOC operations with stable contrast and clear alert hierarchy." },
        swatches: ["#38bdf8", "#14b8a6", "#0f172a"],
    },
    {
        id: "noc-graphite",
        rank: 2,
        name: { zh: "石墨監控", en: "NOC Graphite" },
        profile: { zh: "高密度 · 低干擾", en: "High Density · Low Noise" },
        description: { zh: "偏中性灰階，適合多螢幕牆和長時間值班。", en: "Neutral grayscale layout suitable for multi-screen walls and long shifts." },
        swatches: ["#94a3b8", "#475569", "#111827"],
    },
    {
        id: "emerald-grid",
        rank: 3,
        name: { zh: "綠域網格", en: "Emerald Grid" },
        profile: { zh: "健康導向 · 異常突顯", en: "Health-led · Alert Focus" },
        description: { zh: "正常狀態用綠色系，異常訊號更容易被辨識。", en: "Healthy state emphasizes green, making anomalies stand out quickly." },
        swatches: ["#34d399", "#10b981", "#052e2b"],
    },
    {
        id: "arctic-cyan",
        rank: 4,
        name: { zh: "極地青鋒", en: "Arctic Cyan" },
        profile: { zh: "專注分析 · 清爽高對比", en: "Analytic Focus · Crisp Contrast" },
        description: { zh: "清冷色調，適合技術分析和資料追蹤。", en: "Cool cyan palette optimized for technical analysis and data tracking." },
        swatches: ["#22d3ee", "#06b6d4", "#0c1c27"],
    },
    {
        id: "amber-watch",
        rank: 5,
        name: { zh: "琥珀警戒", en: "Amber Watch" },
        profile: { zh: "告警友善 · 風險管理", en: "Alert-friendly · Risk Control" },
        description: { zh: "偏橙色監控風格，適合風險審核與事件值守。", en: "Amber-centric style for risk review and incident watch duty." },
        swatches: ["#f59e0b", "#f97316", "#1f1305"],
    },
    {
        id: "ruby-incident",
        rank: 6,
        name: { zh: "赤焰事故", en: "Ruby Incident" },
        profile: { zh: "事故應變 · 高警示", en: "Incident Response · High Alert" },
        description: { zh: "強警示配色，適合故障排查與 war room 情境。", en: "Aggressive alert palette for incident response and war-room operations." },
        swatches: ["#fb7185", "#ef4444", "#2b0a12"],
    },
    {
        id: "indigo-sentry",
        rank: 7,
        name: { zh: "靛藍哨兵", en: "Indigo Sentry" },
        profile: { zh: "策略視圖 · 議題導向", en: "Strategic View · Topic-led" },
        description: { zh: "適合偏策略監控、排程與長期趨勢分析。", en: "Great for strategic monitoring, scheduling, and long-term trend tracking." },
        swatches: ["#818cf8", "#6366f1", "#161634"],
    },
    {
        id: "violet-orbit",
        rank: 8,
        name: { zh: "紫軌監測", en: "Violet Orbit" },
        profile: { zh: "研發觀測 · 高辨識", en: "R&D Monitoring · Distinctive" },
        description: { zh: "色彩辨識強，適合多模組同時觀測。", en: "Highly distinguishable palette for simultaneous multi-module monitoring." },
        swatches: ["#a78bfa", "#8b5cf6", "#23163a"],
    },
    {
        id: "slate-storm",
        rank: 9,
        name: { zh: "暴風石板", en: "Slate Storm" },
        profile: { zh: "極簡運維 · 安靜介面", en: "Minimal Ops · Quiet UI" },
        description: { zh: "低飽和主題，降低視覺疲勞。", en: "Low saturation palette that minimizes visual fatigue." },
        swatches: ["#cbd5e1", "#64748b", "#0f172a"],
    },
    {
        id: "solar-dawn",
        rank: 10,
        name: { zh: "晨曦運維", en: "Solar Dawn" },
        profile: { zh: "亮色值班 · 日間模式", en: "Light Shift · Day Mode" },
        description: { zh: "亮色維運模板，適合白天辦公與報表展示。", en: "Bright operations template ideal for daytime reporting and office use." },
        swatches: ["#2563eb", "#0ea5e9", "#f8fafc"],
    },
    {
        id: "teal-nightshift",
        rank: 11,
        name: { zh: "夜班深青", en: "Teal Nightshift" },
        profile: { zh: "夜班值守 · 護眼對比", en: "Night Shift · Eye-friendly" },
        description: { zh: "深青色護眼主題，適合夜間值班。", en: "Low-glare teal palette tailored for overnight monitoring." },
        swatches: ["#14b8a6", "#0d9488", "#042f2e"],
    },
    {
        id: "gold-control",
        rank: 12,
        name: { zh: "金曜控制", en: "Gold Control" },
        profile: { zh: "高階展示 · 決策儀表", en: "Executive Display · Decision Deck" },
        description: { zh: "金色點綴配色，適合管理層展示與戰情簡報。", en: "Gold-accented palette designed for executive briefings and control rooms." },
        swatches: ["#fbbf24", "#f59e0b", "#1c1917"],
    },
];

type OpsStyleContextValue = {
    presetId: string;
    preset: OpsStylePreset;
    presets: OpsStylePreset[];
    setPresetId: (id: string) => void;
    resetToRecommended: () => void;
};

const OpsStyleContext = createContext<OpsStyleContextValue | null>(null);

function getPresetById(id: string): OpsStylePreset {
    return OPS_STYLE_PRESETS.find((preset) => preset.id === id) ?? OPS_STYLE_PRESETS[0];
}

export function OpsStyleProvider({ children }: { children: React.ReactNode }) {
    const [presetId, setPresetIdState] = useState<string>(() => {
        if (typeof window === "undefined") return DEFAULT_PRESET_ID;
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? getPresetById(stored).id : DEFAULT_PRESET_ID;
    });

    useEffect(() => {
        const root = document.documentElement;
        root.setAttribute("data-ops-style", presetId);
        localStorage.setItem(STORAGE_KEY, presetId);
    }, [presetId]);

    const preset = useMemo(() => getPresetById(presetId), [presetId]);
    const presets = useMemo(() => [...OPS_STYLE_PRESETS].sort((a, b) => a.rank - b.rank), []);

    const value = useMemo<OpsStyleContextValue>(() => ({
        presetId,
        preset,
        presets,
        setPresetId: (id) => setPresetIdState(getPresetById(id).id),
        resetToRecommended: () => setPresetIdState(DEFAULT_PRESET_ID),
    }), [preset, presetId, presets]);

    return (
        <OpsStyleContext.Provider value={value}>
            {children}
        </OpsStyleContext.Provider>
    );
}

export function useOpsStyle() {
    const context = useContext(OpsStyleContext);
    if (!context) {
        throw new Error("useOpsStyle must be used within OpsStyleProvider");
    }
    return context;
}
