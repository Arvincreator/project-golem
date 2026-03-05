"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useGolem } from "@/components/GolemContext";
import {
    UserPlus, BrainCircuit, Bot, Key, Shield, Hash, ArrowLeft,
    ExternalLink, Eye, EyeOff, AlertTriangle, Zap
} from "lucide-react";
import Link from "next/link";

type AuthMode = "ADMIN" | "CHAT";

export default function CreateGolemPage() {
    const router = useRouter();
    const { refreshGolems } = useGolem();

    const [id, setId] = useState("");
    const [tgToken, setTgToken] = useState("");
    const [role, setRole] = useState("");
    const [authMode, setAuthMode] = useState<AuthMode>("ADMIN");
    const [adminId, setAdminId] = useState("");
    const [chatId, setChatId] = useState("");
    const [showToken, setShowToken] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const suggestId = () => {
        if (!id) {
            const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
            fetch("/api/golems")
                .then(r => r.json())
                .then(data => {
                    const existing = (data.golems || []).map((g: any) => g.id);
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!id.trim()) return setError("請填寫 Golem ID");
        if (!tgToken.trim()) return setError("請填寫 Telegram Bot Token");
        if (authMode === "ADMIN" && !adminId.trim()) return setError("ADMIN 模式需要填寫 Admin ID");
        if (authMode === "CHAT" && !chatId.trim()) return setError("CHAT 模式需要填寫 Chat ID");

        setIsLoading(true);
        try {
            const res = await fetch("/api/golems/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: id.trim(),
                    tgToken: tgToken.trim(),
                    role: role.trim(),
                    tgAuthMode: authMode,
                    adminId: adminId.trim() || undefined,
                    chatId: chatId.trim() || undefined,
                }),
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || "建立失敗，請稍後再試");
            }

            refreshGolems();
            router.push("/dashboard");
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex-1 overflow-auto bg-gray-950 p-6 flex flex-col text-white">
            <div className="max-w-2xl w-full mx-auto pb-12 pt-8">

                <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300 mb-8 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    返回控制台
                </Link>

                <div className="flex flex-col items-center text-center mb-10 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="inline-flex items-center justify-center p-4 bg-indigo-950/50 border border-indigo-800/50 rounded-2xl mb-5 shadow-[0_0_30px_-5px_theme(colors.indigo.900)]">
                        <UserPlus className="w-8 h-8 text-indigo-400" />
                    </div>
                    <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-white via-blue-100 to-indigo-400 mb-3 tracking-tight">
                        建立新 Golem 實體
                    </h1>
                    <p className="text-lg text-gray-400 max-w-xl">
                        填寫以下資訊以啟動一個全新的 AI 神經網路實體。建立後可進行人格與技能設定。
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150">

                    {error && (
                        <div className="flex items-start gap-3 p-4 bg-red-950/30 border border-red-900/50 rounded-xl text-red-400">
                            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                            <p className="text-sm">{error}</p>
                        </div>
                    )}

                    {/* Section: Identity */}
                    <div className="bg-gray-900/80 backdrop-blur-sm border border-gray-800 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
                        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-600 to-blue-400" />
                        <div className="flex items-center gap-2 mb-5">
                            <Hash className="w-5 h-5 text-indigo-400" />
                            <h2 className="text-base font-semibold text-white">實體識別</h2>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">
                                Golem ID <span className="text-red-400">*</span>
                            </label>
                            <input
                                id="golemId"
                                value={id}
                                onChange={e => setId(e.target.value)}
                                onFocus={suggestId}
                                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 text-white font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
                                placeholder="例如：golem_A、golem_customer_service"
                                pattern="[a-zA-Z0-9_-]+"
                                title="只允許英文字母、數字、底線和連字號"
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

                    {/* Section: Telegram Config */}
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
                                取得 Token (BotFather)
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
                                    type={showToken ? "text" : "password"}
                                    value={tgToken}
                                    onChange={e => setTgToken(e.target.value)}
                                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 pr-11 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-all"
                                    placeholder="123456789:ABCDefghIJKlmnOPQRstUVwxyz"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowToken(!showToken)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 p-1 transition-colors"
                                >
                                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
                                        key={mode}
                                        type="button"
                                        onClick={() => setAuthMode(mode)}
                                        className={`p-3 rounded-xl border text-sm font-medium transition-all text-left ${authMode === mode
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

                        {authMode === "ADMIN" ? (
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">
                                    Admin User ID <span className="text-red-400">*</span>
                                </label>
                                <input
                                    id="adminId"
                                    type="text"
                                    value={adminId}
                                    onChange={e => setAdminId(e.target.value)}
                                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 text-white font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-all"
                                    placeholder="例如：123456789"
                                />
                                <p className="text-xs text-gray-600 mt-1.5">可透過 @userinfobot 取得你的 Telegram User ID</p>
                            </div>
                        ) : (
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">
                                    Group Chat ID <span className="text-red-400">*</span>
                                </label>
                                <input
                                    id="chatId"
                                    type="text"
                                    value={chatId}
                                    onChange={e => setChatId(e.target.value)}
                                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 text-white font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-all"
                                    placeholder="例如：-100987654321"
                                />
                                <p className="text-xs text-gray-600 mt-1.5">群組 Chat ID 通常為負數，可將 bot 加入群組後取得</p>
                            </div>
                        )}
                    </div>

                    <Button
                        type="submit"
                        disabled={isLoading}
                        className="w-full h-14 text-lg font-bold bg-gradient-to-r from-indigo-600 to-blue-500 hover:from-indigo-500 hover:to-blue-400 border-none shadow-xl shadow-indigo-900/20 transition-all hover:scale-[1.02] active:scale-95 rounded-2xl group"
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

                    <p className="text-center text-xs text-gray-600">
                        建立後系統將帶你前往人格設定頁面，為這個 Golem 賦予身分與使命。
                    </p>
                </form>
            </div>
        </div>
    );
}
