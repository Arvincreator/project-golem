"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { i18nMessages, Locale, TranslationKey } from "@/lib/i18n/messages";

type TranslateParams = Record<string, string | number>;

type I18nContextType = {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    toggleLocale: () => void;
    t: (key: TranslationKey, params?: TranslateParams) => string;
};

const STORAGE_KEY = "golem-locale";
const DEFAULT_LOCALE: Locale = "zh-TW";

const I18nContext = createContext<I18nContextType | undefined>(undefined);

function isSupportedLocale(locale: string | null): locale is Locale {
    return locale === "zh-TW" || locale === "en";
}

function resolveInitialLocale(): Locale {
    if (typeof window === "undefined") return DEFAULT_LOCALE;

    const stored = localStorage.getItem(STORAGE_KEY);
    if (isSupportedLocale(stored)) return stored;

    const browserLanguage = String(window.navigator.language || "").toLowerCase();
    if (browserLanguage.startsWith("zh")) return "zh-TW";
    return "en";
}

function interpolate(template: string, params?: TranslateParams): string {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, token: string) => {
        const value = params[token];
        return value === undefined ? match : String(value);
    });
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>(() => resolveInitialLocale());

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, locale);
        document.documentElement.lang = locale;
    }, [locale]);

    const setLocale = useCallback((nextLocale: Locale) => {
        setLocaleState(nextLocale);
    }, []);

    const toggleLocale = useCallback(() => {
        setLocaleState((prev) => (prev === "zh-TW" ? "en" : "zh-TW"));
    }, []);

    const t = useCallback((key: TranslationKey, params?: TranslateParams) => {
        const localeMessages = i18nMessages[locale];
        const fallbackMessages = i18nMessages[DEFAULT_LOCALE];
        const template = localeMessages[key] ?? fallbackMessages[key] ?? key;
        return interpolate(template, params);
    }, [locale]);

    const contextValue = useMemo(() => ({
        locale,
        setLocale,
        toggleLocale,
        t,
    }), [locale, setLocale, toggleLocale, t]);

    return (
        <I18nContext.Provider value={contextValue}>
            {children}
        </I18nContext.Provider>
    );
}

export function useI18n(): I18nContextType {
    const context = useContext(I18nContext);
    if (!context) {
        throw new Error("useI18n must be used within an I18nProvider");
    }
    return context;
}
