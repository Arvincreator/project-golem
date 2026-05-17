"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { socket } from "@/lib/socket";
import { apiUrl } from "@/lib/api";
import { apiGet, apiPost } from "@/lib/api-client";

interface GolemInfo {
    id: string;
    status: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
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
    allowRemote: boolean;
    localIp: string;
    dashboardPort: number;
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
    version: `v${process.env.NEXT_PUBLIC_GOLEM_VERSION || "9.6.13"}`,
    allowRemote: false,
    localIp: "127.0.0.1",
    dashboardPort: 3000,
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
    const [version, setVersion] = useState(`v${process.env.NEXT_PUBLIC_GOLEM_VERSION || "9.6.13"}`);
    const [allowRemote, setAllowRemote] = useState(false);
    const [localIp, setLocalIp] = useState("127.0.0.1");
    const [dashboardPort, setDashboardPort] = useState(3000);

    const fetchGolems = async () => {
        setIsLoadingGolems(true);
        try {
            const data = await apiGet<{ golems?: GolemInfo[] }>(
                apiUrl("/api/golems"),
                undefined,
                { profile: "none" }
            );

            if (Array.isArray(data?.golems) && data.golems.length > 0) {
                const golemList = data.golems;
                setGolems(golemList);
                setActiveGolem((currentActive) => {
                    const ids = golemList.map((g: GolemInfo) => g.id);
                    if (!currentActive || !ids.includes(currentActive)) {
                        const saved = localStorage.getItem("golem_active_id");
                        if (saved && ids.includes(saved)) {
                            return saved;
                        }
                        return golemList[0].id;
                    }
                    return currentActive;
                });
            } else {
                setGolems([]);
                setActiveGolem("");
            }
        } catch {
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
            const data = await apiGet<{
                isSystemConfigured?: boolean;
                isBooting?: boolean;
                allowRemote?: boolean;
                localIp?: string;
                dashboardPort?: number;
            }>(
                apiUrl("/api/system/status"),
                undefined,
                { profile: "none" }
            );
            if (data) {
                setIsSystemConfigured(data.isSystemConfigured ?? true);
                setIsBooting(data.isBooting ?? false);
                setAllowRemote(data.allowRemote ?? false);
                setLocalIp(data.localIp ?? "127.0.0.1");
                setDashboardPort(data.dashboardPort ?? 3000);
            }
        } catch {
            setIsSystemConfigured(true); // default on error
        } finally {
            setIsLoadingSystem(false);
        }

        try {
            const data = await apiGet<{ version?: string }>(
                apiUrl("/api/system/config"),
                undefined,
                { profile: "none" }
            );
            if (data?.version) setVersion(`v${data.version}`);
        } catch {
            console.debug("Golem API unavailable (fetchSystemStatus)");
        }
    };

    const startGolem = async (id: string) => {
        try {
            console.log("🌀 [GolemContext] Requesting remote launch...");
            // 首先調用 Launcher API
            await apiPost("/api/system/launcher/start").catch(() => null);
            
            // 輪詢後端是否已完成啟動 (最多等待 30 秒)
            console.log("⏳ [GolemContext] Waiting for backend to finish booting...");
            let backendReady = false;
            for (let i = 0; i < 60; i++) {
                try {
                    const data = await apiGet<{ isBooting?: boolean }>(
                        apiUrl("/api/system/status"),
                        { signal: AbortSignal.timeout(500) },
                        { profile: "none", retries: 0 }
                    );
                    setIsBooting(Boolean(data?.isBooting));
                    if (!data?.isBooting) {
                        backendReady = true;
                        break;
                    }
                } catch {}
                await new Promise(r => setTimeout(r, 500));
            }

            if (!backendReady) {
                console.error("❌ [GolemContext] Backend failed to start within timeout.");
                return false;
            }

            console.log("✅ [GolemContext] Backend ready. Sending start command...");
            const data = await apiPost<{ success?: boolean }>(apiUrl("/api/golems/start"), { id });
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
        const handleInit = (payload: unknown) => {
            if (isRecord(payload) && Array.isArray(payload.golems)) {
                const formattedGolems = typeof payload.golems[0] === 'string'
                    ? payload.golems.map((id) => ({ id: String(id), status: 'running' }))
                    : payload.golems as GolemInfo[];

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
            allowRemote,
            localIp,
            dashboardPort,
        }}>
            {children}
        </GolemContext.Provider>
    );
}
