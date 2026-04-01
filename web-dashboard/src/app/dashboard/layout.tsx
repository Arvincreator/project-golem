"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Users, Globe, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, GripVertical, Terminal, BrainCircuit, BookOpen, Settings, User, MessageSquare, Plug, BookHeart, Library, Activity, ListTodo } from "lucide-react";
import { GolemProvider, useGolem } from "@/components/GolemContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BootScreen } from "@/components/BootScreen";
import { LanguageToggle } from "@/components/LanguageToggle";
import { OpsStyleSwitcher } from "@/components/OpsStyleSwitcher";
import { useI18n } from "@/components/I18nProvider";
import GlobalAutoDiaryBell from "./components/GlobalAutoDiaryBell";

const SIDEBAR_NAV_ORDER_STORAGE_KEY = "golem-sidebar-nav-order-v1";

const NAV_ITEMS = [
    { labelKey: "sidebar.nav.chat", href: "/dashboard/chat", icon: MessageSquare },
    { labelKey: "sidebar.nav.diary", href: "/dashboard/diary", icon: BookHeart },
    { labelKey: "sidebar.nav.persona", href: "/dashboard/persona", icon: User },
    { labelKey: "sidebar.nav.promptPool", href: "/dashboard/prompt-pool", icon: Library },
    { labelKey: "sidebar.nav.promptTrends", href: "/dashboard/prompt-trends", icon: Activity },
    { labelKey: "sidebar.nav.skills", href: "/dashboard/skills", icon: BookOpen },
    { labelKey: "sidebar.nav.mcp", href: "/dashboard/mcp", icon: Plug },
    { labelKey: "sidebar.nav.agents", href: "/dashboard/agents", icon: Users },
    { labelKey: "sidebar.nav.office", href: "/dashboard/office", icon: Users },
    { labelKey: "sidebar.nav.memory", href: "/dashboard/memory", icon: BrainCircuit },
    { labelKey: "sidebar.nav.tasks", href: "/dashboard/tasks", icon: ListTodo },
    { labelKey: "sidebar.nav.settingsSummary", href: "/dashboard/settings", icon: Settings },
] as const;

type SidebarNavItem = (typeof NAV_ITEMS)[number];
type SidebarNavHref = SidebarNavItem["href"];

const DEFAULT_SIDEBAR_NAV_ORDER: SidebarNavHref[] = NAV_ITEMS.map((item) => item.href);

function isSidebarNavHref(value: string): value is SidebarNavHref {
    return DEFAULT_SIDEBAR_NAV_ORDER.includes(value as SidebarNavHref);
}

function normalizeSidebarNavOrder(order: readonly string[]): SidebarNavHref[] {
    const unique = new Set<SidebarNavHref>();
    const normalized: SidebarNavHref[] = [];

    for (const href of order) {
        if (!isSidebarNavHref(href) || unique.has(href)) continue;
        unique.add(href);
        normalized.push(href);
    }

    for (const href of DEFAULT_SIDEBAR_NAV_ORDER) {
        if (unique.has(href)) continue;
        unique.add(href);
        normalized.push(href);
    }

    return normalized;
}

function isSameNavOrder(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((item, index) => item === b[index]);
}

function readStoredSidebarNavOrder(): SidebarNavHref[] {
    if (typeof window === "undefined") return [...DEFAULT_SIDEBAR_NAV_ORDER];
    try {
        const raw = localStorage.getItem(SIDEBAR_NAV_ORDER_STORAGE_KEY);
        if (!raw) return [...DEFAULT_SIDEBAR_NAV_ORDER];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [...DEFAULT_SIDEBAR_NAV_ORDER];
        const values = parsed.filter((item): item is string => typeof item === "string");
        return normalizeSidebarNavOrder(values);
    } catch {
        return [...DEFAULT_SIDEBAR_NAV_ORDER];
    }
}

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
    const [navOrder, setNavOrder] = useState<SidebarNavHref[]>(() => readStoredSidebarNavOrder());
    const [isSidebarCustomizerOpen, setIsSidebarCustomizerOpen] = useState(false);
    const [draggingHref, setDraggingHref] = useState<SidebarNavHref | null>(null);
    const [dragOverHref, setDragOverHref] = useState<SidebarNavHref | null>(null);

    useEffect(() => {
        const normalized = normalizeSidebarNavOrder(navOrder);
        if (!isSameNavOrder(navOrder, normalized)) {
            setNavOrder(normalized);
            return;
        }
        if (typeof window !== "undefined") {
            localStorage.setItem(SIDEBAR_NAV_ORDER_STORAGE_KEY, JSON.stringify(normalized));
        }
    }, [navOrder]);

    const navItemByHref = new Map<SidebarNavHref, SidebarNavItem>(
        NAV_ITEMS.map((item) => [item.href, item])
    );
    const orderedNavItems = navOrder
        .map((href) => navItemByHref.get(href))
        .filter((item): item is SidebarNavItem => Boolean(item));

    const reorderNavItems = (dragHref: SidebarNavHref, dropHref: SidebarNavHref) => {
        if (dragHref === dropHref) return;
        setNavOrder((prev) => {
            const fromIndex = prev.indexOf(dragHref);
            const toIndex = prev.indexOf(dropHref);
            if (fromIndex < 0 || toIndex < 0) return prev;
            const next = [...prev];
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            return next;
        });
    };

    const moveNavItem = (href: SidebarNavHref, offset: -1 | 1) => {
        setNavOrder((prev) => {
            const index = prev.indexOf(href);
            if (index < 0) return prev;
            const targetIndex = Math.max(0, Math.min(prev.length - 1, index + offset));
            if (targetIndex === index) return prev;
            const next = [...prev];
            const [moved] = next.splice(index, 1);
            next.splice(targetIndex, 0, moved);
            return next;
        });
    };

    const isUnifiedConsole = pathname === "/dashboard" || pathname === "/dashboard/" || pathname.startsWith("/dashboard/terminal");

    return (
        <aside className={cn(
            "enterprise-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300",
            isSidebarOpen ? "w-64" : "w-16"
        )}>
            <div className="p-4 flex items-center justify-between border-b border-sidebar-border/70">
                {isSidebarOpen && (
                    <div className="flex-1 min-w-0 pr-2">
                        <h1 className="text-[1.05rem] font-semibold text-foreground whitespace-nowrap overflow-hidden text-ellipsis">
                            Project Golem
                        </h1>
                        <div className="mt-1 flex items-center gap-2">
                            <span className="enterprise-badge">v{version}</span>
                            <p className="text-[11px] text-muted-foreground whitespace-nowrap">
                                {t("sidebar.botControlCenter")}
                            </p>
                        </div>
                    </div>
                )}
                <button
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className="p-1.5 hover:bg-accent/80 rounded-lg border border-transparent hover:border-border text-muted-foreground hover:text-accent-foreground flex-shrink-0 transition-colors"
                    title={isSidebarOpen ? t("sidebar.collapseSidebar") : t("sidebar.expandSidebar")}
                >
                    {isSidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
                </button>
            </div>

            {/* Golem Switcher - Only show if there are multiple golems */}
            {isSidebarOpen && golems.length > 1 && (
                <div className="px-4 py-3 border-b border-sidebar-border/70">
                    <label className="enterprise-panel-title mb-1.5 block">{t("sidebar.activeGolem")}</label>
                    <select
                        value={activeGolem}
                        onChange={(e) => setActiveGolem(e.target.value)}
                        className="w-full bg-secondary/70 border border-border text-foreground text-sm rounded-lg px-2.5 py-2 focus:outline-none focus:border-primary"
                    >
                        {golems.map(golem => (
                            <option key={golem.id} value={golem.id}>{golem.id}</option>
                        ))}
                    </select>
                </div>
            )}

            {/* Console Switcher Section */}
            <div className={cn(
                "p-3 border-b border-sidebar-border/70 whitespace-nowrap overflow-hidden transition-all",
                !isSidebarOpen && "px-2"
            )}>
                {isSidebarOpen ? (
                    <div className="enterprise-surface p-1.5">
                        <Link
                            href="/dashboard"
                            className={cn(
                                "flex w-full py-2.5 px-3 text-[11px] font-semibold rounded-lg transition-colors items-center justify-center gap-2",
                                isUnifiedConsole ? "bg-background border border-border text-primary" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <LayoutDashboard className="w-3.5 h-3.5" />
                            <Terminal className="w-3.5 h-3.5" />
                            {t("sidebar.unifiedConsole")}
                        </Link>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2 items-center">
                        <Link
                            href="/dashboard"
                            title={t("sidebar.unifiedConsole")}
                            className={cn(
                                "w-10 h-10 flex items-center justify-center rounded-xl border transition-all",
                                isUnifiedConsole ? "bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/30" : "text-muted-foreground border-transparent hover:bg-accent/50 hover:border-border hover:text-accent-foreground"
                            )}
                        >
                            <LayoutDashboard className="w-4 h-4" />
                            <Terminal className="w-4 h-4 -ml-1" />
                        </Link>
                    </div>
                )}
            </div>

            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {isSidebarOpen && (
                    <div className="px-3 pt-3 pb-2 border-b border-sidebar-border/60">
                        <button
                            type="button"
                            onClick={() => setIsSidebarCustomizerOpen((prev) => !prev)}
                            className="w-full flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-secondary/45 hover:bg-secondary/65 px-2.5 py-2 transition-colors"
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                <GripVertical className="w-3.5 h-3.5 text-primary shrink-0" />
                                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground truncate">
                                    {t("sidebar.customizeNav.title")}
                                </span>
                            </div>
                            {isSidebarCustomizerOpen ? (
                                <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                            ) : (
                                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                            )}
                        </button>

                        {isSidebarCustomizerOpen && (
                            <div className="mt-2 rounded-lg border border-border/70 bg-background/45 p-2 space-y-1 max-h-[38vh] overflow-y-auto custom-scrollbar">
                                <p className="text-[10px] text-muted-foreground px-1">
                                    {t("sidebar.customizeNav.hint")}
                                </p>
                                {orderedNavItems.map((item, index) => {
                                    const isDragging = draggingHref === item.href;
                                    const isDragOver = dragOverHref === item.href && draggingHref !== item.href;
                                    const isFirst = index === 0;
                                    const isLast = index === orderedNavItems.length - 1;
                                    return (
                                        <div
                                            key={`customizer-${item.href}`}
                                            draggable
                                            onDragStart={(event) => {
                                                setDraggingHref(item.href);
                                                event.dataTransfer.effectAllowed = "move";
                                                event.dataTransfer.setData("text/plain", item.href);
                                            }}
                                            onDragOver={(event) => {
                                                event.preventDefault();
                                                if (draggingHref && draggingHref !== item.href) {
                                                    setDragOverHref(item.href);
                                                }
                                            }}
                                            onDrop={(event) => {
                                                event.preventDefault();
                                                const dragData = event.dataTransfer.getData("text/plain");
                                                if (isSidebarNavHref(dragData)) {
                                                    reorderNavItems(dragData, item.href);
                                                }
                                                setDraggingHref(null);
                                                setDragOverHref(null);
                                            }}
                                            onDragLeave={() => {
                                                if (dragOverHref === item.href) setDragOverHref(null);
                                            }}
                                            onDragEnd={() => {
                                                setDraggingHref(null);
                                                setDragOverHref(null);
                                            }}
                                            className={cn(
                                                "group flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 transition-colors cursor-grab active:cursor-grabbing",
                                                isDragging
                                                    ? "bg-primary/10 border-primary/40 opacity-70"
                                                    : "bg-secondary/35 border-border/70 hover:bg-secondary/55",
                                                isDragOver && "bg-primary/15 border-primary/60"
                                            )}
                                        >
                                            <div className="flex items-center gap-2 min-w-0">
                                                <GripVertical
                                                    className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary shrink-0"
                                                />
                                                <span className="text-xs text-foreground truncate">
                                                    {t(item.labelKey)}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => moveNavItem(item.href, -1)}
                                                    disabled={isFirst}
                                                    title={t("sidebar.customizeNav.moveUp")}
                                                    className={cn(
                                                        "w-6 h-6 rounded border flex items-center justify-center transition-colors",
                                                        isFirst
                                                            ? "border-border/40 text-muted-foreground/40 cursor-not-allowed"
                                                            : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/70"
                                                    )}
                                                >
                                                    <ChevronUp className="w-3 h-3" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => moveNavItem(item.href, 1)}
                                                    disabled={isLast}
                                                    title={t("sidebar.customizeNav.moveDown")}
                                                    className={cn(
                                                        "w-6 h-6 rounded border flex items-center justify-center transition-colors",
                                                        isLast
                                                            ? "border-border/40 text-muted-foreground/40 cursor-not-allowed"
                                                            : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/70"
                                                    )}
                                                >
                                                    <ChevronDown className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                <nav className="flex-1 py-4 space-y-1 overflow-y-auto flex flex-col items-center custom-scrollbar">
                    {orderedNavItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname.startsWith(item.href);

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                title={!isSidebarOpen ? t(item.labelKey) : undefined}
                                className={cn(
                                    "enterprise-nav-item flex items-center text-sm",
                                    isSidebarOpen ? "w-[90%] space-x-3 px-3 py-2" : "w-10 h-10 justify-center",
                                    isActive
                                        ? "enterprise-nav-item--active text-accent-foreground font-semibold"
                                        : "text-muted-foreground hover:text-accent-foreground"
                                )}
                            >
                                <Icon className="w-4 h-4 flex-shrink-0" />
                                {isSidebarOpen && <span className="whitespace-nowrap">{t(item.labelKey)}</span>}
                            </Link>
                        );
                    })}
                </nav>
            </div>

            <div className="p-4 border-t border-sidebar-border/70 flex flex-col items-center gap-4">
                <ThemeToggle />
                {isSidebarOpen && <LanguageToggle />}
                {isSidebarOpen && <OpsStyleSwitcher />}
                <div className="flex items-center gap-2 text-xs text-muted-foreground overflow-hidden text-center whitespace-nowrap h-5">
                    <span className="status-ping w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                    <Globe className="w-3.5 h-3.5 flex-shrink-0" />
                    {isSidebarOpen && <span className="ml-0.5">{t("sidebar.webGeminiOnline")}</span>}
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
            <main className="enterprise-shell flex-1 overflow-auto bg-background flex flex-col h-screen relative">
                <BootScreen isBooting={isBooting} />
                <GlobalAutoDiaryBell hidden={shouldHideSidebar} />
                <div className="relative z-10 flex-1 min-h-0 overflow-hidden flex flex-col">
                    {children}
                </div>
            </main>
        </div>
    );
}
