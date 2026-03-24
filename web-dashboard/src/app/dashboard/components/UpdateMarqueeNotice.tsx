"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, BellRing } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { useI18n } from "@/components/I18nProvider";

type UpdateInfo = {
    remoteVersion?: string;
    isOutdated?: boolean;
    installMode: string;
    gitInfo?: {
        currentBranch: string;
        behindCount: number;
    };
};

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function resolveUpdateMessage(
    updateInfo: UpdateInfo | null,
    t: (key: "updateMarquee.gitBehind" | "updateMarquee.newVersionKnown" | "updateMarquee.newVersionUnknown", params?: Record<string, string | number>) => string
): string | null {
    if (!updateInfo) return null;

    if (updateInfo.installMode === "git") {
        const behindCount = updateInfo.gitInfo?.behindCount ?? 0;
        if (behindCount > 0) {
            const branch = updateInfo.gitInfo?.currentBranch || "main";
            return t("updateMarquee.gitBehind", { branch, count: behindCount });
        }
        return null;
    }

    if (!updateInfo.isOutdated) return null;

    const remoteVersion = updateInfo.remoteVersion;
    if (remoteVersion && remoteVersion !== "Unknown") {
        return t("updateMarquee.newVersionKnown", { version: remoteVersion });
    }
    return t("updateMarquee.newVersionUnknown");
}

export default function UpdateMarqueeNotice() {
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const { t } = useI18n();

    const fetchUpdateInfo = useCallback(async () => {
        try {
            const info = await apiGet<UpdateInfo>("/api/system/update/check");
            setUpdateInfo(info);
        } catch {
            // Keep the dashboard usable even when update-check endpoint is temporarily unavailable.
        }
    }, []);

    useEffect(() => {
        void fetchUpdateInfo();
    }, [fetchUpdateInfo]);

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            if (document.visibilityState !== "visible") return;
            void fetchUpdateInfo();
        }, REFRESH_INTERVAL_MS);

        return () => window.clearInterval(intervalId);
    }, [fetchUpdateInfo]);

    const message = useMemo(() => resolveUpdateMessage(updateInfo, t), [updateInfo, t]);

    if (!message) return null;

    return (
        <Link
            href="/dashboard/settings"
            className="group block rounded-2xl border border-amber-400/45 bg-gradient-to-r from-amber-500/16 via-orange-500/12 to-amber-500/16 px-4 py-2.5 shadow-lg shadow-amber-950/30 hover:from-amber-500/24 hover:via-orange-500/16 hover:to-amber-500/24 transition-colors"
        >
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 shrink-0 text-amber-800 dark:text-amber-200">
                    <div className="w-7 h-7 rounded-lg border border-amber-500/35 bg-amber-200/20 flex items-center justify-center">
                        <BellRing className="w-4 h-4" />
                    </div>
                    <span className="text-[11px] font-semibold tracking-wide uppercase">{t("updateMarquee.tag")}</span>
                </div>

                <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="dashboard-update-marquee-track group-hover:[animation-play-state:paused]">
                        <span className="pr-10 text-sm font-semibold text-amber-900 dark:text-amber-100">{message}</span>
                        <span aria-hidden className="pr-10 text-sm font-semibold text-amber-900 dark:text-amber-100">{message}</span>
                    </div>
                </div>

                <div className="shrink-0 hidden sm:flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-200">
                    {t("updateMarquee.gotoSettingsSummary")}
                    <ArrowRight className="w-3.5 h-3.5" />
                </div>
            </div>
        </Link>
    );
}
