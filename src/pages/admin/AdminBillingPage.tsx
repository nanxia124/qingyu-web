import { useState, useEffect } from "react";
import { App as AntdApp } from "antd";
import { useTranslation } from 'react-i18next'
import { adminBillingApi, type BillingUser, type Order, type Plan, type InvoiceRequest } from "@/lib/billing";
import { Users as UsersIcon, Receipt, Ticket, Crown, Wallet, Save, FileText } from "lucide-react";

export default function AdminBillingPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<"stats" | "users" | "orders" | "codes" | "plans" | "invoices">("stats");
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<BillingUser[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [codes, setCodes] = useState<any[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [invoices, setInvoices] = useState<(InvoiceRequest & { userEmail?: string })[]>([]);
  const [plansDraft, setPlansDraft] = useState<Record<string, Plan>>({});
  const [savingPlanId, setSavingPlanId] = useState<string>("");
  const [msg, setMsg] = useState("");
  // 生成兑换码表单
  const [genForm, setGenForm] = useState({ count: 10, denomination: 100, kind: "quota", days: 0 });
  const [genResult, setGenResult] = useState<string[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; onConfirm: (() => void) | null }>({ open: false, message: "", onConfirm: null });

  const load = async (t: string) => {
    setMsg("");
    try {
      if (t === "stats") setStats(await adminBillingApi.stats());
      if (t === "users") setUsers(await adminBillingApi.users());
      if (t === "orders") setOrders(await adminBillingApi.orders());
      if (t === "invoices") setInvoices(await adminBillingApi.invoices());
      if (t === "codes") setCodes(await adminBillingApi.codes());
      if (t === "plans") {
        const list = await adminBillingApi.plans();
        setPlans(list);
        const draft: Record<string, Plan> = {};
        list.forEach(p => { draft[p.id] = { ...p, features: [...p.features] }; });
        setPlansDraft(draft);
      }
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  useEffect(() => { load(tab); }, [tab]);

  const showConfirm = (message: string, onConfirm: () => void) => {
    setConfirmDialog({ open: true, message, onConfirm });
  };

  const handleConfirmOk = () => {
    if (confirmDialog.onConfirm) confirmDialog.onConfirm();
    setConfirmDialog({ open: false, message: "", onConfirm: null });
  };

  const adjustUser = async (u: BillingUser) => {
    const input = prompt(t("pages.admin.billing.adjustPrompt", { email: u.email, balance: u.balance }));
    if (input === null) return;
    const delta = Number(input);
    if (!delta) return;
    try {
      await adminBillingApi.adjustUser(u.id, delta, "后台调整");
      setMsg(t("pages.admin.billing.adjusted"));
      load("users");
    } catch (e: any) { setMsg(e.message); }
  };

  const completeOrder = async (o: Order) => {
    try {
      await adminBillingApi.completeOrder(o.id);
      setMsg(t("pages.admin.billing.orderDone"));
      load("orders");
    } catch (e: any) { setMsg(e.message); }
  };

  const markInvoiceProcessing = async (inv: InvoiceRequest) => {
    try {
      await adminBillingApi.updateInvoice(inv.id, { status: "processing" });
      setMsg("已标记为开票中");
      load("invoices");
    } catch (e: any) { setMsg(e.message); }
  };

  const completeInvoice = (inv: InvoiceRequest) => {
    const pdfUrl = window.prompt(`请输入发票 PDF 的访问 URL（抬头：${inv.titleName}，金额：¥${(inv.totalCents / 100).toFixed(2)}）：`);
    if (pdfUrl === null) return;
    const url = pdfUrl.trim();
    if (!/^https?:\/\/.+/.test(url)) { setMsg("请输入合法的 http/https PDF 地址"); return; }
    showConfirm(`确认完成发票审核？将该发票申请标记为已完成，并关联此 PDF：${url}`, async () => {
      try {
        await adminBillingApi.updateInvoice(inv.id, { status: "completed", pdfUrl: url });
        setMsg("发票申请已标记完成");
        load("invoices");
      } catch (e: any) { setMsg(e.message); }
    });
  };
  const failInvoice = async (inv: InvoiceRequest) => {
    const reason = window.prompt(`请输入拒绝原因（将展示给用户）：`);
    if (reason === null) return;
    if (!reason.trim()) { setMsg("拒绝原因不能为空"); return; }
    try {
      await adminBillingApi.updateInvoice(inv.id, { status: "failed", rejectReason: reason.trim() });
      setMsg("已拒绝该发票申请");
      load("invoices");
    } catch (e: any) { setMsg(e.message); }
  };

  const genCodes = async () => {
    try {
      const res = await adminBillingApi.genCodes(genForm);
      setGenResult(res.codes);
      setMsg(t("pages.admin.billing.generated", { count: res.count }));
      load("codes");
    } catch (e: any) { setMsg(e.message); }
  };

  const savePlan = (planId: string) => {
    const draft = plansDraft[planId];
    if (!draft) return;
    showConfirm(`确认保存「${draft.name}」套餐的修改？`, async () => {
      setSavingPlanId(planId);
      try {
        await adminBillingApi.updatePlan({ ...draft, priceCents: Math.round(draft.priceCents) });
        setMsg(`套餐「${draft.name}」已保存`);
        load("plans");
      } catch (e: any) { setMsg(e.message); }
      finally {
        setSavingPlanId("");
      }
    });
  };
  const updatePlanDraft = (planId: string, field: keyof Plan, value: any) => {
    setPlansDraft(prev => ({
      ...prev,
      [planId]: { ...prev[planId], [field]: value },
    }));
  };

  const TABS: [typeof tab, string, any][] = [
    ["stats", t("pages.admin.billing.tabs.stats"), Wallet],
    ["users", t("pages.admin.billing.tabs.users"), UsersIcon],
    ["orders", t("pages.admin.billing.tabs.orders"), Receipt],
    ["invoices", "发票审核", FileText],
    ["codes", t("pages.admin.billing.tabs.codes"), Ticket],
    ["plans", t("pages.admin.billing.tabs.plans"), Crown],
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-text mb-4">{t("pages.admin.billing.title")}</h1>
      <div className="flex gap-1 mb-4 border-b border-border">
        {TABS.map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm flex items-center gap-1.5 border-b-2 -mb-px ${tab === k ? "border-accent text-text" : "border-transparent text-gray-500 hover:text-gray-600"}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {msg && <div className="mb-4 rounded-lg bg-[#5051F8]/10 border border-accent/30 px-4 py-2 text-sm text-text">{msg}</div>}

      {/* 概览 */}
      {tab === "stats" && stats && (
        <div className="grid grid-cols-4 gap-4">
          {[
            [t("pages.admin.billing.overview.userCount"), stats.userCount],
            [t("pages.admin.billing.overview.activeMember"), stats.activeMemberCount],
            [t("pages.admin.billing.overview.revenue"), `¥${(stats.revenueCents / 100).toFixed(2)}`],
            [t("pages.admin.billing.overview.todayRevenue"), `¥${(stats.todayRevenueCents / 100).toFixed(2)}`],
            [t("pages.admin.billing.overview.orderCount"), stats.paidOrderCount],
            [t("pages.admin.billing.overview.unusedCodes"), stats.unusedCodes],
            [t("pages.admin.billing.overview.unpaidOrders"), stats.orderCount - stats.paidOrderCount],
            [t("pages.admin.billing.overview.totalBalance"), stats.totalBalance],
          ].map(([label, v]) => (
            <div key={label as string} className="rounded-xl bg-card border border-border p-4">
              <div className="text-xs text-gray-500">{label}</div>
              <div className="text-2xl font-bold text-text mt-1">{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* 用户 */}
      {tab === "users" && (
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary">
              <tr>{[t("pages.admin.billing.userCols.email"), t("pages.admin.billing.userCols.balance"), t("pages.admin.billing.userCols.member"), t("pages.admin.billing.userCols.expire"), t("pages.admin.billing.userCols.spent"), t("pages.admin.billing.userCols.action")].map(h => <th key={h} className="text-left px-4 py-3 text-gray-500">{h}</th>)}</tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-4 py-3 text-gray-600">{u.email || u.id}</td>
                  <td className="px-4 py-3 text-text">{u.balance}</td>
                  <td className="px-4 py-3 text-gray-600">{u.memberActive ? u.memberLevel : "free"}</td>
                  <td className="px-4 py-3 text-gray-500">{u.memberExpireAt ? new Date(u.memberExpireAt).toLocaleDateString() : "-"}</td>
                  <td className="px-4 py-3 text-gray-600">¥{(u.totalSpent / 100).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => adjustUser(u)} className="text-accent hover:underline text-xs">{t("pages.admin.billing.adjustPoints")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 订单 */}
      {tab === "orders" && (
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary">
              <tr>{[t("pages.admin.billing.orderCols.no"), t("pages.admin.billing.orderCols.user"), t("pages.admin.billing.orderCols.plan"), t("pages.admin.billing.orderCols.amount"), t("pages.admin.billing.orderCols.status"), t("pages.admin.billing.orderCols.time"), t("pages.admin.billing.orderCols.action")].map(h => <th key={h} className="text-left px-4 py-3 text-gray-500">{h}</th>)}</tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} className="border-t border-border">
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{o.id}</td>
                  <td className="px-4 py-3 text-gray-600">{o.userId.slice(-6)}</td>
                  <td className="px-4 py-3 text-gray-600">{o.planId}</td>
                  <td className="px-4 py-3 text-text">¥{(o.amountCents / 100).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${o.status === "paid" ? "bg-green-500/10 text-green-600" : "bg-yellow-500/10 text-amber-600"}`}>
                      {o.status === "paid" ? t("pages.admin.billing.paid") : t("pages.admin.billing.pending")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{new Date(o.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    {o.status !== "paid" && (
                      <button onClick={() => completeOrder(o)} className="text-accent hover:underline text-xs">{t("pages.admin.billing.markPaid")}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 发票审核 */}
      {tab === "invoices" && (
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary">
              <tr>
                {["提交时间", "用户", "抬头", "税号", "收票邮箱", "金额", "订单数", "状态", "操作"].map(h =>
                  <th key={h} className="text-left px-4 py-3 text-gray-500 font-medium">{h}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">暂无发票申请</td></tr>
              )}
              {invoices.map(inv => (
                <tr key={inv.id} className="border-t border-border">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{new Date(inv.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-600">{inv.userEmail || inv.id.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-text">
                    {inv.titleName}
                    <span className="ml-1 text-xs text-gray-500">（{inv.titleType === "company" ? "企业" : "个人"}）</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{inv.taxNo || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{inv.email}</td>
                  <td className="px-4 py-3 text-text">¥{(inv.totalCents / 100).toFixed(2)}</td>
                  <td className="px-4 py-3 text-gray-500">{inv.orders.length} 笔</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      inv.status === "completed" ? "bg-green-500/10 text-green-600"
                      : inv.status === "processing" ? "bg-blue-500/10 text-blue-600"
                      : inv.status === "failed" ? "bg-red-500/10 text-red-500"
                      : "bg-yellow-500/10 text-amber-600"}`}>
                      {inv.status === "completed" ? "已完成"
                       : inv.status === "processing" ? "开票中"
                       : inv.status === "failed" ? "已拒绝"
                       : "待处理"}
                    </span>
                    {inv.status === "failed" && inv.rejectReason && (
                      <div className="text-xs text-red-500 mt-1">原因：{inv.rejectReason}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {inv.status === "pending" && (
                        <button onClick={() => markInvoiceProcessing(inv)} className="text-accent hover:underline text-xs">开始开票</button>
                      )}
                      {(inv.status === "pending" || inv.status === "processing") && (
                        <button onClick={() => completeInvoice(inv)} className="text-green-600 hover:underline text-xs">标记完成</button>
                      )}
                      {(inv.status === "pending" || inv.status === "processing") && (
                        <button onClick={() => failInvoice(inv)} className="text-red-500 hover:underline text-xs">拒绝</button>
                      )}
                      {inv.status === "completed" && inv.pdfUrl && (
                        <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline text-xs">查看 PDF</a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 兑换码 */}
      {tab === "codes" && (
        <div className="space-y-4">
          <div className="rounded-xl bg-card border border-border p-4 flex flex-wrap items-end gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">{t("pages.admin.billing.gen.count")}</label><input type="number" value={genForm.count} onChange={e => setGenForm({...genForm, count: +e.target.value})} className="w-20 rounded bg-secondary border border-border px-2 py-1.5 text-text" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">{t("pages.admin.billing.gen.kind")}</label>
              <select value={genForm.kind} onChange={e => setGenForm({...genForm, kind: e.target.value})} className="rounded bg-secondary border border-border px-2 py-1.5 text-text">
                <option value="quota">{t("pages.admin.billing.gen.quota")}</option><option value="membership">{t("pages.admin.billing.gen.membership")}</option>
              </select>
            </div>
            {genForm.kind === "quota" && (
              <div><label className="block text-xs text-gray-500 mb-1">{t("pages.admin.billing.gen.denom")}</label><input type="number" value={genForm.denomination} onChange={e => setGenForm({...genForm, denomination: +e.target.value})} className="w-24 rounded bg-secondary border border-border px-2 py-1.5 text-text" /></div>
            )}
            <div><label className="block text-xs text-gray-500 mb-1">{t("pages.admin.billing.gen.days")}</label><input type="number" value={genForm.days} onChange={e => setGenForm({...genForm, days: +e.target.value})} className="w-24 rounded bg-secondary border border-border px-2 py-1.5 text-text" /></div>
            <button onClick={genCodes} className="px-4 py-2 rounded-lg bg-[#5051F8] text-white hover:bg-accent-hover">{t("pages.admin.billing.gen.generate")}</button>
          </div>
          {genResult.length > 0 && (
            <div className="rounded-xl bg-card border border-border p-4">
              <div className="text-sm text-gray-500 mb-2">{t("pages.admin.billing.gen.result")}</div>
              <textarea readOnly value={genResult.join("\n")} className="w-full h-32 rounded bg-secondary border border-border p-2 text-green-600 font-mono text-xs" />
            </div>
          )}
          <div className="rounded-xl bg-card border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary"><tr>{[t("pages.admin.billing.codeCols.code"), t("pages.admin.billing.codeCols.denom"), t("pages.admin.billing.codeCols.status"), t("pages.admin.billing.codeCols.usedBy"), t("pages.admin.billing.codeCols.created")].map(h => <th key={h} className="text-left px-4 py-3 text-gray-500">{h}</th>)}</tr></thead>
              <tbody>
                {codes.map(c => (
                  <tr key={c.code} className="border-t border-border">
                    <td className="px-4 py-3 text-green-600 font-mono text-xs">{c.code}</td>
                    <td className="px-4 py-3 text-gray-600">{c.kind === "membership" ? `会员:${c.planId}` : c.denomination}</td>
                    <td className="px-4 py-3">{c.usedBy ? <span className="text-xs text-gray-500">{t("pages.admin.billing.used")}</span> : <span className="text-xs text-green-600">{t("pages.admin.billing.unused")}</span>}</td>
                    <td className="px-4 py-3 text-gray-500">{c.usedBy || "-"}</td>
                    <td className="px-4 py-3 text-gray-500">{new Date(c.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 套餐 */}
      {tab === "plans" && (
        <div className="space-y-4">
          <div className="text-sm text-gray-500">
            直接修改下方字段，点击保存即可生效。价格单位为元，自动按分存储。
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map(plan => {
              const draft = plansDraft[plan.id] || plan;
              return (
                <div key={plan.id} className="rounded-xl bg-card p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 font-mono">{plan.id}</span>
                    <span className="text-xs text-gray-600">level: {draft.level}</span>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-500 mb-1">套餐名称</label>
                    <input
                      type="text"
                      value={draft.name}
                      onChange={e => updatePlanDraft(plan.id, "name", e.target.value)}
                      className="w-full rounded-lg bg-secondary px-3 py-2 text-text text-sm outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">价格（元/月）</label>
                      <input
                        type="number"
                        step="0.01"
                        value={(draft.priceCents / 100).toFixed(2)}
                        onChange={e => updatePlanDraft(plan.id, "priceCents", Number(e.target.value) * 100)}
                        className="w-full rounded-lg bg-secondary px-3 py-2 text-text text-sm outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">时长（天）</label>
                      <input
                        type="number"
                        value={draft.durationDays}
                        onChange={e => updatePlanDraft(plan.id, "durationDays", Number(e.target.value))}
                        className="w-full rounded-lg bg-secondary px-3 py-2 text-text text-sm outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-500 mb-1">每月额度（积分）</label>
                    <input
                      type="number"
                      value={draft.monthlyQuota}
                      onChange={e => updatePlanDraft(plan.id, "monthlyQuota", Number(e.target.value))}
                      className="w-full rounded-lg bg-secondary px-3 py-2 text-text text-sm outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-gray-500 mb-1">描述</label>
                    <input
                      type="text"
                      value={draft.description}
                      onChange={e => updatePlanDraft(plan.id, "description", e.target.value)}
                      className="w-full rounded-lg bg-secondary px-3 py-2 text-text text-sm outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-gray-500 mb-1">权益列表（每行一条）</label>
                    <textarea
                      value={draft.features.join("\n")}
                      onChange={e => updatePlanDraft(plan.id, "features", e.target.value.split("\n").filter(f => f.trim()))}
                      rows={4}
                      className="w-full rounded-lg bg-secondary px-3 py-2 text-text text-sm outline-none focus:ring-1 focus:ring-accent resize-none"
                    />
                  </div>

                  <button
                    onClick={() => savePlan(plan.id)}
                    disabled={savingPlanId === plan.id}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#5051F8] text-white text-sm hover:bg-accent-hover disabled:opacity-50"
                  >
                    <Save size={14} />
                    {savingPlanId === plan.id ? "保存中..." : "保存"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 确认弹窗 */}
      {confirmDialog.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmDialog({ open: false, message: "", onConfirm: null })}>
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="text-sm text-text mb-6">{confirmDialog.message}</div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDialog({ open: false, message: "", onConfirm: null })}
                className="px-4 py-2 rounded-lg bg-secondary text-text text-sm hover:bg-secondary/80"
              >
                取消
              </button>
              <button
                onClick={handleConfirmOk}
                className="px-4 py-2 rounded-lg bg-[#5051F8] text-white text-sm hover:bg-accent-hover"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
