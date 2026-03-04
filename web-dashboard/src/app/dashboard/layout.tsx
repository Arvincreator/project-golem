"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Users, Database, Globe, ChevronLeft, ChevronRight, Terminal, BrainCircuit, BookOpen } from "lucide-react";
import { GolemProvider, useGolem } from "@/components/GolemContext";

function DashboardSidebar({
    isSidebarOpen,
    setIsSidebarOpen
}: {
    isSidebarOpen: boolean,
    setIsSidebarOpen: (v: boolean) => void
}) {
    const pathname = usePathname();
    const { activeGolem, setActiveGolem, golems } = useGolem();

    const navItems = [
        { name: "戰術控制台", href: "/dashboard", icon: LayoutDashboard },
        { name: "終端機控制台", href: "/dashboard/terminal", icon: Terminal },
        { name: "技能說明書", href: "/dashboard/skills", icon: BookOpen },
        { name: "Agent 會議室", href: "/dashboard/agents", icon: Users },
        { name: "辦公室模式", href: "/dashboard/office", icon: Users },
        { name: "記憶核心", href: "/dashboard/memory", icon: BrainCircuit },
    ];

    return (
        <aside className={cn(
            "border-r border-gray-800 bg-gray-950 flex flex-col transition-all duration-300",
            isSidebarOpen ? "w-64" : "w-16"
        )}>
            <div className="p-4 flex items-center justify-between border-b border-gray-800">
                {isSidebarOpen && (
                    <div className="flex-1 min-w-0 pr-2">
                        <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-400 whitespace-nowrap overflow-hidden text-ellipsis">
                            Golem v9.0
                        </h1>
                        <p className="text-xs text-gray-500 mt-1 whitespace-nowrap">MultiAgent War Room</p>
                    </div>
                )}
                <button
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white flex-shrink-0"
                    title={isSidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
                >
                    {isSidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
                </button>
            </div>

            {/* Golem Switcher */}
            {isSidebarOpen && golems.length > 0 && (
                <div className="px-4 py-3 border-b border-gray-800">
                    <label className="text-xs text-gray-500 mb-1 block">Active Golem</label>
                    <select
                        value={activeGolem}
                        onChange={(e) => setActiveGolem(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-cyan-500"
                    >
                        {golems.map(id => (
                            <option key={id} value={id}>{id}</option>
                        ))}
                    </select>
                </div>
            )}

            <nav className="flex-1 py-4 space-y-2 overflow-y-auto flex flex-col items-center">
                {navItems.map((item) => {
                    const Icon = item.icon;

                    const isActive = item.href === "/dashboard"
                        ? (pathname === "/dashboard" || pathname === "/dashboard/")
                        : pathname.startsWith(item.href);

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            title={!isSidebarOpen ? item.name : undefined}
                            className={cn(
                                "flex items-center rounded-lg transition-colors text-sm",
                                isSidebarOpen ? "w-[90%] space-x-3 px-3 py-2" : "w-10 h-10 justify-center mb-2",
                                isActive
                                    ? "bg-gray-800 text-white"
                                    : "text-gray-400 hover:bg-gray-800/50 hover:text-white"
                            )}
                        >
                            <Icon className="w-5 h-5 flex-shrink-0" />
                            {isSidebarOpen && <span className="whitespace-nowrap">{item.name}</span>}
                        </Link>
                    );
                })}
            </nav>

            <div className="p-4 border-t border-gray-800 flex justify-center">
                <div className="flex items-center text-xs text-gray-500 overflow-hidden text-center whitespace-nowrap h-4">
                    <Globe className="w-4 h-4 flex-shrink-0" />
                    {isSidebarOpen && <span className="ml-2">Web Gemini: Online</span>}
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
            <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
                <DashboardSidebar isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen} />
                {/* Main Content */}
                <main className="flex-1 overflow-auto bg-gray-950 flex flex-col h-screen">
                    {children}
                </main>
            </div>
        </GolemProvider>
    );
}
