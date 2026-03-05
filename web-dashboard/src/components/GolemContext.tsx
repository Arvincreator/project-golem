"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { socket } from "@/lib/socket";

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
    refreshGolems: () => void;
    isSystemConfigured: boolean;
    isLoadingSystem: boolean;
}

const GolemContext = createContext<GolemContextType>({
    activeGolem: "",
    activeGolemStatus: "running",
    setActiveGolem: () => { },
    golems: [],
    hasGolems: false,
    isLoadingGolems: true,
    refreshGolems: () => { },
    isSystemConfigured: true, // optimistic default to avoid flash
    isLoadingSystem: true,
});

export const useGolem = () => useContext(GolemContext);

export function GolemProvider({ children }: { children: React.ReactNode }) {
    const [golems, setGolems] = useState<GolemInfo[]>([]);
    const [activeGolem, setActiveGolem] = useState<string>("");
    const [isLoadingGolems, setIsLoadingGolems] = useState(true);
    const [isSystemConfigured, setIsSystemConfigured] = useState(true);
    const [isLoadingSystem, setIsLoadingSystem] = useState(true);

    const fetchGolems = () => {
        setIsLoadingGolems(true);
        fetch("/api/golems")
            .then(res => res.json())
            .then(data => {
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
            })
            .catch(err => console.error("Failed to fetch golems", err))
            .finally(() => setIsLoadingGolems(false));
    };

    const fetchSystemStatus = () => {
        setIsLoadingSystem(true);
        fetch("/api/system/status")
            .then(res => res.json())
            .then(data => {
                setIsSystemConfigured(data.isSystemConfigured ?? true);
            })
            .catch(() => setIsSystemConfigured(true)) // on error, don't block
            .finally(() => setIsLoadingSystem(false));
    };

    useEffect(() => {
        fetchGolems();
        fetchSystemStatus();

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
    const activeGolemStatus = activeGolemObj?.status || "running";
    const hasGolems = golems.length > 0;

    return (
        <GolemContext.Provider value={{
            activeGolem,
            activeGolemStatus,
            setActiveGolem: handleSetGolem,
            golems,
            hasGolems,
            isLoadingGolems,
            refreshGolems: fetchGolems,
            isSystemConfigured,
            isLoadingSystem,
        }}>
            {children}
        </GolemContext.Provider>
    );
}
