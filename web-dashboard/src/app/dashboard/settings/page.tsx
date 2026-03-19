"use client";

import React, { useState, useEffect } from "react";
import {
    Settings, Save, RefreshCw, AlertTriangle, CheckCircle2,
    Eye, EyeOff, Lock, Users, Server, Activity, Cpu, HardDrive,
    DownloadCloud, Loader2, Sparkles, ArrowRight, MessageSquare,
    Clock, ShieldCheck, Settings2, AlertCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { io } from "socket.io-client";
import { ConfirmModal } from "@/components/ConfirmModal";

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
    hasGolems?: boolean;
    liveCount?: number;
    configuredCount?: number;
    isSystemConfigured?: boolean;
    runtime?: { node: string; npm: string; platform: string; arch: string; uptime: number; osName: string };
    health?: { node: boolean; env: boolean; keys: boolean; deps: boolean; core: boolean; dashboard: boolean };
    system?: { totalMem: string; freeMem: string; diskAvail: string };
};

const SystemHealthDashboard = ({ systemStatus }: { systemStatus: SystemStatus | null }) => {
    if (!systemStatus) return null;

    const { runtime, health, system } = systemStatus;

    const StatusItem = ({ label, status, icon: Icon }: { label: string, status: boolean, icon: any }) => (
        <div className="flex items-center justify-between p-2 rounded-lg bg-secondary/30 border border-border/40">
            <div className="flex items-center gap-2">
                <Icon className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-foreground/80">{label}</span>
            </div>
            {status ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-500" />
            ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-500" />
            )}
        </div>
    );

    const healthChecks = health ? Object.values(health) : [];
    const healthyCount = healthChecks.filter(Boolean).length;
    const isReady = healthyCount === healthChecks.length && healthChecks.length > 0;
    const needsAction = healthyCount < healthChecks.length;

    return (
        <div className="space-y-6 mb-8 animate-in fade-in slide-in-from-top-4 duration-500">
            {/* 0. System Integrity Banner */}
            <div className={cn(
                "rounded-xl p-5 shadow-sm border transition-all duration-500 flex items-center justify-between",
                isReady ? "bg-emerald-500/5 border-emerald-500/20" : 
                needsAction ? "bg-amber-500/5 border-amber-500/20" : "bg-muted/5 border-border"
            )}>
                <div className="flex items-center gap-4">
                    <div className={cn(
                        "p-3 rounded-full shadow-inner",
                        isReady ? "bg-emerald-500/10 text-emerald-500" : 
                        needsAction ? "bg-amber-500/10 text-amber-500" : "bg-muted text-muted-foreground"
                    )}>
                        {isReady ? <ShieldCheck className="w-6 h-6" /> : 
                         needsAction ? <AlertCircle className="w-6 h-6" /> : <Activity className="w-6 h-6" />}
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-foreground">
                            系統健康診斷 (System Integrity)
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1">
                            {isReady ? "所有核心模組與配置運作正常，系統處於最佳狀態。" :
                             needsAction ? `檢測到 ${healthChecks.length - healthyCount} 項異常，請檢查下方健康檢查細項。` :
                             "正在初始化系統狀態..."}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="text-right hidden sm:block">
                        <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Health Score</div>
                        <div className={cn(
                            "text-xl font-black font-mono",
                            isReady ? "text-emerald-500" : needsAction ? "text-amber-500" : "text-muted-foreground"
                        )}>
                            {healthChecks.length > 0 ? Math.round((healthyCount / healthChecks.length) * 100) : 0}%
                        </div>
                    </div>
                    <span className={cn(
                        "px-3 py-1.5 rounded-full text-[10px] font-bold tracking-wider uppercase shadow-sm border",
                        isReady ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : 
                        needsAction ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : "bg-muted text-muted-foreground border-border"
                    )}>
                        {isReady ? "Operational" : needsAction ? "Action Required" : "Unknown"}
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* 1. Runtime Info */}
                <div className="bg-card border border-border hover:border-primary/30 transition-colors rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <Cpu className="w-5 h-5 text-primary" />
                        <h3 className="text-sm font-semibold text-foreground">運作環境 (Runtime)</h3>
                    </div>
                    <div className="space-y-3">
                        <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">OS</span>
                            <span className="text-primary font-medium truncate max-w-[150px]" title={runtime?.osName}>{runtime?.osName || 'Unknown'}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Node.js</span>
                            <span className="text-foreground font-mono">{runtime?.node || 'Unknown'}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">npm</span>
                            <span className="text-foreground font-mono">{runtime?.npm || 'Unknown'}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Platform</span>
                            <span className="text-foreground capitalize">{runtime?.platform} ({runtime?.arch})</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Uptime</span>
                            <span className="text-foreground">{Math.floor((runtime?.uptime || 0) / 3600)}h {Math.floor(((runtime?.uptime || 0) % 3600) / 60)}m</span>
                        </div>
                    </div>
                </div>

                {/* 2. System Health */}
                <div className="bg-card border border-border hover:border-primary/30 transition-colors rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <Activity className="w-5 h-5 text-emerald-500" />
                        <h3 className="text-sm font-semibold text-foreground">健康檢查 (Health)</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <StatusItem label="API Keys" status={!!health?.keys} icon={Activity} />
                        <StatusItem label="Env Config" status={!!health?.env} icon={Activity} />
                        <StatusItem label="Dependencies" status={!!health?.deps} icon={Activity} />
                        <StatusItem label="Core Files" status={!!health?.core} icon={Activity} />
                        <StatusItem label="Dashboard" status={!!health?.dashboard} icon={Activity} />
                    </div>
                </div>

                {/* 3. System Resources */}
                <div className="bg-card border border-border hover:border-primary/30 transition-colors rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <Server className="w-5 h-5 text-primary" />
                        <h3 className="text-sm font-semibold text-foreground">系統資源 (Resources)</h3>
                    </div>
                    <div className="space-y-4">
                        <div>
                            <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                                <span>記憶體 (Memory)</span>
                                <span>{system?.freeMem} / {system?.totalMem}</span>
                            </div>
                            <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-indigo-500 transition-all duration-1000 shadow-[0_0_8px_rgba(99,102,241,0.5)]"
                                    style={{ width: `${100 - (parseInt(system?.freeMem || "0") / parseInt(system?.totalMem || "1")) * 100}%` }}
                                />
                            </div>
                        </div>
                        <div className="flex justify-between text-xs pt-1">
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <HardDrive className="w-4 h-4" />
                                磁碟可用空間
                            </div>
                            <span className="text-primary font-bold">{system?.diskAvail || 'N/A'}</span>
                        </div>
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
            <label className="text-sm font-medium text-muted-foreground mb-1 flex items-center justify-between gap-1 overflow-hidden">
                <span className="truncate mr-1" title={label}>{label}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                    {isReadOnly && (
                        <span className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded border border-border flex items-center gap-1 whitespace-nowrap">
                            <Lock className="w-3 h-3" /> 唯讀
                        </span>
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
                    className={`w-full bg-secondary/30 border border-border focus:border-primary rounded-lg px-3 py-2 text-sm text-foreground font-mono transition-colors ${isReadOnly ? "opacity-70 cursor-not-allowed bg-muted" : ""} ${isSecret ? "pr-10" : ""}`}
                    spellCheck={false}
                />
                {isSecret && (
                    <button
                        type="button"
                        onClick={() => setIsVisible(!isVisible)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                        title={isVisible ? "隱藏內容" : "顯示內容"}
                    >
                        {isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                )}
            </div>
            {desc && <p className="text-xs text-muted-foreground mt-1">{desc}</p>}
        </div>
    );
};

const SettingSelectField = ({
    label, desc = "", value = "", onChange, options = []
}: {
    label: string,
    desc?: string,
    value?: string,
    onChange?: (val: string) => void,
    options: { value: string, label: string }[]
}) => {
    return (
        <div className="flex flex-col mb-4">
            <label className="text-sm font-medium text-muted-foreground mb-1 flex items-center justify-between gap-1 overflow-hidden">
                <span className="truncate mr-1" title={label}>{label}</span>
            </label>
            <select
                value={value}
                onChange={(e) => {
                    if (onChange) onChange(e.target.value);
                }}
                className="w-full bg-secondary/30 border border-border focus:border-primary rounded-lg px-3 py-2 text-sm text-foreground transition-colors"
            >
                {options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
            {desc && <p className="text-xs text-muted-foreground mt-1">{desc}</p>}
        </div>
    );
};

const LOCAL_MODELS = [
    {
        id: "Xenova/bge-small-zh-v1.5",
        name: "BGE-Small (繁簡中文最佳，推薦)",
        features: "🏆 中文王者：開序社群中文檢索榜首，語義捕捉極佳。",
        notes: "體積約 90MB，推論極快，適合大部分中文場景。",
        recommendation: "Golem 記憶體高達 80% 以上是中文時首選。"
    },
    {
        id: "Xenova/bge-base-zh-v1.5",
        name: "BGE-Base (高精確度版)",
        features: "精準細膩：比 Small 版本有更深層的語義理解能力。",
        notes: "體積較大，對硬體資源要求略高，載入較慢。",
        recommendation: "需要極高語義精確度且記憶體資源充裕時使用。"
    },
    {
        id: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
        name: "MiniLM-L12 (多語系守門員)",
        features: "🥈 跨語言專家：支援 50+ 語言，對中英夾雜句子理解極佳。",
        notes: "支援「蘋果」與「Apple」的跨語言語義對齊。",
        recommendation: "對話中頻繁夾雜程式碼、英文術語時推薦。"
    },
    {
        id: "Xenova/nomic-embed-text-v1.5",
        name: "Nomic Embed (長文本專家)",
        features: "🥉 超大視窗：支援高達 8192 Token 長度，不截斷訊息。",
        notes: "能將整篇長文壓縮成向量而不遺失細節。",
        recommendation: "記憶單位多為長篇大論或完整網頁草稿時推薦。"
    },
    {
        id: "Xenova/all-MiniLM-L6-v2",
        name: "MiniLM-L6 (輕量多語)",
        features: "極致輕快：最經典的嵌入模型，效能與速度平衡。",
        notes: "支援多國語言，是大多數向量應用的基準模型。",
        recommendation: "一般性用途且希望資源消耗最小化時使用。"
    }
];

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
                        const data = await checkRes.json();
                        if (!data.isBooting) {
                            clearInterval(pollInterval);
                            setStatusText("重新啟動完成！頁面即將重新載入...");
                            setTimeout(() => { window.location.reload(); }, 1500);
                        } else {
                            setStatusText("系統正在初始化中...");
                        }
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
        <div className="bg-card border border-primary/20 hover:border-primary/40 transition-colors rounded-xl p-5 shadow-sm mb-6 animate-in fade-in">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                        <DownloadCloud className="w-5 h-5 text-primary" />
                        系統升級與版本控制 (System Update)
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        當前版本: <span className="font-mono text-primary px-1">{updateInfo.currentVersion}</span>
                        | 安裝模式: <span className="uppercase text-[10px] bg-secondary px-1.5 py-0.5 rounded ml-1 tracking-wider text-muted-foreground">{updateInfo.installMode}</span>
                    </p>
                </div>
                <button
                    onClick={() => { setShowModal(true); setUpdateDone(false); setIsUpdating(false); setStatusText(""); }}
                    className="px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-lg text-sm transition-all font-medium"
                >
                    檢查並更新系統 (Update)
                </button>
            </div>

            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full p-6 space-y-6">
                        <h3 className="text-xl font-bold flex items-center gap-2 text-foreground">
                            <DownloadCloud className="w-6 h-6 text-primary" />
                            系統一鍵更新
                        </h3>

                        {!isUpdating && !updateDone ? (
                            <div className="space-y-4">
                                <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
                                <p className="text-sm text-gray-300 text-center">
                                    此動作將會從 GitHub 下載最新程式碼並進行覆寫。過程可能需要幾分鐘。
                                </p>

                                {updateInfo.installMode === 'git' && updateInfo.gitInfo && (
                                    <div className="bg-secondary/30 p-4 rounded-lg border border-border text-sm space-y-2">
                                        <div className="flex items-center gap-2 text-primary font-semibold mb-2">
                                            <Activity className="w-4 h-4" /> Git 版本差異分析
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">當前分支:</span>
                                            <span className="text-foreground bg-secondary px-1.5 rounded">{updateInfo.gitInfo.currentBranch}</span>
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

                                <div className="space-y-3 bg-muted/30 p-4 rounded-lg border border-border">
                                    <label className="flex items-start gap-3 cursor-pointer group">
                                        <input type="checkbox" checked={keepMemory} onChange={(e) => setKeepMemory(e.target.checked)} className="mt-1" />
                                        <div className="text-sm">
                                            <span className="text-foreground block group-hover:text-primary transition-colors">保留 Golem 記憶與設定檔</span>
                                            <span className="text-muted-foreground text-xs mt-1 block">強制保留 `golem_memory` 與 `.env`，避免心血流失。（強烈建議勾選）</span>
                                        </div>
                                    </label>

                                    {updateInfo.installMode === 'zip' && (
                                        <label className="flex items-start gap-3 cursor-pointer group pt-3 border-t border-border">
                                            <input type="checkbox" checked={keepOldData} onChange={(e) => setKeepOldData(e.target.checked)} className="mt-1" />
                                            <div className="text-sm">
                                                <span className="text-foreground block group-hover:text-primary transition-colors">建立完整系統備份</span>
                                                <span className="text-muted-foreground text-xs mt-1 block">更新前將現有檔案移至 `backup_` 資料夾以防萬一。若取消勾選則會直接覆蓋刪除。</span>
                                            </div>
                                        </label>
                                    )}
                                </div>

                                <div className="flex gap-3 justify-end pt-2">
                                    <button onClick={() => setShowModal(false)} className="px-4 py-2 hover:bg-secondary text-muted-foreground rounded-lg text-sm transition-colors">取消</button>
                                    <button
                                        onClick={handleStartUpdate}
                                        disabled={
                                            (updateInfo.installMode === 'git' && updateInfo.gitInfo && updateInfo.gitInfo.behindCount === 0) ||
                                            (updateInfo.installMode === 'zip' && !updateInfo.isOutdated)
                                        }
                                        className="px-5 py-2 bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-primary-foreground rounded-lg text-sm font-medium transition-colors"
                                    >開始更新</button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-6 py-4">
                                <div className="text-center space-y-2">
                                    {updateDone ? (
                                        <CheckCircle2 className="w-12 h-12 text-primary mx-auto animate-bounce" />
                                    ) : (
                                        <Loader2 className="w-12 h-12 text-primary mx-auto animate-spin" />
                                    )}
                                    <p className="text-foreground font-medium">{statusText || "請稍候..."}</p>
                                </div>

                                {!updateDone && (
                                    <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                                        <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
                                    </div>
                                )}

                                {updateDone && (
                                    <div className="flex gap-3 justify-center pt-4">
                                        <button onClick={() => setShowModal(false)} className="px-4 py-2 hover:bg-secondary text-muted-foreground border border-border rounded-lg text-sm">稍後重啟</button>
                                        <button onClick={handleRestart} className="px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-bold shadow-lg">立即重啟系統</button>
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
    const [isRestartConfirmOpen, setIsRestartConfirmOpen] = useState(false);
    const [activeTab, setActiveTab] = useState("overview");

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
        setIsRestartConfirmOpen(true);
    };

    const executeRestart = async () => {
        setIsRestartConfirmOpen(false);
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
                    <RefreshCw className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-muted-foreground font-mono text-sm">讀取總開關系統中...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 p-4 md:p-6 overflow-y-auto">
            <div className="max-w-6xl mx-auto space-y-6">

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4 sticky top-0 bg-background/95 backdrop-blur z-20">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Settings className="w-6 h-6 text-primary" />
                            系統配置總表 (System Settings)
                        </h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            管理 Golem 的全域配置與 API 金鑰。所有變更均需重啟系統才能完全生效。
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleRestartSystem}
                            className="px-4 py-2 bg-secondary hover:bg-destructive/10 text-muted-foreground hover:text-destructive border border-border hover:border-destructive/30 rounded-lg text-sm transition-all flex items-center gap-2"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Restart System
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className={cn(
                                "px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
                                isSaving
                                    ? "bg-muted text-muted-foreground cursor-not-allowed border border-border"
                                    : "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30 hover:border-primary"
                            )}
                        >
                            {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {isSaving ? "Saving..." : "Save Settings"}
                        </button>
                    </div>
                </div>

                {/* Tab Navigation */}
                <div className="flex items-center gap-1 bg-muted/30 p-1 rounded-xl border border-border/50 overflow-x-auto no-scrollbar">
                    {[
                        { id: 'overview', name: '系統概況', icon: Activity },
                        { id: 'engine', name: '核心引擎', icon: Cpu },
                        { id: 'messaging', name: '通訊平台', icon: MessageSquare },
                        { id: 'schedule', name: '自動化作息', icon: Clock },
                        { id: 'security', name: '安全與指令', icon: ShieldCheck },
                        { id: 'advanced', name: '進階維護', icon: Settings2 }
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
                                activeTab === tab.id
                                    ? "bg-primary text-primary-foreground shadow-sm"
                                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                            )}
                        >
                            <tab.icon className="w-4 h-4" />
                            {tab.name}
                        </button>
                    ))}
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
                {activeTab === 'overview' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
                        <SystemHealthDashboard systemStatus={systemStatus} />
                        <SystemUpdateSection />
                    </div>
                )}

                {/* AI Engine Tab */}
                {activeTab === 'engine' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="space-y-6">
                                {/* AI Backend Selection */}
                                <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                                    <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                                        🤖 AI 引擎選取 (AI Backend)
                                    </h2>
                                    <div className="flex flex-col mb-4">
                                        <label className="text-sm font-medium text-muted-foreground mb-1 flex items-center justify-between gap-1 overflow-hidden">
                                            <span className="truncate mr-1" title="核心引擎 (Primary Engine)">核心引擎 (Primary Engine)</span>
                                        </label>
                                        <select
                                            value={config.env.GOLEM_BACKEND || "gemini"}
                                            onChange={(e) => {
                                                handleChangeEnv("GOLEM_BACKEND", e.target.value);
                                            }}
                                            className="w-full bg-secondary/30 border border-border focus:border-primary rounded-lg px-3 py-2 text-sm text-foreground transition-colors"
                                        >
                                            <option value="gemini">Web Gemini (自動化瀏覽器)</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Gemini Brain Settings */}
                                <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                                    <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
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
                            </div>

                            <div className="space-y-6">
                                {/* Memory Engine Settings */}
                                <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                                    <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                                        ⚙️ 記憶引擎設定
                                    </h2>
                                    <SettingSelectField
                                        label="記憶引擎模式"
                                        desc="browser: 內建 memory.html | lancedb: 高效向量資料庫 | qmd: 混合搜尋"
                                        value={config.env.GOLEM_MEMORY_MODE || "browser"}
                                        onChange={(val) => handleChangeEnv("GOLEM_MEMORY_MODE", val)}
                                        options={[
                                            { value: "browser", label: "Browser (預設)" },
                                            { value: "lancedb", label: "LanceDB (高效能 Pro 版)" },
                                            { value: "qmd", label: "QMD (進階混合)" }
                                        ]}
                                    />

                                    {config.env.GOLEM_MEMORY_MODE === "lancedb" && (
                                        <div className="bg-primary/5 p-4 rounded-xl border border-primary/20 space-y-4 mb-4 animate-in zoom-in-95 mt-4">
                                            <h4 className="text-xs font-bold text-primary flex items-center gap-2">
                                                <Sparkles className="w-3 h-3" /> 本地向量模型配置 (Local Embedding)
                                            </h4>
                                            <div className="space-y-4">
                                                <SettingSelectField
                                                    label="模型選擇"
                                                    desc="本地端計算，具備極佳隱私性。"
                                                    value={config.env.GOLEM_LOCAL_EMBEDDING_MODEL || "Xenova/bge-small-zh-v1.5"}
                                                    onChange={(val) => {
                                                        handleChangeEnv("GOLEM_LOCAL_EMBEDDING_MODEL", val);
                                                        handleChangeEnv("GOLEM_EMBEDDING_PROVIDER", "local");
                                                    }}
                                                    options={LOCAL_MODELS.map(m => ({ value: m.id, label: m.name }))}
                                                />
                                                {(() => {
                                                    const activeModelInfo = LOCAL_MODELS.find(m => m.id === (config.env.GOLEM_LOCAL_EMBEDDING_MODEL || "Xenova/bge-small-zh-v1.5"));
                                                    if (!activeModelInfo) return null;
                                                    return (
                                                        <div className="bg-background/50 border border-border/40 rounded-lg p-3 space-y-2">
                                                            <div className="text-[11px] text-foreground/80 leading-relaxed">
                                                                <span className="font-bold text-primary">特色：</span> {activeModelInfo.features}
                                                            </div>
                                                            <div className="text-[11px] text-foreground/80 leading-relaxed">
                                                                <span className="font-bold text-primary">推薦：</span> {activeModelInfo.recommendation}
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Messaging Tab */}
                {activeTab === 'messaging' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Telegram Section */}
                            <div className="bg-card border border-border hover:border-primary/20 transition-colors rounded-xl p-5 shadow-sm space-y-4">
                                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                                    ✈️ Telegram 設定
                                </h2>
                                <SettingField
                                    label="Bot Token"
                                    keyName="TELEGRAM_TOKEN"
                                    placeholder="123456789:ABCDefgh..."
                                    isSecret
                                    value={config.env.TELEGRAM_TOKEN || ""}
                                    onChange={(val) => handleChangeEnv("TELEGRAM_TOKEN", val)}
                                />
                                <SettingField
                                    label="Auth Mode"
                                    keyName="TG_AUTH_MODE"
                                    placeholder="ADMIN 或 CHAT"
                                    value={config.env.TG_AUTH_MODE || ""}
                                    onChange={(val) => handleChangeEnv("TG_AUTH_MODE", val)}
                                />
                                <div className="grid grid-cols-2 gap-4">
                                    <SettingField label="Admin ID" keyName="ADMIN_ID" isSecret placeholder="Telegram Admin ID (數值)" value={config.env.ADMIN_ID || ""} onChange={(val) => handleChangeEnv("ADMIN_ID", val)} />
                                    <SettingField label="Chat ID" keyName="TG_CHAT_ID" isSecret placeholder="Telegram 群組/頻道 ID" value={config.env.TG_CHAT_ID || ""} onChange={(val) => handleChangeEnv("TG_CHAT_ID", val)} />
                                </div>
                            </div>

                            <div className="space-y-6">
                                {/* Discord Section */}
                                <div className="bg-card border border-border hover:border-primary/20 transition-colors rounded-xl p-5 shadow-sm">
                                    <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                                        👾 Discord 設定
                                    </h2>
                                    <SettingField
                                        label="Bot Token"
                                        keyName="DISCORD_TOKEN"
                                        placeholder="MTAy... (Discord Bot Token)"
                                        isSecret
                                        value={config.env.DISCORD_TOKEN || ""}
                                        onChange={(val) => handleChangeEnv("DISCORD_TOKEN", val)}
                                    />
                                    <SettingField
                                        label="Admin ID"
                                        keyName="DISCORD_ADMIN_ID"
                                        placeholder="Discord User ID (數值)"
                                        isSecret
                                        value={config.env.DISCORD_ADMIN_ID || ""}
                                        onChange={(val) => handleChangeEnv("DISCORD_ADMIN_ID", val)}
                                    />
                                </div>

                                {/* Moltbook Section */}
                                <div className="bg-card border border-border hover:border-rose-900/20 transition-colors rounded-xl p-5 shadow-sm">
                                    <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                                        🦞 Moltbook 社交網絡
                                    </h2>
                                    <SettingField
                                        label="API Key"
                                        keyName="MOLTBOOK_API_KEY"
                                        placeholder="Moltbook 存取金鑰"
                                        isSecret
                                        value={config.env.MOLTBOOK_API_KEY || ""}
                                        onChange={(val) => handleChangeEnv("MOLTBOOK_API_KEY", val)}
                                    />
                                    <SettingField
                                        label="Agent Name"
                                        keyName="MOLTBOOK_AGENT_NAME"
                                        placeholder="Golem"
                                        value={config.env.MOLTBOOK_AGENT_NAME || ""}
                                        onChange={(val) => handleChangeEnv("MOLTBOOK_AGENT_NAME", val)}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Schedule Tab */}
                {activeTab === 'schedule' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto">
                        <div className="bg-card border border-border hover:border-primary/30 transition-colors rounded-xl p-5 shadow-sm">
                            <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                                ⏳ 自動化與作息設定
                            </h2>
                            <div className="grid grid-cols-2 gap-4">
                                <SettingField label="喚醒間隔 (最小)" keyName="GOLEM_AWAKE_INTERVAL_MIN" placeholder="10" desc="分鐘 (最小 1)" value={config.env.GOLEM_AWAKE_INTERVAL_MIN || ""} onChange={(val) => handleChangeEnv("GOLEM_AWAKE_INTERVAL_MIN", val)} />
                                <SettingField label="喚醒間隔 (最大)" keyName="GOLEM_AWAKE_INTERVAL_MAX" placeholder="10080" desc="分鐘 (最大 10080 / 一週)" value={config.env.GOLEM_AWAKE_INTERVAL_MAX || ""} onChange={(val) => handleChangeEnv("GOLEM_AWAKE_INTERVAL_MAX", val)} />
                                <SettingField label="夜間休眠開始" keyName="GOLEM_SLEEP_START" placeholder="23:00" desc="格式: HH:mm (24小時制)" value={config.env.GOLEM_SLEEP_START || ""} onChange={(val) => handleChangeEnv("GOLEM_SLEEP_START", val)} />
                                <SettingField label="夜間休眠結束" keyName="GOLEM_SLEEP_END" placeholder="07:00" desc="格式: HH:mm (24小時制)" value={config.env.GOLEM_SLEEP_END || ""} onChange={(val) => handleChangeEnv("GOLEM_SLEEP_END", val)} />
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
                )}
                {activeTab === 'security' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
                        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                            <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                                🛡️ 指令安全設定
                            </h2>
                                <SettingField
                                    label="嚴格指令防護 (Strict Safeguard)"
                                    keyName="GOLEM_STRICT_SAFEGUARD"
                                    placeholder="false"
                                    desc="是否在 initial validation 階段就攔截 dangerousOps (如 rm -rf)。"
                                    value={config.env.GOLEM_STRICT_SAFEGUARD || ""}
                                    onChange={(val) => handleChangeEnv("GOLEM_STRICT_SAFEGUARD", val)}
                                />
                        </div>

                        {/* Whitelist Settings */}
                        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                            <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                                <ShieldCheck className="w-5 h-5 text-primary" />
                                🛡️ 指令安全與白名單設定 (Drag & Drop)
                            </h3>
                            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 pb-4">
                                {/* 🔴 危險指令 */}
                                <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 flex flex-col h-full">
                                    <h4 className="text-sm font-semibold text-destructive flex items-center gap-2 mb-3">
                                        <AlertTriangle className="w-4 h-4" /> 系統阻擋 (危險)
                                    </h4>
                                    <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar h-[22rem]">
                                        {['rm -rf /', 'rd /s /q', '> /dev/sd', ':(){:|:&};:', 'mkfs', 'Format-Volume', 'dd if=', 'chmod -x'].map((cmd, idx) => (
                                            <div key={`danger-${idx}`} className="px-3 py-2 bg-destructive/20 border border-destructive/40 text-destructive text-xs font-mono rounded cursor-not-allowed opacity-80">
                                                {cmd}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* 🛡️ 系統安全庫 (預設) */}
                                <div className="bg-secondary/30 border border-border rounded-xl p-4 flex flex-col h-full">
                                    <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2 mb-3">
                                        🛡️ 系統安全庫 (預設)
                                    </h4>
                                    <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar h-[22rem]">
                                        {['dir', 'pwd', 'date', 'echo', 'cat', 'grep', 'find', 'whoami', 'tail', 'head', 'df', 'free', 'Get-ChildItem', 'Select-String', 'golem-check']
                                            .filter(cmd => !(config.env.COMMAND_WHITELIST || "").split(',').map(s => s.trim()).includes(cmd))
                                            .map((cmd, idx) => (
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
                                                    <span className="text-[10px] text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity">拖曳啟用</span>
                                                </div>
                                            ))}
                                    </div>
                                </div>

                                {/* 🟢 允許清單 (Whitelist) */}
                                <div
                                    className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex flex-col h-full transition-colors relative"
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        const item = e.dataTransfer.getData("text/plain");
                                        if (!item) return;
                                        const currentWhitelist = (config.env.COMMAND_WHITELIST || "").split(',').map(s => s.trim()).filter(Boolean);
                                        if (!currentWhitelist.includes(item)) {
                                            const newWhitelist = [...currentWhitelist, item];
                                            handleChangeEnv("COMMAND_WHITELIST", newWhitelist.join(','));
                                            const pool = (config.env.CUSTOM_COMMANDS || "").split(',').map(s => s.trim()).filter(c => c !== item && c !== "");
                                            handleChangeEnv("CUSTOM_COMMANDS", pool.join(','));
                                        }
                                    }}
                                >
                                    <h4 className="text-sm font-semibold text-primary flex items-center gap-2 mb-3">
                                        <CheckCircle2 className="w-4 h-4" /> 允許清單 (免審批)
                                    </h4>
                                    <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar h-[22rem]">
                                        {(config.env.COMMAND_WHITELIST || "").split(',').map(s => s.trim()).filter(Boolean).map((cmd, idx) => (
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
                                                    onClick={() => {
                                                        const current = (config.env.COMMAND_WHITELIST || "").split(',').map(s => s.trim()).filter(c => c !== cmd && c !== "");
                                                        handleChangeEnv("COMMAND_WHITELIST", current.join(','));
                                                        const defaultSafe = ['dir', 'pwd', 'date', 'echo', 'cat', 'grep', 'find', 'whoami', 'tail', 'head', 'df', 'free', 'Get-ChildItem', 'Select-String', 'golem-check'];
                                                        if (!defaultSafe.includes(cmd)) {
                                                            const pool = (config.env.CUSTOM_COMMANDS || "").split(',').map(s => s.trim()).filter(Boolean);
                                                            if (!pool.includes(cmd)) handleChangeEnv("CUSTOM_COMMANDS", [...pool, cmd].join(','));
                                                        }
                                                    }}
                                                    className="opacity-0 group-hover:opacity-100 text-red-400 p-0.5"
                                                >
                                                    <RefreshCw className="w-3 h-3 rotate-45" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* 🔵 自訂指令池 (Pool) */}
                                <div
                                    className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 flex flex-col h-full transition-colors relative"
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        const item = e.dataTransfer.getData("text/plain");
                                        if (!item) return;
                                        const pool = (config.env.CUSTOM_COMMANDS || "").split(',').map(s => s.trim()).filter(Boolean);
                                        if (!pool.includes(item)) {
                                            handleChangeEnv("CUSTOM_COMMANDS", [...pool, item].join(','));
                                            const currentWhitelist = (config.env.COMMAND_WHITELIST || "").split(',').map(s => s.trim()).filter(c => c !== item && c !== "");
                                            handleChangeEnv("COMMAND_WHITELIST", currentWhitelist.join(','));
                                        }
                                    }}
                                >
                                    <h4 className="text-sm font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-2 mb-3">
                                        <HardDrive className="w-4 h-4" /> 自訂備選池
                                    </h4>
                                    <input
                                        type="text"
                                        placeholder="新增指令 (如 docker)"
                                        className="w-full bg-secondary border border-border rounded px-2 py-1.5 text-xs font-mono mb-3"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                const val = e.currentTarget.value.trim();
                                                if (val) {
                                                    const pool = (config.env.CUSTOM_COMMANDS || "").split(',').map(s => s.trim()).filter(Boolean);
                                                    if (!pool.includes(val)) {
                                                        handleChangeEnv("CUSTOM_COMMANDS", [...pool, val].join(','));
                                                        e.currentTarget.value = "";
                                                    }
                                                }
                                            }
                                        }}
                                    />
                                    <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar h-[19rem]">
                                        {(config.env.CUSTOM_COMMANDS || "").split(',').map(s => s.trim()).filter(Boolean).map((cmd, idx) => (
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
                                                    onClick={() => {
                                                        const pool = (config.env.CUSTOM_COMMANDS || "").split(',').map(s => s.trim()).filter(c => c !== cmd && c !== "");
                                                        handleChangeEnv("CUSTOM_COMMANDS", pool.join(','));
                                                    }}
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
                )}

                {/* Advanced Tab */}
                {activeTab === 'advanced' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-6">
                                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                                    ⚙️ 系統進階與維護
                                </h2>

                                <div className="space-y-4">
                                    <SettingField label="測試模式" keyName="GOLEM_TEST_MODE" desc="設為 true 將在部分功能使用模擬數據" placeholder="false" value={config.env.GOLEM_TEST_MODE || ""} onChange={(val) => handleChangeEnv("GOLEM_TEST_MODE", val)} />
                                    <SettingField label="系統維護推播通知" keyName="ENABLE_LOG_NOTIFICATIONS" desc="是否在 Telegram/Discord 接收通知" placeholder="false" value={config.env.ENABLE_LOG_NOTIFICATIONS || ""} onChange={(val) => handleChangeEnv("ENABLE_LOG_NOTIFICATIONS", val)} />
                                    <SettingField label="日誌檢查間隔 (分)" keyName="ARCHIVE_CHECK_INTERVAL" placeholder="30" value={config.env.ARCHIVE_CHECK_INTERVAL || ""} onChange={(val) => handleChangeEnv("ARCHIVE_CHECK_INTERVAL", val)} />
                                    <SettingField label="資料暫存路徑" keyName="USER_DATA_DIR" placeholder="./.golem_data" value={config.env.USER_DATA_DIR || ""} onChange={(val) => handleChangeEnv("USER_DATA_DIR", val)} />
                                    <SettingField label="OTA 升級節點" keyName="GITHUB_REPO" placeholder="Arvincreator/project-golem" value={config.env.GITHUB_REPO || ""} onChange={(val) => handleChangeEnv("GITHUB_REPO", val)} />
                                </div>

                                <div className="pt-4 border-t border-border">
                                    <div className="flex items-center justify-between mb-4">
                                        <span className="text-sm font-medium text-foreground flex items-center gap-2">
                                            啟用系統日誌 (System Log)
                                            {logInfo && (
                                                <span className={`px-2 py-0.5 rounded text-xs font-mono ml-2 ${logInfo.bytes > 10 * 1024 * 1024 ? 'bg-red-900/50 text-red-400' : 'bg-green-900/30 text-green-400'}`}>
                                                    大小: {logInfo.size}
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                    <SettingField label="" keyName="ENABLE_SYSTEM_LOG" desc="設為 false 將完全不記錄 system.log" placeholder="false" value={config.env.ENABLE_SYSTEM_LOG || ""} onChange={(val) => handleChangeEnv("ENABLE_SYSTEM_LOG", val)} />
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="bg-secondary/30 p-5 rounded-xl border border-border">
                                    <h4 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                                        <RefreshCw className="w-4 h-4 text-primary" /> 日誌輪替策略
                                    </h4>
                                    <div className="space-y-4">
                                        <SettingField label="單檔儲存上限 (MB)" keyName="LOG_MAX_SIZE_MB" desc="設 0 則不限制單個日誌檔大小" placeholder="10" value={config.env.LOG_MAX_SIZE_MB || ""} onChange={(val) => handleChangeEnv("LOG_MAX_SIZE_MB", val)} />
                                        <SettingField label="保留歷史檔案天數" keyName="LOG_RETENTION_DAYS" desc="過舊的壓縮日誌將會自動刪除" placeholder="7" value={config.env.LOG_RETENTION_DAYS || ""} onChange={(val) => handleChangeEnv("LOG_RETENTION_DAYS", val)} />
                                        <SettingField label="昨日歸檔門檻 (份)" keyName="ARCHIVE_THRESHOLD_YESTERDAY" desc="昨日日誌超過此數量即觸發歸檔" placeholder="5" value={config.env.ARCHIVE_THRESHOLD_YESTERDAY || ""} onChange={(val) => handleChangeEnv("ARCHIVE_THRESHOLD_YESTERDAY", val)} />
                                        <SettingField label="本日歸檔門檻 (份)" keyName="ARCHIVE_THRESHOLD_TODAY" desc="今日日誌超過此數量即觸發歸檔" placeholder="20" value={config.env.ARCHIVE_THRESHOLD_TODAY || ""} onChange={(val) => handleChangeEnv("ARCHIVE_THRESHOLD_TODAY", val)} />
                                    </div>
                                </div>

                                <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                                    <h2 className="text-sm font-bold text-muted-foreground mb-4">🔧 其他唯讀參數</h2>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
                                        {Object.keys(config.env)
                                            .filter(k => ![
                                                'GEMINI_API_KEYS', 'TELEGRAM_TOKEN', 'TG_AUTH_MODE', 'ADMIN_ID', 'TG_CHAT_ID',
                                                'DISCORD_TOKEN', 'DISCORD_ADMIN_ID', 'USER_DATA_DIR', 'GOLEM_TEST_MODE',
                                                'GOLEM_MODE', 'GOLEM_MEMORY_MODE', 'GOLEM_EMBEDDING_PROVIDER', 'GOLEM_LOCAL_EMBEDDING_MODEL', 'GITHUB_REPO',
                                                'MOLTBOOK_API_KEY', 'MOLTBOOK_AGENT_NAME',
                                                'GOLEM_AWAKE_INTERVAL_MIN', 'GOLEM_AWAKE_INTERVAL_MAX',
                                                'GOLEM_SLEEP_START', 'GOLEM_SLEEP_END', 'USER_INTERESTS', 'COMMAND_WHITELIST', 'CUSTOM_COMMANDS',
                                                'ENABLE_LOG_NOTIFICATIONS', 'ARCHIVE_CHECK_INTERVAL', 'ARCHIVE_THRESHOLD_YESTERDAY', 'ARCHIVE_THRESHOLD_TODAY',
                                                'LOG_MAX_SIZE_MB', 'LOG_RETENTION_DAYS', 'ENABLE_SYSTEM_LOG', 'GOLEM_BACKEND', 'GOLEM_STRICT_SAFEGUARD'
                                            ].includes(k))
                                            .map(key => (
                                                <div key={key} className="bg-secondary/20 p-2 rounded border border-border/40">
                                                    <label className="text-[10px] text-muted-foreground block mb-1 uppercase font-bold tracking-wider">{key}</label>
                                                    <div className="text-xs font-mono truncate text-foreground/80">{config.env[key] || "N/A"}</div>
                                                </div>
                                            ))
                                        }
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <ConfirmModal
                    isOpen={isRestartConfirmOpen}
                    onClose={() => setIsRestartConfirmOpen(false)}
                    onConfirm={executeRestart}
                    variant="warning"
                    title="確定要重啟 Golem 嗎？"
                    description="重啟將會中斷目前的對話並重置系統狀態。"
                    confirmText="立即重啟"
                    cancelText="先不要"
                />

            </div>
        </div>
    );
}
