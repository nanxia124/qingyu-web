import { useState, useEffect } from "react";
import { adminBillingApi, type BillingUser, type Order } from "@/lib/billing";
import { Users as UsersIcon, Receipt, Ticket, Crown, Wallet } from "lucide-react";

export default function AdminBillingPage() {
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
    const input = prompt(`调整用户 ${u.email} 的积分（当前 ${u.balance}），输入变动数（正/负）：`);
    if (input === null) return;
    const delta = Number(input);
    if (!delta) return;
    try {
      await adminBillingApi.adjustUser(u.id, delta, "后台调整");
      setMsg("已调整");
      load("users");
    } catch (e: any) { setMsg(e.message); }
  };

  const completeOrder = async (o: Order) => {
    try {
      await adminBillingApi.completeOrder(o.id);
      setMsg("订单已标记完成，权益已发放");
      load("orders");
    } catch (e: any) { setMsg(e.message); }
  };

  const genCodes = async () => {
    try {
      const res = await adminBillingApi.genCodes(genForm);
      setGenResult(res.codes);
      setMsg(`已生成 ${res.count} 个兑换码`);
      load("codes");
    } catch (e: any) { setMsg(e.message); }
  };

  const TABS: [typeof tab, string, any][] = [
    ["stats", "数据概览", Wallet],
    ["users", "用户", UsersIcon],
    ["orders", "订单", Receipt],
    ["codes", "兑换码", Ticket],
    ["plans", "套餐", Crown],
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-white mb-4">计费管理</h1>
      <div className="flex gap-1 mb-4 border-b border-[#2a2a2a]">
        {TABS.map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm flex items-center gap-1.5 border-b-2 -mb-px ${tab === k ? "border-[#5051F8] text-white" : "border-transparent text-gray-500 hover:text-gray-300"}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {msg && <div className="mb-4 rounded-lg bg-[#5051F8]/10 border border-[#5051F8]/30 px-4 py-2 text-sm text-white">{msg}</div>}

      {/* 概览 */}
      {tab === "stats" && stats && (
        <div className="grid grid-cols-4 gap-4">
          {[
            ["总用户", stats.userCount],
            ["活跃会员", stats.activeMemberCount],
            ["总收入", `¥${(stats.revenueCents / 100).toFixed(2)}`],
            ["今日收入", `¥${(stats.todayRevenueCents / 100).toFixed(2)}`],
            ["订单数", stats.paidOrderCount],
            ["在途兑换码", stats.unusedCodes],
            ["未支付订单", stats.orderCount - stats.paidOrderCount],
            ["平台总积分", stats.totalBalance],
          ].map(([label, v]) => (
            <div key={label as string} className="rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] p-4">
              <div className="text-xs text-gray-400">{label}</div>
              <div className="text-2xl font-bold text-white mt-1">{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* 用户 */}
      {tab === "users" && (
        <div className="rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#121212]">
              <tr>{["邮箱", "余额", "会员", "到期", "累计消费", "操作"].map(h => <th key={h} className="text-left px-4 py-3 text-gray-400">{h}</th>)}</tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t border-[#222]">
                  <td className="px-4 py-3 text-gray-300">{u.email || u.id}</td>
                  <td className="px-4 py-3 text-white">{u.balance}</td>
                  <td className="px-4 py-3 text-gray-300">{u.memberActive ? u.memberLevel : "free"}</td>
                  <td className="px-4 py-3 text-gray-500">{u.memberExpireAt ? new Date(u.memberExpireAt).toLocaleDateString() : "-"}</td>
                  <td className="px-4 py-3 text-gray-300">¥{(u.totalSpent / 100).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => adjustUser(u)} className="text-[#5051F8] hover:underline text-xs">调整积分</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 订单 */}
      {tab === "orders" && (
        <div className="rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#121212]">
              <tr>{["订单号", "用户", "套餐", "金额", "状态", "时间", "操作"].map(h => <th key={h} className="text-left px-4 py-3 text-gray-400">{h}</th>)}</tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} className="border-t border-[#222]">
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">{o.id}</td>
                  <td className="px-4 py-3 text-gray-300">{o.userId.slice(-6)}</td>
                  <td className="px-4 py-3 text-gray-300">{o.planId}</td>
                  <td className="px-4 py-3 text-white">¥{(o.amountCents / 100).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${o.status === "paid" ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-400"}`}>
                      {o.status === "paid" ? "已支付" : "待支付"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{new Date(o.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    {o.status !== "paid" && (
                      <button onClick={() => completeOrder(o)} className="text-[#5051F8] hover:underline text-xs">标记已付</button>
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
          <div className="rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] p-4 flex flex-wrap items-end gap-3">
            <div><label className="block text-xs text-gray-400 mb-1">数量</label><input type="number" value={genForm.count} onChange={e => setGenForm({...genForm, count: +e.target.value})} className="w-20 rounded bg-[#121212] border border-[#2a2a2a] px-2 py-1.5 text-white" /></div>
            <div><label className="block text-xs text-gray-400 mb-1">类型</label>
              <select value={genForm.kind} onChange={e => setGenForm({...genForm, kind: e.target.value})} className="rounded bg-[#121212] border border-[#2a2a2a] px-2 py-1.5 text-white">
                <option value="quota">充值额度</option><option value="membership">会员套餐</option>
              </select>
            </div>
            {genForm.kind === "quota" && (
              <div><label className="block text-xs text-gray-400 mb-1">面额(积分)</label><input type="number" value={genForm.denomination} onChange={e => setGenForm({...genForm, denomination: +e.target.value})} className="w-24 rounded bg-[#121212] border border-[#2a2a2a] px-2 py-1.5 text-white" /></div>
            )}
            <div><label className="block text-xs text-gray-400 mb-1">有效期(天,0永久)</label><input type="number" value={genForm.days} onChange={e => setGenForm({...genForm, days: +e.target.value})} className="w-24 rounded bg-[#121212] border border-[#2a2a2a] px-2 py-1.5 text-white" /></div>
            <button onClick={genCodes} className="px-4 py-2 rounded-lg bg-[#5051F8] text-white hover:bg-[#3f40e6]">生成兑换码</button>
          </div>
          {genResult.length > 0 && (
            <div className="rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] p-4">
              <div className="text-sm text-gray-400 mb-2">本次生成（可复制导出）：</div>
              <textarea readOnly value={genResult.join("\n")} className="w-full h-32 rounded bg-[#121212] border border-[#2a2a2a] p-2 text-green-400 font-mono text-xs" />
            </div>
          )}
          <div className="rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#121212]"><tr>{["兑换码", "面额", "状态", "使用者", "生成时间"].map(h => <th key={h} className="text-left px-4 py-3 text-gray-400">{h}</th>)}</tr></thead>
              <tbody>
                {codes.map(c => (
                  <tr key={c.code} className="border-t border-[#222]">
                    <td className="px-4 py-3 text-green-400 font-mono text-xs">{c.code}</td>
                    <td className="px-4 py-3 text-gray-300">{c.kind === "membership" ? `会员:${c.planId}` : c.denomination}</td>
                    <td className="px-4 py-3">{c.usedBy ? <span className="text-xs text-gray-500">已用</span> : <span className="text-xs text-green-400">未用</span>}</td>
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
        <div className="rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] p-4 text-gray-400 text-sm">
          套餐价格与额度配置请直接编辑 <code className="text-green-400">api-data/billing_plans.json</code>，或后续接入可视化编辑。当前包含 free / pro / team 三档。
        </div>
      )}
    </div>
  );
}
