import { useCallback, useEffect, useMemo, useState } from "react";
import { App } from "antd";
import { Check, ChevronDown, ChevronRight, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";

type Capability = "text" | "image" | "video" | "audio";
type ModelBinding = {
  id: string | number;
  channelId: string;
  channelName: string;
  provider: string;
  model: string;
  priority: number;
  isActive: boolean;
};
type CatalogModel = {
  id: number;
  modelId?: string | null;
  displayName: string;
  provider: string;
  capability: Capability;
  visible: boolean;
  sortOrder: number;
  linkedModels: ModelBinding[];
};
type ApiChannel = {
  id: string;
  name: string;
  provider: string;
  model: string;
  is_active: number;
};

const API = "/api/admin";
const capabilities: { value: Capability; label: string; color: string }[] = [
  { value: "text", label: "文本", color: "bg-emerald-500/15 text-emerald-300" },
  { value: "image", label: "图片", color: "bg-sky-500/15 text-sky-300" },
  { value: "video", label: "视频", color: "bg-purple-500/15 text-purple-300" },
  { value: "audio", label: "音频", color: "bg-amber-500/15 text-amber-300" },
];
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("admin_token") || ""}` });

export default function ModelCatalog() {
  const { message } = App.useApp();
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [channels, setChannels] = useState<ApiChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [capabilityFilter, setCapabilityFilter] = useState<Capability | "all">("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCapability, setAddCapability] = useState<Capability>("text");
  const [adding, setAdding] = useState(false);
  const [linkModelId, setLinkModelId] = useState<number | null>(null);
  const [linkProvider, setLinkProvider] = useState("全部");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ title: string; detail: string; run: () => Promise<void> } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [modelResponse, channelResponse] = await Promise.all([
        fetch(`${API}/models-catalog`, { headers: authHeaders() }),
        fetch(`${API}/api-keys`, { headers: authHeaders() }),
      ]);
      const [modelData, channelData] = await Promise.all([modelResponse.json(), channelResponse.json()]);
      if (!modelResponse.ok) throw new Error(modelData.error || `读取模型目录失败（HTTP ${modelResponse.status}）`);
      if (!channelResponse.ok) throw new Error(channelData.error || `读取 API 渠道失败（HTTP ${channelResponse.status}）`);
      setModels(Array.isArray(modelData) ? modelData.map(model => ({ ...model, linkedModels: Array.isArray(model.linkedModels) ? model.linkedModels : [] })) : []);
      setChannels(Array.isArray(channelData) ? channelData : []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "读取模型目录失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredModels = useMemo(() => models.filter(model =>
    (capabilityFilter === "all" || model.capability === capabilityFilter)
      && (!query.trim() || model.displayName.toLowerCase().includes(query.trim().toLowerCase()))
  ), [models, capabilityFilter, query]);

  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `操作失败（HTTP ${response.status}）`);
    return data;
  };

  const addModel = async () => {
    if (!addName.trim()) { message.error("请输入显示名称"); return; }
    setAdding(true);
    try {
      await request("/models-catalog", { method: "POST", body: JSON.stringify({ displayName: addName.trim(), capability: addCapability }) });
      setAddOpen(false);
      setAddName("");
      setAddCapability("text");
      message.success("模型已添加到目录");
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "添加模型失败");
    } finally { setAdding(false); }
  };

  const updateModel = async (id: number, patch: Partial<Pick<CatalogModel, "displayName" | "capability" | "visible" | "sortOrder">>, successText: string) => {
    setBusyKey(`model:${id}`);
    try {
      await request(`/models-catalog/${id}`, { method: "PUT", body: JSON.stringify(patch) });
      message.success(successText);
      setEditingId(null);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存模型失败");
    } finally { setBusyKey(null); }
  };

  const addBinding = async (model: CatalogModel, channel: ApiChannel, upstreamModelId: string) => {
    const busy = `link:${model.id}:${channel.id}:${upstreamModelId}`;
    setBusyKey(busy);
    try {
      await request(`/models-catalog/${model.id}/channels`, { method: "POST", body: JSON.stringify({ channelId: channel.id, upstreamModelId }) });
      message.success("渠道模型已关联");
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "关联渠道模型失败");
    } finally { setBusyKey(null); }
  };

  const removeBinding = async (model: CatalogModel, binding: ModelBinding) => {
    setBusyKey(`unlink:${binding.id}`);
    try {
      await request(`/models-catalog/${model.id}/channels/${binding.id}`, { method: "DELETE" });
      message.success("渠道模型关联已移除");
      setConfirmAction(null);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "移除关联失败");
    } finally { setBusyKey(null); }
  };

  const removeModel = async (model: CatalogModel) => {
    setBusyKey(`model:${model.id}`);
    try {
      await request(`/models-catalog/${model.id}`, { method: "DELETE" });
      message.success("模型已从目录删除");
      setConfirmAction(null);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除模型失败");
    } finally { setBusyKey(null); }
  };

  const providerNames = Array.from(new Set(channels.map(channel => channel.provider || "其他")));
  const availableLinks = (model: CatalogModel) => channels
    .filter(channel => channel.is_active === 1 && (linkProvider === "全部" || channel.provider === linkProvider))
    .flatMap(channel => [...new Set((channel.model || "").split(",").map(name => name.trim()).filter(Boolean))]
      .filter(name => !model.linkedModels.some(link => String(link.channelId) === String(channel.id) && link.model === name))
      .map(name => ({ channel, name })));

  return <div className="space-y-5 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-semibold text-text">模型目录</h2><p className="mt-1 text-sm text-text-muted">维护用户看到的模型名称和能力，再关联已配置渠道中的真实模型。</p></div>
      <div className="flex gap-2">
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-text-secondary disabled:opacity-50"><RefreshCw size={15} className={loading ? "animate-spin" : ""} />刷新</button>
        <button type="button" onClick={() => setAddOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-white"><Plus size={16} />添加目录模型</button>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <div className="rounded-xl bg-card p-4"><div className="text-xs text-text-muted">目录模型</div><div className="mt-2 text-2xl font-semibold text-text">{models.length}</div></div>
      <div className="rounded-xl bg-card p-4"><div className="text-xs text-text-muted">前台可见</div><div className="mt-2 text-2xl font-semibold text-emerald-300">{models.filter(model => model.visible).length}</div></div>
      <div className="rounded-xl bg-card p-4"><div className="text-xs text-text-muted">已绑定渠道模型</div><div className="mt-2 text-2xl font-semibold text-sky-300">{models.reduce((count, model) => count + model.linkedModels.filter(link => link.isActive).length, 0)}</div></div>
      <div className="rounded-xl bg-card p-4"><div className="text-xs text-text-muted">待配置目录</div><div className="mt-2 text-2xl font-semibold text-amber-300">{models.filter(model => model.linkedModels.filter(link => link.isActive).length === 0).length}</div></div>
    </div>

    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-card p-3">
      {(["all", ...capabilities.map(item => item.value)] as const).map(value => <button key={value} type="button" onClick={() => setCapabilityFilter(value)} className={`rounded-lg px-3 py-1.5 text-xs ${capabilityFilter === value ? "bg-accent text-white" : "bg-secondary text-text-muted"}`}>{value === "all" ? "全部" : capabilities.find(item => item.value === value)?.label}</button>)}
      <label className="ml-auto flex min-w-48 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-text-muted"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索模型名称" className="w-full bg-transparent text-text outline-none" /></label>
    </div>

    {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-500/10 p-4 text-sm text-rose-300"><span>{loadError}</span><button type="button" onClick={() => void load()} className="rounded-lg bg-secondary px-3 py-1.5">重试</button></div>}
    {loading && <div className="rounded-xl bg-card p-8 text-center text-sm text-text-muted">正在读取模型目录和渠道…</div>}
    {!loading && !loadError && filteredModels.length === 0 && <div className="rounded-xl bg-card p-8 text-center text-sm text-text-muted">没有符合条件的模型。添加目录模型后，再关联渠道中的实际模型。</div>}

    {!loading && !loadError && <div className="space-y-3">
      {filteredModels.map(model => {
        const cap = capabilities.find(item => item.value === model.capability) || capabilities[0];
        const isExpanded = expanded === model.id;
        const links = availableLinks(model);
        return <section key={model.id} className="overflow-hidden rounded-xl bg-card">
          <div className="flex flex-wrap items-center gap-3 p-4">
            <button type="button" aria-label={isExpanded ? "收起渠道模型" : "展开渠道模型"} onClick={() => setExpanded(isExpanded ? null : model.id)} className="text-text-muted">{isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button>
            <span className={`rounded-md px-2 py-1 text-xs ${cap.color}`}>{cap.label}</span>
            <div className="min-w-36 flex-1">
              {editingId === model.id ? <input value={editingName} onChange={event => setEditingName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void updateModel(model.id, { displayName: editingName.trim() }, "显示名称已保存"); if (event.key === "Escape") setEditingId(null); }} className="w-full rounded-lg bg-secondary px-2 py-1.5 text-sm text-text outline-none" autoFocus /> : <div className="font-medium text-text">{model.displayName}</div>}
              <div className="mt-1 text-xs text-text-muted">{model.linkedModels.filter(link => link.isActive).length} 个可用渠道模型</div>
            </div>
            {editingId === model.id ? <div className="flex gap-1"><button type="button" onClick={() => void updateModel(model.id, { displayName: editingName.trim() }, "显示名称已保存")} disabled={busyKey === `model:${model.id}`} className="rounded-lg bg-emerald-500/10 p-2 text-emerald-300"><Check size={16} /></button><button type="button" onClick={() => setEditingId(null)} className="rounded-lg bg-secondary p-2 text-text-muted"><X size={16} /></button></div> : <button type="button" onClick={() => { setEditingId(model.id); setEditingName(model.displayName); }} className="rounded-lg bg-secondary px-3 py-2 text-xs text-text-secondary">改名称</button>}
            <button type="button" onClick={() => setConfirmAction({ title: model.visible ? "关闭目录模型" : "开启目录模型", detail: model.visible ? `关闭后，用户将不能再选择“${model.displayName}”。` : `开启后，用户可以选择“${model.displayName}”。`, run: async () => { await updateModel(model.id, { visible: !model.visible }, model.visible ? "模型已关闭" : "模型已开启"); setConfirmAction(null); } })} className={`rounded-lg px-3 py-2 text-xs ${model.visible ? "bg-emerald-500/10 text-emerald-300" : "bg-secondary text-text-muted"}`}>{model.visible ? "前台可见" : "已隐藏"}</button>
            <button type="button" onClick={() => setConfirmAction({ title: "删除目录模型", detail: `删除“${model.displayName}”也会移除它的渠道关联。`, run: async () => removeModel(model) })} className="rounded-lg bg-rose-500/10 p-2 text-rose-300"><Trash2 size={15} /></button>
          </div>

          {isExpanded && <div className="space-y-3 bg-secondary/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-medium text-text">关联渠道模型</h3><p className="mt-1 text-xs text-text-muted">新调用会在可用绑定之间轮换；结果未知时不会自动重发。</p></div><button type="button" onClick={() => { setLinkModelId(model.id); setLinkProvider("全部"); }} disabled={!channels.some(channel => channel.is_active === 1 && (channel.model || "").trim())} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs text-white disabled:opacity-40"><Plus size={14} />添加渠道模型</button></div>
            {model.linkedModels.length === 0 && <p className="rounded-lg bg-card px-3 py-4 text-xs text-text-muted">尚未关联渠道模型。关联后，该逻辑模型才会出现在用户的模型选择器中。</p>}
            {model.linkedModels.map(binding => <div key={binding.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-card px-3 py-2.5 text-xs">
              <span className={`h-2 w-2 rounded-full ${binding.isActive ? "bg-emerald-400" : "bg-gray-500"}`} />
              <span className="text-text-secondary">{binding.channelName || "已删除渠道"}</span><span className="rounded bg-secondary px-2 py-1 text-text-muted">{binding.provider}</span><span className="min-w-32 flex-1 break-all font-mono text-text">{binding.model}</span><span className="text-text-muted">优先级 {binding.priority}</span>
              <button type="button" onClick={() => setConfirmAction({ title: "移除渠道关联", detail: `移除“${binding.channelName} / ${binding.model}”后，新调用不再使用这条渠道模型。`, run: async () => removeBinding(model, binding) })} className="rounded-lg bg-rose-500/10 p-2 text-rose-300"><X size={14} /></button>
            </div>)}
          </div>}

          {linkModelId === model.id && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setLinkModelId(null)}>
            <div className="w-full max-w-xl rounded-2xl bg-card p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
              <div className="flex items-center justify-between"><div><h3 className="font-semibold text-text">为“{model.displayName}”选择渠道模型</h3><p className="mt-1 text-xs text-text-muted">只显示已配置渠道中的模型；同一目录下的渠道请求协议需一致。</p></div><button type="button" onClick={() => setLinkModelId(null)} className="rounded-lg bg-secondary p-2 text-text-muted"><X size={16} /></button></div>
              <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => setLinkProvider("全部")} className={`rounded-lg px-3 py-1.5 text-xs ${linkProvider === "全部" ? "bg-accent text-white" : "bg-secondary text-text-muted"}`}>全部</button>{providerNames.map(provider => <button key={provider} type="button" onClick={() => setLinkProvider(provider)} className={`rounded-lg px-3 py-1.5 text-xs ${linkProvider === provider ? "bg-accent text-white" : "bg-secondary text-text-muted"}`}>{provider}</button>)}</div>
              <div className="mt-3 max-h-[55vh] space-y-2 overflow-y-auto">
                {links.map(({ channel, name }) => { const busy = busyKey === `link:${model.id}:${channel.id}:${name}`; return <button key={`${channel.id}:${name}`} type="button" disabled={busy} onClick={() => void addBinding(model, channel, name)} className="flex w-full items-center justify-between gap-3 rounded-lg bg-secondary px-3 py-3 text-left text-sm text-text-secondary hover:bg-accent/10 disabled:opacity-50"><span className="min-w-0"><span className="block truncate">{channel.name} · {channel.provider}</span><span className="mt-1 block break-all font-mono text-xs text-text-muted">{name}</span></span><Plus size={15} className="shrink-0 text-text-muted" /></button>; })}
                {links.length === 0 && <div className="rounded-lg bg-secondary p-6 text-center text-sm text-text-muted">没有可添加的模型。请先在 API 渠道配置中填写模型列表，或检查所选供应商类别。</div>}
              </div>
            </div>
          </div>}
        </section>;
      })}
    </div>}

    {addOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setAddOpen(false)}><div className="w-full max-w-md rounded-2xl bg-card p-5" onClick={event => event.stopPropagation()}>
      <h3 className="font-semibold text-text">添加目录模型</h3><p className="mt-1 text-xs text-text-muted">模型编号由系统管理；添加后再关联一个或多个渠道中的真实模型。</p>
      <label className="mt-4 block text-xs text-text-muted">显示名称<input value={addName} onChange={event => setAddName(event.target.value)} placeholder="例如：快速生图" className="mt-1.5 w-full rounded-lg bg-secondary px-3 py-2.5 text-sm text-text outline-none" autoFocus /></label>
      <label className="mt-3 block text-xs text-text-muted">模型能力<select value={addCapability} onChange={event => setAddCapability(event.target.value as Capability)} className="mt-1.5 w-full rounded-lg bg-secondary px-3 py-2.5 text-sm text-text">{capabilities.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setAddOpen(false)} className="rounded-lg bg-secondary px-4 py-2 text-sm text-text-secondary">取消</button><button type="button" onClick={() => void addModel()} disabled={adding} className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-50">{adding ? "添加中…" : "添加目录模型"}</button></div>
    </div></div>}

    {confirmAction && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={() => setConfirmAction(null)}><div className="w-full max-w-sm rounded-2xl bg-card p-5" onClick={event => event.stopPropagation()}>
      <h3 className="font-semibold text-text">{confirmAction.title}</h3><p className="mt-2 text-sm text-text-muted">{confirmAction.detail}</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setConfirmAction(null)} className="rounded-lg bg-secondary px-4 py-2 text-sm text-text-secondary">取消</button><button type="button" onClick={() => void confirmAction.run()} className="rounded-lg bg-rose-500/15 px-4 py-2 text-sm text-rose-300">确认</button></div>
    </div></div>}
  </div>;
}
