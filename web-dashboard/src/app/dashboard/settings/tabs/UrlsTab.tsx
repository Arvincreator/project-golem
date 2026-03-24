"use client";

import React, { useState, useEffect } from "react";
import { 
    Plus, Trash2, AlertCircle, 
    Globe, ShieldCheck, ExternalLink,
    AlertTriangle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/I18nProvider";

interface UrlsTabProps {
    geminiUrls: string;
    onChange: (newValue: string) => void;
}

function normalizeUrls(raw: string): string[] {
    const urlArray = raw ? raw.split(",").map((url) => url.trim()) : [];
    if (urlArray.length === 0 || (urlArray.length === 1 && !urlArray[0])) {
        return ["https://gemini.google.com/app"];
    }
    return urlArray;
}

export default function UrlsTab({ geminiUrls, onChange }: UrlsTabProps) {
    const { t } = useI18n();
    // Current URLs as an array
    const [urls, setUrls] = useState<string[]>(() => normalizeUrls(geminiUrls));
    
    // Sync URLs from parent config without triggering sync setState in effect
    useEffect(() => {
        const nextUrls = normalizeUrls(geminiUrls);
        const rafId = requestAnimationFrame(() => {
            setUrls((prev) => {
                if (prev.length === nextUrls.length && prev.every((value, index) => value === nextUrls[index])) {
                    return prev;
                }
                return nextUrls;
            });
        });
        return () => cancelAnimationFrame(rafId);
    }, [geminiUrls]);

    const handleUpdateUrls = (newUrls: string[]) => {
        setUrls(newUrls);
        onChange(newUrls.join(','));
    };

    const addUrl = () => {
        // Validation: Ensure all existing URLs are not empty before adding a new one
        const hasEmptyUrl = urls.some(url => !url.trim());
        if (hasEmptyUrl) return;
        
        handleUpdateUrls([...urls, ""]);
    };

    const removeUrl = (index: number) => {
        const newUrls = urls.filter((_, i) => i !== index);
        if (newUrls.length === 0) {
            handleUpdateUrls(["https://gemini.google.com/app"]);
        } else {
            handleUpdateUrls(newUrls);
        }
    };

    const updateUrlValue = (index: number, value: string) => {
        const newUrls = [...urls];
        newUrls[index] = value;
        handleUpdateUrls(newUrls);
    };

    const isAddDisabled = urls.some(url => !url.trim());

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto space-y-6">
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                            {t("settings.urls.title")}
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                            {t("settings.urls.subtitle")}
                        </p>
                    </div>
                    <button
                        onClick={addUrl}
                        disabled={isAddDisabled}
                        className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                            isAddDisabled 
                                ? "bg-secondary text-muted-foreground cursor-not-allowed border border-border opacity-50" 
                                : "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20"
                        )}
                        title={isAddDisabled ? t("settings.urls.addDisabledTitle") : t("settings.urls.addTitle")}
                    >
                        <Plus className="w-3.5 h-3.5" />
                        {t("settings.urls.add")}
                    </button>
                </div>

                <div className="space-y-3">
                    {urls.map((url, index) => (
                        <div key={index} className="group flex items-center gap-3 animate-in fade-in zoom-in-95 duration-200">
                            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-secondary/50 text-muted-foreground shrink-0 font-mono text-xs">
                                {index + 1}
                            </div>
                            
                            <div className="relative flex-1">
                                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                                <input
                                    type="text"
                                    value={url}
                                    onChange={(e) => updateUrlValue(index, e.target.value)}
                                    placeholder="https://gemini.google.com/app"
                                    className={cn(
                                        "w-full bg-secondary/30 border rounded-lg pl-9 pr-3 py-2 text-sm text-foreground font-mono transition-colors",
                                        !url.trim() ? "border-amber-500/50 focus:border-amber-500" : "border-border focus:border-primary"
                                    )}
                                />
                                {url && (
                                    <a 
                                        href={url} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
                                    >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                )}
                            </div>

                            <button
                                onClick={() => removeUrl(index)}
                                className={cn(
                                    "p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all",
                                    urls.length <= 1 && "opacity-20 cursor-not-allowed grayscale"
                                )}
                                disabled={urls.length <= 1}
                                title={t("settings.urls.deleteTitle")}
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                    
                    {isAddDisabled && (
                        <p className="text-[10px] text-amber-500 mt-2 flex items-center gap-1 animate-pulse">
                            <AlertCircle className="w-3 h-3" /> {t("settings.urls.fillAllBeforeAdd")}
                        </p>
                    )}
                </div>

                <div className="mt-8 pt-6 border-t border-border">
                    <div className="bg-primary/5 p-4 rounded-xl border border-primary/20">
                        <h4 className="text-xs font-bold text-primary flex items-center gap-2 mb-3">
                            <AlertCircle className="w-3.5 h-3.5" /> {t("settings.urls.guideTitle")}
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <h5 className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
                                    <ShieldCheck className="w-3 h-3 text-emerald-500" /> {t("settings.urls.failoverTitle")}
                                </h5>
                                <p className="text-[11px] text-muted-foreground leading-relaxed">
                                    {t("settings.urls.failoverDesc")}
                                </p>
                            </div>
                            <div className="space-y-2">
                                <h5 className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
                                    <Globe className="w-3 h-3 text-blue-500" /> {t("settings.urls.localeTitle")}
                                </h5>
                                <p className="text-[11px] text-muted-foreground leading-relaxed">
                                    {t("settings.urls.localeDesc")} <code className="bg-secondary px-1 rounded">?hl=zh-TW</code>
                                </p>
                            </div>
                        </div>
                        <div className="mt-4 pt-3 border-t border-primary/10">
                            <h5 className="text-[10px] font-bold text-primary uppercase tracking-wider mb-2">{t("settings.urls.recommendedTitle")}</h5>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { label: t("settings.urls.recommended.standard"), url: "https://gemini.google.com/app" },
                                    { label: t("settings.urls.recommended.zhTW"), url: "https://gemini.google.com/app?hl=zh-TW" },
                                    { label: t("settings.urls.recommended.english"), url: "https://gemini.google.com/app?hl=en" }
                                ].map((rec, i) => (
                                    <button 
                                        key={i}
                                        onClick={() => {
                                            if (!urls.includes(rec.url)) {
                                                const currentUrls = urls.filter(u => u.trim() !== "");
                                                handleUpdateUrls([...currentUrls, rec.url]);
                                            }
                                        }}
                                        className="text-[10px] bg-background border border-border/50 hover:border-primary/40 px-2 py-1 rounded transition-colors text-muted-foreground hover:text-primary flex items-center gap-1"
                                    >
                                        <Plus className="w-2.5 h-2.5" /> {rec.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Warning Section */}
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                <div className="space-y-1">
                    <h4 className="text-sm font-bold text-amber-500">{t("settings.urls.noticeTitle")}</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        {t("settings.urls.noticeDesc")}
                    </p>
                </div>
            </div>
        </div>
    );
}
