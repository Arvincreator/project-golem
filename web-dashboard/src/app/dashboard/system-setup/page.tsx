"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
    Key, HardDrive, Brain, Eye, EyeOff, AlertTriangle,
    Sparkles, ExternalLink, CheckCircle2, ArrowRight
} from "lucide-react";
import Link from "next/link";
import { useGolem } from "@/components/GolemContext";

type MemoryMode = "browser" | "qmd";

export default function SystemSetupPage() {
    const router = useRouter();
    const { isSystemConfigured } = useGolem();

    const [geminiKeys, setGeminiKeys] = useState("");
    const [userDataDir, setUserDataDir] = useState("./golem_memory");
    const [memoryMode, setMemoryMode] = useState<MemoryMode>("browser");
    const [showKeys, setShowKeys] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isFetching, setIsFetching] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // 載入現有設定
    useEffect(() => {
        fetch("/api/system/config")
            .then(r => r.json())
            .then(data => {
                setUserDataDir(data.userDataDir || "./golem_memory");
                setMemoryMode((data.golemMemoryMode as MemoryMode) || "browser");
                // 不預填 geminiApiKeys（只顯示是否已設定）
            })
            .catch(console.error)
            .finally(() => setIsFetching(false));
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!geminiKeys.trim()) {
            return setError("請填寫 Gemini API Keys");
        }

        setIsLoading(true);
        try {
            const res = await fetch("/api/system/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    geminiApiKeys: geminiKeys.trim(),
                    userDataDir: userDataDir.trim(),
                    golemMemoryMode: memoryMode,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "儲存失敗，請稍後再試");
            }
            // 重整頁面讓 GolemContext 重新取得 isSystemConfigured
            window.location.href = "/dashboard";
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    if (isFetching) {
        return (
            <div className="flex-1 flex items-center justify-center bg-gray-950">
                <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto bg-gray-950 p-6 flex flex-col text-white">
            <div className="max-w-2xl w-full mx-auto pt-8 pb-16">

                {/* Header */}
                <div className="flex flex-col items-center text-center mb-12 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="inline-flex items-center justify-center p-4 bg-emerald-950/50 border border-emerald-800/40 rounded-2xl mb-5 shadow-[0_0_40px_-8px_theme(colors.emerald.900)]">
                        <Sparkles className="w-8 h-8 text-emerald-400" />
                    </div>
                    <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-white via-emerald-100 to-emerald-400 mb-3 tracking-tight">
                        系統初始化設定
                    </h1>
                    <p className="text-lg text-gray-400 max-w-lg leading-relaxed">
                        在開始使用 Golem 之前，請完成核心參數設定。<br />
                        Golem Bot 可以在設定完成後隨時從 Dashboard 新增。
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150">

                    {error && (
                        <div className="flex items-start gap-3 p-4 bg-red-950/30 border border-red-900/40 rounded-xl text-red-400">
                            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                            <p className="text-sm">{error}</p>
                        </div>
                    )}

                    {/* Gemini API Keys */}
                    <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-600 to-teal-400 rounded-t-2xl" />

                        <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-2">
                                <Key className="w-5 h-5 text-emerald-400" />
                                <h2 className="text-base font-semibold text-white">Gemini API Keys</h2>
                                <span className="text-red-400 text-xs font-medium">必填</span>
                            </div>
                            <a
                                href="https://aistudio.google.com/app/apikey"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-emerald-500 hover:text-emerald-400 flex items-center gap-1 transition-colors"
                            >
                                取得 API Key
                                <ExternalLink className="w-3 h-3" />
                            </a>
                        </div>

                        <div className="relative">
                            <input
                                id="geminiKeys"
                                type={showKeys ? "text" : "password"}
                                value={geminiKeys}
                                onChange={e => setGeminiKeys(e.target.value)}
                                placeholder="AIzaSy... (多組 Key 請用半形逗號分隔)"
                                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 pr-11 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"
                            />
                            <button
                                type="button"
                                onClick={() => setShowKeys(!showKeys)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 p-1 transition-colors"
                            >
                                {showKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                        <p className="text-xs text-gray-600 mt-2">
                            支援多組 Key 輪替（KeyChain），建議填入 2 組以上以防超過配額。
                        </p>
                    </div>

                    {/* Memory Config */}
                    <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 to-indigo-400 rounded-t-2xl" />

                        <div className="flex items-center gap-2 mb-5">
                            <Brain className="w-5 h-5 text-blue-400" />
                            <h2 className="text-base font-semibold text-white">記憶引擎設定</h2>
                        </div>

                        {/* Memory Mode */}
                        <div className="mb-5">
                            <label className="block text-sm font-medium text-gray-400 mb-3">記憶引擎模式</label>
                            <div className="grid grid-cols-2 gap-3">
                                {([
                                    { value: "browser", label: "Browser 模式", desc: "內建 memory.html，無須額外安裝（推薦）" },
                                    { value: "qmd", label: "QMD 模式", desc: "混合向量搜尋，需安裝 Bun 與 qmd（進階）" },
                                ] as { value: MemoryMode; label: string; desc: string }[]).map(opt => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => setMemoryMode(opt.value)}
                                        className={`p-3 rounded-xl border text-sm font-medium transition-all text-left ${memoryMode === opt.value
                                            ? "bg-blue-950/30 border-blue-600/50 text-blue-300"
                                            : "bg-gray-950 border-gray-800 text-gray-400 hover:border-gray-700"
                                            }`}
                                    >
                                        <div className="flex items-center justify-between mb-0.5">
                                            <span className="font-bold text-xs">{opt.label}</span>
                                            {memoryMode === opt.value && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
                                        </div>
                                        <div className="text-[10px] font-normal opacity-70">{opt.desc}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* User Data Dir */}
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">
                                <HardDrive className="w-3.5 h-3.5 inline mr-1.5 text-gray-500" />
                                記憶資料儲存路徑
                            </label>
                            <input
                                type="text"
                                value={userDataDir}
                                onChange={e => setUserDataDir(e.target.value)}
                                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                                placeholder="./golem_memory"
                            />
                            <p className="text-xs text-gray-600 mt-1.5">
                                存放 Puppeteer Login Session 與長期記憶。相對路徑以專案根目錄為基準。
                            </p>
                        </div>
                    </div>

                    {/* Submit */}
                    <Button
                        type="submit"
                        disabled={isLoading}
                        className="w-full h-14 text-base font-bold bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 border-none shadow-xl shadow-emerald-900/20 transition-all hover:scale-[1.02] active:scale-95 rounded-2xl group"
                    >
                        {isLoading ? (
                            <span className="flex items-center gap-2">
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                正在儲存設定...
                            </span>
                        ) : (
                            <span className="flex items-center gap-2">
                                完成設定，進入控制台
                                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </span>
                        )}
                    </Button>

                    <p className="text-center text-xs text-gray-600">
                        設定完成後可隨時從側欄「新增 Golem」加入 Telegram Bot。
                        設定值儲存至 <code className="text-gray-500 font-mono">.env</code>。
                    </p>
                </form>
            </div>
        </div>
    );
}
