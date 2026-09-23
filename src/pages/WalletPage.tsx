import { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next'
import { useAuthStore } from "@/stores/useAuthStore";
import { useBillingStore } from "@/stores/useBillingStore";
import { billingApi, type Order, type Txn } from "@/lib/billing";
import { Coins, Ticket, Receipt, Users } from "lucide-react";

const TX_TYPE_TEXT: Record<string, string> = {
  register: "pages.wallet.typeRegister",
  redeem: "pages.wallet.typeRedeem",
  membership: "pages.wallet.typeMembership",
  consume: "pages.wallet.typeConsume",
  refund: "pages.wallet.typeRefund",
  invite: "pages.wallet.typeInvite",
  admin: "pages.wallet.typeAdmin",
  recharge: "pages.wallet.typeRecharge",
};

export default function WalletPage() {
  const { t } = useTranslation()
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
      setMsg(`${t("pages.wallet.redeemSuccess")} ${res.user.balance}`);
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  const inviteUrl = invite?.inviteCode
    ? `${window.location.origin}/?invite=${invite.inviteCode}`
    : "";

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-text mb-6">{t("pages.wallet.title")}</h1>

      {/* 余额卡片 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-2xl bg-card border border-border p-5">
          <div className="flex items-center gap-2 text-gray-500 text-sm"><Coins size={16} /> {t("pages.wallet.currentBalance")}</div>
          <div className="text-3xl font-bold text-accent mt-2">{billingUser?.balance ?? 0}</div>
        </div>
        <div className="rounded-2xl bg-card border border-border p-5">
          <div className="flex items-center gap-2 text-gray-500 text-sm"><Ticket size={16} /> {t("pages.wallet.currentMember")}</div>
          <div className="text-2xl font-bold text-text mt-2">
            {billingUser?.memberActive ? (billingUser?.memberLevel === "pro" ? "Pro" : t("pages.wallet.team")) : t("pages.wallet.free")}
          </div>
          {billingUser?.memberExpireAt ? (
            <div className="text-xs text-gray-500 mt-1">{t("pages.wallet.until")} {new Date(billingUser.memberExpireAt).toLocaleDateString()}</div>
          ) : null}
        </div>
        <div className="rounded-2xl bg-card border border-border p-5">
          <div className="flex items-center gap-2 text-gray-500 text-sm"><Receipt size={16} /> {t("pages.wallet.totalSpent")}</div>
          <div className="text-2xl font-bold text-text mt-2">¥{((billingUser?.totalSpent || 0) / 100).toFixed(2)}</div>
        </div>
      </div>

      {/* Tab */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {([["codes", "pages.wallet.tabCodes"], ["orders", "pages.wallet.tabOrders"], ["txns", "pages.wallet.tabTxns"], ["invite", "pages.wallet.tabInvite"]] as const).map(
          ([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
                tab === k ? "border-accent text-text" : "border-transparent text-gray-500 hover:text-gray-600"
              }`}
            >
              {label}
            </button>
          )
        )}
      </div>

      {msg && <div className="mb-4 rounded-lg bg-[#5051F8]/10 border border-accent/30 px-4 py-2 text-sm text-text">{msg}</div>}

      {/* 兑换码 */}
      {tab === "codes" && (
        <div className="rounded-2xl bg-card border border-border p-6">
          <h3 className="text-text font-medium mb-3">{t("pages.wallet.redeemTitle")}</h3>
          <div className="flex gap-3">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="QY-XXXX-XXXX-XXXX"
              className="flex-1 rounded-lg bg-secondary border border-border px-4 py-2.5 text-text outline-none focus:border-accent font-mono"
            />
            <button
              onClick={redeem}
              className="px-6 py-2.5 rounded-lg bg-[#5051F8] text-white hover:bg-accent-hover transition-colors"
            >
              兑换
            </button>
          </div>
          <p className="text-xs text-gray-600 mt-3">{t("pages.wallet.redeemHint")}</p>
        </div>
      )}

      {/* 订单 */}
      {tab === "orders" && (
        <div className="rounded-2xl bg-card border border-border overflow-hidden">
          {orders.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">{t("pages.wallet.noOrders")}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-secondary">
                <tr>
                  {[t("pages.wallet.hOrderId"), t("pages.wallet.hPlan"), t("pages.wallet.hAmount"), t("pages.wallet.hStatus"), t("pages.wallet.hTime")].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-gray-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-border">
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">{o.id}</td>
                    <td className="px-4 py-3 text-gray-600">{o.planId}</td>
                    <td className="px-4 py-3 text-text">¥{(o.amountCents / 100).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${o.status === "paid" ? "bg-green-500/10 text-green-600" : "bg-yellow-500/10 text-amber-600"}`}>
                        {o.status === "paid" ? t("pages.wallet.paid") : t("pages.wallet.pending")}
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
        <div className="rounded-2xl bg-card border border-border overflow-hidden">
          {txns.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">{t("pages.wallet.noTxns")}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-secondary">
                <tr>
                  {[t("pages.wallet.hType"), t("pages.wallet.hChange"), t("pages.wallet.hBalance"), t("pages.wallet.hNote"), t("pages.wallet.hTime")].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-gray-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="px-4 py-3 text-gray-600">{TX_TYPE_TEXT[t.type] || t.type}</td>
                    <td className="px-4 py-3">
                      <span className={t.change >= 0 ? "text-green-600" : "text-red-500"}>
                        {t.change >= 0 ? "+" : ""}{t.change}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{t.balanceAfter}</td>
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
        <div className="rounded-2xl bg-card border border-border p-6">
          <div className="flex items-center gap-2 mb-3 text-text font-medium">
            <Users size={16} className="text-accent" /> {t("pages.wallet.inviteTitle")}
          </div>
          <p className="text-sm text-gray-500 mb-4">
            {t("pages.wallet.inviteDesc")}
          </p>
          <div className="flex gap-3">
            <input readOnly value={inviteUrl} className="flex-1 rounded-lg bg-secondary border border-border px-4 py-2.5 text-gray-600 text-sm" />
            <button
              onClick={() => inviteUrl && navigator.clipboard.writeText(inviteUrl)}
              className="px-5 py-2.5 rounded-lg bg-[#5051F8] text-white hover:bg-accent-hover transition-colors text-sm"
            >
              {t("pages.wallet.copyLink")}
            </button>
          </div>
          {invite && (
            <div className="mt-4 text-sm text-gray-500">{t("pages.wallet.invited")} {invite.invitedCount}</div>
          )}
        </div>
      )}
    </div>
  );
}
