import { useState, useEffect } from "react";
import { useAuthStore } from "@/stores/useAuthStore";
import { useBillingStore } from "@/stores/useBillingStore";
import { billingApi, type Order, type Txn } from "@/lib/billing";
import { Coins, Ticket, Receipt, Users } from "lucide-react";

const TX_TYPE_TEXT: Record<string, string> = {
  register: "注册赠送",
  redeem: "兑换码充值",
  membership: "会员到账",
  consume: "消费扣费",
  refund: "退款",
  invite: "邀请奖励",
  admin: "后台调整",
  recharge: "在线充值",
};

export default function WalletPage() {
  const { user: authUser, isLoggedIn } = useAuthStore();
  const { user: billingUser, initFromAuth, refreshMe } = useBillingStore();
  const [tab, setTab] = useState<"codes" | "orders" | "txns" | "invite">("codes");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [invite, setInvite] = useState<any>(null);

  useEffect(() => {
    if (isLoggedIn && authUser) {
      initFromAuth({ id: authUser.id, email: authUser.email });
    }
  }, [isLoggedIn, authUser?.id]);

  const load = async (t: string) => {
    try {
      if (t === "orders") setOrders(await billingApi.orders());
      if (t === "txns") setTxns(await billingApi.transactions());
      if (t === "invite") setInvite(await billingApi.invite());
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  useEffect(() => { load(tab); }, [tab]);

  const redeem = async () => {
    setMsg("");
    try {
      const res = await billingApi.redeem(code.trim());
      await refreshMe();
      setCode("");
      setMsg(`兑换成功，当前余额 ${res.user.balance}`);
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  const inviteUrl = invite?.inviteCode
    ? `${window.location.origin}/?invite=${invite.inviteCode}`
    : "";

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">我的钱包</h1>

      {/* 余额卡片 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] p-5">
          <div className="flex items-center gap-2 text-gray-400 text-sm"><Coins size={16} /> 当前余额</div>
          <div className="text-3xl font-bold text-[#5051F8] mt-2">{billingUser?.balance ?? 0}</div>
        </div>
        <div className="rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] p-5">
          <div className="flex items-center gap-2 text-gray-400 text-sm"><Ticket size={16} /> 当前会员</div>
          <div className="text-2xl font-bold text-white mt-2">
            {billingUser?.memberActive ? (billingUser?.memberLevel === "pro" ? "Pro" : "团队版") : "免费版"}
          </div>
          {billingUser?.memberExpireAt ? (
            <div className="text-xs text-gray-500 mt-1">至 {new Date(billingUser.memberExpireAt).toLocaleDateString()}</div>
          ) : null}
        </div>
        <div className="rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] p-5">
          <div className="flex items-center gap-2 text-gray-400 text-sm"><Receipt size={16} /> 累计消费</div>
          <div className="text-2xl font-bold text-white mt-2">¥{((billingUser?.totalSpent || 0) / 100).toFixed(2)}</div>
        </div>
      </div>

      {/* Tab */}
      <div className="flex gap-1 mb-4 border-b border-[#2a2a2a]">
        {([["codes", "兑换码"], ["orders", "订单"], ["txns", "余额流水"], ["invite", "邀请好友"]] as const).map(
          ([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
                tab === k ? "border-[#5051F8] text-white" : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {label}
            </button>
          )
        )}
      </div>

      {msg && <div className="mb-4 rounded-lg bg-[#5051F8]/10 border border-[#5051F8]/30 px-4 py-2 text-sm text-white">{msg}</div>}

      {/* 兑换码 */}
      {tab === "codes" && (
        <div className="rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] p-6">
          <h3 className="text-white font-medium mb-3">输入兑换码</h3>
          <div className="flex gap-3">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="QY-XXXX-XXXX-XXXX"
              className="flex-1 rounded-lg bg-[#121212] border border-[#2a2a2a] px-4 py-2.5 text-white outline-none focus:border-[#5051F8] font-mono"
            />
            <button
              onClick={redeem}
              className="px-6 py-2.5 rounded-lg bg-[#5051F8] text-white hover:bg-[#3f40e6] transition-colors"
            >
              兑换
            </button>
          </div>
          <p className="text-xs text-gray-600 mt-3">兑换码可联系管理员获取，兑换后额度立即到账</p>
        </div>
      )}

      {/* 订单 */}
      {tab === "orders" && (
        <div className="rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] overflow-hidden">
          {orders.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">暂无订单</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[#121212]">
                <tr>
                  {["订单号", "套餐", "金额", "状态", "时间"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-gray-400 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-[#222]">
                    <td className="px-4 py-3 text-gray-300 font-mono text-xs">{o.id}</td>
                    <td className="px-4 py-3 text-gray-300">{o.planId}</td>
                    <td className="px-4 py-3 text-white">¥{(o.amountCents / 100).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${o.status === "paid" ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-400"}`}>
                        {o.status === "paid" ? "已支付" : "待支付"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{new Date(o.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 流水 */}
      {tab === "txns" && (
        <div className="rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] overflow-hidden">
          {txns.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">暂无流水</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[#121212]">
                <tr>
                  {["类型", "变动", "余额", "说明", "时间"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-gray-400 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id} className="border-t border-[#222]">
                    <td className="px-4 py-3 text-gray-300">{TX_TYPE_TEXT[t.type] || t.type}</td>
                    <td className="px-4 py-3">
                      <span className={t.change >= 0 ? "text-green-400" : "text-red-400"}>
                        {t.change >= 0 ? "+" : ""}{t.change}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{t.balanceAfter}</td>
                    <td className="px-4 py-3 text-gray-500">{t.note}</td>
                    <td className="px-4 py-3 text-gray-500">{new Date(t.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 邀请 */}
      {tab === "invite" && (
        <div className="rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] p-6">
          <div className="flex items-center gap-2 mb-3 text-white font-medium">
            <Users size={16} className="text-[#5051F8]" /> 邀请好友
          </div>
          <p className="text-sm text-gray-400 mb-4">
            好友通过你的链接注册并充值，你可获得 {invite?.rewardQuota ?? 0} 积分奖励
          </p>
          <div className="flex gap-3">
            <input readOnly value={inviteUrl} className="flex-1 rounded-lg bg-[#121212] border border-[#2a2a2a] px-4 py-2.5 text-gray-300 text-sm" />
            <button
              onClick={() => inviteUrl && navigator.clipboard.writeText(inviteUrl)}
              className="px-5 py-2.5 rounded-lg bg-[#5051F8] text-white hover:bg-[#3f40e6] transition-colors text-sm"
            >
              复制链接
            </button>
          </div>
          {invite && (
            <div className="mt-4 text-sm text-gray-400">已邀请 {invite.invitedCount} 人</div>
          )}
        </div>
      )}
    </div>
  );
}
