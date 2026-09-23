import { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next'
import { adminBillingApi, type BillingUser, type Order } from "@/lib/billing";
import { Users as UsersIcon, Receipt, Ticket, Crown, Wallet } from "lucide-react";

export default function AdminBillingPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<"stats" | "users" | "orders" | "codes" | "plans">("stats");
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<BillingUser[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [codes, setCodes] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  // 生成兑换码表单
  const [genForm, setGenForm] = useState({ count: 10, denomination: 100, kind: "quota", days: 0 });
  const [genResult, setGenResult] = useState<string[]>([]);

  const load = async (t: string) => {
    setMsg("");
    try {
      if (t === "stats") setStats(await adminBillingApi.stats());
      if (t === "users") setUsers(await adminBillingApi.users());
      if (t === "orders") setOrders(await adminBillingApi.orders());
      if (t === "codes") setCodes(await adminBillingApi.codes());
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  useEffect(() => { load(tab); }, [tab]);

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

  const genCodes = async () => {
    try {
      const res = await adminBillingApi.genCodes(genForm);
      setGenResult(res.codes);
      setMsg(t("pages.admin.billing.generated", { count: res.count }));
      load("codes");
    } catch (e: any) { setMsg(e.message); }
  };

  const TABS: [typeof tab, string, any][] = [
    ["stats", t("pages.admin.billing.tabs.stats"), Wallet],
    ["users", t("pages.admin.billing.tabs.users"), UsersIcon],
    ["orders", t("pages.admin.billing.tabs.orders"), Receipt],
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
        <div className="rounded-xl bg-card border border-border p-4 text-gray-500 text-sm">
          {t("pages.admin.billing.plansNote").split("api-data/billing_plans.json")[0]}<code className="text-green-600">api-data/billing_plans.json</code>... <code className="text-green-600">api-data/billing_plans.json</code>，或后续接入可视化编辑。当前包含 free / pro / team 三档。
        </div>
      )}
    </div>
  );
}
