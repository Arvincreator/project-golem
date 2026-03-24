"use client";

import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { Locale } from "@/lib/i18n/messages";
import { useI18n } from "./I18nProvider";

const SUPPORTED_LOCALES: Locale[] = ["zh-TW", "en"];

export function LanguageToggle() {
    const { locale, setLocale, t } = useI18n();

    return (
        <div className="w-full bg-secondary/60 border border-border rounded-lg p-1 flex items-center gap-1">
            <div className="w-7 h-7 rounded-md bg-background border border-border flex items-center justify-center text-muted-foreground shrink-0">
                <Languages className="w-3.5 h-3.5" />
            </div>

            <div className="flex-1 grid grid-cols-2 gap-1">
                {SUPPORTED_LOCALES.map((supportedLocale) => {
                    const active = locale === supportedLocale;
                    const label = supportedLocale === "zh-TW"
                        ? t("language.zhTW")
                        : t("language.en");
                    return (
                        <button
                            key={supportedLocale}
                            onClick={() => setLocale(supportedLocale)}
                            className={cn(
                                "h-7 text-[11px] font-semibold rounded-md transition-colors px-2 truncate",
                                active
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:text-foreground hover:bg-background/60"
                            )}
                            aria-pressed={active}
                            title={label}
                        >
                            {supportedLocale === "zh-TW" ? "繁中" : "EN"}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
