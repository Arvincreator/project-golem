"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { socket } from "@/lib/socket";
import { apiUrl } from "@/lib/api";
import { useToast } from "@/components/ui/toast-provider";
import { apiDeleteWrite, apiGet, apiPost, apiPostWrite, apiWrite } from "@/lib/api-client";
import { useQuery } from "@/hooks/useQuery";
import { useI18n } from "@/components/I18nProvider";
import {
    Plug, Plus, Trash2, RefreshCw, Zap,
    CheckCircle, XCircle, AlertCircle, ToggleLeft,
    ToggleRight, Edit2, X, Terminal, List, Play, Cpu
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface MCPServer {
    name:        string;
    command:     string;
    args:        string[];
    env:         Record<string, string>;
    enabled:     boolean;
    description: string;
    connected:   boolean;
}

interface MCPTool {
    name:        string;
    description: string;
    inputSchema: { type: string; properties?: Record<string, unknown>; required?: string[] };
}

interface MCPLogEntry {
    time:       string;
    server:     string;
    tool:       string;
    params:     unknown;
    success:    boolean;
    result:     unknown;
    error:      string | null;
    durationMs: number;
}

type MCPLogSocketPayload = {
    type?: string;
    mcpEntry?: MCPLogEntry;
};

function getErrorMessage(error: unknown, fallback = "Unknown error"): string {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
}

// useApiBase 已移除，改用 @/lib/api 的 apiUrl()

// ─── Server Card ──────────────────────────────────────────────────────────────
function ServerCard({
    server, selected, onSelect, onToggle, onDelete, onEdit, onTest
}: {
    server: MCPServer;
    selected: boolean;
    onSelect: () => void;
    onToggle: (enabled: boolean) => void;
    onDelete: () => void;
    onEdit:   () => void;
    onTest:   () => void;
}) {
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    const statusColor = server.connected
        ? 'text-emerald-400' : server.enabled
        ? 'text-amber-400'   : 'text-zinc-500';

    return (
        <div
            onClick={onSelect}
            className={`group relative rounded-xl border p-4 cursor-pointer transition-all duration-200 ${
                selected
                    ? 'border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/10'
                    : 'border-border bg-card hover:border-blue-500/40 hover:bg-card/80'
            }`}
        >
            {/* Status dot */}
            <span className={`absolute top-3 right-3 w-2.5 h-2.5 rounded-full ${
                server.connected ? 'bg-emerald-400 shadow-lg shadow-emerald-400/50 animate-pulse'
                : server.enabled  ? 'bg-amber-400'
                : 'bg-zinc-600'
            }`} />

            <div className="flex items-start gap-3 pr-4">
                <div className={`mt-0.5 p-2 rounded-lg ${selected ? 'bg-blue-500/20' : 'bg-secondary'}`}>
                    <Plug className={`w-4 h-4 ${selected ? 'text-blue-400' : 'text-muted-foreground'}`} />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-foreground truncate">{server.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">
                        {server.command} {server.args?.join(' ')}
                    </p>
                    {server.description && (
                        <p className="text-xs text-muted-foreground/70 mt-1 truncate">{server.description}</p>
                    )}
                    <p className={`text-xs mt-1.5 font-medium ${statusColor}`}>
                        {server.connected
                            ? (isEnglish ? "● Connected" : "● 已連線")
                            : server.enabled
                                ? (isEnglish ? "● Connecting..." : "● 連線中...")
                                : (isEnglish ? "○ Disabled" : "○ 已停用")}
                    </p>
                </div>
            </div>

            {/* Action bar */}
            <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border/50 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onClick={(e) => { e.stopPropagation(); onToggle(!server.enabled); }}
                    className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg text-xs hover:bg-secondary transition-colors"
                    title={server.enabled ? (isEnglish ? "Disable" : "停用") : (isEnglish ? "Enable" : "啟用")}
                >
                    {server.enabled
                        ? <><ToggleRight className="w-3.5 h-3.5 text-blue-400" /><span className="text-blue-400">{isEnglish ? "Enabled" : "啟用中"}</span></>
                        : <><ToggleLeft  className="w-3.5 h-3.5 text-zinc-500" /><span className="text-zinc-500">{isEnglish ? "Disabled" : "已停用"}</span></>
                    }
                </button>
                <button onClick={(e) => { e.stopPropagation(); onTest(); }}
                    className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-amber-400 transition-colors" title={isEnglish ? "Test connection" : "測試連線"}>
                    <Zap className="w-3.5 h-3.5" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
                    className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-blue-400 transition-colors" title={isEnglish ? "Edit" : "編輯"}>
                    <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-red-400 transition-colors" title={isEnglish ? "Delete" : "刪除"}>
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}

// ─── Tool Inspector ───────────────────────────────────────────────────────────
function ToolInspector({ server }: { server: MCPServer | null }) {
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    const [selected, setSelected] = useState<MCPTool | null>(null);
    const serverName = server?.name || "";
    const isServerConnected = Boolean(server?.connected);
    const { data, error, isLoading } = useQuery<{ tools?: MCPTool[] }>(
        () => apiGet<{ tools?: MCPTool[] }>(apiUrl(`/api/mcp/servers/${encodeURIComponent(serverName)}/tools`)),
        [serverName, isServerConnected],
        { enabled: isServerConnected }
    );
    const tools = useMemo(() => data?.tools || [], [data?.tools]);

    useEffect(() => {
        if (!isServerConnected) {
            if (selected !== null) {
                const rafId = requestAnimationFrame(() => setSelected(null));
                return () => cancelAnimationFrame(rafId);
            }
            return;
        }

        if (selected && !tools.some((tool) => tool.name === selected.name)) {
            const rafId = requestAnimationFrame(() => setSelected(null));
            return () => cancelAnimationFrame(rafId);
        }
    }, [isServerConnected, selected, tools]);

    if (!server) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
                <List className="w-10 h-10 opacity-30" />
                <p className="text-sm">{isEnglish ? "Select an MCP server on the left to view tools" : "選擇左側的 MCP Server 以查看可用工具"}</p>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <div>
                    <h3 className="font-semibold text-foreground">{server.name}</h3>
                    <p className="text-xs text-muted-foreground font-mono">{server.command} {server.args?.join(' ')}</p>
                </div>
                {isLoading && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
            </div>

            {error && (
                <div className="m-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
                    <XCircle className="w-4 h-4 flex-shrink-0" /> {error.message}
                </div>
            )}

            {!server.connected && !isLoading && (
                <div className="m-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" /> {isEnglish ? "Server is offline. Enable it first." : "Server 未連線，請先啟用"}
                </div>
            )}

            <div className="flex-1 overflow-auto p-4 flex gap-4">
                {/* Tool list */}
                <div className="w-56 flex-shrink-0 space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground px-2 mb-2 uppercase tracking-wider">
                        {isEnglish ? `Tools (${tools.length})` : `工具 (${tools.length})`}
                    </p>
                    {tools.map(t => (
                        <button
                            key={t.name}
                            onClick={() => setSelected(t)}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                                selected?.name === t.name
                                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                    : 'hover:bg-secondary text-foreground'
                            }`}
                        >
                            <Play className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate font-mono text-xs">{t.name}</span>
                        </button>
                    ))}
                    {tools.length === 0 && !isLoading && server.connected && (
                        <p className="text-xs text-muted-foreground px-2">{isEnglish ? "No tools available" : "無可用工具"}</p>
                    )}
                </div>

                {/* Tool detail */}
                <div className="flex-1 min-w-0">
                    {selected ? (
                        <div className="bg-secondary/50 rounded-xl border border-border p-4 space-y-4">
                            <div>
                                <p className="font-mono font-semibold text-blue-300 text-sm">{selected.name}</p>
                                <p className="text-sm text-muted-foreground mt-1">{selected.description}</p>
                            </div>
                            {selected.inputSchema?.properties && (
                                <div>
                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{isEnglish ? "Parameters" : "參數"}</p>
                                    <div className="space-y-2">
                                        {Object.entries(selected.inputSchema.properties).map(([key, schema]) => {
                                            const schemaObj = (typeof schema === "object" && schema !== null)
                                                ? schema as Record<string, unknown>
                                                : {};
                                            const schemaDescription = typeof schemaObj.description === "string"
                                                ? schemaObj.description
                                                : (typeof schemaObj.type === "string" ? schemaObj.type : "");
                                            return (
                                                <div key={key} className="flex items-start gap-3 bg-background/50 rounded-lg p-2">
                                                    <span className="font-mono text-xs text-blue-300 flex-shrink-0">{key}</span>
                                                    <div>
                                                        {selected.inputSchema.required?.includes(key) && (
                                                            <span className="text-xs text-red-400 mr-2">{isEnglish ? "Required" : "必填"}</span>
                                                        )}
                                                        <span className="text-xs text-muted-foreground">{schemaDescription}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            <div className="text-xs text-muted-foreground/60 pt-2 border-t border-border">
                                <p>{isEnglish ? "Action format (for Golem chat):" : "Action 格式 (用於 Golem 對話):"}</p>
                                <pre className="mt-1 bg-background p-2 rounded-lg text-[11px] text-emerald-300 overflow-x-auto whitespace-pre-wrap">{
                                    JSON.stringify({
                                        action: "mcp_call",
                                        server: server.name,
                                        tool:   selected.name,
                                        parameters: {}
                                    }, null, 2)
                                }</pre>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground/50 text-sm">
                            {isEnglish ? "Select a tool on the left to view details" : "點選左側工具查看詳情"}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Log Panel ────────────────────────────────────────────────────────────────
function LogPanel({ logs }: { logs: MCPLogEntry[] }) {
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    const bottomRef = useRef<HTMLDivElement>(null);
    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

    return (
        <div className="border-t border-border bg-black/40 h-52 overflow-y-auto font-mono text-xs p-3 space-y-1">
            {logs.length === 0 && (
                <p className="text-muted-foreground/50 text-center pt-4">{isEnglish ? "No MCP call logs yet" : "尚無 MCP 呼叫記錄"}</p>
            )}
            {logs.map((l, i) => (
                <div key={i} className={`flex items-start gap-2 ${l.success ? 'text-emerald-300' : 'text-red-400'}`}>
                    <span className="text-muted-foreground/50 whitespace-nowrap">
                        {new Date(l.time).toLocaleTimeString(locale, { hour12: false })}
                    </span>
                    {l.success ? <CheckCircle className="w-3 h-3 mt-0.5 flex-shrink-0" /> : <XCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />}
                    <span className="text-blue-300">[{l.server}/{l.tool}]</span>
                    <span className="text-muted-foreground">({l.durationMs}ms)</span>
                    {l.error && <span className="text-red-400">{l.error}</span>}
                </div>
            ))}
            <div ref={bottomRef} />
        </div>
    );
}

// ─── Add/Edit Dialog ──────────────────────────────────────────────────────────
function ServerDialog({
    initial, onSave, onClose
}: {
    initial: Partial<MCPServer> | null;
    onSave:  (data: Partial<MCPServer>) => void;
    onClose: () => void;
}) {
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    type ServerForm = {
        name: string;
        command: string;
        argsStr: string;
        envStr: string;
        description: string;
        enabled: boolean;
    };
    const isEdit = !!initial?.name;
    const editableFields = [
        { label: isEnglish ? "Name *" : "名稱 *", key: 'name', placeholder: 'codex', mono: false, disabled: isEdit },
        { label: isEnglish ? "Command *" : "執行指令 *", key: 'command', placeholder: 'npx', mono: true, disabled: false },
        { label: isEnglish ? "Arguments (space separated)" : "參數 (空格分隔)", key: 'argsStr', placeholder: '-y @modelcontextprotocol/server-codex', mono: true, disabled: false },
    ] as const;
    const [form, setForm] = useState<ServerForm>({
        name:        initial?.name        || '',
        command:     initial?.command     || '',
        argsStr:     (initial?.args || []).join(' '),
        envStr:      Object.entries(initial?.env || {}).map(([k, v]) => `${k}=${v}`).join('\n'),
        description: initial?.description || '',
        enabled:     initial?.enabled !== false
    });

    const handleSave = () => {
        const args = form.argsStr.trim() ? form.argsStr.trim().split(/\s+/) : [];
        const env: Record<string, string> = {};
        for (const line of form.envStr.split('\n')) {
            const eq = line.indexOf('=');
            if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        }
        onSave({ name: form.name, command: form.command, args, env, description: form.description, enabled: form.enabled });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <h2 className="font-bold text-lg">{isEdit ? (isEnglish ? "Edit MCP Server" : "編輯 MCP Server") : (isEnglish ? "Add MCP Server" : "新增 MCP Server")}</h2>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
                </div>
                <div className="px-6 py-5 space-y-4">
                    {editableFields.map(({ label, key, placeholder, mono, disabled }) => (
                        <div key={key}>
                            <label className="text-sm text-muted-foreground mb-1 block">{label}</label>
                            <input
                                className={`w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 ${mono ? 'font-mono' : ''} ${disabled ? 'opacity-50' : ''}`}
                                value={form[key]}
                                placeholder={placeholder}
                                disabled={disabled}
                                onChange={e => setForm((f: ServerForm) => ({ ...f, [key]: e.target.value }))}
                            />
                        </div>
                    ))}
                    <div>
                        <label className="text-sm text-muted-foreground mb-1 block">{isEnglish ? "Environment Variables (KEY=VALUE, one per line)" : "環境變數 (KEY=VALUE，每行一個)"}</label>
                        <textarea
                            className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 resize-none h-20"
                            value={form.envStr}
                            placeholder={"ANTHROPIC_API_KEY=sk-...\nNODE_ENV=production"}
                            onChange={e => setForm(f => ({ ...f, envStr: e.target.value }))}
                        />
                    </div>
                    <div>
                        <label className="text-sm text-muted-foreground mb-1 block">{isEnglish ? "Description" : "描述"}</label>
                        <input
                            className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                            value={form.description}
                            placeholder="Codex CLI MCP Server"
                            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                        />
                    </div>
                    <label className="flex items-center gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            className="rounded border-border accent-blue-500"
                            checked={form.enabled}
                            onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
                        />
                        <span className="text-sm">{isEnglish ? "Enable (connect immediately)" : "啟用 (立即建立連線)"}</span>
                    </label>
                </div>
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-border bg-secondary/30">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-secondary transition-colors">{isEnglish ? "Cancel" : "取消"}</button>
                    <button
                        onClick={handleSave}
                        disabled={!form.name || !form.command}
                        className="px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isEdit ? (isEnglish ? "Save" : "儲存") : (isEnglish ? "Add" : "新增")}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MCPPage() {
    const toast = useToast();
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    const [servers,     setServers]     = useState<MCPServer[]>([]);
    const [selected,    setSelected]    = useState<MCPServer | null>(null);
    const [logs,        setLogs]        = useState<MCPLogEntry[]>([]);
    const [loading,     setLoading]     = useState(true);
    const [dialog,      setDialog]      = useState<{ mode: 'add' | 'edit'; initial: Partial<MCPServer> | null } | null>(null);
    const [testResult,  setTestResult]  = useState<{ server: string; ok: boolean; msg: string } | null>(null);
    const [injecting,   setInjecting]   = useState(false);
    const [showReminder, setShowReminder] = useState(false);

    const showToast = (msg: string, ok = true) => {
        if (ok) {
            toast.success(msg);
        } else {
            toast.error(msg);
        }
    };

    // ── Fetch servers ─────────────────────────────────────────────
    const fetchServers = useCallback(async () => {
        setLoading(true);
        try {
            const d = await apiGet<{ servers?: MCPServer[] }>(apiUrl("/api/mcp/servers"));
            setServers(d.servers || []);
        } finally {
            setLoading(false);
        }
    }, []);

    // ── Fetch initial logs ────────────────────────────────────────
    const fetchLogs = useCallback(async () => {
        try {
            const d = await apiGet<{ logs?: MCPLogEntry[] }>(apiUrl("/api/mcp/logs?limit=100"));
            setLogs(d.logs || []);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => { fetchServers(); fetchLogs(); }, [fetchServers, fetchLogs]);

    // ── Socket — real-time MCP logs ───────────────────────────────
    useEffect(() => {
        const handler = (payload: unknown) => {
            if (!payload || typeof payload !== "object") return;
            const data = payload as MCPLogSocketPayload;
            const entry = data.mcpEntry;
            if (data.type !== "mcp" || !entry) return;
            setLogs((prev) => [...prev.slice(-199), entry]);
        };
        socket.on('log', handler);
        return () => { socket.off('log', handler); };
    }, []);

    // ── Keep selected in sync after refresh ───────────────────────
    useEffect(() => {
        if (selected) {
            const fresh = servers.find(s => s.name === selected.name);
            if (fresh && fresh !== selected) setSelected(fresh);
        }
    }, [selected, servers]);

    // ── Actions ───────────────────────────────────────────────────
    const handleToggle = async (name: string, enabled: boolean) => {
        await apiPostWrite(
            apiUrl(`/api/mcp/servers/${encodeURIComponent(name)}/toggle`),
            { enabled }
        );
        showToast(enabled
            ? (isEnglish ? `${name} enabled` : `${name} 已啟用`)
            : (isEnglish ? `${name} disabled` : `${name} 已停用`));
        if (enabled) setShowReminder(true);
        await fetchServers();
    };

    const handleInject = async () => {
        setInjecting(true);
        setShowReminder(false);
        try {
            const d = await apiPost<{ success?: boolean; error?: string }>(apiUrl("/api/skills/inject"));
            if (d.success) {
                showToast(isEnglish ? "Inject triggered. Golem is reloading skills..." : '已觸發注入！Golem 正在重新載入技能...', true);
            } else {
                throw new Error(d.error || (isEnglish ? "Invocation failed" : '調用失敗'));
            }
        } catch (e: unknown) {
            showToast(
                isEnglish
                    ? `Inject failed: ${getErrorMessage(e, "Invocation failed")}`
                    : `注入失敗: ${getErrorMessage(e, "調用失敗")}`,
                false
            );
        } finally {
            setInjecting(false);
        }
    };

    const handleDelete = async (name: string) => {
        if (!confirm(isEnglish ? `Delete "${name}"?` : `確定要刪除 "${name}"？`)) return;
        await apiDeleteWrite(apiUrl(`/api/mcp/servers/${encodeURIComponent(name)}`));
        showToast(isEnglish ? `${name} deleted` : `${name} 已刪除`);
        if (selected?.name === name) setSelected(null);
        await fetchServers();
    };

    const handleTest = async (name: string) => {
        setTestResult(null);
        try {
            const d = await apiPostWrite<{ success?: boolean; toolCount?: number; error?: string }>(
                apiUrl(`/api/mcp/servers/${encodeURIComponent(name)}/test`),
                undefined
            );
            setTestResult({
                server: name,
                ok: Boolean(d.success),
                msg: d.success
                    ? (isEnglish ? `${d.toolCount} tools found` : `發現 ${d.toolCount} 個工具`)
                    : (d.error || (isEnglish ? "Test failed" : "測試失敗")),
            });
            setTimeout(() => setTestResult(null), 4000);
        } catch (e: unknown) {
            setTestResult({ server: name, ok: false, msg: getErrorMessage(e, isEnglish ? "Test failed" : "測試失敗") });
            setTimeout(() => setTestResult(null), 4000);
        }
    };

    const handleSave = async (data: Partial<MCPServer>) => {
        const isEdit = !!dialog?.initial?.name;
        const url = isEdit
            ? apiUrl(`/api/mcp/servers/${encodeURIComponent(dialog!.initial!.name!)}`)
            : apiUrl('/api/mcp/servers');
        const method = isEdit ? 'PUT' : 'POST';

        try {
            const d = method === "PUT"
                ? await apiWrite<{ error?: string }>(url, { method: "PUT", body: data })
                : await apiPost<{ error?: string }>(url, data);
            if (d.error) throw new Error(d.error);
            showToast(isEdit ? (isEnglish ? "Updated successfully" : '更新成功') : (isEnglish ? "Added successfully" : '新增成功'));
            setDialog(null);
            await fetchServers();
        } catch (e: unknown) {
            showToast(getErrorMessage(e, isEnglish ? "Operation failed" : "操作失敗"), false);
        }
    };

    // ─────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/50 backdrop-blur-sm flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-blue-500/15 border border-blue-500/30">
                            <Plug className="w-5 h-5 text-blue-400" />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold">{isEnglish ? "MCP Tool Manager" : "MCP 工具管理"}</h1>
                            <p className="text-xs text-muted-foreground">
                                {isEnglish ? "Model Context Protocol — Local Tool Hub" : "Model Context Protocol — 本地工具整合中心"}
                            </p>
                        </div>
                    </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={fetchServers}
                        className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                        title={isEnglish ? "Refresh" : "重新整理"}
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        onClick={handleInject}
                        disabled={injecting}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-lg ${
                            injecting 
                                ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed' 
                                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20'
                        }`}
                        title={isEnglish ? "Inject MCP tools into Golem core" : "將 MCP 工具注入 Golem 核心"}
                    >
                        {injecting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />}
                        {injecting ? (isEnglish ? "Injecting..." : '注入中...') : (isEnglish ? "Inject MCP" : '注入 MCP')}
                    </button>
                    <button
                        onClick={() => setDialog({ mode: 'add', initial: null })}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors shadow-lg shadow-blue-500/20"
                    >
                        <Plus className="w-4 h-4" />
                        {isEnglish ? "Add Server" : "新增 Server"}
                    </button>
                </div>
            </div>

            {/* Test result toast */}
            {testResult && (
                <div className={`mx-6 mt-3 p-3 rounded-xl border text-sm flex items-center gap-2 flex-shrink-0 ${
                    testResult.ok
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : 'bg-red-500/10 border-red-500/30 text-red-400'
                }`}>
                    {testResult.ok ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    <span><strong>{testResult.server}</strong> — {testResult.msg}</span>
                </div>
            )}

            {/* Body */}
            <div className="flex-1 flex overflow-hidden">
                {/* ── Left panel: server list ── */}
                <div className="w-72 flex-shrink-0 border-r border-border flex flex-col overflow-hidden">
                    <div className="px-4 py-3 border-b border-border bg-secondary/20">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            {isEnglish
                                ? `Servers (${servers.filter(s => s.connected).length}/${servers.length} connected)`
                                : `Servers (${servers.filter(s => s.connected).length}/${servers.length} 已連線)`}
                        </p>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {loading && servers.length === 0 && (
                            <div className="flex items-center justify-center h-32 text-muted-foreground">
                                <RefreshCw className="w-5 h-5 animate-spin" />
                            </div>
                        )}
                        {!loading && servers.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-3">
                                <Plug className="w-8 h-8 opacity-30" />
                                <p className="text-sm text-center">
                                    {isEnglish ? "No MCP servers configured yet" : "尚未設定任何 MCP Server"}<br />
                                    {isEnglish ? "Click \"Add Server\" to get started" : "點擊「新增 Server」開始"}
                                </p>
                            </div>
                        )}
                        {servers.map(s => (
                            <ServerCard
                                key={s.name}
                                server={s}
                                selected={selected?.name === s.name}
                                onSelect={() => setSelected(s)}
                                onToggle={(enabled) => handleToggle(s.name, enabled)}
                                onDelete={() => handleDelete(s.name)}
                                onEdit={() => setDialog({ mode: 'edit', initial: s })}
                                onTest={() => handleTest(s.name)}
                            />
                        ))}
                    </div>
                </div>

                {/* ── Right panel: tool inspector + logs ── */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex-1 overflow-hidden flex">
                        <ToolInspector server={selected} />
                    </div>

                    {/* Log panel */}
                    <div className="flex-shrink-0">
                        <div className="flex items-center gap-2 px-4 py-2 border-t border-border bg-secondary/20">
                            <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                {isEnglish ? "MCP Call Log" : "MCP 呼叫 Log"}
                            </span>
                            <span className="ml-auto text-xs text-muted-foreground">
                                {isEnglish ? `${logs.length} records` : `${logs.length} 筆記錄`}
                            </span>
                        </div>
                        <LogPanel logs={logs} />
                    </div>
                </div>
            </div>

            {/* Reminder overlay */}
            {showReminder && (
                <div className="fixed top-20 right-6 z-40 animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className="bg-amber-600 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-4 border border-amber-400/30">
                        <div className="flex-1">
                            <p className="font-bold text-sm">{isEnglish ? "Changes saved!" : "變更已儲存！"}</p>
                            <p className="text-[11px] opacity-90">
                                {isEnglish ? "Click \"Inject MCP\" in the top-right to sync with Golem." : "請點擊右上角「注入 MCP」按鈕以同步至 Golem。"}
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button 
                                onClick={() => setShowReminder(false)}
                                className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-[10px] font-semibold transition-colors"
                            >
                                {isEnglish ? "Got it" : "我知道了"}
                            </button>
                            <button 
                                onClick={handleInject}
                                className="px-2 py-1 rounded bg-white text-amber-700 text-[10px] font-bold hover:bg-zinc-100 transition-all active:scale-95"
                            >
                                {isEnglish ? "Inject now" : "立即注入"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add/Edit dialog */}
            {dialog && (
                <ServerDialog
                    initial={dialog.initial}
                    onSave={handleSave}
                    onClose={() => setDialog(null)}
                />
            )}

        </div>
    );
}
