"use client";

import { Power } from "lucide-react";
import { SettingField } from "../SettingFields";
import { SettingSelectField } from "../SettingFields";
import { useI18n } from "@/components/I18nProvider";

type MessagingTabProps = {
    env: Record<string, string>;
    onChangeEnv: (key: string, value: string) => void;
};

export default function MessagingTab({ env, onChangeEnv }: MessagingTabProps) {
    const { t } = useI18n();
    const discordObserveAll = String(env.DISCORD_CHAT_OBSERVE_ALL ?? "true").toLowerCase() !== "false";

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-card border border-border hover:border-primary/20 transition-colors rounded-xl p-5 shadow-sm space-y-4">
                    <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                        {t("settings.messaging.telegramTitle")}
                    </h2>
                    <SettingField
                        label="Bot Token"
                        keyName="TELEGRAM_TOKEN"
                        placeholder="123456789:ABCDefgh..."
                        isSecret
                        value={env.TELEGRAM_TOKEN || ""}
                        onChange={(val) => onChangeEnv("TELEGRAM_TOKEN", val)}
                    />
                    <SettingField
                        label={t("settings.messaging.authMode.label")}
                        keyName="TG_AUTH_MODE"
                        placeholder={t("settings.messaging.authMode.placeholder")}
                        value={env.TG_AUTH_MODE || ""}
                        onChange={(val) => onChangeEnv("TG_AUTH_MODE", val)}
                    />
                    <div className="grid grid-cols-2 gap-4">
                        <SettingField
                            label="Admin ID"
                            keyName="ADMIN_ID"
                            isSecret
                            placeholder={t("settings.messaging.telegramAdmin.placeholder")}
                            value={env.ADMIN_ID || ""}
                            onChange={(val) => onChangeEnv("ADMIN_ID", val)}
                        />
                        <SettingField
                            label="Chat ID"
                            keyName="TG_CHAT_ID"
                            isSecret
                            placeholder={t("settings.messaging.telegramChat.placeholder")}
                            value={env.TG_CHAT_ID || ""}
                            onChange={(val) => onChangeEnv("TG_CHAT_ID", val)}
                        />
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="bg-card border border-border hover:border-primary/20 transition-colors rounded-xl p-5 shadow-sm">
                        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                            {t("settings.messaging.discordTitle")}
                        </h2>
                        <SettingField
                            label="Bot Token"
                            keyName="DISCORD_TOKEN"
                            placeholder={t("settings.messaging.discordToken.placeholder")}
                            isSecret
                            value={env.DISCORD_TOKEN || ""}
                            onChange={(val) => onChangeEnv("DISCORD_TOKEN", val)}
                        />
                        <SettingSelectField
                            label={t("settings.messaging.authMode.label")}
                            desc={t("settings.messaging.discordAuthMode.desc")}
                            value={env.DISCORD_AUTH_MODE || "ADMIN"}
                            onChange={(val) => onChangeEnv("DISCORD_AUTH_MODE", val)}
                            options={[
                                { value: "ADMIN", label: "ADMIN" },
                                { value: "CHAT", label: "CHAT" },
                            ]}
                        />
                        {(env.DISCORD_AUTH_MODE || "ADMIN") === "CHAT" ? (
                            <>
                                <SettingField
                                    label="Channel ID"
                                    keyName="DISCORD_CHAT_ID"
                                    placeholder={t("settings.messaging.discordChat.placeholder")}
                                    isSecret
                                    value={env.DISCORD_CHAT_ID || ""}
                                    onChange={(val) => onChangeEnv("DISCORD_CHAT_ID", val)}
                                />
                                <div className="mb-4 rounded-lg border border-border/70 bg-secondary/20 p-4">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                                <Power className="h-4 w-4 text-primary" />
                                                {t("settings.messaging.discordObserveAll.label")}
                                            </div>
                                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                                {t("settings.messaging.discordObserveAll.desc")}
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={discordObserveAll}
                                            onClick={() => onChangeEnv("DISCORD_CHAT_OBSERVE_ALL", discordObserveAll ? "false" : "true")}
                                            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
                                                discordObserveAll
                                                    ? "border-primary/40 bg-primary"
                                                    : "border-border bg-muted"
                                            }`}
                                            title={discordObserveAll ? t("settings.messaging.discordObserveAll.on") : t("settings.messaging.discordObserveAll.off")}
                                        >
                                            <span
                                                className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                                    discordObserveAll ? "translate-x-5" : "translate-x-1"
                                                }`}
                                            />
                                        </button>
                                    </div>
                                    <div className="mt-2 text-xs font-medium text-muted-foreground">
                                        {discordObserveAll ? t("settings.messaging.discordObserveAll.on") : t("settings.messaging.discordObserveAll.off")}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <SettingField
                                label="Admin ID"
                                keyName="DISCORD_ADMIN_ID"
                                placeholder={t("settings.messaging.discordAdmin.placeholder")}
                                isSecret
                                value={env.DISCORD_ADMIN_ID || ""}
                                onChange={(val) => onChangeEnv("DISCORD_ADMIN_ID", val)}
                            />
                        )}
                    </div>

                    <div className="bg-card border border-border hover:border-rose-900/20 transition-colors rounded-xl p-5 shadow-sm">
                        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                            {t("settings.messaging.moltbookTitle")}
                        </h2>
                        <SettingField
                            label="API Key"
                            keyName="MOLTBOOK_API_KEY"
                            placeholder={t("settings.messaging.moltbookApi.placeholder")}
                            isSecret
                            value={env.MOLTBOOK_API_KEY || ""}
                            onChange={(val) => onChangeEnv("MOLTBOOK_API_KEY", val)}
                        />
                        <SettingField
                            label="Agent Name"
                            keyName="MOLTBOOK_AGENT_NAME"
                            placeholder={t("settings.messaging.moltbookAgent.placeholder")}
                            value={env.MOLTBOOK_AGENT_NAME || ""}
                            onChange={(val) => onChangeEnv("MOLTBOOK_AGENT_NAME", val)}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
