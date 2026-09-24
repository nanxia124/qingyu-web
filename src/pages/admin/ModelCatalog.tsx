import { useState, useRef, useEffect } from "react";
import { Pencil, Check, X, Upload, ChevronDown, Plus } from "lucide-react";

interface CatalogModel {
  id: number;
  modelId: string;
  displayName: string;
  provider: string;
  avatar: string;
  capability: "image" | "video" | "text" | "audio";
  visible: boolean;
  sortOrder: number;
  linkedModels: string[];
}

const MOCK_MODELS: CatalogModel[] = [
  { id: 1, modelId: "gpt-4o", displayName: "GPT-4o", provider: "OpenAI", avatar: "", capability: "text", visible: true, sortOrder: 1, linkedModels: ["gpt-4o", "gpt-4o-2024-08-06"] },
  { id: 2, modelId: "gpt-image-1", displayName: "GPT Image 1", provider: "OpenAI", avatar: "", capability: "image", visible: true, sortOrder: 2, linkedModels: ["gpt-image-1"] },
  { id: 3, modelId: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", provider: "Google", avatar: "", capability: "text", visible: true, sortOrder: 3, linkedModels: ["gemini-2.5-pro", "gemini-pro-latest", "gemini-2.5-pro-exp"] },
  { id: 4, modelId: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", provider: "Google", avatar: "", capability: "text", visible: true, sortOrder: 4, linkedModels: ["gemini-2.5-flash"] },
  { id: 5, modelId: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5", provider: "Anthropic", avatar: "", capability: "text", visible: false, sortOrder: 5, linkedModels: [] },
  { id: 6, modelId: "sora-2", displayName: "Sora 2", provider: "OpenAI", avatar: "", capability: "video", visible: false, sortOrder: 6, linkedModels: ["sora-2"] },
];

const MOCK_STATS: Record<string, { todayCalls: number; weekCalls: number; totalCalls: number; totalSuccess: number; totalFail: number; avgLatency7d: number }> = {
  "gpt-4o": { todayCalls: 128, weekCalls: 892, totalCalls: 12847, totalSuccess: 12543, totalFail: 304, avgLatency7d: 1230 },
  "gpt-4o-2024-08-06": { todayCalls: 56, weekCalls: 401, totalCalls: 5621, totalSuccess: 5580, totalFail: 41, avgLatency7d: 980 },
  "gpt-image-1": { todayCalls: 34, weekCalls: 215, totalCalls: 3420, totalSuccess: 3380, totalFail: 40, avgLatency7d: 2400 },
  "gemini-2.5-pro": { todayCalls: 210, weekCalls: 1500, totalCalls: 21000, totalSuccess: 20580, totalFail: 420, avgLatency7d: 890 },
  "gemini-pro-latest": { todayCalls: 89, weekCalls: 620, totalCalls: 8900, totalSuccess: 8760, totalFail: 140, avgLatency7d: 760 },
  "gemini-2.5-pro-exp": { todayCalls: 12, weekCalls: 80, totalCalls: 1200, totalSuccess: 1100, totalFail: 100, avgLatency7d: 1500 },
  "gemini-2.5-flash": { todayCalls: 450, weekCalls: 3200, totalCalls: 45000, totalSuccess: 44550, totalFail: 450, avgLatency7d: 320 },
  "sora-2": { todayCalls: 5, weekCalls: 32, totalCalls: 500, totalSuccess: 480, totalFail: 20, avgLatency7d: 8500 },
};

const CAP_TABS = ["全部", "图片", "视频", "文本", "音频"] as const;

const CAP_ORDER: Array<{ key: CatalogModel["capability"]; label: string; dot: string; badge: string }> = [
  { key: "text", label: "文本", dot: "bg-emerald-400", badge: "bg-emerald-500/15 text-emerald-300" },
  { key: "image", label: "图片", dot: "bg-sky-400", badge: "bg-sky-500/15 text-sky-300" },
  { key: "video", label: "视频", dot: "bg-purple-400", badge: "bg-purple-500/15 text-purple-300" },
  { key: "audio", label: "音频", dot: "bg-amber-400", badge: "bg-amber-500/15 text-amber-300" },
];

const ALL_AVAILABLE_MODELS: Array<{ id: string; provider: string }> = [
  { id: "gpt-4o", provider: "OpenAI" },
  { id: "gpt-4o-2024-08-06", provider: "OpenAI" },
  { id: "gpt-4o-mini", provider: "OpenAI" },
  { id: "gpt-image-1", provider: "OpenAI" },
  { id: "gpt-4-turbo", provider: "OpenAI" },
  { id: "gpt-3.5-turbo", provider: "OpenAI" },
  { id: "dall-e-3", provider: "OpenAI" },
  { id: "sora-2", provider: "OpenAI" },
  { id: "gemini-2.5-pro", provider: "Google" },
  { id: "gemini-2.5-pro-exp", provider: "Google" },
  { id: "gemini-2.5-flash", provider: "Google" },
  { id: "gemini-pro-latest", provider: "Google" },
  { id: "claude-sonnet-4-5", provider: "Anthropic" },
  { id: "claude-opus-4", provider: "Anthropic" },
  { id: "claude-3-5-sonnet", provider: "Anthropic" },
  { id: "midjourney-v6", provider: "Midjourney" },
];

const ALL_PROVIDERS = ["全部", "OpenAI", "Google", "Anthropic", "Midjourney"];

const PROVIDER_AVATAR: Record<string, { bg: string; text: string }> = {
  "OpenAI": { bg: "#10A37F", text: "O" },
  "Google": { bg: "#4285F4", text: "G" },
  "Anthropic": { bg: "#D97757", text: "A" },
  "Midjourney": { bg: "#7C3AED", text: "M" },
};

function getDefaultAvatar(provider: string) {
  return PROVIDER_AVATAR[provider] || { bg: "#6B7280", text: "?" };
}

export default function ModelCatalog() {
  const [models, setModels] = useState<CatalogModel[]>([]);

  useEffect(() => {
    fetch("/api/admin/models-catalog", {
      headers: { Authorization: `Bearer ${localStorage.getItem("admin_token") || ""}` },
    })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setModels(data);
      })
      .catch(e => console.error("加载模型目录失败:", e));
  }, []);
  const [capTab, setCapTab] = useState<string>("全部");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedAll, setExpandedAll] = useState(false);
  const [sortMode, setSortMode] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const [pickChannelId, setPickChannelId] = useState<number | null>(null);
  const [pickProvider, setPickProvider] = useState<string>("全部");
  const [editingNameId, setEditingNameId] = useState<number | null>(null);
  const [editingNameValue, setEditingNameValue] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [callDetail, setCallDetail] = useState<{ model: string; type: string } | null>(null);
  const [callStatusFilter, setCallStatusFilter] = useState<"全部" | "成功" | "失败">("全部");
  const [callTimeFilter, setCallTimeFilter] = useState<"今天" | "近7天" | "自定义">("今天");
  const [toast, setToast] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({ modelId: "", displayName: "", capability: "text" as "text" | "image" | "video" | "audio" });
  const [adding, setAdding] = useState(false);

  const handleAddModel = async () => {
    if (!addForm.displayName.trim()) {
      alert("请输入显示名称");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/admin/models-catalog", {
      const res = await fetch("/api/admin/models-catalog", {
        method: "POST",
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("admin_token") || ""}`,
        },
        body: JSON.stringify({ ...addForm, modelId: addForm.modelId.trim() || addForm.displayName.trim() || `model-${Date.now()}` }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "添加失败");
        return;
      }
      setModels(prev => [...prev, data]);
      setShowAddDialog(false);
      setAddForm({ modelId: "", displayName: "", capability: "text" });
    } catch (e: any) {
      alert(e.message);
    } finally {
      setAdding(false);
    }
  };

  const groups = capTab === "全部" ? CAP_ORDER : CAP_ORDER.filter(g => g.label === capTab);

  const toggleExpand = (id: number) => {
    setExpandedAll(false);
    setExpandedId(expandedId === id ? null : id);
  };

  const toggleExpandAll = () => {
    if (expandedAll) { setExpandedAll(false); setExpandedId(null); }
    else { setExpandedAll(true); setExpandedId(null); }
  };

  const toggleVisible = (id: number) => {
    const model = models.find(m => m.id === id);
    if (!model) return;
    setConfirmDialog({
      title: model.visible ? "关闭模型" : "开启模型",
      message: `确定${model.visible ? "关闭" : "开启"}模型 "${model.displayName}"？${model.visible ? "前台将不再显示此模型" : "前台将显示此模型"}`,
      onConfirm: () => {
        setModels(prev => prev.map(m => m.id === id ? { ...m, visible: !m.visible } : m));
        setConfirmDialog(null);
        showToast(model.visible ? "模型已关闭" : "模型已开启");
      },
    });
  };

  const handleDelete = (id: number) => {
    const model = models.find(m => m.id === id);
    if (!model) return;
    setConfirmDialog({
      title: "删除模型",
      message: `确定删除模型 "${model.displayName}"？此操作不可恢复。`,
      onConfirm: () => {
        setModels(prev => prev.filter(m => m.id !== id));
        setConfirmDialog(null);
      },
    });
  };

  const removeLinked = (modelId: number, linked: string) => {
    setConfirmDialog({
      title: "移除渠道模型",
      message: `确定移除渠道模型 "${linked}"？`,
      onConfirm: () => {
        setModels(prev => prev.map(m => m.id === modelId ? { ...m, linkedModels: m.linkedModels.filter(l => l !== linked) } : m));
        setConfirmDialog(null);
      },
    });
  };

  const startEditName = (m: CatalogModel) => {
    setConfirmDialog({
      title: "修改模型名称",
      message: `Confirm rename model "${m.displayName}"?`,
      onConfirm: () => {
        setEditingNameId(m.id);
        setEditingNameValue(m.displayName);
        setTimeout(() => nameInputRef.current?.focus(), 0);
        setConfirmDialog(null);
      }
    });
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const saveEditName = () => {
    if (editingNameValue.trim()) {
      setModels(prev => prev.map(m => m.id === editingNameId ? { ...m, displayName: editingNameValue.trim() } : m));
      showToast("修改成功");
    }
    setEditingNameId(null);
  };

  const cancelEditName = () => {
    setEditingNameId(null);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>, modelId: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setModels(prev => prev.map(m => m.id === modelId ? { ...m, avatar: reader.result as string } : m));
    };
    reader.readAsDataURL(file);
  };

  return (
    <div>

      {/* 顶部总览 */}
      <div className="mb-4 grid grid-cols-5 gap-3">
        <div className="rounded-xl bg-card px-4 py-3">
          <div className="text-[10px] text-gray-500">今日总调用</div>
          <div className="text-xl text-white font-medium">-</div>
        </div>
        <div className="rounded-xl bg-card px-4 py-3">
          <div className="text-[10px] text-gray-500">今日消耗 Token</div>
          <div className="text-xl text-white font-medium">-</div>
        </div>
        <div className="rounded-xl bg-card px-4 py-3">
          <div className="text-[10px] text-gray-500">今日总费用</div>
          <div className="text-xl text-emerald-400 font-medium">-</div>
        </div>
        <div className="rounded-xl bg-card px-4 py-3">
          <div className="text-[10px] text-gray-500">整体成功率</div>
          <div className="text-xl text-white font-medium">-</div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-secondary p-1">
          {CAP_TABS.map(t => (
            <button key={t} onClick={() => setCapTab(t)}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${capTab === t ? "bg-[#5051F8] text-white" : "text-gray-500 hover:text-gray-300"}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setSortMode(!sortMode)} className={`rounded-lg px-3 py-2 text-sm transition-colors ${sortMode ? "bg-[#5051F8] text-white" : "bg-secondary text-gray-500 hover:bg-border"}`}>
            {sortMode ? "完成排序" : "排序"}
          </button>
          <button onClick={toggleExpandAll} className="rounded-lg bg-secondary px-3 py-2 text-sm text-gray-500 hover:bg-border">
            {expandedAll ? "折叠全部" : "展开全部"}
          </button>
          <button className="rounded-lg bg-secondary px-3 py-2 text-sm text-gray-500 hover:bg-border">批量导入</button>
          <button onClick={() => setShowAddDialog(true)} className="rounded-lg bg-[#5051F8] px-4 py-2 text-sm text-white hover:bg-accent-hover">
            + 添加模型
          </button>
        </div>
      </div>

      {models.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-500">该分类下没有模型</p>
      ) : (
        <div className="space-y-6">
          {groups.map(g => {
            const capModels = models.filter(m => m.capability === g.key);
            if (capModels.length === 0) return null;
            return (
              <div key={g.key}>
                <div className="mb-2 flex items-center gap-2 px-1">
                  <span className={`h-2 w-2 rounded-full ${g.dot}`} />
                  <h3 className="text-sm font-medium text-gray-300">{g.label}模型</h3>
                  <span className="text-xs text-gray-600">({capModels.length})</span>
                </div>
                <div className="space-y-2">
                  {capModels.map((m) => {
                    const isExpanded = expandedAll || expandedId === m.id;
                    const isEditingName = editingNameId === m.id;
                    return (
                      <div key={m.id} className={`rounded-xl bg-card transition-colors ${sortMode ? "opacity-80" : "hover:bg-surface-hover"}`}>
                        <div
                          className="grid grid-cols-12 items-center gap-3 px-4 py-3 cursor-pointer"
                          onClick={() => { if (!sortMode) toggleExpand(m.id); }}
                        >
                          <div className="col-span-6 flex items-center gap-3">
                            <div className="relative shrink-0 cursor-pointer group" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                              {m.avatar ? (
                                <img src={m.avatar} alt="" className="h-6 w-6 rounded-full object-cover" />
                              ) : (
                                <div className="flex h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: getDefaultAvatar(m.provider).bg }}>
                                  <span className="text-[10px] font-bold text-white">{getDefaultAvatar(m.provider).text}</span>
                                </div>
                              )}
                              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Upload size={10} className="text-white" />
                              </div>
                              <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                                onChange={(e) => handleAvatarUpload(e, m.id)} />
                            </div>
                            {isEditingName ? (
                              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <input ref={nameInputRef} value={editingNameValue}
                                  onChange={e => setEditingNameValue(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter") saveEditName(); if (e.key === "Escape") cancelEditName(); }}
                                  className="rounded-md bg-secondary px-2 py-1 text-sm text-white outline-none w-36" />
                                <button onClick={saveEditName} className="rounded p-1 text-emerald-400 hover:bg-emerald-500/10"><Check size={14} /></button>
                                <button onClick={cancelEditName} className="rounded p-1 text-gray-500 hover:bg-secondary"><X size={14} /></button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 group">
                                <span className="text-sm font-medium text-white">{m.displayName || m.modelId}</span>
                                <button onClick={(e) => { e.stopPropagation(); startEditName(m); }} className="rounded p-0.5 text-gray-600 opacity-0 group-hover:opacity-100 hover:bg-secondary hover:text-gray-400 transition-opacity" title="修改展示名"><Pencil size={12} /></button>
                              </div>
                            )}
                          </div>
                          <div className="col-span-4 flex items-center gap-3">
                            <span className={`rounded px-2 py-0.5 text-xs ${g.badge}`}>{g.label}</span>
                            <span className="text-xs text-gray-500">{m.linkedModels.length} 个渠道</span>
                            {m.linkedModels.length > 0 && (
                              <span className="flex items-center gap-1 text-xs text-emerald-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                {m.linkedModels.length}/{m.linkedModels.length} 可用
                              </span>
                            )}
                            <span className="text-xs text-gray-500">今日 ${(Math.random() * 20 + 2).toFixed(2)}</span>
                          </div>
                          <div className="col-span-2 flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => toggleVisible(m.id)}
                              className={`relative h-5 w-9 rounded-full transition-colors ${m.visible ? "bg-[#5051F8]" : "bg-gray-600"}`}>
                              <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
                                style={{ left: m.visible ? "1.125rem" : "0.125rem" }} />
                            </button>
                            <button onClick={() => handleDelete(m.id)} className="text-xs text-red-400/70 hover:text-red-400">删除</button>
                            <ChevronDown size={16} className="text-gray-600 transition-transform"
                              style={{ transform: isExpanded ? "rotate(180deg)" : "none" }} />
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="px-4 pb-4 pt-0 ml-9">
                            <div className="text-xs text-gray-500 mb-2">关联的中转站模型（前台请求时自动轮询/故障转移）</div>
                            <div className="space-y-1.5">
                              {m.linkedModels.length === 0 && (
                                <p className="text-xs text-gray-600 py-2">还没有关联渠道模型，点下面 + 添加</p>
                              )}
                              {m.linkedModels.map(linked => {
                                const st = MOCK_STATS[linked] || { todayCalls: 0, weekCalls: 0, totalCalls: 0, totalSuccess: 0, totalFail: 0, avgLatency7d: 0 };
                                const successRate = st.totalCalls > 0 ? ((st.totalSuccess / st.totalCalls) * 100).toFixed(1) : "0";
                                const failRate = st.totalCalls > 0 ? ((st.totalFail / st.totalCalls) * 100).toFixed(1) : "0";
                                return (
                                  <div key={linked} className="rounded-lg bg-secondary p-3">
                                    <div className="flex items-center gap-4">
                                      {/* 左边：模型名 + 余额 */}
                                      <div className="w-56 shrink-0">
                                        <span className="text-base text-gray-200 font-mono font-medium">{linked}</span>
                                        <div className="text-[10px] text-gray-500 mt-0.5">余额 ${(Math.random() * 50 + 5).toFixed(2)} · 今日 {Math.floor(Math.random() * 500 + 50)}K tokens</div>
                                      </div>
                                      {/* 中间：统计数据 */}
                                      <div className="flex items-center gap-4 flex-1">
                                        <div onClick={() => setCallDetail({ model: linked, type: "今日调用" })} className="cursor-pointer hover:opacity-80"><div className="text-[10px] text-gray-500">今日调用</div><div className="text-base text-gray-200">{st.todayCalls}</div></div>
                                        <div onClick={() => setCallDetail({ model: linked, type: "7日调用" })} className="cursor-pointer hover:opacity-80"><div className="text-[10px] text-gray-500">7日调用</div><div className="text-base text-gray-200">{st.weekCalls}</div></div>
                                        <div><div className="text-[10px] text-gray-500">总调用</div><div className="text-base text-gray-200">{st.totalCalls}</div></div>
                                        <div><div className="text-[10px] text-gray-500">平均耗时</div><div className="text-base text-gray-200">{st.avgLatency7d}ms</div></div>
                                        <div><div className="text-[10px] text-gray-500">成功</div><div className="text-base text-emerald-400">{st.totalSuccess}</div></div>
                                        <div><div className="text-[10px] text-gray-500">失败</div><div className="text-base text-red-400">{st.totalFail}</div></div>
                                        <div><div className="text-[10px] text-gray-500">成功率</div><div className="text-base text-emerald-400">{successRate}%</div></div>
                                        <div><div className="text-[10px] text-gray-500">失败率</div><div className="text-base text-red-400">{failRate}%</div></div>
                                      </div>
                                      {/* 最右边：删除按钮 */}
                                      <button onClick={() => removeLinked(m.id, linked)} className="text-gray-600 hover:text-red-400 shrink-0">
                                        <X size={14} />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                              <button onClick={() => setPickChannelId(m.id)}
                                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-gray-500 hover:text-gray-300 w-fit">
                                <Plus size={12} /> 添加渠道模型
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pickChannelId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => { setPickChannelId(null); setPickProvider("全部"); }}>
          <div className="w-full max-w-2xl rounded-xl bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-semibold text-white">添加渠道模型</h3>
              <button onClick={() => { setPickChannelId(null); setPickProvider("全部"); }} className="text-gray-500 hover:text-gray-300">
                <X size={18} />
              </button>
            </div>
            <p className="mb-3 text-xs text-gray-500">从已配置的 API 渠道中选择要挂到这个模型下的模型</p>
            <div className="mb-3 flex gap-2 flex-wrap">
              {ALL_PROVIDERS.filter(p => p !== "全部").map(p => (
                <button key={p}
                  onClick={() => setPickProvider(p)}
                  className={`rounded-lg px-3 py-1 text-xs transition-colors ${pickProvider === p ? "bg-[#5051F8] text-white" : "bg-secondary text-gray-500 hover:text-gray-300"}`}>
                  {p}
                </button>
              ))}
            </div>
            <div className="h-[34rem] overflow-y-auto space-y-4 pr-1">
              {(pickProvider === "全部" ? ALL_PROVIDERS.slice(1) : [pickProvider]).map(pv => {
                const list = ALL_AVAILABLE_MODELS
                  .filter(m => m.provider === pv)
                  .filter(m => !models.find(x => x.id === pickChannelId)?.linkedModels.includes(m.id));
                if (list.length === 0) return null;
                return (
                  <div key={pv}>
                    <div className="mb-1.5 px-1 text-xs font-medium text-gray-500">{pv}</div>
                    <div className="space-y-1.5">
                      {list.map(m => (
                        <button key={m.id}
                          onClick={() => {
                            setModels(prev => prev.map(x => x.id === pickChannelId ? { ...x, linkedModels: [...x.linkedModels, m.id] } : x));
                          }}
                          className="w-full flex items-center justify-between rounded-lg bg-secondary px-4 py-2.5 text-sm text-gray-200 hover:bg-[#5051F8]/10 transition-colors">
                          <span className="font-mono">{m.id}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={() => { setPickChannelId(null); setPickProvider("全部"); }} className="rounded-lg bg-secondary px-4 py-2 text-sm text-gray-400 hover:bg-border">完成</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast 提示 */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] rounded-lg bg-emerald-500 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      {/* 调用详情弹窗 */}
      {callDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setCallDetail(null)}>
          <div className="w-full max-w-5xl rounded-xl bg-card p-6 shadow-2xl max-h-[98vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-white">{callDetail.type} - {callDetail.model}</h3>
              <div className="flex items-center gap-2">
                <button onClick={() => showToast("导出中...")} className="rounded-lg bg-secondary px-3 py-1.5 text-xs text-gray-400 hover:bg-border">导出 CSV</button>
                <button onClick={() => setCallDetail(null)} className="text-gray-500 hover:text-gray-300">
                  <X size={18} />
                </button>
              </div>
            </div>
            {/* 小统计 */}
            <div className="flex gap-4 mb-4 text-xs">
              <span className="text-gray-500">总调用 <span className="text-white font-medium">128</span></span>
              <span className="text-gray-500">成功率 <span className="text-emerald-400 font-medium">97.6%</span></span>
              <span className="text-gray-500">总费用 <span className="text-white font-medium">$0.32</span></span>
            </div>
            {/* 筛选栏 */}
            <div className="flex items-center gap-2 mb-3">
              <div className="flex gap-1 rounded-lg bg-secondary p-1">
                {(["全部", "成功", "失败"] as const).map(s => (
                  <button key={s} onClick={() => setCallStatusFilter(s)}
                    className={`rounded-md px-3 py-1 text-xs ${callStatusFilter === s ? "bg-[#5051F8] text-white" : "text-gray-500 hover:text-gray-300"}`}>
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex gap-1 rounded-lg bg-secondary p-1">
                {(["今天", "近7天", "自定义"] as const).map(t => (
                  <button key={t} onClick={() => setCallTimeFilter(t)}
                    className={`rounded-md px-3 py-1 text-xs ${callTimeFilter === t ? "bg-[#5051F8] text-white" : "text-gray-500 hover:text-gray-300"}`}>
                    {t}
                  </button>
                ))}
              </div>
              <input type="text" placeholder="搜索 IP..." className="ml-auto rounded-lg bg-secondary px-3 py-1.5 text-xs text-gray-300 outline-none w-48" />
            </div>
            <div className="space-y-2">
              {/* 表头 */}
              <div className="grid grid-cols-[130px_100px_70px_80px_80px_100px_50px_55px_65px_45px] items-center gap-3 px-4 text-[10px] text-gray-500">
                <span>时间</span>
                <span>IP</span>
                <span>位置</span>
                <span>用户</span>
                <span>UID</span>
                <span>接口</span>
                <span>状态</span>
                <span>耗时</span>
                <span>Tokens</span>
                <span>费用</span>
              </div>
              {[
                { time: "2026-09-23 14:23:15", ip: "112.97.123.45", location: "广东深圳", user: "user@qq.com", uid: "u_8f3k2x7z", endpoint: "/v1/chat", status: "成功", latency: "1230ms", tokens: "1.2K", cost: "$0.003" },
                { time: "2026-09-23 14:22:48", ip: "183.14.22.109", location: "广东广州", user: "138****1234", uid: "u_2j9d4s1a", endpoint: "/v1/chat", status: "成功", latency: "980ms", tokens: "856", cost: "$0.002" },
                { time: "2026-09-23 14:21:32", ip: "223.104.6.78", location: "北京朝阳", user: "user@163.com", uid: "u_5k8m3n6p", endpoint: "/v1/chat", status: "失败", latency: "超时", tokens: "-", cost: "-", error: "上游服务超时，超过30秒未响应" },
                { time: "2026-09-23 14:20:11", ip: "119.139.200.15", location: "上海浦东", user: "159****5678", uid: "u_7h2g9f4d", endpoint: "/v1/images", status: "成功", latency: "1100ms", tokens: "2.1K", cost: "$0.005" },
                { time: "2026-09-23 14:18:56", ip: "171.223.55.89", location: "浙江杭州", user: "user@gmail.com", uid: "u_1q4w7e2r", endpoint: "/v1/chat", status: "成功", latency: "1350ms", tokens: "980", cost: "$0.0025" },
              ].map((log, i) => (
                <div key={i}>
                  <div className="grid grid-cols-[130px_100px_70px_80px_80px_100px_50px_55px_65px_45px] items-center gap-3 rounded-lg bg-secondary px-4 py-2.5 text-sm cursor-pointer hover:bg-border">
                    <span className="text-gray-400 font-mono text-xs">{log.time}</span>
                    <span className="text-gray-300 font-mono text-xs">{log.ip}</span>
                    <span className="text-gray-400 text-xs">{log.location}</span>
                    <span className="text-gray-400 text-xs truncate">{log.user}</span>
                    <span className="text-gray-500 font-mono text-xs">{log.uid}</span>
                    <span className="text-gray-500 font-mono text-xs truncate">{log.endpoint}</span>
                    <span className={log.status === "成功" ? "text-emerald-400 text-xs" : "text-red-400 text-xs"}>{log.status}</span>
                    <span className="text-gray-400 text-xs">{log.latency}</span>
                    <span className="text-gray-300 font-mono text-xs">{log.tokens}</span>
                    <span className="text-gray-300 font-mono text-xs">{log.cost}</span>
                  </div>
                  {log.error && (
                    <div className="ml-4 mt-1 rounded-lg bg-red-500/10 px-4 py-2 text-xs text-red-400">
                      错误详情：{log.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {/* 分页 */}
            <div className="flex items-center justify-between mt-4 text-xs text-gray-500">
              <span>共 128 条记录</span>
              <div className="flex gap-1">
                <button className="rounded px-2 py-1 bg-secondary">上一页</button>
                <button className="rounded px-2 py-1 bg-[#5051F8] text-white">1</button>
                <button className="rounded px-2 py-1 bg-secondary">2</button>
                <button className="rounded px-2 py-1 bg-secondary">3</button>
                <button className="rounded px-2 py-1 bg-secondary">下一页</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setConfirmDialog(null)}>
          <div className="w-full max-w-sm rounded-xl bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-base font-semibold text-white">{confirmDialog.title}</h3>
            <p className="mb-6 text-sm text-gray-400">{confirmDialog.message}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDialog(null)} className="rounded-lg bg-secondary px-4 py-2 text-sm text-gray-400 hover:bg-border">取消</button>
              <button onClick={confirmDialog.onConfirm} className="rounded-lg bg-red-500 px-4 py-2 text-sm text-white hover:bg-red-600">确定</button>
            </div>
          </div>
        </div>
      )}

      {/* 添加模型弹窗 */}
      {showAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAddDialog(false)}>
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="text-base font-medium text-text mb-4">添加模型到目录</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">显示名称 *</label>
                <input
                  type="text"
                  value={addForm.displayName}
                  onChange={e => setAddForm(prev => ({ ...prev, displayName: e.target.value }))}
                  placeholder="例如：GPT-4o"
                  className="w-full rounded-lg bg-secondary px-3 py-2 text-sm text-text outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">模型类型</label>
                <select
                  value={addForm.capability}
                  onChange={e => setAddForm(prev => ({ ...prev, capability: e.target.value as any }))}
                  className="w-full rounded-lg bg-secondary px-3 py-2 text-sm text-text outline-none"
                >
                  <option value="text">文本</option>
                  <option value="image">图片</option>
                  <option value="video">视频</option>
                  <option value="audio">音频</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowAddDialog(false)} className="rounded-lg bg-secondary px-4 py-2 text-sm text-gray-400 hover:bg-border">取消</button>
              <button onClick={handleAddModel} disabled={adding} className="rounded-lg bg-[#5051F8] px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50">
                {adding ? "添加中..." : "添加"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
