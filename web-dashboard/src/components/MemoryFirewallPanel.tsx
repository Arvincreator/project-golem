"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Shield, Plus, Trash2, RefreshCw, Power, PowerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast-provider";
import { apiGet, apiPostWrite, apiWrite } from "@/lib/api-client";
import { useGolem } from "@/components/GolemContext";
import { cn } from "@/lib/utils";

type FirewallStatus = {
  enabled: boolean;
  rulesCount: number;
  activeRulesCount: number;
  hitsCount: number;
};

type FirewallRule = {
  id: string;
  pattern: string;
  matchMode: "contains" | "exact";
  scope: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type FirewallHit = {
  id: string;
  ruleId: string;
  phase: "recall" | "response";
  golemId?: string | null;
  sample: string;
  timestamp: string;
};

type Props = {
  embedded?: boolean;
};

export function MemoryFirewallPanel({ embedded = false }: Props) {
  const toast = useToast();
  const { activeGolem } = useGolem();
  const [status, setStatus] = useState<FirewallStatus | null>(null);
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [hits, setHits] = useState<FirewallHit[]>([]);
  const [newPattern, setNewPattern] = useState("");
  const [scopeMode, setScopeMode] = useState<"global" | "golem">("global");
  const [loading, setLoading] = useState(false);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);

  const resolvedScope = useMemo(() => {
    if (scopeMode === "golem" && activeGolem) return `golem:${activeGolem}`;
    return "global";
  }, [scopeMode, activeGolem]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statusData, ruleData, hitData] = await Promise.all([
        apiGet<FirewallStatus>("/api/memory-firewall/status"),
        apiGet<FirewallRule[]>("/api/memory-firewall/rules?includeDisabled=true"),
        apiGet<FirewallHit[]>("/api/memory-firewall/hits?limit=80")
      ]);
      setStatus(statusData);
      setRules(ruleData || []);
      setHits(hitData || []);
    } catch (error) {
      toast.error("讀取記憶防火牆失敗", error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAll().catch(() => {});
  }, [loadAll]);

  const toggleGlobal = useCallback(async () => {
    if (!status) return;
    try {
      await apiWrite("/api/memory-firewall/status", {
        method: "PATCH",
        body: { enabled: !status.enabled }
      });
      await loadAll();
      toast.success("記憶防火牆已更新", !status.enabled ? "防火牆已開啟" : "防火牆已關閉 (效能優先)");
    } catch (error) {
      toast.error("切換失敗", error instanceof Error ? error.message : String(error));
    }
  }, [loadAll, status, toast]);

  const createRule = useCallback(async () => {
    const pattern = newPattern.trim();
    if (!pattern) return;
    try {
      await apiPostWrite("/api/memory-firewall/rules", {
        pattern,
        scope: resolvedScope,
        matchMode: "contains",
        enabled: true
      });
      setNewPattern("");
      await loadAll();
      toast.success("規則已新增", "新規則已生效。未來命中內容將被攔截。");
    } catch (error) {
      toast.error("新增規則失敗", error instanceof Error ? error.message : String(error));
    }
  }, [loadAll, newPattern, resolvedScope, toast]);

  const toggleRule = useCallback(async (rule: FirewallRule) => {
    try {
      setBusyRuleId(rule.id);
      await apiWrite(`/api/memory-firewall/rules/${encodeURIComponent(rule.id)}`, {
        method: "PATCH",
        body: { enabled: !rule.enabled }
      });
      await loadAll();
    } catch (error) {
      toast.error("更新規則失敗", error instanceof Error ? error.message : String(error));
    } finally {
      setBusyRuleId(null);
    }
  }, [loadAll, toast]);

  const deleteRule = useCallback(async (rule: FirewallRule) => {
    if (!confirm(`刪除規則：${rule.pattern} ?`)) return;
    try {
      setBusyRuleId(rule.id);
      await apiWrite(`/api/memory-firewall/rules/${encodeURIComponent(rule.id)}`, { method: "DELETE" });
      await loadAll();
      toast.success("規則已刪除", "該條防火牆規則已移除。");
    } catch (error) {
      toast.error("刪除規則失敗", error instanceof Error ? error.message : String(error));
    } finally {
      setBusyRuleId(null);
    }
  }, [loadAll, toast]);

  const Wrapper = embedded ? "div" : "div";

  return (
    <Wrapper className={embedded ? "space-y-6" : "h-full overflow-auto bg-background text-foreground"}>
      <div className={embedded ? "space-y-6" : "mx-auto max-w-7xl p-6 space-y-6"}>
        <div className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
              <Shield className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">記憶防火牆</h1>
              <p className="mt-1 text-sm text-muted-foreground">控制禁提規則。規則命中時會阻止記憶注入，並遮罩最終回覆中的禁提內容。</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg border border-border bg-card px-3 py-2">
              <div className="font-mono text-lg text-foreground">{status?.rulesCount ?? 0}</div>
              <div className="text-muted-foreground">總規則</div>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2">
              <div className="font-mono text-lg text-emerald-400">{status?.activeRulesCount ?? 0}</div>
              <div className="text-muted-foreground">啟用中</div>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2">
              <div className="font-mono text-lg text-amber-400">{status?.hitsCount ?? 0}</div>
              <div className="text-muted-foreground">命中次數</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={toggleGlobal} variant="outline" className={cn(status?.enabled ? "text-emerald-300 border-emerald-500/30" : "text-amber-300 border-amber-500/30")}>
              {status?.enabled ? <Power className="h-4 w-4 mr-2" /> : <PowerOff className="h-4 w-4 mr-2" />}
              {status?.enabled ? "防火牆已開啟" : "防火牆已關閉"}
            </Button>
            <Button onClick={() => loadAll()} variant="outline" disabled={loading}>
              <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
              重新整理
            </Button>
            {!status?.enabled && <span className="text-xs text-amber-300">效能優先模式：目前略過所有防火牆比對。</span>}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-lg font-semibold">新增規則</h2>
          <div className="flex flex-wrap gap-2">
            <input value={newPattern} onChange={(e) => setNewPattern(e.target.value)} placeholder="例如：請不要再提某某某" className="flex-1 min-w-[280px] rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm focus:outline-none focus:border-primary" />
            <select value={scopeMode} onChange={(e) => setScopeMode(e.target.value as "global" | "golem")} className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm">
              <option value="global">全域</option>
              <option value="golem" disabled={!activeGolem}>僅目前 Golem</option>
            </select>
            <Button onClick={createRule} disabled={!newPattern.trim()}>
              <Plus className="h-4 w-4 mr-2" />新增
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">可直接輸入完整句子，系統會自動抽取關鍵片語。</p>
        </div>

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">規則清單</div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-muted-foreground text-xs uppercase"><tr><th className="px-4 py-2 text-left">Pattern</th><th className="px-4 py-2 text-left">Scope</th><th className="px-4 py-2 text-left">狀態</th><th className="px-4 py-2 text-left">更新時間</th><th className="px-4 py-2 text-right">操作</th></tr></thead>
              <tbody>
                {rules.length === 0 ? <tr><td className="px-4 py-6 text-muted-foreground" colSpan={5}>尚無規則</td></tr> : rules.map((rule) => (
                  <tr key={rule.id} className="border-t border-border/60">
                    <td className="px-4 py-3 font-medium text-foreground">{rule.pattern}</td>
                    <td className="px-4 py-3 text-muted-foreground">{rule.scope}</td>
                    <td className="px-4 py-3"><span className={cn("px-2 py-1 rounded text-xs border", rule.enabled ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" : "text-muted-foreground border-border bg-secondary/40")}>{rule.enabled ? "啟用" : "停用"}</span></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(rule.updatedAt).toLocaleString()}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => toggleRule(rule)} disabled={busyRuleId === rule.id}>{rule.enabled ? "停用" : "啟用"}</Button><Button size="sm" variant="outline" className="text-red-300 border-red-500/30" onClick={() => deleteRule(rule)} disabled={busyRuleId === rule.id}><Trash2 className="h-4 w-4" /></Button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">最近命中紀錄</div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-muted-foreground text-xs uppercase"><tr><th className="px-4 py-2 text-left">時間</th><th className="px-4 py-2 text-left">階段</th><th className="px-4 py-2 text-left">Golem</th><th className="px-4 py-2 text-left">內容片段</th></tr></thead>
              <tbody>
                {hits.length === 0 ? <tr><td className="px-4 py-6 text-muted-foreground" colSpan={4}>尚無命中紀錄</td></tr> : hits.map((hit) => (
                  <tr key={hit.id} className="border-t border-border/60"><td className="px-4 py-3 text-xs text-muted-foreground">{new Date(hit.timestamp).toLocaleString()}</td><td className="px-4 py-3">{hit.phase}</td><td className="px-4 py-3">{hit.golemId || "-"}</td><td className="px-4 py-3 text-muted-foreground">{hit.sample || "-"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Wrapper>
  );
}
