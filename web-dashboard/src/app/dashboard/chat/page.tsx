"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo, DragEvent, ClipboardEvent } from "react";
import { useGolem } from "@/components/GolemContext";
import { socket } from "@/lib/socket";
import { User, Bot, Send, X, FileText, Paperclip, UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { Typewriter } from "@/components/Typewriter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiGet, apiPost, apiPostWrite } from "@/lib/api-client";
import { useI18n } from "@/components/I18nProvider";

interface ChatMessage {
    id: string;
    sender: string;
    content: string;
    timestamp: string;
    isSystem: boolean;
    actionData?: ChatActionButton[];
    isHistory?: boolean;
    isThinking?: boolean;
    attachments?: {
        url: string;
        mimeType: string;
        name?: string;
    }[];
}

interface CommandOption {
    name: string;
    description: string;
}

interface CommandItem {
    command: string;
    description: string;
    options?: CommandOption[];
}

interface PromptShortcutItem {
    id: string;
    shortcut: string;
    prompt: string;
    note?: string;
    recentUseCount?: number;
    lastUsedAt?: string;
}

interface PromptPoolResponse {
    success?: boolean;
    items?: PromptShortcutItem[];
    topUsedShortcuts?: Array<{
        id: string;
        shortcut: string;
        note?: string;
        recentUseCount?: number;
        lastUsedAt?: string;
    }>;
}

interface SuggestionItem {
    key: string;
    command: string;
    description: string;
    source: "command" | "prompt";
    injectedPrompt?: string;
}

interface InjectedShortcutCandidate {
    shortcut: string;
    seedPrompt: string;
}

interface ChatActionButton {
    text: string;
    callback_data: string;
}

interface ChatHistoryRecord {
    time: string;
    msg: string;
    actionData?: ChatActionButton[];
    attachments?: ChatMessage["attachments"];
    attachment?: ChatMessage["attachments"] extends Array<infer T> ? T : never;
}

type SocketLogPayload = {
    type?: string;
    msg?: string;
    time?: string;
    actionData?: ChatActionButton[];
    attachments?: ChatMessage["attachments"];
    attachment?: ChatMessage["attachments"] extends Array<infer T> ? T : never;
};

type PlanningModePayload = {
    enabled?: boolean;
    updatedAt?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function extractGolemReplyOnly(rawText: string): string {
    const text = String(rawText || "").trim();
    if (!text) return "";

    const cleaned = text.replace(/^🤖\s*\[Golem\]\s*說:\s*/i, "").trim();
    const hasTitanTags = /\[GOLEM_(MEMORY|ACTION|REPLY)\]/i.test(cleaned);
    const replyMatch = cleaned.match(/\[GOLEM_REPLY\]([\s\S]*?)(?=\[\/?GOLEM_[A-Z]+\]|$)/i);

    if (replyMatch && replyMatch[1]) {
        return replyMatch[1].trim();
    }

    if (hasTitanTags) {
        return "";
    }

    return cleaned;
}

function normalizeShortcutKey(input: string): string {
    return String(input || "")
        .trim()
        .replace(/^((?:\/)?[a-z0-9_]{1,32})@[a-z0-9_]{3,}$/i, "$1")
        .toLowerCase()
        .replace(/^\/+/, "");
}

export default function DirectChatPage() {
    const { activeGolem } = useGolem();
    const { t } = useI18n();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [completedTypingMsgs, setCompletedTypingMsgs] = useState<Set<string>>(new Set());
    const [input, setInput] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [selectedFile, setSelectedFile] = useState<{ name: string, base64: string, type: string } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    // Command suggestions state
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [filteredCommands, setFilteredCommands] = useState<SuggestionItem[]>([]);
    const [allCommands, setAllCommands] = useState<CommandItem[]>([]);
    const [promptShortcuts, setPromptShortcuts] = useState<PromptShortcutItem[]>([]);
    const [injectedShortcutCandidate, setInjectedShortcutCandidate] = useState<InjectedShortcutCandidate | null>(null);
    const [planningModeEnabled, setPlanningModeEnabled] = useState(false);
    const [planningModeLoading, setPlanningModeLoading] = useState(false);

    const systemCommandSet = useMemo(() => {
        const set = new Set<string>();
        for (const item of allCommands) {
            const command = normalizeShortcutKey(String(item.command || ""));
            if (command) set.add(command);
        }
        return set;
    }, [allCommands]);

    const promptShortcutMap = useMemo(() => {
        const map = new Map<string, PromptShortcutItem>();
        for (const item of promptShortcuts) {
            const key = normalizeShortcutKey(item.shortcut);
            if (key && !map.has(key)) {
                map.set(key, item);
            }
        }
        return map;
    }, [promptShortcuts]);

    useEffect(() => {
        const fetchCommands = async () => {
            try {
                const data = await apiGet<{ success?: boolean; commands?: CommandItem[] }>("/api/commands");
                if (data.success && data.commands) {
                    setAllCommands(data.commands);
                }
            } catch (err) {
                console.error("Failed to fetch commands:", err);
            }
        };
        fetchCommands();
    }, []);

    useEffect(() => {
        const fetchPromptPool = async () => {
            try {
                const data = await apiGet<PromptPoolResponse>("/api/prompt-pool");
                if (Array.isArray(data.items)) {
                    const sortedByUsage = [...data.items].sort((a, b) => {
                        const countDiff = Number(b.recentUseCount || 0) - Number(a.recentUseCount || 0);
                        if (countDiff !== 0) return countDiff;
                        return String(a.shortcut || "").localeCompare(String(b.shortcut || ""));
                    });
                    setPromptShortcuts(sortedByUsage);
                }
            } catch (err) {
                console.error("Failed to fetch prompt pool:", err);
            }
        };
        fetchPromptPool();
    }, []);

    useEffect(() => {
        if (!activeGolem) return;
        let isMounted = true;

        const fetchPlanningMode = async () => {
            try {
                const data = await apiGet<{
                    success?: boolean;
                    planningMode?: PlanningModePayload;
                }>(`/api/chat/planning-mode?golemId=${encodeURIComponent(activeGolem)}`);
                if (!isMounted) return;
                if (data && data.success && data.planningMode && typeof data.planningMode.enabled === "boolean") {
                    setPlanningModeEnabled(data.planningMode.enabled);
                }
            } catch (error) {
                console.error("Failed to fetch planning mode:", error);
            }
        };

        fetchPlanningMode();
        return () => { isMounted = false; };
    }, [activeGolem]);

    useEffect(() => {
        const handlePlanningModeSocket = (payload: PlanningModePayload) => {
            if (payload && typeof payload.enabled === "boolean") {
                setPlanningModeEnabled(payload.enabled);
            }
        };
        socket.on("chat_planning_mode", handlePlanningModeSocket);
        return () => {
            socket.off("chat_planning_mode", handlePlanningModeSocket);
        };
    }, []);
    const [suggestionIndex, setSuggestionIndex] = useState(0);
    const suggestionListRef = useRef<HTMLDivElement>(null);

    const scrollRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragCounterRef = useRef(0);

    useEffect(() => {
        const handleSocketLog = (payload: unknown) => {
            if (!isRecord(payload)) return;

            const data = payload as SocketLogPayload;
            const type = typeof data.type === "string" ? data.type : "";
            const rawPayloadMessage = typeof data.msg === "string" ? data.msg : "";
            if (!rawPayloadMessage) return;
            const isThinkingMessage = type === 'thinking';

            if (isThinkingMessage || type === 'agent' || type === 'approval' || rawPayloadMessage.includes('[MultiAgent]') || rawPayloadMessage.includes('[User]')) {
                let rawMsg = rawPayloadMessage;

                if (rawMsg.startsWith('[MultiAgent]')) {
                    rawMsg = rawMsg.replace('[MultiAgent]', '').trim();
                }

                let sender = "System";
                let content = rawMsg;
                let isSystem = true;

                const match = rawMsg.match(/\[(.*?)\]\s*([\s\S]*)/);
                if (match) {
                    sender = match[1];
                    content = match[2] || " ";
                    isSystem = !(sender === 'User' || sender === 'WebUser');
                }

                if (!isThinkingMessage && isSystem) {
                    content = extractGolemReplyOnly(content);
                    if (!content) return;
                }

                setMessages((prev) => {
                    let filtered = prev;
                    if (!isThinkingMessage && (sender !== 'User' && sender !== 'WebUser')) {
                        filtered = prev.filter(m => !(m.isThinking && m.sender === sender));
                    }

                    return [...filtered.slice(-1000), {
                        id: isThinkingMessage ? `thinking-${sender}-${Date.now()}` : (Date.now().toString() + Math.random()),
                        sender,
                        content,
                        timestamp: data.time || new Date().toLocaleTimeString(),
                        isSystem,
                        actionData: data.actionData,
                        isThinking: isThinkingMessage,
                        // 同時相容後端廣播的 attachments[]（複數）和舊版的 attachment（單數）
                        attachments: data.attachments
                            ? data.attachments
                            : (data.attachment ? [data.attachment] : undefined)
                    }];
                });
            }
        };
        socket.on("log", handleSocketLog);

        return () => {
            socket.off("log", handleSocketLog);
        };
    }, []);

    useEffect(() => {
        if (!activeGolem) return;

        let isMounted = true;
        const fetchHistory = async () => {
            try {
                const data = await apiGet<{ success?: boolean; history?: ChatHistoryRecord[] }>(
                    `/api/chat/history?golemId=${encodeURIComponent(activeGolem)}`
                );
                if (data.success && data.history && isMounted) {
                    const parsedHistory = data.history.map((h) => {
                        let rawMsg = h.msg;
                        if (rawMsg.startsWith('[MultiAgent]')) rawMsg = rawMsg.replace('[MultiAgent]', '').trim();
                        let sender = "System";
                        let content = rawMsg;
                        const match = rawMsg.match(/\[(.*?)\]\s*([\s\S]*)/);
                        if (match) {
                            sender = match[1];
                            content = match[2] || " ";
                        }

                        const isSystem = !(sender === 'User' || sender === 'WebUser');
                        if (isSystem) {
                            content = extractGolemReplyOnly(content);
                        }

                        return {
                            id: h.time + Math.random().toString(),
                            sender,
                            content,
                            timestamp: h.time,
                            isSystem,
                            actionData: h.actionData,
                            isHistory: true,
                            attachments: h.attachments
                                ? h.attachments
                                : (h.attachment ? [h.attachment] : undefined)
                        };
                    }).filter((item) => {
                        if (!item.isSystem) return true;
                        return Boolean(item.content && item.content.trim());
                    });

                    setMessages(parsedHistory);
                    setCompletedTypingMsgs(new Set(parsedHistory.map((m) => m.id)));
                }
            } catch (err) {
                console.error("Failed to fetch chat history:", err);
            }
        };
        fetchHistory();

        return () => { isMounted = false; };
    }, [activeGolem]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleTypingComplete = (id: string) => {
        setCompletedTypingMsgs((prev) => {
            const next = new Set(prev);
            next.add(id);
            return next;
        });
    };

    const isMessageRendered = (index: number) => {
        for (let i = 0; i < index; i++) {
            const prevMsg = messages[i];
            if (prevMsg.isSystem && !completedTypingMsgs.has(prevMsg.id)) {
                return false;
            }
        }
        return true;
    };

    const handleAction = async (callbackData: string) => {
        if (!activeGolem) return;
        setIsSending(true);
        try {
            await apiPost("/api/chat/callback", { golemId: activeGolem, callback_data: callbackData });
        } catch (e) {
            console.error("Failed to send action:", e);
        } finally {
            setIsSending(false);
        }
    };

    const togglePlanningMode = async () => {
        if (!activeGolem || planningModeLoading) return;
        const nextEnabled = !planningModeEnabled;
        const previousEnabled = planningModeEnabled;
        setPlanningModeEnabled(nextEnabled);
        setPlanningModeLoading(true);

        try {
            const data = await apiPostWrite<{
                success?: boolean;
                planningMode?: PlanningModePayload;
            }>("/api/chat/planning-mode", {
                golemId: activeGolem,
                enabled: nextEnabled,
                persist: true,
            });
            if (data && data.success && data.planningMode && typeof data.planningMode.enabled === "boolean") {
                setPlanningModeEnabled(data.planningMode.enabled);
            }
        } catch (error) {
            console.error("Failed to toggle planning mode:", error);
            setPlanningModeEnabled(previousEnabled);
        } finally {
            setPlanningModeLoading(false);
        }
    };

    const attachFile = useCallback((file: File) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            setSelectedFile({
                name: file.name,
                base64: (event.target?.result as string).split(',')[1],
                type: file.type || 'application/octet-stream'
            });
        };
        reader.readAsDataURL(file);
    }, []);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        attachFile(file);
        // Reset input value to allow selecting same file again
        e.target.value = '';
    };

    useEffect(() => {
        if (showSuggestions && suggestionListRef.current) {
            const activeItem = suggestionListRef.current.children[0]?.children[suggestionIndex] as HTMLElement;
            if (activeItem) {
                activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }, [suggestionIndex, showSuggestions]);

    useEffect(() => {
        if (suggestionIndex < filteredCommands.length) return;
        setSuggestionIndex(0);
    }, [filteredCommands.length, suggestionIndex]);

    const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current += 1;
        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            setIsDragging(true);
        }
    };

    const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current -= 1;
        if (dragCounterRef.current === 0) {
            setIsDragging(false);
        }
    };

    const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        dragCounterRef.current = 0;
        const file = e.dataTransfer.files?.[0];
        if (file) attachFile(file);
    };

    // ── Clipboard Paste Handler ───────────────────────────────────────────────
    const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of Array.from(items)) {
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file) {
                    e.preventDefault();
                    attachFile(file);
                    return;
                }
            }
        }
    };

    const handleSend = async () => {
        if ((!input.trim() && !selectedFile) || !activeGolem) return;

        const rawVal = input.trim();
        const shortcutCandidate = injectedShortcutCandidate;
        const expansion = (() => {
            if (!rawVal) return "";
            const tokens = rawVal.split(/\s+/);
            const firstToken = tokens[0] || "";
            const firstTokenKey = normalizeShortcutKey(firstToken);
            const matched = firstTokenKey ? promptShortcutMap.get(firstTokenKey) : undefined;
            if (firstToken.startsWith('/') && firstTokenKey && systemCommandSet.has(firstTokenKey)) {
                return { text: rawVal, matchedShortcut: "" };
            }
            if (!matched) return { text: rawVal, matchedShortcut: "" };
            const rest = tokens.slice(1).join(" ").trim();
            if (!rest) return { text: matched.prompt, matchedShortcut: matched.shortcut };
            return { text: `${matched.prompt}\n${rest}`, matchedShortcut: matched.shortcut };
        })();
        const val = typeof expansion === "string" ? expansion : expansion.text;
        const matchedShortcut = typeof expansion === "string" ? "" : expansion.matchedShortcut;
        const fallbackShortcut = (() => {
            if (matchedShortcut) return "";
            if (!shortcutCandidate) return "";
            const seedPrompt = String(shortcutCandidate.seedPrompt || "").trim();
            if (!seedPrompt) return "";
            const inputForCheck = rawVal.trimStart();
            if (!inputForCheck.startsWith(seedPrompt)) return "";
            return String(shortcutCandidate.shortcut || "").trim();
        })();
        const trackShortcut = matchedShortcut || fallbackShortcut;
        setInput("");
        setInjectedShortcutCandidate(null);
        setShowSuggestions(false);
        setIsSending(true);

        try {
            let attachmentInfo = null;
            
            if (selectedFile) {
                const uploadData = await apiPost<{ success?: boolean; path?: string; url?: string }>("/api/upload", {
                    fileName: selectedFile.name,
                    base64Data: selectedFile.base64,
                });
                if (uploadData.success) {
                    attachmentInfo = {
                        path: uploadData.path,
                        url: uploadData.url,
                        mimeType: selectedFile.type
                    };
                }
                setSelectedFile(null);
            }

            await apiPost("/api/chat", {
                golemId: activeGolem,
                message: val,
                attachment: attachmentInfo
            });

            if (trackShortcut) {
                apiPostWrite("/api/prompt-pool/track-use", {
                    shortcut: trackShortcut,
                    source: "web_dashboard",
                    platform: "web",
                }).catch((trackErr) => {
                    console.warn("Failed to track prompt shortcut usage:", trackErr);
                });
            }
        } catch (e) {
            console.error("Failed to send message:", e);
        } finally {
            setIsSending(false);
        }
    };

    const handleCommandClick = (item: SuggestionItem) => {
        if (item.source === "prompt") {
            const injectedPrompt = item.injectedPrompt || "";
            setInput(injectedPrompt);
            setInjectedShortcutCandidate({
                shortcut: item.command,
                seedPrompt: injectedPrompt,
            });
        } else {
            setInput(item.command + " ");
            setInjectedShortcutCandidate(null);
        }
        setShowSuggestions(false);
    };

    const onInputChange = (val: string) => {
        const raw = String(val || "");
        const trimmed = raw.trim();

        if (!trimmed) {
            setInput(raw);
            setInjectedShortcutCandidate(null);
            setShowSuggestions(false);
            return;
        }

        const parts = trimmed.split(/\s+/);
        const token = parts[0] || "";
        const startsWithSlash = token.startsWith('/');
        const hasSpace = /\s/.test(trimmed);
        const tokenKey = normalizeShortcutKey(token);
        const exactPromptShortcut = (() => {
            if (!startsWithSlash) return undefined;
            const matched = promptShortcutMap.get(tokenKey);
            if (!matched) return undefined;
            if (tokenKey && systemCommandSet.has(tokenKey)) {
                return undefined;
            }
            return matched;
        })();

        // 只輸入快捷指令後按空白，直接注入 prompt 到對話框輸入區
        if (exactPromptShortcut && /\s$/.test(raw) && parts.length === 1) {
            const injectedPrompt = `${exactPromptShortcut.prompt} `;
            setInput(injectedPrompt);
            setInjectedShortcutCandidate({
                shortcut: exactPromptShortcut.shortcut,
                seedPrompt: exactPromptShortcut.prompt,
            });
            setShowSuggestions(false);
            return;
        }

        setInput(raw);
        if (injectedShortcutCandidate) {
            const seedPrompt = String(injectedShortcutCandidate.seedPrompt || "").trim();
            const inputForCheck = raw.trimStart();
            if (!seedPrompt || !inputForCheck.startsWith(seedPrompt)) {
                setInjectedShortcutCandidate(null);
            }
        }

        const promptSuggestions: SuggestionItem[] = !hasSpace && startsWithSlash
            ? promptShortcuts
                .filter((item) => {
                    const shortcutKey = normalizeShortcutKey(item.shortcut);
                    if (String(item.shortcut || "").startsWith('/') && systemCommandSet.has(shortcutKey)) {
                        return false;
                    }
                    return shortcutKey.includes(tokenKey);
                })
                .slice(0, 20)
                .map((item) => ({
                    key: `prompt-${item.id}`,
                    command: item.shortcut,
                    description: item.note || item.prompt.replace(/\s+/g, " ").slice(0, 80) || t("chat.suggestion.promptInjectedFallback"),
                    source: "prompt",
                    injectedPrompt: item.prompt,
                }))
            : [];

        const commandSuggestions: SuggestionItem[] = [];
        if (startsWithSlash) {
            const exactCmd = allCommands.find((c) => normalizeShortcutKey(c.command) === tokenKey);

            if (exactCmd && exactCmd.options && raw.includes(' ')) {
                const arg = parts.length > 1 ? parts[1] : '';
                let options = exactCmd.options;

                if (options.some((o) => o.name === '@username') && activeGolem) {
                    const dynamicOption = { name: `@${activeGolem}`, description: t("chat.dynamicOptionForGolem", { golem: activeGolem }) };
                    options = [dynamicOption, ...options.filter((o) => o.name !== '@username')];
                }

                const filteredOptions = options
                    .filter((opt) => opt.name.toLowerCase().includes(arg.toLowerCase()))
                    .slice(0, 20);

                commandSuggestions.push(...filteredOptions.map((opt) => ({
                    key: `cmd-option-${exactCmd.command}-${opt.name}`,
                    command: `${exactCmd.command} ${opt.name}`,
                    description: opt.description,
                    source: "command" as const,
                })));
            } else if (!raw.includes(' ')) {
                const filtered = allCommands
                    .filter((c) => normalizeShortcutKey(c.command).includes(tokenKey))
                    .slice(0, 20);
                commandSuggestions.push(...filtered.map((cmd) => ({
                    key: `cmd-${cmd.command}`,
                    command: cmd.command,
                    description: cmd.description,
                    source: "command" as const,
                })));
            }
        }

        const nextSuggestions = [...promptSuggestions, ...commandSuggestions];
        setFilteredCommands(nextSuggestions);
        setShowSuggestions(nextSuggestions.length > 0);
        setSuggestionIndex(0);
    };

    return (
        <div className="flex flex-col h-full bg-background p-6 max-h-screen">
            <div className="flex justify-between items-center mb-6 flex-shrink-0">
                <div>
                    <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-500">
                        {t("chat.title")}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        {t("chat.subtitle", { golem: activeGolem || t("chat.noActiveGolem") })}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="text-right">
                        <p className="text-xs font-semibold text-foreground/90">Planning Mode</p>
                        <p className="text-[10px] text-muted-foreground">
                            Complex-only auto multi-agent
                        </p>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={planningModeEnabled}
                        disabled={!activeGolem || planningModeLoading}
                        onClick={togglePlanningMode}
                        className={cn(
                            "relative inline-flex h-6 w-11 items-center rounded-full border transition-colors",
                            planningModeEnabled
                                ? "bg-cyan-500/30 border-cyan-400/60"
                                : "bg-secondary border-border",
                            (!activeGolem || planningModeLoading) && "opacity-60 cursor-not-allowed"
                        )}
                        title={!activeGolem ? "Select a golem first" : "Toggle planning mode"}
                    >
                        <span
                            className={cn(
                                "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                                planningModeEnabled ? "translate-x-6" : "translate-x-1"
                            )}
                        />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col bg-card rounded-xl border border-border">
                {/* Chat window */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
                    {messages.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-muted-foreground/60 italic">
                            {t("chat.emptyState")}
                        </div>
                    ) : (
                        messages.map((msg, index) => {
                            if (!isMessageRendered(index)) return null;

                            const isUser = msg.sender === 'User' || msg.sender === 'WebUser';
                            return (
                                <div
                                    key={msg.id}
                                    className={cn(
                                        "flex flex-col max-w-[80%]",
                                        msg.isSystem ? "mr-auto items-start text-left" : isUser ? "ml-auto items-end" : "mr-auto"
                                    )}
                                >
                                    {(msg.sender !== 'System' || msg.isThinking) && (
                                        <div className={cn("flex items-center space-x-2 mb-1", isUser && "flex-row-reverse space-x-reverse")}>
                                            <div className={cn(
                                                "w-6 h-6 rounded-full flex items-center justify-center border flex-shrink-0",
                                                isUser ? "bg-blue-600/10 border-blue-500/20" : "bg-primary/10 border-primary/20"
                                            )}>
                                                {isUser ? <User className="w-3 h-3 text-blue-600 dark:text-blue-300" /> : <Bot className="w-3 h-3 text-primary" />}
                                            </div>
                                            <span className={cn("text-xs font-bold", isUser ? "text-blue-600 dark:text-blue-400" : "text-primary")}>{msg.sender}</span>
                                            <span className="text-[10px] text-muted-foreground">{msg.timestamp}</span>
                                        </div>
                                    )}
                                    <div
                                        className={cn(
                                            "p-3 rounded-2xl text-sm whitespace-pre-wrap break-words inline-block shadow-sm transition-all duration-200",
                                            msg.isThinking
                                                ? "animate-pulse bg-secondary border border-border text-muted-foreground italic backdrop-blur-sm" :
                                                msg.isSystem
                                                    ? "bg-secondary/50 border border-border rounded-tl-none text-foreground/90 shadow-sm"
                                                    : isUser
                                                        ? "bg-blue-600/10 text-blue-900 dark:text-blue-100 border border-blue-500/20 rounded-tr-none shadow-sm"
                                                        : "bg-primary/10 text-foreground font-medium border border-primary/20 rounded-tl-none shadow-sm"
                                        )}
                                    >
                                        {/* ── 附件顯示：支援從 Gemini 回傳的多個附件 ── */}
                                        {msg.attachments && msg.attachments.length > 0 && (
                                            <div className="mb-2 flex flex-col gap-2">
                                                {msg.attachments.map((att, attIdx) => (
                                                    (att.mimeType || "").startsWith('image/') ? (
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img
                                                            key={attIdx}
                                                            src={att.url}
                                                            alt="attachment"
                                                            className="max-w-full max-h-64 rounded-lg border border-border shadow-sm cursor-zoom-in hover:scale-[1.01] transition-transform"
                                                            onClick={() => window.open(att.url, '_blank')}
                                                        />
                                                    ) : (
                                                        <a
                                                            key={attIdx}
                                                            href={att.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="flex items-center gap-2 p-2 bg-secondary/50 rounded-lg border border-border w-fit hover:bg-secondary transition-colors"
                                                        >
                                                            <FileText size={20} className="text-primary flex-shrink-0" />
                                                            <div className="overflow-hidden">
                                                                <p className="text-[10px] text-muted-foreground truncate max-w-[150px]">{att.name || att.url.split('/').pop()}</p>
                                                                <p className="text-[10px] text-primary/60 font-medium">{t("chat.download")}</p>
                                                            </div>
                                                        </a>
                                                    )
                                                ))}
                                            </div>
                                        )}
                                        {msg.isThinking ? t("chat.thinking") : (msg.isSystem && !msg.isHistory ?
                                            <Typewriter content={msg.content.replace(/\n{2,}/g, '\n\n').trim()} onComplete={() => handleTypingComplete(msg.id)} />
                                            : (msg.isSystem ?
                                                <div className="prose dark:prose-invert prose-sm max-w-none prose-p:m-0 prose-headings:my-1 prose-pre:my-1 prose-pre:bg-zinc-950 dark:prose-pre:bg-gray-950 prose-pre:border prose-pre:border-border dark:prose-pre:border-gray-800 prose-ul:list-disc prose-ul:ml-4 prose-ol:list-decimal prose-ol:ml-4 prose-li:m-0 leading-snug [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                        {msg.content.replace(/\n{2,}/g, '\n\n').trim()}
                                                    </ReactMarkdown>
                                                </div>
                                                : msg.content.replace(/\n{2,}/g, '\n\n').trim()
                                            ))}
                                    </div>
                                    {msg.actionData && Array.isArray(msg.actionData) && (!msg.isSystem || msg.isHistory || completedTypingMsgs.has(msg.id)) && (
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {msg.actionData.map((btn, idx) => {
                                                const isApprove = btn.text.includes('批准') || btn.text.includes('Approve');
                                                const isDeny = btn.text.includes('拒絕') || btn.text.includes('Reject') || btn.text.includes('Deny');

                                                return (
                                                    <button
                                                        key={idx}
                                                        onClick={() => handleAction(btn.callback_data)}
                                                        className={cn(
                                                            "px-5 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 border flex items-center gap-2 transform active:scale-95 shadow-md",
                                                            isApprove
                                                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500 hover:text-white"
                                                                : isDeny
                                                                    ? "bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                                                                    : "bg-secondary border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                                                        )}
                                                    >
                                                        {btn.text}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Input area — supports drag & drop onto this zone */}
                <div
                    className={cn(
                        "relative p-3 border-t border-border bg-card/50 transition-colors duration-150",
                        isDragging && "bg-primary/5 border-primary/40"
                    )}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                >
                    {/* Command suggestions dropdown */}
                    {showSuggestions && (
                        <div 
                            ref={suggestionListRef}
                            className="absolute bottom-full left-4 mb-2 w-80 max-h-72 overflow-y-auto bg-card/95 backdrop-blur-md border border-border rounded-xl shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-2 duration-200 scrollbar-thin scrollbar-thumb-primary/20 scrollbar-track-transparent"
                        >
                            <div className="p-2 space-y-1">
                                {filteredCommands.map((cmd, idx) => (
                                    <button
                                        key={cmd.key}
                                        onClick={() => handleCommandClick(cmd)}
                                        onMouseEnter={() => setSuggestionIndex(idx)}
                                        className={cn(
                                            "w-full text-left p-2 rounded-lg transition-all duration-150 group",
                                            idx === suggestionIndex ? "bg-primary/20 border-primary/20" : "hover:bg-secondary"
                                        )}
                                    >
                                        <div className="flex flex-col">
                                            <span className={cn(
                                                "text-sm font-bold",
                                                idx === suggestionIndex ? "text-primary" : "text-foreground/90"
                                            )}>
                                                {cmd.command}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground/80">
                                                {cmd.source === "prompt" ? t("chat.suggestion.promptPool") : t("chat.suggestion.systemCommand")}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground line-clamp-1 group-hover:line-clamp-none mt-0.5">
                                                {cmd.description}
                                            </span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Drag overlay */}
                    {isDragging && (
                        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-b-xl border-2 border-dashed border-primary/60 bg-primary/10 backdrop-blur-sm pointer-events-none">
                            <UploadCloud size={28} className="text-primary animate-bounce" />
                            <p className="text-sm font-semibold text-primary">{t("chat.dragOverlay")}</p>
                        </div>
                    )}

                    {/* Selected file preview */}
                    {selectedFile && (
                        <div className="mb-3 flex items-center p-2 bg-secondary/50 border border-border rounded-lg relative group w-fit">
                            {selectedFile.type.startsWith('image/') ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img 
                                    src={`data:${selectedFile.type};base64,${selectedFile.base64}`} 
                                    alt="preview" 
                                    className="h-16 w-16 object-cover rounded border border-border"
                                />
                            ) : (
                                <div className="h-16 w-16 flex items-center justify-center bg-primary/10 rounded border border-border text-primary">
                                    <FileText size={32} />
                                </div>
                            )}
                            <button 
                                onClick={() => setSelectedFile(null)}
                                className="absolute -top-2 -right-2 p-1 bg-destructive text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                            >
                                <X size={12} />
                            </button>
                            <div className="ml-3 pr-2">
                                <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">{selectedFile.name}</p>
                                <p className="text-[10px] text-primary/60 font-medium">{t("chat.fileReady")}</p>
                            </div>
                        </div>
                    )}

                    <div className="relative flex items-center gap-2">
                        <input 
                            type="file" 
                            ref={fileInputRef} 
                            onChange={handleFileSelect} 
                            accept="*/*" 
                            className="hidden" 
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={!activeGolem || isSending}
                            className="p-2.5 rounded-lg bg-secondary/80 border border-border text-muted-foreground hover:text-primary hover:bg-secondary transition-all"
                            title={t("chat.uploadTitle")}
                        >
                            <Paperclip size={20} />
                        </button>
                        
                        <div className="relative flex-1 flex items-center">
                            <textarea
                                className="flex-1 max-h-32 min-h-[44px] bg-secondary/50 border border-border rounded-lg px-4 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 resize-none transition-all"
                                placeholder={activeGolem
                                    ? t("chat.placeholder.withGolem", { golem: activeGolem })
                                    : t("chat.placeholder.noGolem")}
                                value={input}
                                onChange={(e) => onInputChange(e.target.value)}
                                onKeyDown={(e) => {
                                    if (showSuggestions) {
                                        if (filteredCommands.length === 0) {
                                            setShowSuggestions(false);
                                            return;
                                        }
                                        if (e.key === 'ArrowDown') {
                                            e.preventDefault();
                                            setSuggestionIndex((prev) => (prev + 1) % filteredCommands.length);
                                            return;
                                        }
                                        if (e.key === 'ArrowUp') {
                                            e.preventDefault();
                                            setSuggestionIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
                                            return;
                                        }
                                        if (e.key === 'Enter' || e.key === 'Tab') {
                                            e.preventDefault();
                                            handleCommandClick(filteredCommands[suggestionIndex]);
                                            return;
                                        }
                                        if (e.key === 'Escape') {
                                            e.preventDefault();
                                            setShowSuggestions(false);
                                            return;
                                        }
                                    }

                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        const rawInput = input.trim();
                                        if (rawInput) {
                                            const maybeShortcut = rawInput.split(/\s+/)[0].toLowerCase();
                                            if (maybeShortcut.startsWith('/') && systemCommandSet.has(maybeShortcut)) {
                                                e.preventDefault();
                                                handleSend();
                                                return;
                                            }
                                            const shortcutItem = promptShortcutMap.get(maybeShortcut);
                                            if (shortcutItem && rawInput.toLowerCase() === maybeShortcut) {
                                                e.preventDefault();
                                                setInput(shortcutItem.prompt);
                                                setInjectedShortcutCandidate({
                                                    shortcut: shortcutItem.shortcut,
                                                    seedPrompt: shortcutItem.prompt,
                                                });
                                                setShowSuggestions(false);
                                                return;
                                            }
                                        }
                                        e.preventDefault();
                                        handleSend();
                                    }
                                }}
                                onPaste={handlePaste}
                                disabled={!activeGolem || isSending}
                                rows={1}
                                style={{ height: "auto" }}
                            />
                            <button
                                onClick={handleSend}
                                disabled={!activeGolem || (!input.trim() && !selectedFile) || isSending}
                                className={cn(
                                    "absolute right-2 p-2 rounded-md transition-all flex items-center justify-center",
                                    (!activeGolem || (!input.trim() && !selectedFile) || isSending)
                                        ? "text-gray-600 bg-transparent"
                                        : "text-cyan-400 hover:text-cyan-300 hover:bg-cyan-900/20"
                                )}
                            >
                                <Send size={18} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
