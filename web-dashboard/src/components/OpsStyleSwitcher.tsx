"use client";

import { Check, Palette, Sparkles, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "./I18nProvider";
import { useOpsStyle } from "./OpsStyleProvider";

export function OpsStyleSwitcher() {
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    const { presetId, preset, presets, setPresetId, resetToRecommended } = useOpsStyle();

    return (
        <details className="w-full rounded-xl border border-border bg-secondary/45 p-2 open:bg-secondary/65 transition-colors">
            <summary className="list-none cursor-pointer select-none">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-lg border border-border bg-background flex items-center justify-center text-primary shrink-0">
                            <Palette className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
                                {isEnglish ? "Ops Style" : "維運風格"}
                            </p>
                            <p className="text-xs font-semibold text-foreground truncate">
                                #{preset.rank} {isEnglish ? preset.name.en : preset.name.zh}
                            </p>
                        </div>
                    </div>
                    <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
            </summary>

            <div className="mt-3 pt-3 border-t border-border/70 space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                {presets.map((item) => {
                    const active = presetId === item.id;
                    const label = isEnglish ? item.name.en : item.name.zh;
                    const profile = isEnglish ? item.profile.en : item.profile.zh;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => setPresetId(item.id)}
                            className={cn(
                                "w-full rounded-lg border px-2.5 py-2 text-left transition-colors",
                                active
                                    ? "bg-primary/12 border-primary/35"
                                    : "bg-background/45 border-border hover:bg-background/75"
                            )}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                                            #{item.rank}
                                        </span>
                                        {item.rank <= 3 && (
                                            <span className="inline-flex items-center gap-1 text-[10px] text-amber-400">
                                                <Star className="w-3 h-3" />
                                                {isEnglish ? "Top Rank" : "推薦排行"}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm font-semibold text-foreground truncate mt-0.5">{label}</p>
                                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{profile}</p>
                                </div>

                                <div className="shrink-0 flex items-center gap-1">
                                    {item.swatches.map((swatch) => (
                                        <span
                                            key={swatch}
                                            className="w-3 h-3 rounded-full border border-white/20"
                                            style={{ backgroundColor: swatch }}
                                        />
                                    ))}
                                    {active && (
                                        <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground inline-flex items-center justify-center ml-1">
                                            <Check className="w-3 h-3" />
                                        </span>
                                    )}
                                </div>
                            </div>
                        </button>
                    );
                })}

                <button
                    type="button"
                    onClick={resetToRecommended}
                    className="w-full h-8 rounded-lg border border-border bg-background/50 hover:bg-background/80 text-xs font-semibold text-foreground transition-colors"
                >
                    {isEnglish ? "Reset to Best Practice (#1)" : "重設為最佳實踐（#1）"}
                </button>
            </div>
        </details>
    );
}

