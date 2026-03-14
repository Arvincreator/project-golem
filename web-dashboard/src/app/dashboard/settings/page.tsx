"use client";

import React, { useState, useEffect } from "react";
import {
    Settings, Save, RefreshCw, AlertTriangle, CheckCircle2,
    Eye, EyeOff, Lock, Users, Server, Activity, Cpu, HardDrive,
    DownloadCloud, Loader2, X, ShieldCheck, ShieldAlert
} from "lucide-react";
import { io } from "socket.io-client";

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

const SystemUpdateSection = () => {
    const [updateInfo, setUpdateInfo] = useState<{ currentVersion: string, remoteVersion?: string, isOutdated?: boolean, installMode: string, gitInfo?: { currentBranch: string, currentCommit: string, latestCommit: string, behindCount: number } } | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusText, setStatusText] = useState("");
    const [keepOldData, setKeepOldData] = useState(true);
    const [keepMemory, setKeepMemory] = useState(true);
    const [updateDone, setUpdateDone] = useState(false);
    const [logInfo, setLogInfo] = useState<{ size: string, bytes: number } | null>(null);

    // Initial check for update and log info
    useEffect(() => {
        let isMounted = true;
        const checkUpdate = async () => {
            try {
                const res = await fetch('/api/system/update/check');
                if (res.ok) {
                    const data = await res.json();
                    if (isMounted) setUpdateInfo(data);
                }
            } catch (err) {
                console.error('Failed to check for updates:', err);
            }
        };

        const checkLogInfo = async () => {
            try {
                const res = await fetch('/api/system/log-info');
                if (res.ok) {
                    const data = await res.json();
                    if (isMounted && data.success) setLogInfo(data);
                }
            } catch (err) {
                console.error('Failed to fetch log info:', err);
            }
        };

        checkUpdate();
        checkLogInfo();

        return () => { isMounted = false; };
    }, []);

    useEffect(() => {
        if (!isUpdating && !showModal) return;
        const socket = io(window.location.origin);
        socket.on('system:update_progress', (data: any) => {
            if (data.status === 'running') {
                setStatusText(data.message);
                if (data.progress !== null && data.progress !== undefined) setProgress(data.progress);
            } else if (data.status === 'requires_restart') {
                setStatusText(data.message);
                setProgress(100);
                setUpdateDone(true);
                setIsUpdating(false);
            } else if (data.status === 'error') {
                setStatusText(data.message);
                setIsUpdating(false);
            }
        });
        return () => { socket.disconnect(); };
    }, [isUpdating, showModal]);

    const handleStartUpdate = async () => {
        setIsUpdating(true);
        setProgress(0);
        setStatusText("準備更新...");
        setUpdateDone(false);
        try {
            await fetch("/api/system/update/execute", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ keepOldData, keepMemory })
            });
        } catch (e) {
            setStatusText("啟動更新程序失敗");
            setIsUpdating(false);
        }
    };

    const handleRestart = async () => {
        try {
            await fetch("/api/system/restart", { method: "POST" });
            setStatusText("重新啟動指令已發送... 等待系統恢復中！");

            let retries = 0;
            const maxRetries = 40;
            const pollInterval = setInterval(async () => {
                retries++;
                try {
                    const checkRes = await fetch("/api/system/status");
                    if (checkRes.ok) {
                        clearInterval(pollInterval);
                        setStatusText("重新啟動完成！頁面即將重新載入...");
                        setTimeout(() => { window.location.reload(); }, 1000);
                    }
                } catch (err) {
                    // Server is offline
                }

                if (retries >= maxRetries) {
                    clearInterval(pollInterval);
                    setStatusText("重啟超時。若您未配置自動重啟 (PM2/Nodemon)，請手動至終端機啟動伺服器。");
                }
            }, 1000);

        } catch (e) {
            alert("重啟請求發送失敗。");
        }
    };

    if (!updateInfo) return null;

    return (
        <div className="bg-gray-900/30 border border-indigo-900/50 hover:border-indigo-700/50 transition-colors rounded-xl p-5 shadow-sm mb-6 animate-in fade-in">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <DownloadCloud className="w-5 h-5 text-indigo-400" />
                        系統升級與版本控制 (System Update)
                    </h2>
                    <p className="text-sm text-gray-400 mt-1">
                        當前版本: <span className="font-mono text-cyan-400 px-1">{updateInfo.currentVersion}</span>
                        | 安裝模式: <span className="uppercase text-xs bg-gray-800 px-1.5 py-0.5 rounded ml-1 tracking-wider">{updateInfo.installMode}</span>
                    </p>
                </div>
                <button
                    onClick={() => { setShowModal(true); setUpdateDone(false); setIsUpdating(false); setStatusText(""); }}
                    className="px-4 py-2 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/50 rounded-lg text-sm transition-all"
                >
                    檢查並更新系統 (Update)
                </button>
            </div>

            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl max-w-md w-full p-6 space-y-6">
                        <h3 className="text-xl font-bold flex items-center gap-2 text-white">
                            <DownloadCloud className="w-6 h-6 text-indigo-400" />
                            系統一鍵更新
                        </h3>

                        {!isUpdating && !updateDone ? (
                            <div className="space-y-4">
                                <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
                                <p className="text-sm text-gray-300 text-center">
                                    此動作將會從 GitHub 下載最新程式碼並進行覆寫。過程可能需要幾分鐘。
                                </p>

                                {updateInfo.installMode === 'git' && updateInfo.gitInfo && (
                                    <div className="bg-gray-950 p-4 rounded-lg border border-gray-800 text-sm space-y-2">
                                        <div className="flex items-center gap-2 text-indigo-400 font-semibold mb-2">
                                            <Activity className="w-4 h-4" /> Git 版本差異分析
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">當前分支:</span>
                                            <span className="text-gray-300 bg-gray-800 px-1.5 rounded">{updateInfo.gitInfo.currentBranch}</span>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <span className="text-gray-500">當前版本 (Current):</span>
                                            <span className="text-gray-400 font-mono text-xs">{updateInfo.gitInfo.currentCommit}</span>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <span className="text-gray-500">遠端最新 (Latest):</span>
                                            <span className="text-emerald-400/90 font-mono text-xs">{updateInfo.gitInfo.latestCommit}</span>
                                        </div>
                                        <div className="pt-2 border-t border-gray-800 mt-2">
                                            {updateInfo.gitInfo.behindCount > 0 ? (
                                                <span className="text-amber-400 font-medium">⚠️ 您的系統落後遠端 {updateInfo.gitInfo.behindCount} 個更新 (Commits)。建議進行更新。</span>
                                            ) : (
                                                <span className="text-emerald-400 font-medium">✅ 您目前已經是最新版本，無需更新。</span>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {updateInfo.installMode === 'zip' && updateInfo.remoteVersion && updateInfo.remoteVersion !== 'Unknown' && (
                                    <div className="bg-gray-950 p-4 rounded-lg border border-gray-800 text-sm space-y-2">
                                        <div className="flex items-center gap-2 text-indigo-400 font-semibold mb-2">
                                            <Activity className="w-4 h-4" /> 主機板號差異分析
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">當前版本 (Current):</span>
                                            <span className="text-gray-400 font-mono text-xs text-right">{updateInfo.currentVersion}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">遠端最新 (Latest):</span>
                                            <span className="text-emerald-400/90 font-mono text-xs text-right">{updateInfo.remoteVersion}</span>
                                        </div>
                                        <div className="pt-2 border-t border-gray-800 mt-2">
                                            {updateInfo.isOutdated ? (
                                                <span className="text-amber-400 font-medium">⚠️ 發現新版本 (v{updateInfo.remoteVersion}) 可供更新。建議進行更新。</span>
                                            ) : (
                                                <span className="text-emerald-400 font-medium">✅ 您目前已經是最新版本 (v{updateInfo.currentVersion})。</span>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-3 bg-black/30 p-4 rounded-lg border border-gray-800">
                                    <label className="flex items-start gap-3 cursor-pointer group">
                                        <input type="checkbox" checked={keepMemory} onChange={(e) => setKeepMemory(e.target.checked)} className="mt-1" />
                                        <div className="text-sm">
                                            <span className="text-gray-200 block group-hover:text-white transition-colors">保留 Golem 記憶與設定檔</span>
                                            <span className="text-gray-500 text-xs mt-1 block">強制保留 `golem_memory` 與 `.env`，避免心血流失。（強烈建議勾選）</span>
                                        </div>
                                    </label>

                                    {updateInfo.installMode === 'zip' && (
                                        <label className="flex items-start gap-3 cursor-pointer group pt-3 border-t border-gray-800">
                                            <input type="checkbox" checked={keepOldData} onChange={(e) => setKeepOldData(e.target.checked)} className="mt-1" />
                                            <div className="text-sm">
                                                <span className="text-gray-200 block group-hover:text-white transition-colors">建立完整系統備份</span>
                                                <span className="text-gray-500 text-xs mt-1 block">更新前將現有檔案移至 `backup_` 資料夾以防萬一。若取消勾選則會直接覆蓋刪除。</span>
                                            </div>
                                        </label>
                                    )}
                                </div>

                                <div className="flex gap-3 justify-end pt-2">
                                    <button onClick={() => setShowModal(false)} className="px-4 py-2 hover:bg-gray-800 text-gray-400 rounded-lg text-sm transition-colors">取消</button>
                                    <button
                                        onClick={handleStartUpdate}
                                        disabled={
                                            (updateInfo.installMode === 'git' && updateInfo.gitInfo && updateInfo.gitInfo.behindCount === 0) ||
                                            (updateInfo.installMode === 'zip' && !updateInfo.isOutdated)
                                        }
                                        className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900/50 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                                    >開始更新</button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-6 py-4">
                                <div className="text-center space-y-2">
                                    {updateDone ? (
                                        <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto animate-bounce" />
                                    ) : (
                                        <Loader2 className="w-12 h-12 text-indigo-500 mx-auto animate-spin" />
                                    )}
                                    <p className="text-white font-medium">{statusText || "請稍候..."}</p>
                                </div>

                                {!updateDone && (
                                    <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                                        <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${progress}%` }} />
                                    </div>
                                )}

                                {updateDone && (
                                    <div className="flex gap-3 justify-center pt-4">
                                        <button onClick={() => setShowModal(false)} className="px-4 py-2 hover:bg-gray-800 text-gray-400 border border-gray-700 rounded-lg text-sm">稍後重啟</button>
                                        <button onClick={handleRestart} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold shadow-lg shadow-emerald-900/50">立即重啟系統</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
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
    const [logInfo, setLogInfo] = useState<{ size: string, bytes: number } | null>(null);

    useEffect(() => {
        fetchConfig();
        fetchStatus();
        fetchLogInfo();
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

    const fetchLogInfo = async () => {
        try {
            const res = await fetch('/api/system/log-info');
            if (res.ok) {
                const data = await res.json();
                if (data.success) setLogInfo(data);
            }
        } catch (err) {
            console.error('Failed to fetch log info:', err);
        }
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

        if (!hasEnvChanges) {
            setStatusMessage({ type: 'warning', text: "沒有任何變更需要儲存" });
            setIsSaving(false);
            return;
        }

        try {
            const payload = {
                env: changedEnv
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
            <div className="max-w-6xl mx-auto space-y-6">

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

                {/* System Update Region */}
                <SystemUpdateSection />

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
                            <SettingField
                                label="測試模式"
                                keyName="GOLEM_TEST_MODE"
                                placeholder="false"
                                desc="true 或 false"
                                value={config.env.GOLEM_TEST_MODE || ""}
                                onChange={(val) => handleChangeEnv("GOLEM_TEST_MODE", val)}
                            />

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
                            <div className="grid grid-cols-2 gap-4 mt-4">
                                <SettingField
                                    label="OTA 升級節點 (GitHub Repo)"
                                    keyName="GITHUB_REPO"
                                    placeholder="https://raw.github..."
                                    value={config.env.GITHUB_REPO || ""}
                                    onChange={(val) => handleChangeEnv("GITHUB_REPO", val)}
                                />
                                <div className="space-y-4 col-span-2">
                                    <div className="bg-gray-800/30 p-4 rounded-lg border border-gray-700/50">
                                        <h4 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
                                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                                            日誌輪替策略 (Log Rotation Strategy)
                                        </h4>
                                        <p className="text-xs text-gray-500 mb-4">
                                            系統將自動在「跨日」或「檔案大小達標」時建立新的日誌壓縮檔，這兩個條件只要達成其一即會觸發輪替。
                                        </p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <SettingField
                                                label="單檔儲存上限 (MB)"
                                                keyName="LOG_MAX_SIZE_MB"
                                                placeholder="10"
                                                desc="超過此容量即切割壓縮新檔 (設 0 則不限制)"
                                                value={config.env.LOG_MAX_SIZE_MB || ""}
                                                onChange={(val) => handleChangeEnv("LOG_MAX_SIZE_MB", val)}
                                            />
                                            <SettingField
                                                label="保留歷史檔案天數"
                                                keyName="LOG_RETENTION_DAYS"
                                                placeholder="7"
                                                desc="過舊的壓縮日誌將會自動刪除"
                                                value={config.env.LOG_RETENTION_DAYS || ""}
                                                onChange={(val) => handleChangeEnv("LOG_RETENTION_DAYS", val)}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="mt-4 pt-4 border-t border-gray-800/80">
                                <div className="flex items-center justify-between mb-4">
                                    <span className="text-sm font-medium text-gray-300 flex items-center gap-2">
                                        啟用系統日誌 (System Log)
                                        {logInfo && (
                                            <span className={`px-2 py-0.5 rounded text-xs font-mono ml-2 ${logInfo.bytes > 10 * 1024 * 1024 ? 'bg-red-900/50 text-red-400' : 'bg-green-900/30 text-green-400'}`}>
                                                system.log 大小: {logInfo.size}
                                            </span>
                                        )}
                                    </span>
                                </div>
                                <SettingField
                                    label=""
                                    keyName="ENABLE_SYSTEM_LOG"
                                    placeholder="true"
                                    desc="設為 false 將完全不記錄 system.log，節省硬碟空間"
                                    value={config.env.ENABLE_SYSTEM_LOG || ""}
                                    onChange={(val) => handleChangeEnv("ENABLE_SYSTEM_LOG", val)}
                                />
                            </div>
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
                            <div className="mt-4">
                                <SettingField
                                    label="興趣標籤 (User Interests)"
                                    keyName="USER_INTERESTS"
                                    placeholder="科技圈熱門話題,全球趣聞"
                                    desc="用於自主搜尋與聊天，請使用半形逗號「,」分隔多個興趣項目。"
                                    value={config.env.USER_INTERESTS || ""}
                                    onChange={(val) => handleChangeEnv("USER_INTERESTS", val)}
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
                        {/* Section: Other Variables (Read Only) */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 mb-6">
                            {Object.keys(config.env)
                                .filter(k => ![
                                    'GEMINI_API_KEYS', 'TELEGRAM_TOKEN', 'TG_AUTH_MODE', 'ADMIN_ID', 'TG_CHAT_ID',
                                    'DISCORD_TOKEN', 'DISCORD_ADMIN_ID', 'USER_DATA_DIR', 'GOLEM_TEST_MODE',
                                    'GOLEM_MODE', 'GOLEM_MEMORY_MODE', 'GITHUB_REPO',
                                    'MOLTBOOK_API_KEY', 'MOLTBOOK_AGENT_NAME',
                                    'GOLEM_AWAKE_INTERVAL_MIN', 'GOLEM_AWAKE_INTERVAL_MAX',
                                    'GOLEM_SLEEP_START', 'GOLEM_SLEEP_END', 'USER_INTERESTS', 'COMMAND_WHITELIST', 'CUSTOM_COMMANDS', 'COMMAND_EXEMPT_KEYWORDS',
                                    'AUTHORIZED_DANGEROUS_COMMANDS', 'CUSTOM_DANGEROUS_COMMANDS', 'AUTHORIZED_SENSITIVE_KEYWORDS', 'CUSTOM_SENSITIVE_KEYWORDS'
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

                        {/* 🛡️ 三橫列安全管理架構 (v9.6 Refined) */}
                        <div className="mt-8 border-t border-gray-800/80 pt-6 space-y-12">
                            {/* Row 1: 指令精確白名單 (Exact Match Whitelist) */}
                            <div className="group/row transition-all">
                                <h3 className="text-lg font-bold text-emerald-400 mb-2 flex items-center gap-2 group-hover/row:translate-x-1 transition-transform">
                                    <ShieldCheck className="w-6 h-6" /> 1. 指令精確白名單 (Exact Match)
                                </h3>
                                <p className="text-sm text-gray-500 mb-6 font-light">
                                    此處管理的指令必須「完全相同」才會放行。適用於一般的系統查詢或安全腳本。
                                </p>
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    {/* 系統預設庫 */}
                                    <div className="bg-gray-950/20 border border-gray-800/50 rounded-2xl p-5">
                                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                                            📦 系統安全庫 (預設)
                                        </h4>
                                        <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto custom-scrollbar">
                                            {['ls', 'dir', 'pwd', 'date', 'echo', 'cat', 'grep', 'find', 'whoami', 'tail', 'head', 'df', 'free', 'golem-check']
                                                .filter(cmd => !(config.env.COMMAND_WHITELIST || "").split(',').includes(cmd))
                                                .map(cmd => (
                                                    <button
                                                        key={cmd}
                                                        onClick={() => {
                                                            const current = (config.env.COMMAND_WHITELIST || "").split(',').filter(Boolean);
                                                            handleChangeEnv("COMMAND_WHITELIST", [...current, cmd].join(','));
                                                        }}
                                                        className="px-3 py-1.5 bg-gray-900 border border-gray-800 text-gray-400 text-xs font-mono rounded-lg hover:border-emerald-500/50 hover:text-gray-200 transition-all"
                                                        title="點擊加入允許清單"
                                                    >
                                                        + {cmd}
                                                    </button>
                                                ))}
                                        </div>
                                    </div>
                                    {/* 自訂備選池 */}
                                    <div className="bg-gray-950/20 border border-gray-800/50 rounded-2xl p-5">
                                        <h4 className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                                            💾 自訂指令池
                                        </h4>
                                        <div className="flex gap-2 mb-4">
                                            <input
                                                type="text"
                                                placeholder="新增常用指令..."
                                                className="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:border-blue-500 transition-colors"
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        const val = e.currentTarget.value.trim();
                                                        if (val) {
                                                            const current = (config.env.CUSTOM_COMMANDS || "").split(',').filter(Boolean);
                                                            if (!current.includes(val)) handleChangeEnv("CUSTOM_COMMANDS", [...current, val].join(','));
                                                            e.currentTarget.value = "";
                                                        }
                                                    }
                                                }}
                                            />
                                        </div>
                                        <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto custom-scrollbar">
                                            {(config.env.CUSTOM_COMMANDS || "").split(',').filter(Boolean).map(cmd => (
                                                <div key={cmd} className="group flex items-center bg-blue-950/10 border border-blue-900/30 rounded-lg pr-1">
                                                    <button
                                                        onClick={() => {
                                                            const currentWh = (config.env.COMMAND_WHITELIST || "").split(',').filter(Boolean);
                                                            handleChangeEnv("COMMAND_WHITELIST", [...currentWh, cmd].join(','));
                                                            const currentCu = (config.env.CUSTOM_COMMANDS || "").split(',').filter(Boolean);
                                                            handleChangeEnv("CUSTOM_COMMANDS", currentCu.filter(c => c !== cmd).join(','));
                                                        }}
                                                        className="px-3 py-1.5 text-blue-400 text-xs font-mono hover:text-blue-300 transition-colors"
                                                        title="點擊啟用免審批"
                                                    >
                                                        + {cmd}
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            const current = (config.env.CUSTOM_COMMANDS || "").split(',').filter(Boolean);
                                                            handleChangeEnv("CUSTOM_COMMANDS", current.filter(c => c !== cmd).join(','));
                                                        }}
                                                        className="p-1 text-blue-900 hover:text-red-500 transition-colors"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    {/* 允許清單 */}
                                    <div className="bg-emerald-950/10 border border-emerald-900/30 rounded-2xl p-5 outline outline-2 outline-emerald-500/20">
                                        <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                            ✅ 允許清單 (免審批)
                                        </h4>
                                        <div className="flex flex-wrap gap-2 max-h-72 overflow-y-auto custom-scrollbar">
                                            {(config.env.COMMAND_WHITELIST || "").split(',').filter(Boolean).map(cmd => (
                                                <div key={cmd} className="flex items-center bg-gray-900 border border-emerald-500/50 rounded-lg px-3 py-1.5 group select-none">
                                                    <span className="text-emerald-400 text-xs font-mono">{cmd}</span>
                                                    <button
                                                        onClick={() => {
                                                            const currentWh = (config.env.COMMAND_WHITELIST || "").split(',').filter(Boolean);
                                                            handleChangeEnv("COMMAND_WHITELIST", currentWh.filter(c => c !== cmd).join(','));
                                                            // 如果不是系統預設的，放回備選池
                                                            const system = ['ls', 'dir', 'pwd', 'date', 'echo', 'cat', 'grep', 'find', 'whoami', 'tail', 'head', 'df', 'free', 'golem-check'];
                                                            if (!system.includes(cmd)) {
                                                                const currentCu = (config.env.CUSTOM_COMMANDS || "").split(',').filter(Boolean);
                                                                if (!currentCu.includes(cmd)) handleChangeEnv("CUSTOM_COMMANDS", [...currentCu, cmd].join(','));
                                                            }
                                                        }}
                                                        className="ml-2 opacity-0 group-hover:opacity-100 p-0.5 text-gray-500 hover:text-red-400 transition-all"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            ))}
                                            {!(config.env.COMMAND_WHITELIST || "").trim() && (
                                                <div className="w-full text-center py-6 text-gray-600 text-xs italic border border-dashed border-gray-800 rounded-lg">
                                                    未啟用任何免審批指令
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Row 2: 危險指令管理 (Dangerous Commands) */}
                            <div className="group/row transition-all">
                                <h3 className="text-lg font-bold text-red-500 mb-2 flex items-center gap-2 group-hover/row:translate-x-1 transition-transform">
                                    <ShieldAlert className="w-6 h-6" /> 2. 危險指令管理 (Dangerous Patterns)
                                </h3>
                                <p className="text-sm text-gray-500 mb-6 font-light">
                                    針對毀滅性操作，系統預設嚴格阻擋。您可將特定完整指令加入「豁免欄」以容許執行（執行前仍會提醒）。
                                </p>
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    {/* 系統阻擋清單 (可點擊加入豁免) */}
                                    <div className="bg-red-950/10 border border-red-900/30 rounded-2xl p-5">
                                        <h4 className="text-xs font-bold text-red-600 uppercase tracking-wider mb-4 flex items-center gap-2">
                                            💀 系統預設阻擋 (點擊快速豁免)
                                        </h4>
                                        <div className="flex flex-wrap gap-2">
                                            {['rm -rf /', 'rd /s /q', '> /dev/sd', ':(){:|:&};:', 'mkfs', 'Format-Volume', 'dd if=', 'chmod -x', 'rm', 'mv', 'chmod', 'chown', 'sudo', 'su', 'reboot', 'shutdown', 'npm uninstall', 'Remove-Item', 'Stop-Computer']
                                                .filter(cmd => !(config.env.AUTHORIZED_DANGEROUS_COMMANDS || "").split(',').includes(cmd))
                                                .map(cmd => (
                                                    <button
                                                        key={cmd}
                                                        onClick={() => {
                                                            const current = (config.env.AUTHORIZED_DANGEROUS_COMMANDS || "").split(',').filter(Boolean);
                                                            if (!current.includes(cmd)) handleChangeEnv("AUTHORIZED_DANGEROUS_COMMANDS", [...current, cmd].join(','));
                                                        }}
                                                        className="px-2 py-1 bg-red-950/30 border border-red-900/50 text-red-400 text-[10px] font-mono rounded hover:bg-red-500 hover:text-white transition-all"
                                                        title="點擊將此指令模式加入豁免名單"
                                                    >
                                                        {cmd}
                                                    </button>
                                                ))}
                                            {['rm -rf /', 'rd /s /q', '> /dev/sd', ':(){:|:&};:', 'mkfs', 'Format-Volume', 'dd if=', 'chmod -x']
                                                .every(cmd => (config.env.AUTHORIZED_DANGEROUS_COMMANDS || "").split(',').includes(cmd)) && (
                                                <div className="text-[10px] text-gray-600 italic">所有系統預設危險指令皆已豁免</div>
                                            )}
                                        </div>
                                    </div>
                                    {/* 自訂風險模式 (Contains) */}
                                    <div className="bg-gray-950/20 border border-gray-800/50 rounded-2xl p-5">
                                        <h4 className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-4">
                                            ⚠️ 擴充危險模式 (包含比對)
                                        </h4>
                                        <div className="flex gap-2 mb-4">
                                            <input
                                                type="text"
                                                placeholder="輸入自訂風險關鍵字..."
                                                className="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:border-amber-500 transition-colors"
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        const val = e.currentTarget.value.trim();
                                                        if (val) {
                                                            const current = (config.env.CUSTOM_DANGEROUS_COMMANDS || "").split(',').filter(Boolean);
                                                            if (!current.includes(val)) handleChangeEnv("CUSTOM_DANGEROUS_COMMANDS", [...current, val].join(','));
                                                            e.currentTarget.value = "";
                                                        }
                                                    }
                                                }}
                                            />
                                        </div>
                                        <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto custom-scrollbar">
                                            {(config.env.CUSTOM_DANGEROUS_COMMANDS || "").split(',').filter(Boolean).map(cmd => (
                                                <div key={cmd} className="flex items-center bg-gray-900 border border-amber-900/50 rounded-lg px-2 py-1 group">
                                                    <span className="text-amber-500 text-[10px] font-mono">{cmd}</span>
                                                    <button
                                                        onClick={() => {
                                                            const current = (config.env.CUSTOM_DANGEROUS_COMMANDS || "").split(',').filter(Boolean);
                                                            handleChangeEnv("CUSTOM_DANGEROUS_COMMANDS", current.filter(c => c !== cmd).join(','));
                                                        }}
                                                        className="ml-2 opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-500 transition-all"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    {/* 豁免清單 */}
                                    <div className="bg-red-950/10 border border-red-900/30 rounded-2xl p-5 outline outline-2 outline-red-500/20">
                                        <h4 className="text-xs font-bold text-red-500 uppercase tracking-wider mb-4">
                                            🔓 豁免清單 (Waiver List)
                                        </h4>
                                        <div className="flex gap-2 mb-4">
                                            <input
                                                type="text"
                                                placeholder="輸入完整指令給予豁免..."
                                                className="flex-1 bg-gray-900 border border-red-900/50 rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:border-red-500 transition-colors"
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        const val = e.currentTarget.value.trim();
                                                        if (val) {
                                                            const current = (config.env.AUTHORIZED_DANGEROUS_COMMANDS || "").split(',').filter(Boolean);
                                                            if (!current.includes(val)) handleChangeEnv("AUTHORIZED_DANGEROUS_COMMANDS", [...current, val].join(','));
                                                            e.currentTarget.value = "";
                                                        }
                                                    }
                                                }}
                                            />
                                        </div>
                                        <div className="flex flex-wrap gap-2 max-h-60 overflow-y-auto custom-scrollbar">
                                            {(config.env.AUTHORIZED_DANGEROUS_COMMANDS || "").split(',').filter(Boolean).map(cmd => (
                                                <div key={cmd} className="flex items-center bg-red-900/10 border border-red-900/30 rounded-lg px-2 py-1 group">
                                                    <span className="text-red-300 text-[10px] font-mono line-clamp-1">{cmd}</span>
                                                    <button
                                                        onClick={() => {
                                                            const current = (config.env.AUTHORIZED_DANGEROUS_COMMANDS || "").split(',').filter(Boolean);
                                                            handleChangeEnv("AUTHORIZED_DANGEROUS_COMMANDS", current.filter(c => c !== cmd).join(','));
                                                        }}
                                                        className="ml-2 opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 transition-all"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            ))}
                                            {!(config.env.AUTHORIZED_DANGEROUS_COMMANDS || "").trim() && (
                                                <div className="w-full text-center py-4 text-gray-600 text-[10px] italic border border-dashed border-gray-800 rounded-lg">
                                                    尚未豁免任何指令
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Row 3: 關鍵字放行與敏感符號管理 (Keyword/Symbol Management) */}
                            <div className="group/row transition-all">
                                <h3 className="text-lg font-bold text-cyan-400 mb-2 flex items-center gap-2 group-hover/row:translate-x-1 transition-transform">
                                    <Lock className="w-6 h-6" /> 3. 關鍵字放行與敏感符號 (Contains Match)
                                </h3>
                                <p className="text-sm text-gray-500 mb-6 font-light">
                                    此處管理的條目只要指令「包含」其中內容即生效。適用於授權特定符號（如 `&&`）或工具（如 `git`）。
                                </p>
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    {/* Column 1: 系統敏感符號 (Templates) */}
                                    <div className="bg-gray-950/20 border border-gray-800/50 rounded-2xl p-5">
                                        <h4 className="text-xs font-bold text-cyan-500 uppercase tracking-wider mb-2">
                                            📍 敏感符號模板
                                        </h4>
                                        <p className="text-[10px] text-gray-500 mb-4">點擊將符號加入授權以消除警告。</p>
                                        <div className="flex flex-wrap gap-2">
                                            {['>', '<', '`', '$(', ';', '&&', '||', '|']
                                                .filter(s => !(config.env.AUTHORIZED_SENSITIVE_KEYWORDS || "").split(',').includes(s))
                                                .map(s => (
                                                    <button
                                                        key={s}
                                                        onClick={() => {
                                                            const current = (config.env.AUTHORIZED_SENSITIVE_KEYWORDS || "").split(',').filter(Boolean);
                                                            if (!current.includes(s)) handleChangeEnv("AUTHORIZED_SENSITIVE_KEYWORDS", [...current, s].join(','));
                                                        }}
                                                        className="px-3 py-1.5 bg-gray-900 border border-gray-800 text-cyan-800 font-mono rounded-lg text-xs hover:border-cyan-500/50 hover:text-cyan-400 transition-all"
                                                        title="點擊授權此符號"
                                                    >
                                                        {s}
                                                    </button>
                                                ))}
                                            {['>', '<', '`', '$(', ';', '&&', '||', '|']
                                                .every(s => (config.env.AUTHORIZED_SENSITIVE_KEYWORDS || "").split(',').includes(s)) && (
                                                <div className="text-[10px] text-gray-600 italic">所有預設符號皆已授權</div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Column 2: 授權符號管理 (Authorized Symbols) */}
                                    <div className="bg-cyan-950/10 border border-cyan-900/30 rounded-2xl p-5">
                                        <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                            🛡️ 已授權符號 (Authorized)
                                        </h4>
                                        <div className="flex gap-2 mb-4">
                                            <input
                                                type="text"
                                                placeholder="新增其他敏感關鍵字..."
                                                className="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:border-cyan-500 transition-colors"
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        const val = e.currentTarget.value.trim();
                                                        if (val) {
                                                            const current = (config.env.AUTHORIZED_SENSITIVE_KEYWORDS || "").split(',').filter(Boolean);
                                                            if (!current.includes(val)) handleChangeEnv("AUTHORIZED_SENSITIVE_KEYWORDS", [...current, val].join(','));
                                                            e.currentTarget.value = "";
                                                        }
                                                    }
                                                }}
                                            />
                                        </div>
                                        <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto custom-scrollbar">
                                            {(config.env.AUTHORIZED_SENSITIVE_KEYWORDS || "").split(',').filter(Boolean).map(s => (
                                                <div key={s} className="flex items-center bg-gray-900 border border-cyan-500/30 rounded-lg px-2 py-1 group">
                                                    <span className="text-cyan-400 text-xs font-mono">{s}</span>
                                                    <button
                                                        onClick={() => {
                                                            const current = (config.env.AUTHORIZED_SENSITIVE_KEYWORDS || "").split(',').filter(Boolean);
                                                            handleChangeEnv("AUTHORIZED_SENSITIVE_KEYWORDS", current.filter(c => c !== s).join(','));
                                                        }}
                                                        className="ml-2 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-500 transition-all"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            ))}
                                            {!(config.env.AUTHORIZED_SENSITIVE_KEYWORDS || "").trim() && (
                                                <div className="w-full text-center py-4 text-gray-600 text-[10px] italic border border-dashed border-gray-800 rounded-lg">
                                                    尚未授權任何符號
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Column 3: 全局免審批關鍵字 (Exempt Keywords) */}
                                    <div className="bg-cyan-950/5 border border-cyan-900/20 rounded-2xl p-5 outline outline-2 outline-cyan-500/10">
                                        <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-2">
                                            ✨ 免審批工具 (Keyword Bypass)
                                        </h4>
                                        <p className="text-[10px] text-gray-500 mb-4">包含這些詞即「自動放行」（且不受符號限制）。</p>
                                        <div className="flex gap-2 mb-4">
                                            <input
                                                type="text"
                                                placeholder="例如: git, npm, docker..."
                                                className="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:border-cyan-400 transition-colors"
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        const val = e.currentTarget.value.trim();
                                                        if (val) {
                                                            const current = (config.env.COMMAND_EXEMPT_KEYWORDS || "").split(',').filter(Boolean);
                                                            if (!current.includes(val)) handleChangeEnv("COMMAND_EXEMPT_KEYWORDS", [...current, val].join(','));
                                                            e.currentTarget.value = "";
                                                        }
                                                    }
                                                }}
                                            />
                                        </div>
                                        <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto custom-scrollbar">
                                            {(config.env.COMMAND_EXEMPT_KEYWORDS || "").split(',').filter(Boolean).map(s => (
                                                <div key={s} className="flex items-center bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-3 py-1.5 group">
                                                    <span className="text-cyan-300 text-xs font-mono">{s}</span>
                                                    <button
                                                        onClick={() => {
                                                            const current = (config.env.COMMAND_EXEMPT_KEYWORDS || "").split(',').filter(Boolean);
                                                            handleChangeEnv("COMMAND_EXEMPT_KEYWORDS", current.filter(c => c !== s).join(','));
                                                        }}
                                                        className="ml-2 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            ))}
                                            {!(config.env.COMMAND_EXEMPT_KEYWORDS || "").trim() && (
                                                <div className="w-full text-center py-4 text-gray-600 text-[10px] italic border border-dashed border-gray-800 rounded-lg">
                                                    尚未設定關鍵字放行
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
