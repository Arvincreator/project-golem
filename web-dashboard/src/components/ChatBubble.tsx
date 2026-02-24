import { cn } from "@/lib/utils";
import { useEffect, useState, useRef } from "react";

interface ChatBubbleProps {
    text: string;
    role: "user" | "golem" | "brain" | "memory" | "action" | "system" | string;
    className?: string;
}

const roleStyles: Record<string, { align: "left" | "right" }> = {
    action: { align: "right" },
    memory: { align: "left" },
    brain: { align: "right" },
    user: { align: "left" },
    golem: { align: "right" },
    system: { align: "right" },
    alex: { align: "left" },
    bob: { align: "left" },
    carol: { align: "right" },
    devil: { align: "left" },
    angel: { align: "right" },
    judge: { align: "right" }
};

export function ChatBubble({ text, role, className }: ChatBubbleProps) {
    const [displayedText, setDisplayedText] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const textRef = useRef(text);

    useEffect(() => {
        if (!text) {
            setDisplayedText("");
            return;
        }

        // Logic for typewriter effect
        setIsTyping(true);
        setDisplayedText(""); // Reset
        let currentText = "";
        let index = 0;

        const isJSON = text.trim().startsWith('{') || text.trim().startsWith('[');
        const fullText = isJSON ? "傳送資料中..." : text;

        const interval = setInterval(() => {
            if (index < fullText.length) {
                currentText += fullText[index];
                setDisplayedText(currentText);
                index++;

                // Auto-scroll to bottom as text grows
                if (scrollRef.current) {
                    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                }
            } else {
                setIsTyping(false);
                clearInterval(interval);
            }
        }, 30); // Speed: 30ms per char

        return () => clearInterval(interval);
    }, [text]);

    // Extra effect to catch content shifts
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [displayedText]);

    if (!text) return null;

    const style = roleStyles[role] || roleStyles.brain;
    const isLeftAligned = style.align === "left";

    return (
        <div className={cn(
            "absolute z-10 min-w-[200px] max-w-[280px] h-[100px] p-2.5 bg-white text-black border-4 border-black font-mono text-[10px] md:text-[11px] leading-snug tracking-tight shadow-[4px_4px_0_0_rgba(0,0,0,1)] rounded-none flex flex-col",
            "before:content-[''] before:absolute before:border-solid before:border-t-black",
            isLeftAligned
                ? "before:-bottom-[12px] before:left-4 before:border-t-[8px] before:border-x-[8px] before:border-x-transparent"
                : "before:-bottom-[12px] before:right-4 before:border-t-[8px] before:border-x-[8px] before:border-x-transparent",
            className
        )}>
            {/* Inner triangle for the bubble tail (White part) */}
            <div className={cn(
                "absolute -bottom-[8px] w-0 h-0 border-solid border-x-[4px] border-x-transparent border-t-[4px] border-t-white z-10",
                isLeftAligned ? "left-[20px]" : "right-[20px]"
            )} />
            {/* Inner triangle for the bubble tail (Black part) */}
            <div className={cn(
                "absolute -bottom-[6px] w-0 h-0 border-solid border-x-[6px] border-x-transparent border-t-[6px] border-t-black z-10",
                isLeftAligned ? "left-[18px]" : "right-[18px]"
            )} />

            <div
                ref={scrollRef}
                className="break-words whitespace-pre-wrap overflow-y-auto h-full no-scrollbar overflow-x-hidden"
            >
                {displayedText}
                {isTyping && <span className="animate-pulse ml-0.5">▋</span>}
            </div>
        </div>
    );
}
