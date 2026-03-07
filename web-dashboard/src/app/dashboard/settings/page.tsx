"use client";

import React, { useState, useEffect } from "react";
import {
    Settings, Save, RefreshCw, AlertTriangle, CheckCircle2,
    Eye, EyeOff, Lock, Users, Server, Activity, Cpu, HardDrive
} from "lucide-react";

type GolemConfig = {
    id: string;
    tgToken?: string;
    role?: string;
    tgAuthMode?: string;
    adminId?: string;
    chatId?: string;
};

type ConfigData = {
    env: Record<string, string>;
    golems: GolemConfig[];
};

type SystemStatus = {
    runtime?: { node: string; npm: string; platform: string; arch: string; uptime: number };
    health?: { node: boolean; env: boolean; keys: boolean; deps: boolean; core: boolean; dashboard: boolean };
    system?: { totalMem: string; freeMem: string; diskAvail: string };
};

const SystemHealthDashboard = ({ systemStatus }: { systemStatus: SystemStatus | null }) => {
    if (!systemStatus) return null;

    const { runtime, health, system } = systemStatus;

    const StatusItem = ({ label, status, icon: Icon }: { label: string, status: boolean, icon: any }) => (
        <div className="flex items-center justify-between p-2 rounded-lg bg-gray-900/40 border border-gray-800/40">
            <div className="flex items-center gap-2">
                <Icon className="w-4 h-4 text-gray-400" />
                <span className="text-xs text-gray-300">{label}</span>
            </div>
            {status ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            ) : (
                <AlertTriangle className="w-4 h-4 text-amber-500" />
            )}
        </div>
    );

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-top-4 duration-500 mb-8">
            {/* 1. Runtime Info */}
            <div className="bg-gray-900/30 border border-gray-800 hover:border-gray-700/50 transition-colors rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                    <Cpu className="w-5 h-5 text-cyan-400" />
                    <h3 className="text-sm font-semibold text-white">運作環境 (Runtime)</h3>
                </div>
                <div className="space-y-3">
                    <div className="flex justify-between text-xs">
                        <span className="text-gray-500">OS</span>
                        <span className="text-indigo-400 font-medium">{(systemStatus as any)?.runtime?.osName || 'Unknown'}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Node.js</span>
                        <span className="text-gray-300 font-mono">{runtime?.node || 'Unknown'}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-gray-500">npm</span>
                        <span className="text-gray-300 font-mono">{runtime?.npm || 'Unknown'}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Platform</span>
                        <span className="text-gray-300 capitalize">{runtime?.platform} ({runtime?.arch})</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Uptime</span>
                        <span className="text-gray-300">{Math.floor((runtime?.uptime || 0) / 3600)}h {Math.floor(((runtime?.uptime || 0) % 3600) / 60)}m</span>
                    </div>
                </div>
            </div>

            {/* 2. System Health */}
            <div className="bg-gray-900/30 border border-gray-800 hover:border-gray-700/50 transition-colors rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                    <Activity className="w-5 h-5 text-emerald-400" />
                    <h3 className="text-sm font-semibold text-white">健康檢查 (Health)</h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <StatusItem label="API Keys" status={!!health?.keys} icon={Activity} />
                    <StatusItem label="Env Config" status={!!health?.env} icon={Activity} />
                    <StatusItem label="Dependencies" status={!!health?.deps} icon={Activity} />
                    <StatusItem label="Core Files" status={!!health?.core} icon={Activity} />
                </div>
            </div>

            {/* 3. System Resources */}
            <div className="bg-gray-900/30 border border-gray-800 hover:border-gray-700/50 transition-colors rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                    <Server className="w-5 h-5 text-indigo-400" />
                    <h3 className="text-sm font-semibold text-white">系統資源 (Resources)</h3>
                </div>
                <div className="space-y-4">
                    <div>
                        <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                            <span>記憶體 (Memory)</span>
                            <span>{system?.freeMem} / {system?.totalMem}</span>
                        </div>
                        <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-indigo-500 transition-all duration-1000"
                                style={{ width: `${100 - (parseInt(system?.freeMem || "0") / parseInt(system?.totalMem || "1")) * 100}%` }}
                            />
                        </div>
                    </div>
                    <div className="flex justify-between text-xs pt-1">
                        <div className="flex items-center gap-2 text-gray-500">
                            <HardDrive className="w-4 h-4" />
                            磁碟可用空間
                        </div>
                        <span className="text-emerald-400 font-bold">{system?.diskAvail || 'N/A'}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

const SettingField = ({
    label, desc = "", keyName,
    isReadOnly = false, isSecret = false, value = "", onChange,
    type = "text", placeholder = ""
}: {
    label: string,
    desc?: string,
    isReadOnly?: boolean, isSecret?: boolean, value?: string, onChange?: (val: string) => void,
    type?: string, placeholder?: string, keyName?: string
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const inputType = (isSecret && !isVisible) ? "password" : type;

    return (
        <div className="flex flex-col mb-4">
            <label className="text-sm font-medium text-gray-300 mb-1 flex items-center justify-between gap-1 overflow-hidden">
                <span className="truncate mr-1" title={label}>{label}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                    {isReadOnly && (
                        <span className="text-[10px] bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded border border-gray-700 flex items-center gap-1 whitespace-nowrap">
                            <Lock className="w-3 h-3" /> 唯讀
                        </span>
                    )}
                    {!isReadOnly && (
                        <span className="text-[10px] bg-orange-900/40 text-orange-400 px-1.5 py-0.5 rounded border border-orange-800/50 whitespace-nowrap">需重啟</span>
                    )}
                </div>
            </label>
            <div className="relative">
                <input
                    type={inputType}
                    value={value}
                    onChange={(e) => {
                        if (onChange) {
                            onChange(e.target.value);
                        }
                    }}
                    placeholder={placeholder}
                    disabled={isReadOnly}
                    className={`w-full bg-gray-900/50 border border-gray-700/50 focus:border-cyan-500 rounded-lg px-3 py-2 text-sm text-gray-100 font-mono transition-colors ${isReadOnly ? "opacity-70 cursor-not-allowed bg-gray-900/80" : ""} ${isSecret ? "pr-10" : ""}`}
                    spellCheck={false}
                />
                {isSecret && (
                    <button
                        type="button"
                        onClick={() => setIsVisible(!isVisible)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors p-1"
                        title={isVisible ? "隱藏內容" : "顯示內容"}
                    >
                        {isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                )}
            </div>
            {desc && <p className="text-xs text-gray-500 mt-1">{desc}</p>}
        </div>
    );
};

export default function SettingsPage() {
    const [config, setConfig] = useState<ConfigData>({ env: {}, golems: [] });
    const [originalConfig, setOriginalConfig] = useState<ConfigData>({ env: {}, golems: [] });
    const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'warning', text: string } | null>(null);

    useEffect(() => {
        fetchConfig();
        fetchStatus();
    }, []);

    const fetchConfig = async () => {
        setIsLoading(true);
        setStatusMessage(null);
        try {
            const res = await fetch("/api/config");
            const data = await res.json();
            if (res.ok) {
                setConfig(data);
                setOriginalConfig(data);
            } else {
                throw new Error(data.error || "Failed to fetch config");
            }
        } catch (error: any) {
            setStatusMessage({ type: 'error', text: error.message });
        } finally {
            setIsLoading(false);
        }
    };

    const fetchStatus = async () => {
        try {
            const res = await fetch("/api/system/status");
            const data = await res.json();
            if (res.ok) setSystemStatus(data);
        } catch (e) { console.error("Failed to fetch system status:", e); }
    };


    const handleSave = async () => {
        setIsSaving(true);
        setStatusMessage(null);

        // Calculate differences
        const changedEnv: Record<string, string> = {};
        let hasEnvChanges = false;

        Object.keys(config.env).forEach(key => {
            if (config.env[key] !== originalConfig.env[key]) {
                changedEnv[key] = config.env[key];
                hasEnvChanges = true;
            }
        });

        const golemsChanged = JSON.stringify(config.golems) !== JSON.stringify(originalConfig.golems);

        if (!hasEnvChanges && !golemsChanged) {
            setStatusMessage({ type: 'warning', text: "沒有任何變更需要儲存" });
            setIsSaving(false);
            return;
        }

        try {
            const payload = {
                env: changedEnv,
                golems: golemsChanged ? config.golems : undefined
            };

            const res = await fetch("/api/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (res.ok && data.success) {
                setOriginalConfig(config);
                setStatusMessage({ type: 'warning', text: "部分設定已儲存，但需要重啟總開關（Restart System）才能完全生效。" });

            } else {
                throw new Error(data.message || data.error || "儲存失敗");
            }
        } catch (error: any) {
            setStatusMessage({ type: 'error', text: error.message });
        } finally {
            setIsSaving(false);
        }
    };

    const handleRestartSystem = async () => {
        if (!confirm("確定要重啟 Golem 嗎？這將會中斷目前的對話。")) return;
        try {
            await fetch("/api/system/reload", { method: "POST" });
            setStatusMessage({ type: 'warning', text: "重新啟動指令已發送... 等待系統恢復中！" });

            // Start polling the backend to see when it comes back online
            let retries = 0;
            const maxRetries = 30; // 30 attempts, 1 sec each = 30 seconds max timeout

            const pollInterval = setInterval(async () => {
                retries++;
                try {
                    const checkRes = await fetch("/api/system/status");
                    if (checkRes.ok) {
                        clearInterval(pollInterval);
                        setStatusMessage({ type: 'success', text: "重新啟動完成！頁面即將重新載入..." });
                        setTimeout(() => {
                            window.location.reload();
                        }, 1000);
                    }
                } catch (err) {
                    // Ignore errors, it means the server is simply offline and still rebooting
                }

                if (retries >= maxRetries) {
                    clearInterval(pollInterval);
                    setStatusMessage({ type: 'error', text: "重啟超時。請手動檢查終端機日誌。" });
                }
            }, 1000);

        } catch (e) {
            alert("重啟請求發送失敗。");
        }
    };

    const handleChangeEnv = (key: string, value: string) => {
        setConfig(prev => ({
            ...prev,
            env: { ...prev.env, [key]: value }
        }));
    };

    const handleChangeGolem = (index: number, key: keyof GolemConfig, value: string) => {
        setConfig(prev => {
            const newGolems = [...prev.golems];
            newGolems[index] = { ...newGolems[index], [key]: value };
            return { ...prev, golems: newGolems };
        });
    };

    const addGolem = () => {
        setConfig(prev => ({
            ...prev,
            golems: [
                ...prev.golems,
                { id: `golem_${Math.random().toString(36).substr(2, 5)}`, tgToken: '', tgAuthMode: 'ADMIN', adminId: '' }
            ]
        }));
    };

    const removeGolem = (index: number) => {
        setConfig(prev => {
            const newGolems = [...prev.golems];
            newGolems.splice(index, 1);
            return { ...prev, golems: newGolems };
        });
    };

    if (isLoading) {
        return (
            <div className="flex-1 p-6 flex items-center justify-center">
                <div className="flex flex-col items-center space-y-4">
                    <RefreshCw className="w-8 h-8 text-cyan-500 animate-spin" />
                    <p className="text-gray-400 font-mono text-sm">讀取總開關系統中...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 p-4 md:p-6 overflow-y-auto">
            <div className="max-w-4xl mx-auto space-y-6">

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-800 pb-4">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Settings className="w-6 h-6 text-cyan-400" />
                            系統配置總表 (System Settings)
                        </h1>
                        <p className="text-sm text-gray-400 mt-1">
                            管理 Golem 的全域配置與 API 金鑰。部分變數支援熱抽換，不需斷電即可生效。
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleRestartSystem}
                            className="px-4 py-2 bg-gray-800 hover:bg-red-900/40 text-gray-300 hover:text-red-400 border border-gray-700 hover:border-red-800 rounded-lg text-sm transition-all flex items-center gap-2"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Restart System
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${isSaving
                                ? "bg-cyan-900/50 text-cyan-500 cursor-not-allowed border border-cyan-800/50"
                                : "bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/30 hover:border-cyan-500"
                                }`}
                        >
                            {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {isSaving ? "Saving..." : "Save Settings"}
                        </button>
                    </div>
                </div>

                {/* Status Message */}
                {statusMessage && (
                    <div className={`p-4 rounded-lg flex items-start gap-3 border ${statusMessage.type === 'success' ? 'bg-green-950/30 border-green-900/50 text-green-400' :
                        statusMessage.type === 'warning' ? 'bg-orange-950/30 border-orange-900/50 text-orange-400' :
                            'bg-red-950/30 border-red-900/50 text-red-400'
                        }`}>
                        {statusMessage.type === 'success' && <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />}
                        {(statusMessage.type === 'warning' || statusMessage.type === 'error') && <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />}
                        <p className="text-sm">{statusMessage.text}</p>
                    </div>
                )}

                {/* System Health Dashboard */}
                <SystemHealthDashboard systemStatus={systemStatus} />

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 左側：AI 大腦與控制權限 */}
                    <div className="space-y-6">
                        {/* Section: Gemini Brain */}
                        <div className="bg-gray-900/30 border border-gray-800 rounded-xl p-5 shadow-sm">
                            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                                🧠 Golem Brain (大腦設定)
                            </h2>
                            <SettingField
                                label="Gemini API Keys"
                                keyName="GEMINI_API_KEYS"
                                desc="支援多組 Key 輪替 (KeyChain)，請用半形逗號 ',' 分隔。"
                                placeholder="AIzaSy...,AIzaSy..."
                                isSecret
                                value={config.env.GEMINI_API_KEYS || ""}
                                onChange={(val) => handleChangeEnv("GEMINI_API_KEYS", val)}
                            />
                        </div>

                        {/* Section: Telegram Config */}
                        <div className="bg-gray-900/30 border border-gray-800 hover:border-indigo-900/50 transition-colors rounded-xl p-5 shadow-sm">
                            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                                ✈️ Telegram 設定 (單機全域)
                            </h2>
                            <SettingField
                                label="Bot Token"
                                keyName="TELEGRAM_TOKEN"
                                placeholder="123456789:ABCDefgh..."
                                desc="與 @BotFather 申請的憑證。"
                                isSecret
                                value={config.env.TELEGRAM_TOKEN || ""}
                                onChange={(val) => handleChangeEnv("TELEGRAM_TOKEN", val)}
                            />
                            <SettingField
                                label="Auth Mode"
                                keyName="TG_AUTH_MODE"
                                placeholder="ADMIN 或 CHAT"
                                desc="ADMIN: 僅限管理員個人。CHAT: 僅限特定群組。"
                                value={config.env.TG_AUTH_MODE || ""}
                                onChange={(val) => handleChangeEnv("TG_AUTH_MODE", val)}
                            />
                            <div className="grid grid-cols-2 gap-4">
                                <SettingField
                                    label="Admin ID"
                                    keyName="ADMIN_ID"
                                    placeholder="無"
                                    isSecret
                                    value={config.env.ADMIN_ID || ""}
                                    onChange={(val) => handleChangeEnv("ADMIN_ID", val)}
                                />
                                <SettingField
                                    label="Chat ID"
                                    keyName="TG_CHAT_ID"
                                    placeholder="無"
                                    isSecret
                                    value={config.env.TG_CHAT_ID || ""}
                                    onChange={(val) => handleChangeEnv("TG_CHAT_ID", val)}
                                />
                            </div>
                        </div>

                        {/* Section: Discord Config */}
                        <div className="bg-gray-900/30 border border-gray-800 hover:border-purple-900/50 transition-colors rounded-xl p-5 shadow-sm">
                            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                                👾 Discord 設定
                            </h2>
                            <SettingField
                                label="Bot Token"
                                keyName="DISCORD_TOKEN"
                                placeholder="MTE1Mj..."
                                desc="Discord Developer Portal 的 Token。"
                                isSecret
                                value={config.env.DISCORD_TOKEN || ""}
                                onChange={(val) => handleChangeEnv("DISCORD_TOKEN", val)}
                            />
                            <SettingField
                                label="Admin ID"
                                keyName="DISCORD_ADMIN_ID"
                                placeholder="無"
                                isSecret
                                value={config.env.DISCORD_ADMIN_ID || ""}
                                onChange={(val) => handleChangeEnv("DISCORD_ADMIN_ID", val)}
                            />
                        </div>
                    </div>

                    {/* 右側：系統進階與社交 */}
                    <div className="space-y-6">
                        {/* Section: Moltbook / Social */}
                        <div className="bg-gray-900/30 border border-gray-800 hover:border-rose-900/30 transition-colors rounded-xl p-5 shadow-sm">
                            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                                🦞 Moltbook 社交網絡
                            </h2>
                            <SettingField
                                label="API Key"
                                keyName="MOLTBOOK_API_KEY"
                                placeholder="無"
                                desc="Agent 在 Moltbook 上的身分證憑證。"
                                isSecret
                                value={config.env.MOLTBOOK_API_KEY || ""}
                                onChange={(val) => handleChangeEnv("MOLTBOOK_API_KEY", val)}
                            />
                            <SettingField
                                label="Agent Name"
                                keyName="MOLTBOOK_AGENT_NAME"
                                placeholder="例如: Golem_v9(golem)"
                                desc="僅供辨識用的備註名稱。"
                                value={config.env.MOLTBOOK_AGENT_NAME || ""}
                                onChange={(val) => handleChangeEnv("MOLTBOOK_AGENT_NAME", val)}
                            />
                        </div>

                        {/* Section: System Advanced */}
                        <div className="bg-gray-900/30 border border-gray-800 rounded-xl p-5 shadow-sm">
                            <h2 className="text-lg font-semibold text-gray-300 mb-4 flex items-center gap-2">
                                ⚙️ 系統進階設定
                            </h2>
                            <div className="grid grid-cols-2 gap-4">
                                <SettingField
                                    label="執行模式"
                                    keyName="GOLEM_MODE"
                                    placeholder="SINGLE"
                                    desc="SINGLE 或是 MULTI"
                                    value={config.env.GOLEM_MODE || ""}
                                    onChange={(val) => handleChangeEnv("GOLEM_MODE", val)}
                                />
                                <SettingField
                                    label="測試模式"
                                    keyName="GOLEM_TEST_MODE"
                                    placeholder="false"
                                    desc="true 或 false"
                                    value={config.env.GOLEM_TEST_MODE || ""}
                                    onChange={(val) => handleChangeEnv("GOLEM_TEST_MODE", val)}
                                />
                            </div>
                            <SettingField
                                label="記憶引擎模式"
                                keyName="GOLEM_MEMORY_MODE"
                                placeholder="browser"
                                desc="browser 或是 qmd 混合搜尋"
                                value={config.env.GOLEM_MEMORY_MODE || ""}
                                onChange={(val) => handleChangeEnv("GOLEM_MEMORY_MODE", val)}
                            />
                            <SettingField
                                label="資料暫存路徑"
                                keyName="USER_DATA_DIR"
                                placeholder="./golem_memory"
                                value={config.env.USER_DATA_DIR || ""}
                                onChange={(val) => handleChangeEnv("USER_DATA_DIR", val)}
                            />
                            <SettingField
                                label="OTA 升級節點 (GitHub Repo)"
                                keyName="GITHUB_REPO"
                                placeholder="https://raw.github..."
                                value={config.env.GITHUB_REPO || ""}
                                onChange={(val) => handleChangeEnv("GITHUB_REPO", val)}
                            />
                        </div>

                        {/* Section: Autonomy Schedule */}
                        <div className="bg-gray-900/30 border border-gray-800 hover:border-blue-900/30 transition-colors rounded-xl p-5 shadow-sm">
                            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                                ⏳ 自動化與作息設定
                            </h2>
                            <div className="grid grid-cols-2 gap-4">
                                <SettingField
                                    label="喚醒間隔 (最小)"
                                    keyName="GOLEM_AWAKE_INTERVAL_MIN"
                                    placeholder="2"
                                    desc="最短幾小時主動喚醒一次"
                                    value={config.env.GOLEM_AWAKE_INTERVAL_MIN || ""}
                                    onChange={(val) => handleChangeEnv("GOLEM_AWAKE_INTERVAL_MIN", val)}
                                />
                                <SettingField
                                    label="喚醒間隔 (最大)"
                                    keyName="GOLEM_AWAKE_INTERVAL_MAX"
                                    placeholder="5"
                                    desc="最長幾小時主動喚醒一次"
                                    value={config.env.GOLEM_AWAKE_INTERVAL_MAX || ""}
                                    onChange={(val) => handleChangeEnv("GOLEM_AWAKE_INTERVAL_MAX", val)}
                                />
                                <SettingField
                                    label="夜間休眠開始"
                                    keyName="GOLEM_SLEEP_START"
                                    placeholder="1"
                                    desc="24小時制，預設 1"
                                    value={config.env.GOLEM_SLEEP_START || ""}
                                    onChange={(val) => handleChangeEnv("GOLEM_SLEEP_START", val)}
                                />
                                <SettingField
                                    label="夜間休眠結束"
                                    keyName="GOLEM_SLEEP_END"
                                    placeholder="7"
                                    desc="24小時制，預設 7"
                                    value={config.env.GOLEM_SLEEP_END || ""}
                                    onChange={(val) => handleChangeEnv("GOLEM_SLEEP_END", val)}
                                />
                            </div>
                        </div>

                    </div>
                </div>

                {/* Section: Other Variables (Read Only) */}
                <div className="mt-8 border-t border-gray-800/60 pt-8">
                    <h2 className="text-xl font-bold tracking-tight text-gray-400 mb-6 flex items-center gap-2">
                        🔧 其他唯讀參數 (Other Configs)
                    </h2>
                    <div className="bg-gray-950/50 border border-gray-800/80 rounded-xl p-5 shadow-sm">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
                            {Object.keys(config.env)
                                .filter(k => ![
                                    'GEMINI_API_KEYS', 'TELEGRAM_TOKEN', 'TG_AUTH_MODE', 'ADMIN_ID', 'TG_CHAT_ID',
                                    'DISCORD_TOKEN', 'DISCORD_ADMIN_ID', 'USER_DATA_DIR', 'GOLEM_TEST_MODE',
                                    'GOLEM_MODE', 'GOLEM_MEMORY_MODE', 'GITHUB_REPO',
                                    'MOLTBOOK_API_KEY', 'MOLTBOOK_AGENT_NAME',
                                    'GOLEM_AWAKE_INTERVAL_MIN', 'GOLEM_AWAKE_INTERVAL_MAX',
                                    'GOLEM_SLEEP_START', 'GOLEM_SLEEP_END'
                                ].includes(k))
                                .map(key => (
                                    <div key={key}>
                                        <SettingField
                                            label={key}
                                            keyName={key}
                                            isReadOnly
                                            value={config.env[key] || ""}
                                            onChange={() => { }}
                                        />
                                    </div>
                                ))
                            }
                        </div>
                        {Object.keys(config.env).length === 0 && (
                            <p className="text-sm text-gray-500 italic text-center py-4">無其他參數</p>
                        )}
                    </div>
                </div>

                {/* Section: MULTI-GOLEM CONFIGS (golems.json) */}
                <div className="mt-8 border-t border-gray-800/60 pt-8">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                            <Users className="w-5 h-5 text-indigo-400" />
                            多機組態 (Multi-Golem)
                        </h2>
                        <button
                            onClick={addGolem}
                            className="text-sm px-3 py-1.5 bg-indigo-900/40 text-indigo-300 hover:bg-indigo-900/80 border border-indigo-700/50 rounded-md transition-colors"
                        >
                            + 新增配置
                        </button>
                    </div>

                    <div className="space-y-6">
                        {config.golems.map((golem, index) => (
                            <div key={`golem-${index}`} className="bg-gray-900/40 border border-indigo-900/30 rounded-xl p-5 shadow-sm relative group">
                                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => removeGolem(index)}
                                        className="text-xs px-2 py-1 bg-red-900/30 hover:bg-red-800/60 text-red-400 rounded transition-colors"
                                    >
                                        移除
                                    </button>
                                </div>

                                <h3 className="text-md font-mono text-indigo-300 mb-4 pb-2 border-b border-gray-800/50">
                                    Entity ID: {golem.id}
                                </h3>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2">
                                    <div className="space-y-4">
                                        <SettingField
                                            label="Entity ID (ID)"
                                            keyName={`golemId_${index}`}
                                            value={golem.id}
                                            onChange={(val) => handleChangeGolem(index, 'id', val)}
                                            placeholder="ex: golem_B"
                                        />
                                        <SettingField
                                            label="Role (任務指派)"
                                            keyName={`golemRole_${index}`}
                                            value={golem.role || ""}
                                            onChange={(val) => handleChangeGolem(index, 'role', val)}
                                            placeholder="ex: 客服專員"
                                        />
                                        <SettingField
                                            label="Bot Token"
                                            keyName={`golemToken_${index}`}
                                            value={golem.tgToken || ""}
                                            onChange={(val) => handleChangeGolem(index, 'tgToken', val)}
                                            placeholder="123456:ABC..."
                                            isSecret
                                            desc="若修改此欄位需重啟系統"
                                        />
                                    </div>
                                    <div className="space-y-4">
                                        <SettingField
                                            label="Auth Mode"
                                            keyName={`golemAuthMode_${index}`}
                                            value={golem.tgAuthMode || ""}
                                            onChange={(val) => handleChangeGolem(index, 'tgAuthMode', val)}
                                            placeholder="ADMIN 或是 CHAT"
                                        />
                                        <div className="grid grid-cols-2 gap-4">
                                            <SettingField
                                                label="Admin ID"
                                                keyName={`golemAdmin_${index}`}
                                                value={golem.adminId || ""}
                                                onChange={(val) => handleChangeGolem(index, 'adminId', val)}
                                                placeholder="使用者 ID"
                                                isSecret
                                            />
                                            <SettingField
                                                label="Chat ID"
                                                keyName={`golemChat_${index}`}
                                                value={golem.chatId || ""}
                                                onChange={(val) => handleChangeGolem(index, 'chatId', val)}
                                                placeholder="群組 ID"
                                                isSecret
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}

                        {config.golems.length === 0 && (
                            <div className="text-center py-10 border border-dashed border-gray-800 rounded-xl">
                                <p className="text-gray-500 font-mono">尚無多機配置 (golems.json為空)</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
