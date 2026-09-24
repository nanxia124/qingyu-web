import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { AlertTriangle, RefreshCw, ShieldCheck, XCircle, CheckCircle } from "lucide-react";

interface ReconciliationRow {
  workspaceId: string;
  ownerEmail: string;
  quotaCode: string;
  granted: number;
  reserved: number;
  consumed: number;
  available: number;
  ledgerReserved: number;
  ledgerCommitted: number;
  ledgerReleased: number;
  drift: number;
}

interface AlertRow {
  id: string;
  type: string;
  severity: "info" | "warn" | "critical";
  workspaceId: string | null;
  summary: string;
  detail: Record<string, any>;
  status: string;
  createdAt: string;
  acknowledgedBy?: string | null;
}

const severityStyle: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  warn: "bg-amber-100 text-amber-700",
  info: "bg-sky-100 text-sky-700",
};

export default function AdminOpsPage() {
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [r, a] = await Promise.all([
        api.get<ReconciliationRow[]>("/admin/billing/reconciliation"),
        api.get<AlertRow[]>("/admin/billing/alerts", { all: "1" }),
      ]);
      setRows(r);
      setAlerts(a);
    } catch (e: any) {
      setError(e?.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const ackAlert = async (id: string) => {
    try {
      await api.post(`/admin/billing/alerts/${id}/ack`);
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: "ack" } : a));
    } catch (e: any) {
      alert(e?.message || "确认失败");
    }
  };

  const driftCount = rows.filter(r => Math.abs(r.drift) > 0.001).length;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text">计费对账与告警</h1>
        <button onClick={load} className="flex items-center gap-2 rounded-lg bg-accent text-white px-4 py-2 text-sm hover:opacity-90">
          <RefreshCw size={15} /> 刷新
        </button>
      </div>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">{error}</div>}

      {/* 告警 */}
      <section className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle size={18} className="text-amber-500" /> 异常告警
            <span className="text-xs font-normal text-text-muted">（{alerts.length} 条）</span>
          </div>
        </div>
        <div className="divide-y divide-border">
          {alerts.length === 0 && !loading && (
            <div className="px-5 py-8 text-center text-text-muted text-sm flex items-center justify-center gap-2">
              <CheckCircle size={16} className="text-green-500" /> 暂无告警，系统运行正常
            </div>
          )}
          {alerts.map(a => (
            <div key={a.id} className="px-5 py-3 flex items-start gap-3">
              <span className={`text-xs px-2 py-0.5 rounded ${severityStyle[a.severity] || "bg-gray-100"}`}>{a.severity}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-text text-sm">{a.summary}</span>
                  <code className="text-[11px] text-text-muted bg-secondary px-1.5 py-0.5 rounded">{a.type}</code>
                </div>
                <pre className="text-[11px] text-text-muted mt-1 whitespace-pre-wrap break-all">{JSON.stringify(a.detail)}</pre>
                <div className="text-[11px] text-text-muted mt-1">{new Date(a.createdAt).toLocaleString()}</div>
              </div>
              {a.status === "open" ? (
                <button onClick={() => ackAlert(a.id)} className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white hover:opacity-90">确认</button>
              ) : (
                <span className="text-xs text-text-muted flex items-center gap-1"><ShieldCheck size={13} /> 已确认{a.acknowledgedBy ? `: ${a.acknowledgedBy}` : ""}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 对账漂移 */}
      <section className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldCheck size={18} className="text-accent" /> 额度账户对账
            <span className="text-xs font-normal text-text-muted">（{rows.length} 个账户，{driftCount} 个漂移）</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-text-muted text-xs">
              <tr>
                <th className="px-4 py-2 text-left">账户</th>
                <th className="px-4 py-2 text-right">发放</th>
                <th className="px-4 py-2 text-right">预占</th>
                <th className="px-4 py-2 text-right">已用</th>
                <th className="px-4 py-2 text-right">可用</th>
                <th className="px-4 py-2 text-right">漂移</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <tr key={r.workspaceId + r.quotaCode} className={Math.abs(r.drift) > 0.001 ? "bg-red-50" : ""}>
                  <td className="px-4 py-2">
                    <div className="font-medium text-text">{r.ownerEmail}</div>
                    <div className="text-[11px] text-text-muted">{r.quotaCode}</div>
                  </td>
                  <td className="px-4 py-2 text-right">{r.granted}</td>
                  <td className="px-4 py-2 text-right">{r.reserved}</td>
                  <td className="px-4 py-2 text-right">{r.consumed}</td>
                  <td className="px-4 py-2 text-right">{r.available}</td>
                  <td className={`px-4 py-2 text-right font-mono ${Math.abs(r.drift) > 0.001 ? "text-red-600 font-semibold" : "text-green-600"}`}>
                    {Math.abs(r.drift) > 0.001 ? <XCircle size={14} className="inline mr-1" /> : null}{r.drift.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
