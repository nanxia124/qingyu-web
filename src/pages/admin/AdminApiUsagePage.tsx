import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "";
const PAGE_SIZE = 50;

type Range = "today" | "d7" | "d30";
type Channel = { id: number; name: string; provider: string; is_active: number };
type Summary = {
  calls: number;
  successes: number;
  failures: number;
  inFlight: number;
  released: number;
  unknown: number;
  successRate: number | null;
  avgLatencyMs: number | null;
};
type UsageEntry = {
  id: string;
  requestId: string | null;
  occurredAt: string;
  completedAt: string | null;
  userEmail: string;
  provider: string;
  model: string;
  quantity: number;
  status: "reserved" | "committed" | "released" | "failed" | "unknown";
  latencyMs: number | null;
  targetPath: string;
  statusCode: number | null;
  phase: string;
};
type UsagePage = { total: number; limit: number; offset: number; items: UsageEntry[] };

const ranges: { value: Range; label: string; historyKey: "d1" | "d7" | "d30" }[] = [
  { value: "today", label: "今日（上海时间）", historyKey: "d1" },
  { value: "d7", label: "近 7 天", historyKey: "d7" },
  { value: "d30", label: "近 30 天", historyKey: "d30" },
];
const statusText: Record<UsageEntry["status"], string> = {
  reserved: "进行中", committed: "成功", released: "已释放", failed: "失败", unknown: "结果未知",
};
const statusColors: Record<UsageEntry["status"], string> = {
  reserved: "bg-amber-400", committed: "bg-emerald-400", released: "bg-slate-400", failed: "bg-rose-400", unknown: "bg-orange-400",
};
const statusTextColors: Record<UsageEntry["status"], string> = {
  reserved: "text-amber-300", committed: "text-emerald-300", released: "text-gray-400", failed: "text-rose-300", unknown: "text-orange-300",
};
const timeText = (value: string | null) => value
  ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "medium" }).format(new Date(value))
  : "尚未完成";

export default function AdminApiUsagePage({ token }: { token: string }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [history, setHistory] = useState<Record<number, any>>({});
  const [channelId, setChannelId] = useState("");
  const [range, setRange] = useState<Range>("today");
  const [page, setPage] = useState<UsagePage | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [error, setError] = useState("");
  const [pageError, setPageError] = useState("");

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const fetchBase = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [channelsResponse, historyResponse] = await Promise.all([
        fetch(`${API}/api/admin/api-keys`, { headers }),
        fetch(`${API}/api/admin/key-history`, { headers }),
      ]);
      const [channelsData, historyData] = await Promise.all([channelsResponse.json(), historyResponse.json()]);
      if (!channelsResponse.ok) throw new Error(channelsData.error || `读取渠道失败（HTTP ${channelsResponse.status}）`);
      if (!historyResponse.ok) throw new Error(historyData.error || `读取统计失败（HTTP ${historyResponse.status}）`);
      setChannels(channelsData);
      setHistory(historyData);
      setChannelId(current => current && channelsData.some((channel: Channel) => String(channel.id) === current)
        ? current : String(channelsData[0]?.id ?? ""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取 API 调用数据失败");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { void fetchBase(); }, [fetchBase]);

  const fetchPage = useCallback(async (nextOffset: number) => {
    if (!channelId) { setPage(null); return; }
    setLoadingPage(true);
    setPageError("");
    try {
      const params = new URLSearchParams({ range, capability: "全部", limit: String(PAGE_SIZE), offset: String(nextOffset) });
      const response = await fetch(`${API}/api/admin/api-keys/${channelId}/usage?${params}`, { headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `读取明细失败（HTTP ${response.status}）`);
      setPage(data);
      setOffset(nextOffset);
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : "读取调用明细失败");
    } finally {
      setLoadingPage(false);
    }
  }, [channelId, headers, range]);

  useEffect(() => { void fetchPage(0); }, [fetchPage]);

  const selectedChannel = channels.find(channel => String(channel.id) === channelId);
  const activeRange = ranges.find(item => item.value === range)!;
  const summary: Summary | null = history[Number(channelId)]?.[activeRange.historyKey]?._all || null;
  const statuses: { key: UsageEntry["status"]; label: string; count: number }[] = summary ? [
    { key: "committed", label: "成功", count: summary.successes || 0 },
    { key: "failed", label: "失败", count: summary.failures || 0 },
    { key: "reserved", label: "进行中", count: summary.inFlight || 0 },
    { key: "released", label: "已释放", count: summary.released || 0 },
    { key: "unknown", label: "结果未知", count: summary.unknown || 0 },
  ] : [];

  return <div className="space-y-5 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 text-xl font-semibold"><BarChart3 size={21} className="text-accent" />API 调用追踪</div>
        <p className="mt-1 text-sm text-text-muted">按渠道和时间范围查看调用汇总，并逐条核对请求记录。统计包含所选渠道的所有用户。</p>
      </div>
      <button type="button" onClick={() => { void fetchBase(); void fetchPage(0); }} disabled={loading || loadingPage} className="inline-flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-text-secondary hover:bg-secondary/80 disabled:opacity-50">
        <RefreshCw size={15} className={loading || loadingPage ? "animate-spin" : ""} />刷新
      </button>
    </div>

    <section className="flex flex-wrap items-end gap-3 rounded-xl bg-card p-4">
      <label className="grid gap-1.5 text-xs text-text-muted">API 渠道
        <select value={channelId} onChange={event => { setChannelId(event.target.value); setOffset(0); }} className="min-w-56 rounded-lg bg-input px-3 py-2 text-sm text-text">
          {channels.length === 0 && <option value="">暂无渠道</option>}
          {channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name} · {channel.provider}</option>)}
        </select>
      </label>
      <label className="grid gap-1.5 text-xs text-text-muted">时间范围
        <select value={range} onChange={event => { setRange(event.target.value as Range); setOffset(0); }} className="min-w-44 rounded-lg bg-input px-3 py-2 text-sm text-text">
          {ranges.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      {selectedChannel && <span className={`mb-2 rounded-full px-2.5 py-1 text-xs ${selectedChannel.is_active ? "bg-emerald-500/10 text-emerald-300" : "bg-secondary text-text-muted"}`}>{selectedChannel.is_active ? "启用中" : "已停用"}</span>}
    </section>

    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-500/10 p-4 text-sm text-rose-300"><span>{error}</span><button type="button" onClick={() => void fetchBase()} className="rounded-lg bg-rose-500/10 px-3 py-1.5">重试</button></div>}
    {loading && <div className="rounded-xl bg-card p-6 text-sm text-text-muted">正在读取渠道和汇总…</div>}

    {!loading && !error && !selectedChannel && <div className="rounded-xl bg-card p-6 text-sm text-text-muted">尚无 API 渠道，添加渠道并产生调用后即可查看追踪数据。</div>}

    {!loading && selectedChannel && <>
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          ["总调用", summary?.calls ?? 0, "text-text"],
          ["成功率", summary?.successRate == null ? "—" : `${summary.successRate}%`, "text-emerald-300"],
          ["成功", summary?.successes ?? 0, "text-emerald-300"],
          ["失败", summary?.failures ?? 0, "text-rose-300"],
        ].map(([label, value, color]) => <div key={String(label)} className="rounded-xl bg-card p-4">
          <div className="text-xs text-text-muted">{label}</div><div className={`mt-2 text-2xl font-semibold ${color}`}>{value}</div>
        </div>)}
      </section>

      <section className="rounded-xl bg-card p-4 md:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold">调用结果分布</h2><span className="text-xs text-text-muted">{activeRange.label} · {summary?.calls ?? 0} 次</span></div>
        <div className="mt-4 space-y-3">
          {statuses.map(item => {
            const percent = summary?.calls ? Math.round(item.count * 100 / summary.calls) : 0;
            return <div key={item.key} className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-3 text-xs">
              <span className="text-text-secondary">{item.label}</span>
              <div className="h-2 overflow-hidden rounded-full bg-secondary"><div className={`h-full rounded-full ${statusColors[item.key]}`} style={{ width: `${percent}%` }} /></div>
              <span className={`text-right tabular-nums ${statusTextColors[item.key]}`}>{item.count} <span className="text-text-muted">({percent}%)</span></span>
            </div>;
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-text-muted">
          <span>平均延迟：{summary?.avgLatencyMs == null ? "暂无" : `${summary.avgLatencyMs} ms`}</span>
          <span>处理中与异常状态保留原始记录，不从总调用中隐藏。</span>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4">
          <div><h2 className="font-semibold">逐条调用记录</h2><p className="mt-1 text-xs text-text-muted">明细按发生时间倒序；记录编号和请求编号可用于进一步核对。</p></div>
          {page && <span className="text-xs text-text-muted">共 {page.total} 条</span>}
        </div>
        {pageError && <div role="alert" className="flex items-center justify-between gap-3 px-4 pb-4 text-sm text-rose-300"><span>{pageError}</span><button type="button" onClick={() => void fetchPage(offset)} className="rounded-lg bg-secondary px-3 py-1.5">重试</button></div>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-xs">
            <thead className="bg-secondary/70 text-text-muted"><tr>
              <th className="px-4 py-3 font-medium">发生时间（上海）</th><th className="px-4 py-3 font-medium">用户</th><th className="px-4 py-3 font-medium">模型</th><th className="px-4 py-3 font-medium">状态</th><th className="px-4 py-3 font-medium">请求路径 / HTTP</th><th className="px-4 py-3 font-medium">阶段 / 延迟</th><th className="px-4 py-3 font-medium">记录与请求编号</th>
            </tr></thead>
            <tbody>
              {page?.items.map(entry => <tr key={entry.id} className="align-top hover:bg-secondary/30">
                <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{timeText(entry.occurredAt)}<div className="mt-1 text-text-muted">完成：{timeText(entry.completedAt)}</div></td>
                <td className="max-w-48 break-all px-4 py-3 text-text-secondary">{entry.userEmail}</td>
                <td className="px-4 py-3 text-text-secondary">{entry.model || "未记录"}<div className="mt-1 text-text-muted">数量 {entry.quantity}</div></td>
                <td className={`whitespace-nowrap px-4 py-3 ${statusTextColors[entry.status]}`}>{statusText[entry.status]}</td>
                <td className="max-w-56 break-all px-4 py-3 text-text-secondary">{entry.targetPath || "未记录"}<div className="mt-1 text-text-muted">{entry.statusCode == null ? "无 HTTP 状态" : `HTTP ${entry.statusCode}`}</div></td>
                <td className="px-4 py-3 text-text-secondary">{entry.phase || "未记录"}<div className="mt-1 text-text-muted">{entry.latencyMs == null ? "无延迟数据" : `${entry.latencyMs} ms`}</div></td>
                <td className="max-w-64 break-all px-4 py-3 font-mono text-[10px] text-text-muted">记录 {entry.id}<div className="mt-1">请求 {entry.requestId || "无外部请求编号"}</div></td>
              </tr>)}
              {page && page.items.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-text-muted">所选渠道和时间范围没有调用记录。</td></tr>}
              {!page && !loadingPage && !pageError && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-text-muted">暂无可显示的记录。</td></tr>}
              {loadingPage && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-text-muted">正在读取调用记录…</td></tr>}
            </tbody>
          </table>
        </div>
        {page && page.total > PAGE_SIZE && <div className="flex items-center justify-between gap-3 p-4 text-xs text-text-muted">
          <span>{page.offset + 1}–{Math.min(page.offset + page.limit, page.total)} / {page.total}</span>
          <div className="flex gap-2"><button type="button" disabled={offset === 0 || loadingPage} onClick={() => void fetchPage(Math.max(0, offset - PAGE_SIZE))} className="rounded-lg bg-secondary px-3 py-2 disabled:opacity-40">上一页</button><button type="button" disabled={offset + PAGE_SIZE >= page.total || loadingPage} onClick={() => void fetchPage(offset + PAGE_SIZE)} className="rounded-lg bg-secondary px-3 py-2 disabled:opacity-40">下一页</button></div>
        </div>}
      </section>
    </>}
  </div>;
}
