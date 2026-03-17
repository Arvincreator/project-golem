"use client";

import React, { useEffect, useState } from "react";
import { Loader2, ShieldCheck, Cpu, Globe, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function BootScreen({ isBooting }: { isBooting: boolean }) {
    const [progress, setProgress] = useState(0);
    const [statusText, setStatusText] = useState("正在初始化系統核心...");

    useEffect(() => {
        if (!isBooting) {
            setProgress(100);
            return;
        }

        const stages = [
            { threshold: 20, text: "啟動雙子引擎 (Gemini Dual-Engine)..." },
            { threshold: 40, text: "載入長期記憶與金字塔式索引..." },
            { threshold: 60, text: "建立 Chrome DevTools Protocol 連線..." },
            { threshold: 80, text: "注入核心協議 (Titan Protocol)..." },
            { threshold: 95, text: "正在進行最後的系統巡檢..." },
        ];

        const interval = setInterval(() => {
            setProgress((prev) => {
                if (prev >= 98) return prev;
                const next = prev + Math.random() * 2;
                
                const stage = stages.findLast(s => next >= s.threshold);
                if (stage) setStatusText(stage.text);
                
                return next;
            });
        }, 150);

        return () => clearInterval(interval);
    }, [isBooting]);

    return (
        <AnimatePresence>
            {isBooting && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5 }}
                    className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#050505] overflow-hidden"
                >
                    {/* Background Ambient Glow */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-500/10 blur-[120px] rounded-full" />
                    <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-cyan-500/5 blur-[100px] rounded-full" />

                    {/* Logo & Animation */}
                    <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.2, type: "spring", stiffness: 100 }}
                        className="relative mb-12"
                    >
                        <div className="relative z-10 w-24 h-24 rounded-3xl bg-gradient-to-br from-blue-600 to-cyan-400 flex items-center justify-center shadow-[0_0_50px_rgba(37,99,235,0.4)] animate-pulse">
                            <Zap className="w-12 h-12 text-white stroke-[2.5]" />
                        </div>
                        {/* Orbiting particles or rings can go here */}
                        <div className="absolute inset-x-0 -bottom-8 flex justify-center">
                             <div className="h-1 w-12 bg-gradient-to-r from-transparent via-blue-400 to-transparent blur-sm" />
                        </div>
                    </motion.div>

                    {/* Title & Status */}
                    <div className="text-center z-10 space-y-4 max-w-md px-6">
                        <h2 className="text-3xl font-bold tracking-tight text-white mb-2">
                            PROJECT <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">GOLEM</span>
                        </h2>
                        
                        <div className="flex flex-col items-center gap-6">
                            <div className="w-64 h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/10 relative">
                                <motion.div 
                                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-600 to-cyan-400 shadow-[0_0_15px_rgba(37,99,235,0.6)]"
                                    initial={{ width: "0%" }}
                                    animate={{ width: `${progress}%` }}
                                    transition={{ ease: "linear" }}
                                />
                            </div>
                            
                            <div className="flex items-center gap-3 text-muted-foreground bg-white/5 border border-white/10 px-4 py-2 rounded-full backdrop-blur-md">
                                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                                <span className="text-xs font-medium tracking-wide min-w-[200px]">{statusText}</span>
                            </div>
                        </div>
                    </div>

                    {/* System Info (Footer) */}
                    <div className="absolute bottom-12 left-0 right-0 flex justify-center gap-12 text-[10px] text-white/20 uppercase tracking-[0.2em] font-bold z-10">
                        <div className="flex items-center gap-2">
                            <ShieldCheck className="w-3 h-3" />
                            <span>Titan Protocol v2</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Cpu className="w-3 h-3" />
                            <span>Neural Core Active</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Globe className="w-3 h-3" />
                            <span>Web Gemini Linked</span>
                        </div>
                    </div>

                    {/* Scanlines Effect */}
                    <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] z-50 bg-[length:100%_2px,3px_100%]" />
                </motion.div>
            )}
        </AnimatePresence>
    );
}
