"use client";

import { RefreshCw } from "lucide-react";
import { SettingField } from "../SettingFields";
import { LogInfo } from "../../types";
import { useI18n } from "@/components/I18nProvider";

type AdvancedTabProps = {
    env: Record<string, string>;
    logInfo: LogInfo | null;
    onChangeEnv: (key: string, value: string) => void;
};

const EDITABLE_KEYS = new Set([
    "GEMINI_API_KEYS", "TELEGRAM_TOKEN", "TG_AUTH_MODE", "ADMIN_ID", "TG_CHAT_ID",
    "DISCORD_TOKEN", "DISCORD_ADMIN_ID", "USER_DATA_DIR", "GOLEM_TEST_MODE",
    "GOLEM_MODE", "GOLEM_MEMORY_MODE", "GOLEM_EMBEDDING_PROVIDER", "GOLEM_LOCAL_EMBEDDING_MODEL", "GITHUB_REPO",
    "GOLEM_OLLAMA_BASE_URL", "GOLEM_OLLAMA_BRAIN_MODEL", "GOLEM_OLLAMA_EMBEDDING_MODEL", "GOLEM_OLLAMA_RERANK_MODEL", "GOLEM_OLLAMA_TIMEOUT_MS",
    "GOLEM_LMSTUDIO_BASE_URL", "GOLEM_LMSTUDIO_BRAIN_MODEL", "GOLEM_LMSTUDIO_TIMEOUT_MS", "GOLEM_LMSTUDIO_API_KEY",
    "MOLTBOOK_API_KEY", "MOLTBOOK_AGENT_NAME",
    "GOLEM_AWAKE_INTERVAL_MIN", "GOLEM_AWAKE_INTERVAL_MAX",
    "GOLEM_SLEEP_START", "GOLEM_SLEEP_END", "USER_INTERESTS", "COMMAND_WHITELIST", "CUSTOM_COMMANDS",
    "ENABLE_LOG_NOTIFICATIONS", "ARCHIVE_CHECK_INTERVAL", "ARCHIVE_THRESHOLD_YESTERDAY", "ARCHIVE_THRESHOLD_TODAY",
    "LOG_MAX_SIZE_MB", "LOG_RETENTION_DAYS", "ENABLE_SYSTEM_LOG", "GOLEM_BACKEND", "GOLEM_STRICT_SAFEGUARD",
    "DIARY_RAW_RETENTION_DAYS", "DIARY_WEEKLY_RETENTION_DAYS", "DIARY_MONTHLY_RETENTION_DAYS", "DIARY_ROTATE_MIN_INTERVAL_MS",
    "DIARY_BACKUP_MAX_FILES", "DIARY_BACKUP_RETENTION_DAYS",
    "GOLEM_INTERVENTION_LEVEL", "GOLEM_MAX_AUTO_TURNS", "GOLEM_MAX_RESPONSE_WORDS",
    "TG_ENGINE", "CB_TG_TIMEOUT_MS", "CB_TG_RESET_MS", "CB_TG_ERROR_PCT",
    "MULTI_AGENT_WORKER_SEND_TIMEOUT_MS", "MULTI_AGENT_WORKER_IDLE_TIMEOUT_MS", "MULTI_AGENT_WORKER_DRAFT_CHECK_INTERVAL_MS"
]);

export default function AdvancedTab({ env, logInfo, onChangeEnv }: AdvancedTabProps) {
    const { t } = useI18n();

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-6">
                    <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                        {t("settings.advanced.title")}
                    </h2>

                    <div className="space-y-4">
                        <SettingField
                            label={t("settings.advanced.testMode.label")}
                            keyName="GOLEM_TEST_MODE"
                            desc={t("settings.advanced.testMode.desc")}
                            placeholder="false"
                            value={env.GOLEM_TEST_MODE || ""}
                            onChange={(val) => onChangeEnv("GOLEM_TEST_MODE", val)}
                        />
                        <SettingField
                            label={t("settings.advanced.maintenanceNotify.label")}
                            keyName="ENABLE_LOG_NOTIFICATIONS"
                            desc={t("settings.advanced.maintenanceNotify.desc")}
                            placeholder="false"
                            value={env.ENABLE_LOG_NOTIFICATIONS || ""}
                            onChange={(val) => onChangeEnv("ENABLE_LOG_NOTIFICATIONS", val)}
                        />
                        <SettingField
                            label={t("settings.advanced.archiveCheckInterval.label")}
                            keyName="ARCHIVE_CHECK_INTERVAL"
                            placeholder="30"
                            value={env.ARCHIVE_CHECK_INTERVAL || ""}
                            onChange={(val) => onChangeEnv("ARCHIVE_CHECK_INTERVAL", val)}
                        />
                        <div className="rounded-lg border border-border/70 bg-secondary/20 p-3 space-y-3">
                            <h4 className="text-sm font-semibold text-foreground">{t("settings.advanced.multiAgentTimeout.title")}</h4>
                            <SettingField
                                label={t("settings.advanced.multiAgentTimeout.send.label")}
                                keyName="MULTI_AGENT_WORKER_SEND_TIMEOUT_MS"
                                desc={t("settings.advanced.multiAgentTimeout.send.desc")}
                                placeholder="90000"
                                value={env.MULTI_AGENT_WORKER_SEND_TIMEOUT_MS || ""}
                                onChange={(val) => onChangeEnv("MULTI_AGENT_WORKER_SEND_TIMEOUT_MS", val)}
                            />
                            <SettingField
                                label={t("settings.advanced.multiAgentTimeout.idle.label")}
                                keyName="MULTI_AGENT_WORKER_IDLE_TIMEOUT_MS"
                                desc={t("settings.advanced.multiAgentTimeout.idle.desc")}
                                placeholder="90000"
                                value={env.MULTI_AGENT_WORKER_IDLE_TIMEOUT_MS || ""}
                                onChange={(val) => onChangeEnv("MULTI_AGENT_WORKER_IDLE_TIMEOUT_MS", val)}
                            />
                            <SettingField
                                label={t("settings.advanced.multiAgentTimeout.draft.label")}
                                keyName="MULTI_AGENT_WORKER_DRAFT_CHECK_INTERVAL_MS"
                                desc={t("settings.advanced.multiAgentTimeout.draft.desc")}
                                placeholder="10000"
                                value={env.MULTI_AGENT_WORKER_DRAFT_CHECK_INTERVAL_MS || ""}
                                onChange={(val) => onChangeEnv("MULTI_AGENT_WORKER_DRAFT_CHECK_INTERVAL_MS", val)}
                            />
                        </div>
                        <SettingField
                            label={t("settings.advanced.userDataDir.label")}
                            keyName="USER_DATA_DIR"
                            placeholder="./.golem_data"
                            value={env.USER_DATA_DIR || ""}
                            onChange={(val) => onChangeEnv("USER_DATA_DIR", val)}
                        />
                        <SettingField
                            label={t("settings.advanced.otaRepo.label")}
                            keyName="GITHUB_REPO"
                            placeholder="Arvincreator/project-golem"
                            value={env.GITHUB_REPO || ""}
                            onChange={(val) => onChangeEnv("GITHUB_REPO", val)}
                        />

                        <div className="flex flex-col mb-4">
                            <label className="text-sm font-medium text-muted-foreground mb-1 flex items-center justify-between gap-1 overflow-hidden">
                                <span className="truncate mr-1" title={t("settings.advanced.remoteAccess.label")}>{t("settings.advanced.remoteAccess.label")}</span>
                            </label>
                            <div
                                onClick={() => {
                                    const newValue = env.ALLOW_REMOTE_ACCESS === "true" ? "false" : "true";
                                    onChangeEnv("ALLOW_REMOTE_ACCESS", newValue);
                                }}
                                className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-colors duration-200 ease-in-out ${env.ALLOW_REMOTE_ACCESS === "true" ? "bg-emerald-600" : "bg-gray-700"}`}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transform transition-transform duration-200 ease-in-out ${env.ALLOW_REMOTE_ACCESS === "true" ? "translate-x-6" : "translate-x-0"}`} />
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{t("settings.advanced.remoteAccess.desc")}</p>
                        </div>

                        {env.ALLOW_REMOTE_ACCESS === "true" && (
                            <div className="mt-2 animate-in fade-in zoom-in-95">
                                <SettingField
                                    label={t("settings.advanced.remoteAccessPassword.label")}
                                    keyName="REMOTE_ACCESS_PASSWORD"
                                    isSecret
                                    placeholder={t("settings.advanced.remoteAccessPassword.placeholder")}
                                    desc={t("settings.advanced.remoteAccessPassword.desc")}
                                    value={env.REMOTE_ACCESS_PASSWORD || ""}
                                    onChange={(val) => onChangeEnv("REMOTE_ACCESS_PASSWORD", val)}
                                />
                            </div>
                        )}
                    </div>

                    <div className="pt-4 border-t border-border">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-sm font-medium text-foreground flex items-center gap-2">
                                {t("settings.advanced.systemLog.label")}
                                {logInfo && (
                                    <span className={`px-2 py-0.5 rounded text-xs font-mono ml-2 ${logInfo.bytes > 10 * 1024 * 1024 ? "bg-red-900/50 text-red-400" : "bg-green-900/30 text-green-400"}`}>
                                        {t("settings.advanced.systemLog.size", { size: logInfo.size })}
                                    </span>
                                )}
                            </span>
                        </div>
                        <SettingField
                            label=""
                            keyName="ENABLE_SYSTEM_LOG"
                            desc={t("settings.advanced.systemLog.desc")}
                            placeholder="false"
                            value={env.ENABLE_SYSTEM_LOG || ""}
                            onChange={(val) => onChangeEnv("ENABLE_SYSTEM_LOG", val)}
                        />
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="bg-secondary/30 p-5 rounded-xl border border-border">
                        <h4 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                            <RefreshCw className="w-4 h-4 text-primary" /> {t("settings.advanced.logRotate.title")}
                        </h4>
                        <div className="space-y-4">
                            <SettingField
                                label={t("settings.advanced.logRotate.maxSize.label")}
                                keyName="LOG_MAX_SIZE_MB"
                                desc={t("settings.advanced.logRotate.maxSize.desc")}
                                placeholder="10"
                                value={env.LOG_MAX_SIZE_MB || ""}
                                onChange={(val) => onChangeEnv("LOG_MAX_SIZE_MB", val)}
                            />
                            <SettingField
                                label={t("settings.advanced.logRotate.retentionDays.label")}
                                keyName="LOG_RETENTION_DAYS"
                                desc={t("settings.advanced.logRotate.retentionDays.desc")}
                                placeholder="7"
                                value={env.LOG_RETENTION_DAYS || ""}
                                onChange={(val) => onChangeEnv("LOG_RETENTION_DAYS", val)}
                            />
                            <SettingField
                                label={t("settings.advanced.logRotate.yesterdayThreshold.label")}
                                keyName="ARCHIVE_THRESHOLD_YESTERDAY"
                                desc={t("settings.advanced.logRotate.yesterdayThreshold.desc")}
                                placeholder="5"
                                value={env.ARCHIVE_THRESHOLD_YESTERDAY || ""}
                                onChange={(val) => onChangeEnv("ARCHIVE_THRESHOLD_YESTERDAY", val)}
                            />
                            <SettingField
                                label={t("settings.advanced.logRotate.todayThreshold.label")}
                                keyName="ARCHIVE_THRESHOLD_TODAY"
                                desc={t("settings.advanced.logRotate.todayThreshold.desc")}
                                placeholder="20"
                                value={env.ARCHIVE_THRESHOLD_TODAY || ""}
                                onChange={(val) => onChangeEnv("ARCHIVE_THRESHOLD_TODAY", val)}
                            />
                        </div>
                    </div>

                    <div className="bg-secondary/30 p-5 rounded-xl border border-border">
                        <h4 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                            <RefreshCw className="w-4 h-4 text-rose-300" /> {t("settings.advanced.diaryRotate.title")}
                        </h4>
                        <div className="space-y-4">
                            <SettingField
                                label={t("settings.advanced.diaryRotate.rawRetention.label")}
                                keyName="DIARY_RAW_RETENTION_DAYS"
                                desc={t("settings.advanced.diaryRotate.rawRetention.desc")}
                                placeholder="7"
                                value={env.DIARY_RAW_RETENTION_DAYS || ""}
                                onChange={(val) => onChangeEnv("DIARY_RAW_RETENTION_DAYS", val)}
                            />
                            <SettingField
                                label={t("settings.advanced.diaryRotate.weeklyRetention.label")}
                                keyName="DIARY_WEEKLY_RETENTION_DAYS"
                                desc={t("settings.advanced.diaryRotate.weeklyRetention.desc")}
                                placeholder="365"
                                value={env.DIARY_WEEKLY_RETENTION_DAYS || ""}
                                onChange={(val) => onChangeEnv("DIARY_WEEKLY_RETENTION_DAYS", val)}
                            />
                            <SettingField
                                label={t("settings.advanced.diaryRotate.monthlyRetention.label")}
                                keyName="DIARY_MONTHLY_RETENTION_DAYS"
                                desc={t("settings.advanced.diaryRotate.monthlyRetention.desc")}
                                placeholder="1825"
                                value={env.DIARY_MONTHLY_RETENTION_DAYS || ""}
                                onChange={(val) => onChangeEnv("DIARY_MONTHLY_RETENTION_DAYS", val)}
                            />
                            <SettingField
                                label={t("settings.advanced.diaryRotate.minInterval.label")}
                                keyName="DIARY_ROTATE_MIN_INTERVAL_MS"
                                desc={t("settings.advanced.diaryRotate.minInterval.desc")}
                                placeholder="300000"
                                value={env.DIARY_ROTATE_MIN_INTERVAL_MS || ""}
                                onChange={(val) => onChangeEnv("DIARY_ROTATE_MIN_INTERVAL_MS", val)}
                            />
                            <SettingField
                                label={t("settings.advanced.diaryRotate.backupMax.label")}
                                keyName="DIARY_BACKUP_MAX_FILES"
                                desc={t("settings.advanced.diaryRotate.backupMax.desc")}
                                placeholder="120"
                                value={env.DIARY_BACKUP_MAX_FILES || ""}
                                onChange={(val) => onChangeEnv("DIARY_BACKUP_MAX_FILES", val)}
                            />
                            <SettingField
                                label={t("settings.advanced.diaryRotate.backupDays.label")}
                                keyName="DIARY_BACKUP_RETENTION_DAYS"
                                desc={t("settings.advanced.diaryRotate.backupDays.desc")}
                                placeholder="180"
                                value={env.DIARY_BACKUP_RETENTION_DAYS || ""}
                                onChange={(val) => onChangeEnv("DIARY_BACKUP_RETENTION_DAYS", val)}
                            />
                        </div>
                    </div>

                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                        <h2 className="text-sm font-bold text-muted-foreground mb-4">{t("settings.advanced.readonly.title")}</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
                            {Object.keys(env)
                                .filter((key) => !EDITABLE_KEYS.has(key))
                                .map((key) => (
                                    <div key={key} className="bg-secondary/20 p-2 rounded border border-border/40">
                                        <label className="text-[10px] text-muted-foreground block mb-1 uppercase font-bold tracking-wider">{key}</label>
                                        <div className="text-xs font-mono truncate text-foreground/80">{env[key] || t("settings.advanced.readonly.na")}</div>
                                    </div>
                                ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
