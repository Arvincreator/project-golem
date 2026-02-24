"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Users, Database, Globe, ChevronLeft, ChevronRight } from "lucide-react";

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    const navItems = [
        { name: "戰術控制台", href: "/dashboard", icon: LayoutDashboard },
        { name: "Agent 會議室", href: "/dashboard/agents", icon: Users },
        { name: "辦公室模式", href: "/dashboard/office", icon: Users },
    ];

    return (
        <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
            {/* Sidebar */}
            <aside className={cn(
                "border-r border-gray-800 bg-gray-950 flex flex-col transition-all duration-300",
                isSidebarOpen ? "w-64" : "w-16"
            )}>
                <div className="p-4 flex items-center justify-between border-b border-gray-800">
                    {isSidebarOpen && (
                        <div>
                            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-400 whitespace-nowrap">
                                Golem v9.0
                            </h1>
                            <p className="text-xs text-gray-500 mt-1 whitespace-nowrap">MultiAgent War Room</p>
                        </div>
                    )}
                    <button
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white"
                        title={isSidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
                    >
                        {isSidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
                    </button>
                </div>

                <nav className="flex-1 py-4 space-y-2 overflow-hidden flex flex-col items-center">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname === item.href;

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

            {/* Main Content */}
            <main className="flex-1 overflow-auto bg-gray-950 flex flex-col h-screen">
                {children}
            </main>
        </div>
    );
}
