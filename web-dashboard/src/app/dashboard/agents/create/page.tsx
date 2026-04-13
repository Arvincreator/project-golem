"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useGolem } from "@/components/GolemContext";
import {
    UserPlus, BrainCircuit, Bot, Shield, Hash, ArrowLeft,
    ExternalLink, Eye, EyeOff, AlertTriangle, MessageSquare, ChevronRight, ChevronLeft, CheckCircle2
} from "lucide-react";
import Link from "next/link";
import { ApiError, apiGet, apiPost } from "@/lib/api-client";

type AuthMode = "ADMIN" | "CHAT";

export default function CreateGolemPage() {
    const router = useRouter();
    const [step, setStep] = useState(1);
    const { refreshGolems, isSingleNode } = useGolem();

    // Step 1: Identity
    const [id, setId] = React.useState(isSingleNode ? "golem_A" : "");
    const [role, setRole] = useState("");

    React.useEffect(() => {
        if (isSingleNode) setId("golem_A");
    }, [isSingleNode]);

    // Step 2: Platforms
    const [platforms, setPlatforms] = useState({ telegram: false, discord: false, direct: false });

    // Step 3: Configs
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Telegram
    const [tgToken, setTgToken] = useState("");
    const [tgAuthMode, setTgAuthMode] = useState<AuthMode>("ADMIN");
    const [tgAdminId, setTgAdminId] = useState("");
    const [tgChatId, setTgChatId] = useState("");
    const [showTgToken, setShowTgToken] = useState(false);

    // Discord
    const [dcToken, setDcToken] = useState("");
    const [dcAuthMode] = useState<AuthMode>("ADMIN");
    const [dcAdminId, setDcAdminId] = useState("");
    const [dcChatId] = useState("");
    const [showDcToken, setShowDcToken] = useState(false);

    const suggestId = () => {
        if (!id) {
            const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
            apiGet<{ golems?: Array<{ id?: string }> }>("/api/golems")
                .then((data) => {
                    const existing = (data.golems || []).map((g) => g.id).filter(Boolean);
                    for (const ch of letters) {
                        const candidate = `golem_${ch}`;
                        if (!existing.includes(candidate)) {
                            setId(candidate);
                            break;
                        }
                    }
                })
                .catch(() => setId("golem_A"));
        }
    };

    const nextStep = () => {
        setError(null);
        if (step === 1) {
            if (!id.trim()) return setError("請填寫 Golem ID");
            setStep(2);
        } else if (step === 2) {
            if (!platforms.telegram && !platforms.discord && !platforms.direct) return setError("請至少選擇一種通訊方式");
            if (platforms.direct) {
                // 如果是直接交談，直接送出
                handleSubmit();
            } else {
                setStep(3);
            }
        }
    };

    const prevStep = () => {
        setError(null);
        setStep(step - 1);
    };

    const selectPlatform = (platform: 'telegram' | 'discord' | 'direct') => {
        setPlatforms({
            telegram: platform === 'telegram',
            discord: platform === 'discord',
            direct: platform === 'direct'
        });
    };

    const handleSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        setError(null);

        if (platforms.telegram) {
            if (!tgToken.trim()) return setError("請填寫 Telegram Bot Token");
            if (tgAuthMode === "ADMIN" && !tgAdminId.trim()) return setError("Telegram ADMIN 模式需要填寫 Admin ID");
            if (tgAuthMode === "CHAT" && !tgChatId.trim()) return setError("Telegram CHAT 模式需要填寫 Chat ID");
        }

        if (platforms.discord) {
            if (!dcToken.trim()) return setError("請填寫 Discord Bot Token");
            if (dcAuthMode === "ADMIN" && !dcAdminId.trim()) return setError("Discord ADMIN 模式需要填寫 Admin ID");
            if (dcAuthMode === "CHAT" && !dcChatId.trim()) return setError("Discord CHAT 模式需要填寫 Chat ID (Channel ID)");
        }

        setIsLoading(true);
        try {
            const data = await apiPost<{ success?: boolean; error?: string }>("/api/golems/create", {
                id: id.trim(),
                role: role.trim(),
                tgToken: platforms.telegram ? tgToken.trim() || undefined : undefined,
                tgAuthMode: platforms.telegram ? tgAuthMode : undefined,
                tgAdminId: platforms.telegram && tgAuthMode === "ADMIN" ? tgAdminId.trim() : undefined,
                tgChatId: platforms.telegram && tgAuthMode === "CHAT" ? tgChatId.trim() : undefined,
                dcToken: platforms.discord ? dcToken.trim() || undefined : undefined,
                dcAuthMode: platforms.discord ? "ADMIN" : undefined,
                dcAdminId: platforms.discord ? dcAdminId.trim() : undefined,
                dcChatId: undefined,
            });

            if (!data.success) {
                throw new Error(data.error || "建立失敗，請稍後再試");
            }

            // ✅ 改用軟路由加上預先刷新背景快取，避免重複閃屏
            await refreshGolems();
            router.push("/dashboard/setup");
        } catch (err: unknown) {
            if (err instanceof ApiError && err.status === 409) {
                const payload = (err.payload && typeof err.payload === "object")
                    ? (err.payload as Record<string, unknown>)
                    : null;
                const errorCode = typeof payload?.error === "string" ? payload.error : "";
                if (errorCode === "system_setup_required") {
                    router.push("/dashboard/system-setup");
                    return;
                }
            }

            setError(err instanceof Error ? err.message : "建立失敗，請稍後再試");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex-1 overflow-auto bg-gray-950 p-6 flex flex-col text-white">
            <div className="max-w-2xl w-full mx-auto pb-12 pt-8">

                <div className="flex items-center justify-between mb-8">
                    <Link
                        href="/dashboard"
                        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        返回控制台
                    </Link>

                    {/* Stepper Indicator */}
                    <div className="flex items-center gap-2 text-sm font-medium">
                        <div className={`flex items-center justify-center w-6 h-6 rounded-full ${step >= 1 ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-500'}`}>1</div>
                        <div className={`w-8 h-1 rounded-full ${step >= 2 ? 'bg-indigo-600' : 'bg-gray-800'}`}></div>
                        <div className={`flex items-center justify-center w-6 h-6 rounded-full ${step >= 2 ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-500'}`}>2</div>
                        <div className={`w-8 h-1 rounded-full ${step >= 3 ? 'bg-indigo-600' : 'bg-gray-800'}`}></div>
                        <div className={`flex items-center justify-center w-6 h-6 rounded-full ${step >= 3 ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-500'}`}>3</div>
                    </div>
                </div>

                <div className="flex flex-col items-center text-center mb-10 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="inline-flex items-center justify-center p-4 bg-indigo-950/50 border border-indigo-800/50 rounded-2xl mb-5 shadow-[0_0_30px_-5px_theme(colors.indigo.900)]">
                        <UserPlus className="w-8 h-8 text-indigo-400" />
                    </div>
                    <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-white via-blue-100 to-indigo-400 mb-3 tracking-tight">
                        建立新 Golem 實體
                    </h1>
                    <p className="text-lg text-gray-400 max-w-xl">
                        {step === 1 && "第一步：為這個全新的 AI 神經網路實體命名與定位。"}
                        {step === 2 && "第二步：選擇這個 Golem 將在哪個通訊平台為您服務。"}
                        {step === 3 && "第三步：設定所選平台的連接 Token 與權限。"}
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

                    {error && (
                        <div className="flex items-start gap-3 p-4 bg-red-950/30 border border-red-900/50 rounded-xl text-red-400 animate-in fade-in slide-in-from-top-2">
                            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                            <p className="text-sm">{error}</p>
                        </div>
                    )}

                    {/* Step 1: Identity */}
                    {step === 1 && (
                        <div className="bg-gray-900/80 backdrop-blur-sm border border-gray-800 rounded-2xl p-6 shadow-2xl relative overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-600 to-blue-400" />
                            <div className="flex items-center gap-2 mb-5">
                                <Hash className="w-5 h-5 text-indigo-400" />
                                <h2 className="text-base font-semibold text-white">實體識別</h2>
                            </div>
                            <div className="hidden">
                                <label className="block text-sm font-medium text-gray-400 mb-2">
                                    Golem ID <span className="text-red-400">*</span>
                                </label>
                                <input
                                    id="golemId"
                                    value={id}
                                    onChange={e => setId(e.target.value)}
                                    onFocus={!isSingleNode ? suggestId : undefined}
                                    disabled={isSingleNode}
                                    className={`w-full bg-gray-950 border ${isSingleNode ? 'border-amber-800/30 opacity-60' : 'border-gray-800 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500'} rounded-xl px-4 py-3 text-white font-mono focus:outline-none transition-all`}
                                    placeholder="例如：golem_A、golem_customer_service"
                                    pattern="[a-zA-Z0-9_-]+"
                                    title="只允許英文字母、數字、底線和連字號"
                                    autoFocus={!isSingleNode}
                                />
                                <p className="text-xs text-gray-600 mt-2">只允許英數字、底線 (_)、連字號 (-)。點擊欄位可自動建議。</p>
                            </div>
                            <div className="mt-4">
                                <label className="block text-sm font-medium text-gray-400 mb-2">
                                    任務角色說明 <span className="text-gray-600">(選填)</span>
                                </label>
                                <input
                                    value={role}
                                    onChange={e => setRole(e.target.value)}
                                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
                                    placeholder="例如：主要客服機器人、測試用開發環境"
                                />
                            </div>
                        </div>
                    )}

                    {/* Step 2: Choose Platforms */}
                    {step === 2 && (
                        <div className="bg-gray-900/80 backdrop-blur-sm border border-gray-800 rounded-2xl p-6 shadow-2xl relative overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-600 to-teal-400" />
                            <div className="flex flex-col gap-4">
                                <button
                                    type="button"
                                    onClick={() => selectPlatform('telegram')}
                                    className={`relative flex items-center p-5 rounded-xl border-2 transition-all ${platforms.telegram ? 'bg-sky-950/40 border-sky-500' : 'bg-gray-950 border-gray-800 hover:border-gray-700'}`}
                                >
                                    <div className={`p-3 rounded-lg mr-4 ${platforms.telegram ? 'bg-sky-500/20 text-sky-400' : 'bg-gray-800 text-gray-400'}`}>
                                        <Bot className="w-6 h-6" />
                                    </div>
                                    <div className="text-left flex-1">
                                        <h3 className={`font-bold text-lg ${platforms.telegram ? 'text-white' : 'text-gray-300'}`}>Telegram</h3>
                                        <p className="text-sm text-gray-500">透過 Telegram 機器人帳號與您的 Golem 互動</p>
                                    </div>
                                    {platforms.telegram && <div className="absolute right-5 text-sky-400"><CheckCircle2 className="w-6 h-6" /></div>}
                                </button>

                                <button
                                    type="button"
                                    onClick={() => selectPlatform('discord')}
                                    className={`relative flex items-center p-5 rounded-xl border-2 transition-all ${platforms.discord ? 'bg-violet-950/40 border-violet-500' : 'bg-gray-950 border-gray-800 hover:border-gray-700'}`}
                                >
                                    <div className={`p-3 rounded-lg mr-4 ${platforms.discord ? 'bg-violet-500/20 text-violet-400' : 'bg-gray-800 text-gray-400'}`}>
                                        <MessageSquare className="w-6 h-6" />
                                    </div>
                                    <div className="text-left flex-1">
                                        <h3 className={`font-bold text-lg ${platforms.discord ? 'text-white' : 'text-gray-300'}`}>Discord</h3>
                                        <p className="text-sm text-gray-500">在 Discord 伺服器或私訊中部署您的 Golem</p>
                                    </div>
                                    {platforms.discord && <div className="absolute right-5 text-violet-400"><CheckCircle2 className="w-6 h-6" /></div>}
                                </button>

                                <button
                                    type="button"
                                    onClick={() => selectPlatform('direct')}
                                    className={`relative flex items-center p-5 rounded-xl border-2 transition-all ${platforms.direct ? 'bg-emerald-950/40 border-emerald-500' : 'bg-gray-950 border-gray-800 hover:border-gray-700'}`}
                                >
                                    <div className={`p-3 rounded-lg mr-4 ${platforms.direct ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-800 text-gray-400'}`}>
                                        <MessageSquare className="w-6 h-6" />
                                    </div>
                                    <div className="text-left flex-1">
                                        <h3 className={`font-bold text-lg ${platforms.direct ? 'text-white' : 'text-gray-300'}`}>直接交談 (Dashboard)</h3>
                                        <p className="text-sm text-gray-500">直接在網頁儀表板與您的 Golem 進行互動，無需第三方平台</p>
                                    </div>
                                    {platforms.direct && <div className="absolute right-5 text-emerald-400"><CheckCircle2 className="w-6 h-6" /></div>}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Configure Selected Platforms */}
                    {step === 3 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            {platforms.telegram && (
                                <div className="bg-gray-900/80 backdrop-blur-sm border border-gray-800 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
                                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-600 to-blue-400" />
                                    <div className="flex items-center justify-between mb-5">
                                        <div className="flex items-center gap-2">
                                            <Bot className="w-5 h-5 text-sky-400" />
                                            <h2 className="text-base font-semibold text-white">Telegram 設定</h2>
                                        </div>
                                        <a
                                            href="https://t.me/BotFather"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-sky-500 hover:text-sky-400 flex items-center gap-1 transition-colors"
                                        >
                                            取得 Token
                                            <ExternalLink className="w-3 h-3" />
                                        </a>
                                    </div>

                                    <div className="mb-5">
                                        <label className="block text-sm font-medium text-gray-400 mb-2">
                                            Bot Token <span className="text-red-400">*</span>
                                        </label>
                                        <div className="relative">
                                            <input
                                                id="tgToken"
                                                type={showTgToken ? "text" : "password"}
                                                value={tgToken}
                                                onChange={e => setTgToken(e.target.value)}
                                                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 pr-11 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-all"
                                                placeholder="123456789:ABCDefghIJKlmnOPQRstUVwxyz"
                                                autoFocus
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowTgToken(!showTgToken)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 p-1 transition-colors"
                                            >
                                                {showTgToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="mb-5">
                                        <label className="block text-sm font-medium text-gray-400 mb-3">
                                            <Shield className="w-4 h-4 inline mr-1.5 text-gray-500" />
                                            驗證模式 <span className="text-red-400">*</span>
                                        </label>
                                        <div className="grid grid-cols-2 gap-3">
                                            {(["ADMIN", "CHAT"] as AuthMode[]).map(mode => (
                                                <button
                                                    key={`tg-${mode}`}
                                                    type="button"
                                                    onClick={() => setTgAuthMode(mode)}
                                                    className={`p-3 rounded-xl border text-sm font-medium transition-all text-left ${tgAuthMode === mode
                                                        ? "bg-sky-950/30 border-sky-600/50 text-sky-300"
                                                        : "bg-gray-950 border-gray-800 text-gray-400 hover:border-gray-700"
                                                        }`}
                                                >
                                                    <div className="font-bold mb-0.5">{mode}</div>
                                                    <div className="text-xs font-normal opacity-70">
                                                        {mode === "ADMIN" ? "限定個人 Admin ID 使用" : "限定特定群組 Chat ID 使用"}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {tgAuthMode === "ADMIN" ? (
                                        <div className="animate-in fade-in slide-in-from-top-2">
                                            <label className="block text-sm font-medium text-gray-400 mb-2">
                                                Admin User ID <span className="text-red-400">*</span>
                                            </label>
                                            <input
                                                id="tgAdminId"
                                                type="text"
                                                value={tgAdminId}
                                                onChange={e => setTgAdminId(e.target.value)}
                                                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 text-white font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-all"
                                                placeholder="例如：123456789"
                                            />
                                            <p className="text-xs text-gray-600 mt-1.5">可透過 @userinfobot 取得你的 Telegram User ID</p>
                                        </div>
                                    ) : (
                                        <div className="animate-in fade-in slide-in-from-top-2">
                                            <label className="block text-sm font-medium text-gray-400 mb-2">
                                                Group Chat ID <span className="text-red-400">*</span>
                                            </label>
                                            <input
                                                id="tgChatId"
                                                type="text"
                                                value={tgChatId}
                                                onChange={e => setTgChatId(e.target.value)}
                                                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 text-white font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-all"
                                                placeholder="例如：-100987654321"
                                            />
                                            <p className="text-xs text-gray-600 mt-1.5">群組 Chat ID 通常為負數，可將 bot 加入群組後取得</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {platforms.discord && (
                                <div className="bg-gray-900/80 backdrop-blur-sm border border-gray-800 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
                                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-violet-600 to-indigo-400" />
                                    <div className="flex items-center justify-between mb-5">
                                        <div className="flex items-center gap-2">
                                            <MessageSquare className="w-5 h-5 text-violet-400" />
                                            <h2 className="text-base font-semibold text-white">Discord 設定</h2>
                                        </div>
                                        <a
                                            href="https://discord.com/developers/applications"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-violet-500 hover:text-violet-400 flex items-center gap-1 transition-colors"
                                        >
                                            取得 Token
                                            <ExternalLink className="w-3 h-3" />
                                        </a>
                                    </div>

                                    <div className="mb-5">
                                        <label className="block text-sm font-medium text-gray-400 mb-2">
                                            Bot Token <span className="text-red-400">*</span>
                                        </label>
                                        <div className="relative">
                                            <input
                                                id="dcToken"
                                                type={showDcToken ? "text" : "password"}
                                                value={dcToken}
                                                onChange={e => setDcToken(e.target.value)}
                                                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 pr-11 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
                                                placeholder="MTIzNDU2Nzg5.ABCDef... (在此貼上 Token)"
                                                autoFocus={!platforms.telegram}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowDcToken(!showDcToken)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 p-1 transition-colors"
                                            >
                                                {showDcToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="animate-in fade-in slide-in-from-top-2">
                                        <label className="block text-sm font-medium text-gray-400 mb-2">
                                            Admin User ID <span className="text-red-400">*</span>
                                        </label>
                                        <input
                                            id="dcAdminId"
                                            type="text"
                                            value={dcAdminId}
                                            onChange={e => setDcAdminId(e.target.value)}
                                            className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
                                            placeholder="例如：123456789012345678"
                                        />
                                        <p className="text-xs text-gray-600 mt-1.5">開啟開發者模式後，右鍵點擊你的 Discord 帳號選擇「複製使用者 ID」</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex gap-4 pt-4">
                        {step > 1 && (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={prevStep}
                                className="h-14 px-6 text-base font-medium bg-transparent text-gray-300 border-gray-700 hover:bg-gray-800 hover:text-white rounded-xl transition-all"
                            >
                                <ChevronLeft className="w-5 h-5 mr-1" /> 上一步
                            </Button>
                        )}

                        {step < 3 ? (
                            <Button
                                type="button"
                                onClick={nextStep}
                                className="flex-1 h-14 text-lg font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all"
                            >
                                下一步 <ChevronRight className="w-5 h-5 ml-1" />
                            </Button>
                        ) : (
                            <Button
                                type="submit"
                                disabled={isLoading}
                                className="flex-1 h-14 text-lg font-bold bg-gradient-to-r from-indigo-600 to-blue-500 hover:from-indigo-500 hover:to-blue-400 border-none shadow-xl shadow-indigo-900/20 transition-all hover:scale-[1.02] active:scale-95 rounded-2xl group"
                            >
                                {isLoading ? (
                                    <span className="flex items-center gap-2">
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        正在孕育新實體...
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-2">
                                        <BrainCircuit className="w-6 h-6 group-hover:animate-pulse" />
                                        建立並啟動 Golem
                                    </span>
                                )}
                            </Button>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
}
