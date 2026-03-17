"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { socket } from "@/lib/socket";
import { apiUrl } from "@/lib/api";

interface GolemInfo {
    id: string;
    status: string;
}

interface GolemContextType {
    activeGolem: string;
    activeGolemStatus: string;
    setActiveGolem: (id: string) => void;
    golems: GolemInfo[];
    hasGolems: boolean;
    isLoadingGolems: boolean;
    refreshGolems: () => Promise<void>;
    startGolem: (id: string) => Promise<boolean>;
    isSystemConfigured: boolean;
    isBooting: boolean;
    isLoadingSystem: boolean;
    isSingleNode: boolean;
    version: string;
}

const GolemContext = createContext<GolemContextType>({
    activeGolem: "",
    activeGolemStatus: "", // ✅ [Bug #3 修復] 預設為空字串，避免載入中誤顯示 "running"
    setActiveGolem: () => { },
    golems: [],
    hasGolems: false,
    isLoadingGolems: true,
    refreshGolems: async () => { },
    startGolem: async () => false,
    isSystemConfigured: true,
    isBooting: false,
    isLoadingSystem: true,
    isSingleNode: true,
    version: `v${process.env.NEXT_PUBLIC_GOLEM_VERSION || "9.1.5"}`,
});

export const useGolem = () => useContext(GolemContext);

export function GolemProvider({ children }: { children: React.ReactNode }) {
    const [golems, setGolems] = useState<GolemInfo[]>([]);
    const [activeGolem, setActiveGolem] = useState<string>("");
    const [isLoadingGolems, setIsLoadingGolems] = useState(true);
    const [isSystemConfigured, setIsSystemConfigured] = useState(false);
    const [isBooting, setIsBooting] = useState(false);
    const [isLoadingSystem, setIsLoadingSystem] = useState(true);
    const [isSingleNode] = useState(true);
    const [version, setVersion] = useState(`v${process.env.NEXT_PUBLIC_GOLEM_VERSION || "9.1.5"}`);

    const fetchGolems = async () => {
        setIsLoadingGolems(true);
        try {
            const res = await fetch(apiUrl("/api/golems"));
            if (!res.ok) return;

            // Use a safer JSON parsing that won't throw SyntaxError on non-JSON bodies
            const data = await res.json().catch(() => null);
            if (!data) return;

            if (data.golems && data.golems.length > 0) {
                setGolems(data.golems);
                setActiveGolem((currentActive) => {
                    const ids = data.golems.map((g: GolemInfo) => g.id);
                    if (!currentActive || !ids.includes(currentActive)) {
                        const saved = localStorage.getItem("golem_active_id");
                        if (saved && ids.includes(saved)) {
                            return saved;
                        }
                        return data.golems[0].id;
                    }
                    return currentActive;
                });
            } else {
                setGolems([]);
                setActiveGolem("");
            }
        } catch (err) {
            // Silently handle connection errors (e.g. during shutdown/restart)
            console.debug("Golem API unavailable (fetchGolems)");
            // 在離線狀態下，為了保持 Sidebar 可見以便重啟，我們保留一個虛擬的 Golem
            setGolems([{ id: "golem_A", status: "offline" }]);
            setActiveGolem("golem_A");
        } finally {
            setIsLoadingGolems(false);
        }
    };

    const fetchSystemStatus = async () => {
        setIsLoadingSystem(true);
        try {
            const statusRes = await fetch(apiUrl("/api/system/status"));
            if (statusRes.ok) {
                const data = await statusRes.json().catch(() => null);
                if (data) {
                    setIsSystemConfigured(data.isSystemConfigured ?? true);
                    setIsBooting(data.isBooting ?? false);
                }
            }
        } catch (e) {
            setIsSystemConfigured(true); // default on error
        } finally {
            setIsLoadingSystem(false);
        }

        try {
            const configRes = await fetch(apiUrl("/api/system/config"));
            if (configRes.ok) {
                const data = await configRes.json().catch(() => null);
                if (data && data.version) setVersion(`v${data.version}`);
            }
        } catch (e) {
            console.debug("Golem API unavailable (fetchSystemStatus)");
        }
    };

    const startGolem = async (id: string) => {
        try {
            console.log("🌀 [GolemContext] Requesting remote launch...");
            // 首先調用 Launcher API
            await fetch("/api/system/launcher/start", { method: "POST" }).catch(() => null);
            
            // 輪詢後端是否已完成啟動 (最多等待 30 秒)
            console.log("⏳ [GolemContext] Waiting for backend to finish booting...");
            let backendReady = false;
            for (let i = 0; i < 60; i++) {
                try {
                    const check = await fetch(apiUrl("/api/system/status"), { signal: AbortSignal.timeout(500) });
                    if (check.ok) {
                        const data = await check.json();
                        setIsBooting(data.isBooting);
                        if (!data.isBooting) {
                            backendReady = true;
                            break;
                        }
                    }
                } catch (e) {}
                await new Promise(r => setTimeout(r, 500));
            }

            if (!backendReady) {
                console.error("❌ [GolemContext] Backend failed to start within timeout.");
                return false;
            }

            console.log("✅ [GolemContext] Backend ready. Sending start command...");
            const res = await fetch(apiUrl("/api/golems/start"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            });
            const data = await res.json();
            if (data.success) {
                fetchGolems();
                fetchSystemStatus(); // 重整系統狀態
                return true;
            }
            return false;
        } catch (err) {
            console.error("❌ [GolemContext] Failed to start golem", err);
            return false;
        }
    };

    useEffect(() => {
        fetchGolems();
        fetchSystemStatus();

        // 🎯 [v9.1.15] 自動輪詢 Booting 狀態，直到就緒
        let bootPollingTimer: NodeJS.Timeout | null = null;
        if (isBooting) {
            bootPollingTimer = setInterval(() => {
                fetchSystemStatus();
            }, 1000);
        }

        return () => {
            if (bootPollingTimer) clearInterval(bootPollingTimer);
        };
    }, [isBooting]);

    useEffect(() => {
        const handleInit = (data: any) => {
            if (data.golems) {
                const formattedGolems = typeof data.golems[0] === 'string'
                    ? data.golems.map((id: string) => ({ id, status: 'running' }))
                    : data.golems;

                setGolems(formattedGolems);
                setActiveGolem(prev => {
                    if (!prev && formattedGolems.length > 0) return formattedGolems[0].id;
                    return prev;
                });
                setIsLoadingGolems(false);
            }
        };

        const handleConnect = () => {
            fetchGolems();
            fetchSystemStatus();
        };

        socket.on("init", handleInit);
        socket.on("connect", handleConnect);

        return () => {
            socket.off("init", handleInit);
            socket.off("connect", handleConnect);
        };
    }, []);

    const handleSetGolem = (id: string) => {
        setActiveGolem(id);
        localStorage.setItem("golem_active_id", id);
    };

    const activeGolemObj = golems.find((g: GolemInfo) => g.id === activeGolem);
    const activeGolemStatus = activeGolemObj?.status ?? ""; // ✅ [Bug #3 修復] 空字串，避免誤顯示為 running
    const hasGolems = golems.length > 0;

    return (
        <GolemContext.Provider value={{
            activeGolem,
            activeGolemStatus,
            setActiveGolem: handleSetGolem,
            golems,
            hasGolems,
            isLoadingGolems,
            refreshGolems: async () => {
                await fetchSystemStatus();
                await fetchGolems();
            },
            startGolem,
            isSystemConfigured,
            isBooting,
            isLoadingSystem,
            isSingleNode,
            version,
        }}>
            {children}
        </GolemContext.Provider>
    );
}
