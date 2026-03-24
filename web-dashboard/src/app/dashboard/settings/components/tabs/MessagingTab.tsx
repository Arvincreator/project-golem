"use client";

import { SettingField } from "../SettingFields";
import { useI18n } from "@/components/I18nProvider";

type MessagingTabProps = {
    env: Record<string, string>;
    onChangeEnv: (key: string, value: string) => void;
};

export default function MessagingTab({ env, onChangeEnv }: MessagingTabProps) {
    const { t } = useI18n();

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
                        <SettingField
                            label="Admin ID"
                            keyName="DISCORD_ADMIN_ID"
                            placeholder={t("settings.messaging.discordAdmin.placeholder")}
                            isSecret
                            value={env.DISCORD_ADMIN_ID || ""}
                            onChange={(val) => onChangeEnv("DISCORD_ADMIN_ID", val)}
                        />
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
