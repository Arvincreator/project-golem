"use client";

import { SettingField, SettingSelectField } from "../SettingFields";
import { useI18n } from "@/components/I18nProvider";

type TgAdvancedTabProps = {
    env: Record<string, string>;
    onChangeEnv: (key: string, value: string) => void;
};

export default function TgAdvancedTab({ env, onChangeEnv }: TgAdvancedTabProps) {
    const { t } = useI18n();

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto">
            <div className="bg-card border border-border hover:border-primary/30 transition-colors rounded-xl p-5 shadow-sm space-y-6">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    {t("settings.tgAdvanced.title")}
                </h2>
                <SettingSelectField
                    label={t("settings.tgAdvanced.engineMode.label")}
                    desc={t("settings.tgAdvanced.engineMode.desc")}
                    value={env.TG_ENGINE || "grammy"}
                    onChange={(val) => onChangeEnv("TG_ENGINE", val)}
                    options={[
                        { value: "grammy", label: t("settings.tgAdvanced.engineMode.option.grammy") },
                        { value: "legacy", label: t("settings.tgAdvanced.engineMode.option.legacy") }
                    ]}
                />

                <div className="pt-4 border-t border-border">
                    <h3 className="text-sm font-bold text-foreground mb-4">{t("settings.tgAdvanced.breaker.title")}</h3>
                    <p className="text-xs text-muted-foreground mb-4">{t("settings.tgAdvanced.breaker.desc")}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SettingField
                            label={t("settings.tgAdvanced.breaker.timeout.label")}
                            keyName="CB_TG_TIMEOUT_MS"
                            placeholder="10000"
                            desc={t("settings.tgAdvanced.breaker.timeout.desc")}
                            value={env.CB_TG_TIMEOUT_MS || ""}
                            onChange={(val) => onChangeEnv("CB_TG_TIMEOUT_MS", val)}
                        />
                        <SettingField
                            label={t("settings.tgAdvanced.breaker.reset.label")}
                            keyName="CB_TG_RESET_MS"
                            placeholder="15000"
                            desc={t("settings.tgAdvanced.breaker.reset.desc")}
                            value={env.CB_TG_RESET_MS || ""}
                            onChange={(val) => onChangeEnv("CB_TG_RESET_MS", val)}
                        />
                    </div>
                    <div className="mt-4">
                        <SettingField
                            label={t("settings.tgAdvanced.breaker.errorPct.label")}
                            keyName="CB_TG_ERROR_PCT"
                            placeholder="30"
                            desc={t("settings.tgAdvanced.breaker.errorPct.desc")}
                            value={env.CB_TG_ERROR_PCT || ""}
                            onChange={(val) => onChangeEnv("CB_TG_ERROR_PCT", val)}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
