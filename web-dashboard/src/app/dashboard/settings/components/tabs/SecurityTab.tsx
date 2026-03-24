"use client";

import { AlertTriangle, CheckCircle2, HardDrive, RefreshCw, ShieldCheck } from "lucide-react";
import { SettingField, SettingSelectField } from "../SettingFields";
import { useI18n } from "@/components/I18nProvider";

type SecurityTabProps = {
    env: Record<string, string>;
    onChangeEnv: (key: string, value: string) => void;
};

const DANGEROUS_COMMANDS = [
    "rm -rf /",
    "rd /s /q",
    "> /dev/sd",
    ":(){:|:&};:",
    "mkfs",
    "Format-Volume",
    "dd if=",
    "chmod -x"
];

const SYSTEM_SAFE_LIBRARY = [
    "dir",
    "pwd",
    "date",
    "echo",
    "cat",
    "grep",
    "find",
    "whoami",
    "tail",
    "head",
    "df",
    "free",
    "Get-ChildItem",
    "Select-String",
    "golem-check"
];

const SYSTEM_SAFE_WHITELIST = [
    "ls",
    ...SYSTEM_SAFE_LIBRARY
];

const parseCsv = (value?: string): string[] => {
    if (!value) return [];
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
};

export default function SecurityTab({ env, onChangeEnv }: SecurityTabProps) {
    const { t } = useI18n();
    const whitelist = parseCsv(env.COMMAND_WHITELIST);
    const customCommands = parseCsv(env.CUSTOM_COMMANDS);
    const availableSystemCommands = SYSTEM_SAFE_LIBRARY.filter((cmd) => !whitelist.includes(cmd));

    const moveToWhitelist = (item: string) => {
        if (!item || whitelist.includes(item)) return;
        onChangeEnv("COMMAND_WHITELIST", [...whitelist, item].join(","));
        onChangeEnv(
            "CUSTOM_COMMANDS",
            customCommands.filter((cmd) => cmd !== item).join(",")
        );
    };

    const removeFromWhitelist = (cmd: string) => {
        const nextWhitelist = whitelist.filter((item) => item !== cmd);
        onChangeEnv("COMMAND_WHITELIST", nextWhitelist.join(","));

        if (!SYSTEM_SAFE_WHITELIST.includes(cmd) && !customCommands.includes(cmd)) {
            onChangeEnv("CUSTOM_COMMANDS", [...customCommands, cmd].join(","));
        }
    };

    const moveToCustomPool = (item: string) => {
        if (!item) return;

        if (!customCommands.includes(item)) {
            onChangeEnv("CUSTOM_COMMANDS", [...customCommands, item].join(","));
        }

        if (whitelist.includes(item)) {
            onChangeEnv(
                "COMMAND_WHITELIST",
                whitelist.filter((cmd) => cmd !== item).join(",")
            );
        }
    };

    const removeFromCustomPool = (cmd: string) => {
        onChangeEnv(
            "CUSTOM_COMMANDS",
            customCommands.filter((item) => item !== cmd).join(",")
        );
    };

    const addCustomCommand = (value: string) => {
        if (!value || customCommands.includes(value)) return;
        onChangeEnv("CUSTOM_COMMANDS", [...customCommands, value].join(","));
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                    {t("settings.security.title")}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <SettingSelectField
                        label={t("settings.security.intervention.label")}
                        desc={t("settings.security.intervention.desc")}
                        value={env.GOLEM_INTERVENTION_LEVEL || "NORMAL"}
                        onChange={(val) => onChangeEnv("GOLEM_INTERVENTION_LEVEL", val)}
                        options={[
                            { value: "CONSERVATIVE", label: t("settings.security.intervention.option.conservative") },
                            { value: "NORMAL", label: t("settings.security.intervention.option.normal") },
                            { value: "PROACTIVE", label: t("settings.security.intervention.option.proactive") }
                        ]}
                    />
                    <SettingField
                        label={t("settings.security.maxAutoTurns.label")}
                        keyName="GOLEM_MAX_AUTO_TURNS"
                        placeholder="5"
                        desc={t("settings.security.maxAutoTurns.desc")}
                        value={env.GOLEM_MAX_AUTO_TURNS || ""}
                        onChange={(val) => onChangeEnv("GOLEM_MAX_AUTO_TURNS", val)}
                    />
                </div>
                <SettingField
                    label={t("settings.security.strictSafeguard.label")}
                    keyName="GOLEM_STRICT_SAFEGUARD"
                    placeholder="false"
                    desc={t("settings.security.strictSafeguard.desc")}
                    value={env.GOLEM_STRICT_SAFEGUARD || ""}
                    onChange={(val) => onChangeEnv("GOLEM_STRICT_SAFEGUARD", val)}
                />
                <SettingField
                    label={t("settings.security.trustSystemLibrary.label")}
                    keyName="GOLEM_TRUST_SYSTEM_COMMANDS"
                    placeholder="false"
                    desc={t("settings.security.trustSystemLibrary.desc")}
                    value={env.GOLEM_TRUST_SYSTEM_COMMANDS || ""}
                    onChange={(val) => onChangeEnv("GOLEM_TRUST_SYSTEM_COMMANDS", val)}
                />

                <div className="mt-6 p-4 border border-red-500/30 bg-red-500/5 rounded-lg">
                    <div className="flex items-center gap-2 text-red-400 font-bold mb-2">
                        <span className="text-xl">⚠️</span>
                        <span>{t("settings.security.dangerZone.title")}</span>
                    </div>
                    <SettingField
                        label={t("settings.security.fullAutoApprove.label")}
                        keyName="GOLEM_AUTO_APPROVE_ALL"
                        placeholder="false"
                        desc={t("settings.security.fullAutoApprove.desc")}
                        value={env.GOLEM_AUTO_APPROVE_ALL || ""}
                        onChange={(val) => onChangeEnv("GOLEM_AUTO_APPROVE_ALL", val)}
                    />
                    <SettingField
                        label={t("settings.security.silentAutoApprove.label")}
                        keyName="GOLEM_SILENT_AUTO_APPROVE"
                        placeholder="false"
                        desc={t("settings.security.silentAutoApprove.desc")}
                        value={env.GOLEM_SILENT_AUTO_APPROVE || ""}
                        onChange={(val) => onChangeEnv("GOLEM_SILENT_AUTO_APPROVE", val)}
                    />
                </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-primary" />
                    {t("settings.security.dragDrop.title")}
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 pb-4">
                    <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 flex flex-col h-full">
                        <h4 className="text-sm font-semibold text-destructive flex items-center gap-2 mb-3">
                            <AlertTriangle className="w-4 h-4" /> {t("settings.security.blocked.title")}
                        </h4>
                        <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar h-[22rem]">
                            {DANGEROUS_COMMANDS.map((cmd, idx) => (
                                <div
                                    key={`danger-${idx}`}
                                    className="px-3 py-2 bg-destructive/20 border border-destructive/40 text-destructive text-xs font-mono rounded cursor-not-allowed opacity-80"
                                >
                                    {cmd}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-secondary/30 border border-border rounded-xl p-4 flex flex-col h-full">
                        <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2 mb-3">
                            {t("settings.security.systemLibrary.title")}
                        </h4>
                        <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar h-[22rem]">
                            {availableSystemCommands.map((cmd, idx) => (
                                <div
                                    key={`safe-drv-${idx}`}
                                    draggable
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData("text/plain", cmd);
                                        e.dataTransfer.effectAllowed = "move";
                                    }}
                                    className="px-3 py-2 bg-secondary border border-border text-foreground/80 text-xs font-mono rounded cursor-grab hover:border-primary shadow-sm active:cursor-grabbing group flex items-center justify-between"
                                >
                                    <span>{cmd}</span>
                                    <span className="text-[10px] text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity">{t("settings.security.systemLibrary.dragEnable")}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div
                        className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex flex-col h-full transition-colors relative"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                            e.preventDefault();
                            moveToWhitelist(e.dataTransfer.getData("text/plain"));
                        }}
                    >
                        <h4 className="text-sm font-semibold text-primary flex items-center gap-2 mb-3">
                            <CheckCircle2 className="w-4 h-4" /> {t("settings.security.allowList.title")}
                        </h4>
                        <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar h-[22rem]">
                            {whitelist.map((cmd, idx) => (
                                <div
                                    key={`whitelist-${idx}`}
                                    draggable
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData("text/plain", cmd);
                                        e.dataTransfer.effectAllowed = "move";
                                    }}
                                    className="px-3 py-2 bg-primary/10 border border-primary/30 text-primary text-xs font-mono rounded cursor-grab flex items-center justify-between group shadow-sm"
                                >
                                    <span>{cmd}</span>
                                    <button
                                        onClick={() => removeFromWhitelist(cmd)}
                                        className="opacity-0 group-hover:opacity-100 text-red-400 p-0.5"
                                    >
                                        <RefreshCw className="w-3 h-3 rotate-45" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div
                        className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 flex flex-col h-full transition-colors relative"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                            e.preventDefault();
                            moveToCustomPool(e.dataTransfer.getData("text/plain"));
                        }}
                    >
                        <h4 className="text-sm font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-2 mb-3">
                            <HardDrive className="w-4 h-4" /> {t("settings.security.customPool.title")}
                        </h4>
                        <input
                            type="text"
                            placeholder={t("settings.security.customPool.placeholder")}
                            className="w-full bg-secondary border border-border rounded px-2 py-1.5 text-xs font-mono mb-3"
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    const val = e.currentTarget.value.trim();
                                    addCustomCommand(val);
                                    if (val) {
                                        e.currentTarget.value = "";
                                    }
                                }
                            }}
                        />
                        <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar h-[19rem]">
                            {customCommands.map((cmd, idx) => (
                                <div
                                    key={`pool-${idx}`}
                                    draggable
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData("text/plain", cmd);
                                        e.dataTransfer.effectAllowed = "move";
                                    }}
                                    className="px-3 py-2 bg-secondary border border-border text-foreground/80 text-xs font-mono rounded cursor-grab flex items-center justify-between group shadow-sm hover:border-blue-500"
                                >
                                    <span>{cmd}</span>
                                    <button
                                        onClick={() => removeFromCustomPool(cmd)}
                                        className="opacity-0 group-hover:opacity-100 text-red-400 p-0.5"
                                    >
                                        <RefreshCw className="w-3 h-3 rotate-45" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
