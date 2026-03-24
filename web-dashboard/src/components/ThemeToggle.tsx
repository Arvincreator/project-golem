"use client";

import { Monitor, MoonStar, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
    const { resolvedTheme, toggleTheme, theme, setTheme } = useTheme();

    return (
        <div className="flex items-center gap-2">
            <button
                onClick={toggleTheme}
                className="relative inline-flex h-9 w-16 items-center rounded-full border border-border bg-secondary/70 transition-all duration-300 hover:bg-muted/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                role="switch"
                aria-checked={resolvedTheme === "dark"}
                aria-label="Toggle dark mode"
            >
                <span
                    className={`absolute left-2 transition-opacity duration-300 ${
                        resolvedTheme === "light" ? "opacity-100" : "opacity-30"
                    }`}
                >
                    <Sun className="h-3.5 w-3.5 text-amber-400" />
                </span>
                <span
                    className={`absolute right-2 transition-opacity duration-300 ${
                        resolvedTheme === "dark" ? "opacity-100" : "opacity-30"
                    }`}
                >
                    <MoonStar className="h-3.5 w-3.5 text-sky-300" />
                </span>
                <span
                    className={`inline-block h-7 w-7 transform rounded-full bg-foreground shadow-lg transition-transform duration-300 ${
                        resolvedTheme === "dark" ? "translate-x-8" : "translate-x-1"
                    }`}
                />
            </button>
            <button
                onClick={() => setTheme("system")}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                    theme === "system"
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary/70 text-muted-foreground hover:text-foreground"
                }`}
                aria-label="Use system theme"
            >
                <span className="inline-flex items-center gap-1">
                    <Monitor className="h-3 w-3" />
                    Auto
                </span>
            </button>
        </div>
    );
}
