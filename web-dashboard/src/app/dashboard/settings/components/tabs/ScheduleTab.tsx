"use client";

import { Power } from "lucide-react";
import { SettingField } from "../SettingFields";
import { useI18n } from "@/components/I18nProvider";

type ScheduleTabProps = {
    env: Record<string, string>;
    onChangeEnv: (key: string, value: string) => void;
};

export default function ScheduleTab({ env, onChangeEnv }: ScheduleTabProps) {
    const { t } = useI18n();
    const autonomyEnabled = String(env.GOLEM_AUTONOMY_ENABLED ?? "true").toLowerCase() !== "false";

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto">
            <div className="bg-card border border-border hover:border-primary/30 transition-colors rounded-xl p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                    {t("settings.schedule.title")}
                </h2>
                <div className="mb-5 rounded-lg border border-border/70 bg-secondary/20 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <Power className="h-4 w-4 text-primary" />
                                {t("settings.schedule.autonomyEnabled.label")}
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                {t("settings.schedule.autonomyEnabled.desc")}
                            </p>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={autonomyEnabled}
                            onClick={() => onChangeEnv("GOLEM_AUTONOMY_ENABLED", autonomyEnabled ? "false" : "true")}
                            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
                                autonomyEnabled
                                    ? "border-primary/40 bg-primary"
                                    : "border-border bg-muted"
                            }`}
                            title={autonomyEnabled ? t("settings.schedule.autonomyEnabled.on") : t("settings.schedule.autonomyEnabled.off")}
                        >
                            <span
                                className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                    autonomyEnabled ? "translate-x-5" : "translate-x-1"
                                }`}
                            />
                        </button>
                    </div>
                    <div className="mt-2 text-xs font-medium text-muted-foreground">
                        {autonomyEnabled ? t("settings.schedule.autonomyEnabled.on") : t("settings.schedule.autonomyEnabled.off")}
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <SettingField
                        label={t("settings.schedule.awakeMin.label")}
                        keyName="GOLEM_AWAKE_INTERVAL_MIN"
                        placeholder="10"
                        desc={t("settings.schedule.awakeMin.desc")}
                        value={env.GOLEM_AWAKE_INTERVAL_MIN || ""}
                        onChange={(val) => onChangeEnv("GOLEM_AWAKE_INTERVAL_MIN", val)}
                    />
                    <SettingField
                        label={t("settings.schedule.awakeMax.label")}
                        keyName="GOLEM_AWAKE_INTERVAL_MAX"
                        placeholder="10080"
                        desc={t("settings.schedule.awakeMax.desc")}
                        value={env.GOLEM_AWAKE_INTERVAL_MAX || ""}
                        onChange={(val) => onChangeEnv("GOLEM_AWAKE_INTERVAL_MAX", val)}
                    />
                    <SettingField
                        label={t("settings.schedule.sleepStart.label")}
                        keyName="GOLEM_SLEEP_START"
                        placeholder="23:00"
                        desc={t("settings.schedule.sleepStart.desc")}
                        value={env.GOLEM_SLEEP_START || ""}
                        onChange={(val) => onChangeEnv("GOLEM_SLEEP_START", val)}
                    />
                    <SettingField
                        label={t("settings.schedule.sleepEnd.label")}
                        keyName="GOLEM_SLEEP_END"
                        placeholder="07:00"
                        desc={t("settings.schedule.sleepEnd.desc")}
                        value={env.GOLEM_SLEEP_END || ""}
                        onChange={(val) => onChangeEnv("GOLEM_SLEEP_END", val)}
                    />
                </div>
                <div className="mt-4">
                    <SettingField
                        label={t("settings.schedule.interests.label")}
                        keyName="USER_INTERESTS"
                        placeholder={t("settings.schedule.interests.placeholder")}
                        desc={t("settings.schedule.interests.desc")}
                        value={env.USER_INTERESTS || ""}
                        onChange={(val) => onChangeEnv("USER_INTERESTS", val)}
                    />
                </div>
            </div>
        </div>
    );
}
