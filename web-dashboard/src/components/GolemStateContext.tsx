"use client";

import {
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
    ReactNode,
} from "react";
import { socket } from "@/lib/socket";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

/**
 * Golem behaviour states, mirrored from Star-Office-UI's STATES map.
 *
 *   idle        → sofa / resting (no recent activity)
 *   writing     → "brain" role — composing a reply
 *   researching → "memory" role — querying memory
 *   executing   → "action" role — running tools / tasks
 *   syncing     → reserved for future sync events
 *   error       → error log detected
 */
export type GolemBehaviorState =
    | "idle"
    | "writing"
    | "researching"
    | "executing"
    | "syncing"
    | "error";

interface GolemStateContextValue {
    /** Current behaviour state */
    state: GolemBehaviorState;
    /** Human-readable description of what Golem is doing */
    detail: string;
    /** Milliseconds since the last active event */
    msSinceLastActivity: number;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

/** After this many ms of silence, revert to "idle". */
const IDLE_TIMEOUT_MS = 4000;

// ─────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────

const GolemStateContext = createContext<GolemStateContextValue>({
    state: "idle",
    detail: "Waiting…",
    msSinceLastActivity: Infinity,
});

export function useGolemState() {
    return useContext(GolemStateContext);
}

// ─────────────────────────────────────────────────────────
// Helpers — log classification
// ─────────────────────────────────────────────────────────

function classifyLog(logData: {
    msg?: string;
    raw?: string;
    cleanMsg?: string;
}): { role: string; text: string } | null {
    const text = logData.cleanMsg || logData.msg || logData.raw || "";
    if (!text) return null;

    const lowerText = text.toLowerCase();

    // Multi-agent prefix has its own role tag
    const multiAgentMatch = text.match(/\[MultiAgent\]\s*\[(.*?)\]/i);
    if (multiAgentMatch) {
        const name = multiAgentMatch[1].trim().toLowerCase();
        return { role: name, text };
    }

    if (text.includes("[GOLEM_MEMORY]")) return { role: "memory", text };
    if (text.includes("[GOLEM_ACTION]")) return { role: "action", text };
    if (
        text.includes("🤖 [Golem] 說:") ||
        text.includes("[GOLEM_REPLY]")
    )
        return { role: "brain", text };
    if (
        text.includes("🗣️ [User] 說:") ||
        lowerText.includes("[user]") ||
        lowerText.includes("you:") ||
        lowerText.includes("使用者:")
    )
        return { role: "user", text };

    return null;
}

/**
 * Map a log role to a GolemBehaviorState.
 *
 * brain  → writing   (composing a reply)
 * memory → researching
 * action → executing (tool calls / code)
 * error  → error
 * user   → keep current state (user message doesn't change Golem state)
 */
function roleToState(role: string): GolemBehaviorState | null {
    switch (role) {
        case "brain":
            return "writing";
        case "memory":
            return "researching";
        case "action":
            return "executing";
        case "error":
        case "system_error":
            return "error";
        default:
            // multi-agent sub-roles (alex, bob, carol…) → executing
            if (!["user", "system"].includes(role)) return "executing";
            return null;
    }
}

function roleToDetail(role: string, text: string): string {
    const short = text.slice(0, 60).replace(/\n/g, " ");
    switch (role) {
        case "brain":
            return "Composing reply…";
        case "memory":
            return "Searching memory…";
        case "action":
            return short || "Executing task…";
        default:
            return short || "Working…";
    }
}

// ─────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────

export function GolemStateProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<GolemBehaviorState>("idle");
    const [detail, setDetail] = useState("Waiting…");
    const [msSinceLastActivity, setMsSinceLastActivity] = useState(Infinity);

    const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastActivityRef = useRef<number>(Date.now() - 999999);

    const scheduleIdle = () => {
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        idleTimerRef.current = setTimeout(() => {
            setState("idle");
            setDetail("Waiting…");
        }, IDLE_TIMEOUT_MS);
    };

    // Track elapsed ms for consumers that want fine-grained info
    useEffect(() => {
        const ticker = setInterval(() => {
            setMsSinceLastActivity(Date.now() - lastActivityRef.current);
        }, 500);
        return () => clearInterval(ticker);
    }, []);

    useEffect(() => {
        const handleLog = (logData: Record<string, unknown>) => {
            const classified = classifyLog(
                logData as { msg?: string; raw?: string; cleanMsg?: string }
            );
            if (!classified) return;

            const { role, text } = classified;
            const newState = roleToState(role);
            if (!newState) return; // user messages don't change Golem state

            lastActivityRef.current = Date.now();
            setState(newState);
            setDetail(roleToDetail(role, text));
            scheduleIdle();
        };

        socket.on("log", handleLog);
        return () => {
            socket.off("log", handleLog);
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <GolemStateContext.Provider
            value={{ state, detail, msSinceLastActivity }}
        >
            {children}
        </GolemStateContext.Provider>
    );
}
