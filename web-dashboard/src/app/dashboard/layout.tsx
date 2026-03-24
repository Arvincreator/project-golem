"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Users, Globe, ChevronLeft, ChevronRight, Terminal, BrainCircuit, BookOpen, Settings, User, MessageSquare, Plug, BookHeart, Library, Activity } from "lucide-react";
import { GolemProvider, useGolem } from "@/components/GolemContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BootScreen } from "@/components/BootScreen";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useI18n } from "@/components/I18nProvider";

function DashboardSidebar({
    isSidebarOpen,
    setIsSidebarOpen
}: {
    isSidebarOpen: boolean,
    setIsSidebarOpen: (v: boolean) => void
}) {
    const pathname = usePathname();
    const { activeGolem, setActiveGolem, golems, version } = useGolem();
    const { t } = useI18n();

    const navItems = [
        { labelKey: "sidebar.nav.chat", href: "/dashboard/chat", icon: MessageSquare },
        { labelKey: "sidebar.nav.promptPool", href: "/dashboard/prompt-pool", icon: Library },
        { labelKey: "sidebar.nav.promptTrends", href: "/dashboard/prompt-trends", icon: Activity },
        { labelKey: "sidebar.nav.skills", href: "/dashboard/skills", icon: BookOpen },
        { labelKey: "sidebar.nav.diary", href: "/dashboard/diary", icon: BookHeart },
        { labelKey: "sidebar.nav.mcp", href: "/dashboard/mcp", icon: Plug },
        { labelKey: "sidebar.nav.persona", href: "/dashboard/persona", icon: User },
        { labelKey: "sidebar.nav.agents", href: "/dashboard/agents", icon: Users },
        { labelKey: "sidebar.nav.office", href: "/dashboard/office", icon: Users },
        { labelKey: "sidebar.nav.memory", href: "/dashboard/memory", icon: BrainCircuit },
        { labelKey: "sidebar.nav.settingsSummary", href: "/dashboard/settings", icon: Settings },
    ] as const;

    const isTactical = pathname === "/dashboard" || pathname === "/dashboard/";
    const isTerminal = pathname.startsWith("/dashboard/terminal");

    return (
        <aside className={cn(
            "border-r border-border bg-card flex flex-col transition-all duration-300",
            isSidebarOpen ? "w-64" : "w-16"
        )}>
            <div className="p-4 flex items-center justify-between border-b border-border">
                {isSidebarOpen && (
                    <div className="flex-1 min-w-0 pr-2">
                        <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-400 whitespace-nowrap overflow-hidden text-ellipsis">
                            Golem {version}
                        </h1>
                        <p className="text-xs text-muted-foreground mt-1 whitespace-nowrap">
                            {t("sidebar.botControlCenter")}
                        </p>
                    </div>
                )}
                <button
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-accent-foreground flex-shrink-0"
                    title={isSidebarOpen ? t("sidebar.collapseSidebar") : t("sidebar.expandSidebar")}
                >
                    {isSidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
                </button>
            </div>

            {/* Golem Switcher - Only show if there are multiple golems */}
            {isSidebarOpen && golems.length > 1 && (
                <div className="px-4 py-3 border-b border-border">
                    <label className="text-xs text-muted-foreground mb-1 block">{t("sidebar.activeGolem")}</label>
                    <select
                        value={activeGolem}
                        onChange={(e) => setActiveGolem(e.target.value)}
                        className="w-full bg-secondary border border-border text-foreground text-sm rounded px-2 py-1.5 focus:outline-none focus:border-primary"
                    >
                        {golems.map(golem => (
                            <option key={golem.id} value={golem.id}>{golem.id}</option>
                        ))}
                    </select>
                </div>
            )}

            {/* Console Switcher Section */}
            <div className={cn(
                "p-3 border-b border-border bg-accent/10 whitespace-nowrap overflow-hidden transition-all",
                !isSidebarOpen && "px-2"
            )}>
                {isSidebarOpen ? (
                    <div className="relative flex p-1 bg-secondary/80 rounded-xl border border-border shadow-inner">
                        <div
                            className={cn(
                                "absolute top-1 bottom-1 w-[calc(50%-4px)] bg-background border border-border shadow-md rounded-lg transition-all duration-300 ease-out",
                                isTerminal ? "translate-x-full" : "translate-x-0"
                            )}
                        />
                        <Link
                            href="/dashboard"
                            className={cn(
                                "relative flex-1 py-1.5 text-[11px] font-bold text-center z-10 rounded-lg transition-colors flex flex-col items-center justify-center",
                                isTactical ? "text-primary" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <LayoutDashboard className="w-3.5 h-3.5 mb-1" />
                            {t("sidebar.tacticalDashboard")}
                        </Link>
                        <Link
                            href="/dashboard/terminal"
                            className={cn(
                                "relative flex-1 py-1.5 text-[11px] font-bold text-center z-10 rounded-lg transition-colors flex flex-col items-center justify-center",
                                isTerminal ? "text-primary" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Terminal className="w-3.5 h-3.5 mb-1" />
                            {t("sidebar.terminalDashboard")}
                        </Link>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2 items-center">
                        <Link
                            href="/dashboard"
                            title={t("sidebar.tacticalDashboard")}
                            className={cn(
                                "w-10 h-10 flex items-center justify-center rounded-lg transition-all",
                                isTactical ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30" : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                            )}
                        >
                            <LayoutDashboard className="w-5 h-5" />
                        </Link>
                        <Link
                            href="/dashboard/terminal"
                            title={t("sidebar.terminalDashboard")}
                            className={cn(
                                "w-10 h-10 flex items-center justify-center rounded-lg transition-all",
                                isTerminal ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30" : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                            )}
                        >
                            <Terminal className="w-5 h-5" />
                        </Link>
                    </div>
                )}
            </div>

            <nav className="flex-1 py-4 space-y-1 overflow-y-auto flex flex-col items-center">
                {navItems.map((item) => {
                    const Icon = item.icon;

                    const isActive = pathname.startsWith(item.href);

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            title={!isSidebarOpen ? t(item.labelKey) : undefined}
                            className={cn(
                                "flex items-center rounded-lg transition-colors text-sm",
                                isSidebarOpen ? "w-[90%] space-x-3 px-3 py-2" : "w-10 h-10 justify-center",
                                isActive
                                    ? "bg-accent text-accent-foreground font-medium"
                                    : "text-muted-foreground hover:bg-accent/30 hover:text-accent-foreground"
                            )}
                        >
                            <Icon className="w-5 h-5 flex-shrink-0" />
                            {isSidebarOpen && <span className="whitespace-nowrap">{t(item.labelKey)}</span>}
                        </Link>
                    );
                })}
            </nav>

            <div className="p-4 border-t border-border flex flex-col items-center gap-4">
                <ThemeToggle />
                {isSidebarOpen && <LanguageToggle />}
                <div className="flex items-center text-xs text-muted-foreground overflow-hidden text-center whitespace-nowrap h-4">
                    <Globe className="w-4 h-4 flex-shrink-0" />
                    {isSidebarOpen && <span className="ml-2">{t("sidebar.webGeminiOnline")}</span>}
                </div>
            </div>
        </aside>
    );
}



export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    return (
        <GolemProvider>
            <DashboardContent isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen}>
                {children}
            </DashboardContent>
        </GolemProvider>
    );
}

function DashboardContent({
    children,
    isSidebarOpen,
    setIsSidebarOpen
}: {
    children: React.ReactNode,
    isSidebarOpen: boolean,
    setIsSidebarOpen: (v: boolean) => void
}) {
    const { activeGolemStatus, isSystemConfigured, isLoadingSystem, isLoadingGolems, hasGolems, isBooting } = useGolem();
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (isLoadingGolems) return;
        if (activeGolemStatus === 'pending_setup' && pathname !== '/dashboard/setup') {
            router.push('/dashboard/setup');
        }
    }, [activeGolemStatus, pathname, router, isLoadingGolems]);

    // 系統設定保護：若 GEMINI_API_KEYS 未設定且不在設定頁，就導向設定向導
    useEffect(() => {
        if (!isLoadingSystem && !isSystemConfigured && pathname !== '/dashboard/system-setup') {
            router.push('/dashboard/system-setup');
        }
    }, [isLoadingSystem, isSystemConfigured, pathname, router]);

    // (移除原本強制跳轉到 agents/create 的邏輯，改由 /dashboard 自己渲染迎新畫面)

    const isSetupPage = ['/dashboard/system-setup', '/dashboard/agents/create', '/dashboard/setup']
        .some(p => pathname.startsWith(p));

    // 當沒有任何 Golem 時，隱藏 Sidebar，強制引導設定
    const shouldHideSidebar = isSetupPage || (!isLoadingGolems && !hasGolems);

    return (
        <div className="flex h-screen bg-background text-foreground overflow-hidden">
            {!shouldHideSidebar && <DashboardSidebar isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen} />}
            {/* Main Content */}
            <main className="flex-1 overflow-auto bg-background flex flex-col h-screen relative">
                <BootScreen isBooting={isBooting} />
                {children}
            </main>
        </div>
    );
}
