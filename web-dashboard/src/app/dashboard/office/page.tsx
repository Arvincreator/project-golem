"use client";

import { useEffect, useState, useRef } from "react";
import { socket } from "@/lib/socket";
import { ChatBubble } from "@/components/ChatBubble";
import { PixelSprite } from "@/components/PixelSprite";
import {
    GolemStateProvider,
    useGolemState,
    type GolemBehaviorState,
} from "@/components/GolemStateContext";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface ChatMessage {
    id: string;
    role: "user" | "brain" | "memory" | "action" | "system" | string;
    text: string;
    timestamp: number;
}

type Message = ChatMessage;

// ─────────────────────────────────────────────────────────
// Sprite Config — derived from actual spritesheet analysis:
//   star-working-spritesheet-grid.webp: 2400×1500 → 10×10cols = 100 frames @ 240×150
//   Note: game.js declares frameWidth=230, frameHeight=144 (source rect)
//         actual measured: 2400/10=240, 1500/10=150. We use true pixel values.
// ─────────────────────────────────────────────────────────
const SPRITES = {
    idle: {
        src: "/star-office/star-idle-v5.png",
        frameWidth: 256,
        frameHeight: 256,
        frameCount: 48,
        cols: 8,
        fps: 12,
    },
    working: {
        src: "/star-office/star-working-spritesheet-grid.webp",
        frameWidth: 240,
        frameHeight: 150,
        frameCount: 100,
        cols: 10,
        fps: 12,
    },
    sync: {
        src: "/star-office/sync-animation-v3-grid.webp",
        frameWidth: 256,
        frameHeight: 256,
        frameCount: 49,
        cols: 7,
        fps: 12,
    },
    errorBug: {
        src: "/star-office/error-bug-spritesheet-grid.webp",
        frameWidth: 180,
        frameHeight: 180,
        frameCount: 99,
        cols: 9,
        fps: 12,
    },
    cats: {
        src: "/star-office/cats-spritesheet.webp",
        frameWidth: 160,
        frameHeight: 160,
        frameCount: 16,
        cols: 4,
        fps: 6,
    },
    coffee: {
        src: "/star-office/coffee-machine-v3-grid.webp",
        frameWidth: 230,
        frameHeight: 230,
        frameCount: 96,
        cols: 12,
        fps: 12,
    },
    plants: {
        src: "/star-office/plants-spritesheet.webp",
        frameWidth: 160,
        frameHeight: 160,
        frameCount: 16,
        cols: 4,
        fps: 4,
    },
} as const;

// ─────────────────────────────────────────────────────────
// State display labels and colours
// ─────────────────────────────────────────────────────────

const STATE_META: Record<GolemBehaviorState, { label: string; colour: string }> = {
    idle:        { label: "IDLE",        colour: "#94a3b8" },
    writing:     { label: "WRITING",     colour: "#facc15" },
    researching: { label: "RESEARCHING", colour: "#a78bfa" },
    executing:   { label: "EXECUTING",   colour: "#f97316" },
    syncing:     { label: "SYNCING",     colour: "#38bdf8" },
    error:       { label: "ERROR",       colour: "#ef4444" },
};

// ─────────────────────────────────────────────────────────
// GolemSprite — animated character block driven by state
// ─────────────────────────────────────────────────────────

function GolemSprite({ activeMessage }: { activeMessage: Message | null }) {
    const { state } = useGolemState();
    const prevStateRef = useRef(state);
    const [visible, setVisible] = useState(true);

    // Fade-transition between states
    useEffect(() => {
        if (prevStateRef.current === state) return;
        prevStateRef.current = state;
        setVisible(false);
        const t = setTimeout(() => setVisible(true), 180);
        return () => clearTimeout(t);
    }, [state]);

    const isWorking = state === "writing" || state === "researching" || state === "executing";

    return (
        <div
            className="relative flex flex-col items-center"
            style={{
                opacity: visible ? 1 : 0,
                transition: "opacity 0.18s ease",
                // pixel-art: disable anti-aliasing globally for this subtree
                imageRendering: "pixelated",
            }}
        >
            {/* Working animation (writing / researching / executing) */}
            {isWorking && (
                <div className="absolute" style={{ top: 0, left: "50%", transform: "translate(-50%, -50%)" }}>
                    <PixelSprite
                        {...SPRITES.working}
                        scale={1.32} // restored to layout.js original exact scale
                        isPlaying={true}
                    />
                </div>
            )}

            {/* Idle — show static star image sitting on sofa */}
            {state === "idle" && (
                <div className="absolute" style={{ filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.5))", transform: "translate(-50%, -50%)" }}>
                    <PixelSprite
                        {...SPRITES.idle}
                        scale={1}
                        isPlaying={true}
                    />
                </div>
            )}

            {/* Syncing animation */}
            {state === "syncing" && (
                <div className="absolute" style={{ transform: "translate(-50%, -50%)" }}>
                    <PixelSprite
                        {...SPRITES.sync}
                        scale={1}
                        isPlaying={true}
                    />
                </div>
            )}

            {/* Error bug */}
            {state === "error" && (
                <div className="absolute" style={{ transform: "translate(-50%, -50%)" }}>
                    <PixelSprite
                        {...SPRITES.errorBug}
                        scale={0.9}
                        isPlaying={true}
                    />
                    <span
                        className="absolute -top-6 left-1/2 -translate-x-1/2 text-red-400 text-[12px] font-bold animate-bounce whitespace-nowrap"
                        style={{ fontFamily: "var(--font-press-start)" }}
                    >
                        !! ERROR !!
                    </span>
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────
// Status HUD badge
// ─────────────────────────────────────────────────────────

function StatusBadge() {
    const { state, detail } = useGolemState();
    const meta = STATE_META[state];

    return (
        <div className="flex items-center gap-2">
            <span
                className="px-2 py-0.5 text-[8px] font-bold border-2 border-black"
                style={{
                    color: meta.colour,
                    borderColor: meta.colour,
                    backgroundColor: "rgba(0,0,0,0.6)",
                    fontFamily: "var(--font-press-start)",
                    textShadow: `0 0 6px ${meta.colour}`,
                    letterSpacing: 1,
                }}
            >
                ◉ {meta.label}
            </span>
            <span
                className="text-[8px] text-gray-400 hidden md:inline truncate max-w-[200px]"
                style={{ fontFamily: "Courier New, monospace" }}
            >
                {detail}
            </span>
        </div>
    );
}

// ─────────────────────────────────────────────────────────
// Decoration sprites (Interactive ambient)
// ─────────────────────────────────────────────────────────

function InteractiveDecoration({ sprite, className, style, scale = 1, isAnim = false }: { sprite: any, className?: string, style?: React.CSSProperties, scale?: number, isAnim?: boolean }) {
    // Generate initial random frame
    const [frame, setFrame] = useState(() => Math.floor(Math.random() * sprite.frameCount));
    const [isPlaying, setIsPlaying] = useState(isAnim);

    const handleClick = () => {
        if (!isAnim) {
            // For static objects, randomise frame
            setFrame(Math.floor(Math.random() * sprite.frameCount));
        } else {
            // For animated objects, just restart animation or toggle it
            setIsPlaying(!isPlaying);
        }
    };

    return (
        <div
            className={`cursor-pointer transition-transform hover:scale-105 active:scale-95 ${className || ""}`}
            style={style}
            onClick={handleClick}
        >
            <PixelSprite
                {...sprite}
                scale={scale}
                isPlaying={isPlaying}
                startFrame={frame}
                key={isAnim ? isPlaying.toString() : frame} // Force re-render of static frame component
            />
        </div>
    );
}

function DecorationSprites() {
    return (
        <>
            {/* Coffee machine — bottom-right-ish. Animated by default in game.js, but let's make it animated and togglable. */}
            <InteractiveDecoration
                sprite={SPRITES.coffee}
                scale={1}
                isAnim={true}
                className="absolute"
                style={{ left: 659, top: 397, transform: "translate(-50%, -50%)", zIndex: 99, opacity: 0.88 }}
            />

            {/* Plants */}
            {/* Plant 1 */}
            <InteractiveDecoration
                sprite={SPRITES.plants}
                scale={1}
                className="absolute"
                style={{ left: 565, top: 178, transform: "translate(-50%, -50%)", zIndex: 5 }}
            />
            {/* Plant 2 */}
            <InteractiveDecoration
                sprite={SPRITES.plants}
                scale={1}
                className="absolute"
                style={{ left: 230, top: 185, transform: "translate(-50%, -50%)", zIndex: 5 }}
            />
            {/* Plant 3 */}
            <InteractiveDecoration
                sprite={SPRITES.plants}
                scale={1}
                className="absolute"
                style={{ left: 977, top: 496, transform: "translate(-50%, -50%)", zIndex: 5 }}
            />

            {/* Cat — bottom-left corner. */}
            <InteractiveDecoration
                sprite={SPRITES.cats}
                scale={1}
                className="absolute"
                style={{ left: 94, top: 557, transform: "translate(-50%, -50%)", zIndex: 2000 }}
            />

            {/* Desk image */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src="/star-office/desk-v3.webp"
                alt="desk"
                className="absolute"
                style={{
                    left: 218,
                    top: 417,
                    transform: "translate(-50%, -50%)",
                    zIndex: 1000,
                    imageRendering: "pixelated",
                    filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.5))",
                }}
            />
        </>
    );
}

// ─────────────────────────────────────────────────────────
// Scene layout — maps GolemBehaviorState to character position
// Use exact center coordinates from layout.js
// ─────────────────────────────────────────────────────────

const SCENE_POSITIONS: Record<GolemBehaviorState, { left: number; top: number }> = {
    idle:        { left: 670 + 128, top: 144 + 128 }, // sofa origin is 0,0 (width 256), so center is +128
    writing:     { left: 217, top: 333 }, // desk area (masked by desk z-1000)
    researching: { left: 217, top: 333 }, // desk area (masked by desk z-1000)
    executing:   { left: 217, top: 333 }, // desk area (masked by desk z-1000)
    syncing:     { left: 1157, top: 592 }, // sync corner
    error:       { left: 1007, top: 221 }, // error area
};

// ─────────────────────────────────────────────────────────
// Scene Scale Container - keeps 1280x720 aspect ratio
// ─────────────────────────────────────────────────────────

function SceneContainer({ children }: { children: React.ReactNode }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);

    useEffect(() => {
        const resize = () => {
            if (!containerRef.current) return;
            const w = containerRef.current.clientWidth;
            const h = containerRef.current.clientHeight;
            const scaleX = w / 1280;
            const scaleY = h / 720;
            setScale(Math.min(scaleX, scaleY));
        };
        resize();
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, []);

    return (
        <div ref={containerRef} className="flex-1 relative border-4 border-[#25395A] overflow-hidden z-0 bg-black flex items-center justify-center">
            <div 
                style={{ 
                    width: 1280, 
                    height: 720, 
                    transform: `scale(${scale})`, 
                    transformOrigin: "center center",
                    backgroundImage: "url('/star-office/office_bg_small.webp')",
                    backgroundSize: "cover",
                    imageRendering: "pixelated",
                }} 
                className="relative overflow-hidden shadow-[inset_0_20px_50px_rgba(0,0,0,0.5)]"
            >
                {children}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────
// Inner office (uses GolemState context)
// ─────────────────────────────────────────────────────────

function OfficeInner() {
    const { state } = useGolemState();
    const [messageHistory, setMessageHistory] = useState<ChatMessage[]>([]);
    const [activeMessages, setActiveMessages] = useState<Record<string, Message | null>>({
        user: null, brain: null, memory: null, action: null,
    });
    const [isLogExpanded, setIsLogExpanded] = useState(true);
    const logConsoleRef = useRef<HTMLDivElement>(null);
    const timersRef = useRef<Record<string, NodeJS.Timeout | null>>({});

    // Position transition
    const pos = SCENE_POSITIONS[state];

    // ── Auto-scroll log ──────────────────────────────────
    useEffect(() => {
        if (logConsoleRef.current) {
            logConsoleRef.current.scrollTop = logConsoleRef.current.scrollHeight;
        }
    }, [messageHistory]);

    // ── Socket log handler ───────────────────────────────
    useEffect(() => {
        const handleLog = (logData: Record<string, unknown>) => {
            const rawText = (logData.cleanMsg || logData.msg || logData.raw) as string | undefined;
            if (!rawText) return;

            let role = "system";
            const lowerText = rawText.toLowerCase();

            const multiAgentMatch = rawText.match(/\[MultiAgent\]\s*\[(.*?)\]/i);
            if (multiAgentMatch) {
                role = multiAgentMatch[1].trim().toLowerCase();
            } else if (rawText.includes("[GOLEM_MEMORY]")) {
                role = "memory";
            } else if (rawText.includes("[GOLEM_ACTION]")) {
                role = "action";
            } else if (rawText.includes("🤖 [Golem] 說:") || rawText.includes("[GOLEM_REPLY]")) {
                role = "brain";
            } else if (
                rawText.includes("🗣️ [User] 說:") ||
                lowerText.includes("[user]") ||
                lowerText.includes("you:") ||
                lowerText.includes("使用者:")
            ) {
                role = "user";
            }

            if (role === "system") return;

            let displayText = rawText;
            if (multiAgentMatch) displayText = rawText.replace(/\[MultiAgent\]\s*\[.*?\]\s*/i, "").trim();
            else {
                if (role === "memory") displayText = rawText.replace(/\[GOLEM_MEMORY\]\n?/i, "").trim();
                if (role === "action") displayText = rawText.replace(/\[GOLEM_ACTION\]\n?/i, "").trim();
                if (role === "brain") displayText = rawText.replace(/🤖 \[Golem\] 說:\s*/i, "").replace(/\[GOLEM_REPLY\]\n?/i, "").trim();
                if (role === "user") displayText = rawText.replace(/🗣️ \[User\] 說:\s*/i, "").trim();
            }

            const newMsg: ChatMessage = {
                id: Math.random().toString(36).substring(7),
                role,
                text: displayText,
                timestamp: Date.now(),
            };

            setActiveMessages(prev => ({ ...prev, [role]: newMsg }));
            setMessageHistory(prev => [...prev, newMsg].slice(-100));

            if (timersRef.current[role]) clearTimeout(timersRef.current[role]!);
            timersRef.current[role] = setTimeout(() => {
                setActiveMessages(prev => ({ ...prev, [role]: null }));
            }, role === "user" ? 5000 : 8000);
        };

        socket.on("log", handleLog);
        return () => {
            socket.off("log", handleLog);
            Object.values(timersRef.current).forEach(t => t && clearTimeout(t));
        };
    }, []);

    // Determine which active message should show on the Golem sprite
    const golemMessage =
        activeMessages.brain ??
        activeMessages.action ??
        activeMessages.memory ??
        null;

    const userMessage = activeMessages.user ?? null;

    // Manual action triggers
    const triggerReply = () => {
        socket.emit("chat message", "分析目前對話狀態並主動給予回覆。");
    };

    const triggerMemoryCompress = () => {
        socket.emit("chat message", "請執行記憶壓縮與整理。");
    };

    return (
        <div className="relative w-full h-full bg-[#3A3C45] border-8 border-[#2B2D31] shadow-2xl overflow-hidden flex flex-col">

            {/* ── TOP HUD ─────────────────────────────── */}
            <div className="w-full bg-[#3B5B8C] border-4 border-[#25395A] p-2 flex justify-between items-center text-white z-30 shrink-0">
                <div className="flex items-center gap-3">
                    <span
                        className="text-[#FFD700] text-[10px] font-bold hidden md:inline whitespace-nowrap"
                        style={{ fontFamily: "var(--font-press-start)", textShadow: "2px 2px 0 rgba(0,0,0,1)" }}
                    >
                        GOLEM DEV STORY
                    </span>
                    <StatusBadge />
                </div>
                {/* Action Buttons */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={triggerReply}
                        className="bg-[#2B2D31] hover:bg-[#1A1A1A] border-2 border-[#FFD700] text-[#FFD700] px-3 py-1 text-[8px] md:text-[10px] font-bold transition-transform active:scale-95 shadow-[2px_2px_0_0_rgba(0,0,0,1)]"
                        style={{ fontFamily: "var(--font-press-start)" }}
                    >
                        [主動回覆]
                    </button>
                    <button
                        onClick={triggerMemoryCompress}
                        className="bg-[#2B2D31] hover:bg-[#1A1A1A] border-2 border-[#38bdf8] text-[#38bdf8] px-3 py-1 text-[8px] md:text-[10px] font-bold transition-transform active:scale-95 shadow-[2px_2px_0_0_rgba(0,0,0,1)]"
                        style={{ fontFamily: "var(--font-press-start)" }}
                    >
                        [壓縮記憶]
                    </button>
                </div>
            </div>

            {/* ── SCENE ───────────────────────────────── */}
            <SceneContainer>
                {/* Ambient decorations */}
                <DecorationSprites />

                {/* User bubble — top-left */}
                {userMessage && (
                    <div className="absolute top-[80px] left-[80px] z-[2000] text-[18px]" style={{ width: 360 }}>
                        <ChatBubble role="user" text={userMessage.text} />
                    </div>
                )}

                {/* Golem character — position shifts by state. z-[900] sits BEHIND the desk (z-[1000]) */}
                <div
                    className="absolute z-[900]"
                    style={{
                        left: pos.left,
                        top: pos.top,
                        transition: "left 0.6s cubic-bezier(0.4,0,0.2,1), top 0.6s cubic-bezier(0.4,0,0.2,1)",
                    }}
                >
                    <GolemSprite activeMessage={golemMessage} />
                </div>

                {/* Golem Chat Bubble — stays IN FRONT of everything (z-[2000]) */}
                {golemMessage && (
                    <div
                        className="absolute z-[2000] flex items-center justify-center min-w-[280px]"
                        style={{
                            left: pos.left,
                            top: pos.top - 180, // Offset buble higher
                            transform: "translateX(-50%)",
                            transition: "left 0.6s cubic-bezier(0.4,0,0.2,1), top 0.6s cubic-bezier(0.4,0,0.2,1)",
                        }}
                    >
                        <ChatBubble role={golemMessage.role} text={golemMessage.text} />
                    </div>
                )}

                {/* State label overlay (subtle, bottom-right of scene) */}
                <div
                    className="absolute bottom-6 right-8 text-[14px] opacity-60 z-[3000]"
                    style={{
                        fontFamily: "var(--font-press-start)",
                        color: STATE_META[state].colour,
                        textShadow: `0 0 6px ${STATE_META[state].colour}`,
                    }}
                >
                    {STATE_META[state].label}
                </div>
            </SceneContainer>

            {/* ── BOTTOM HUD ──────────────────────────── */}
            <div className="w-full bg-[#3B5B8C] border-4 border-[#25395A] border-t-0 p-2 flex justify-between items-center text-[8px] md:text-[10px] text-white z-40 shrink-0">
                <div className="flex items-center gap-4">
                    <span
                        className="text-[#FFD700]"
                        style={{ fontFamily: "var(--font-press-start)" }}
                    >
                        PROJECT: <span className="text-white ml-2">Multi-Agent System v2.0</span>
                    </span>
                </div>
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => setIsLogExpanded(!isLogExpanded)}
                        className="bg-black/60 border-2 border-[#FFD700] px-2 py-0.5 text-[#FFD700] hover:bg-black transition-colors transform active:scale-95 flex items-center gap-1"
                        style={{ fontFamily: "var(--font-press-start)" }}
                    >
                        {isLogExpanded ? "CLOSE LOG ▲" : "OPEN LOG ▼"}
                    </button>
                </div>
            </div>

            {/* ── LOG CONSOLE ─────────────────────────── */}
            <div
                ref={logConsoleRef}
                className={`w-full bg-black/80 border-4 border-[#25395A] border-t-0 p-2 overflow-y-auto font-mono text-[10px] text-green-400 custom-scrollbar flex flex-col gap-1 z-40 shrink-0 shadow-[inset_0_2px_10px_rgba(0,0,0,0.8)] transition-all duration-500 origin-bottom ${isLogExpanded ? "h-32 opacity-100" : "h-0 opacity-0 py-0 border-b-0"}`}
            >
                {messageHistory.length === 0 ? (
                    <div className="text-gray-500 italic">Waiting for system logs…</div>
                ) : (
                    messageHistory.map(msg => (
                        <div key={msg.id} className="border-b border-green-900/40 pb-1 mb-1">
                            <span className={
                                msg.role === "user" ? "text-cyan-400 font-bold" :
                                    msg.role === "brain" ? "text-yellow-400 font-bold" :
                                        msg.role === "memory" ? "text-purple-400 font-bold" :
                                            "text-red-400 font-bold"
                            }>[{msg.role.toUpperCase()}]</span>
                            <span className="text-gray-500 ml-1">
                                {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                            </span>
                            <div className="mt-1 text-white/90 whitespace-pre-wrap pl-2 border-l-2 border-gray-700 ml-1">
                                {msg.text}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────
// Page export — wraps everything in the state provider
// ─────────────────────────────────────────────────────────

export default function OfficePage() {
    return (
        <div className="h-full w-full bg-[#1A1A1A] p-0 flex flex-col items-center justify-center font-[family-name:var(--font-press-start)] antialiased">
            <GolemStateProvider>
                <OfficeInner />
            </GolemStateProvider>
        </div>
    );
}
