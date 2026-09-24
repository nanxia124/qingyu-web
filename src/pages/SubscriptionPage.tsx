import { useState, useEffect, useRef } from "react";
import { useTranslation } from 'react-i18next'
import { Check, Zap, Crown, Rocket } from "lucide-react";
import { useAuthStore } from "@/stores/useAuthStore";
import { useBillingStore } from "@/stores/useBillingStore";
import { billingApi, type Plan } from "@/lib/billing";

const LEVEL_ICON: Record<string, any> = {
  free: Zap,
  pro: Crown,
  team: Rocket,
};

export default function SubscriptionPage() {
  const { t } = useTranslation()
  const { user: authUser, isLoggedIn, openAuthModal } = useAuthStore();
  const { user: billingUser, plans, initFromAuth, refreshMe, refreshPlans } = useBillingStore();
  const [loading, setLoading] = useState("");
  const [msg, setMsg] = useState("");
  // 每个套餐在本次购买流程中固定一个编号。请求超时后重试会拿到原订单，不会重复创建或重复付款。
  const checkoutKeysRef = useRef(new Map<string, string>());
  const checkoutBusyRef = useRef(false);

  useEffect(() => {
    if (isLoggedIn && authUser) {
      initFromAuth({ id: authUser.id, email: authUser.email });
    }
    refreshPlans();
  }, [isLoggedIn, authUser?.id]);

  const buy = async (plan: Plan) => {
    if (!isLoggedIn) {
      openAuthModal();
      return;
    }
    if (!authUser || checkoutBusyRef.current) return;
    checkoutBusyRef.current = true;
    setLoading(plan.id);
    setMsg("");
    try {
      const storageKey = `qingyu:checkout:${authUser.id}:${plan.id}`;
      let idempotencyKey = checkoutKeysRef.current.get(storageKey) || localStorage.getItem(storageKey);
      if (!idempotencyKey) {
        idempotencyKey = `checkout_${crypto.randomUUID()}`;
        localStorage.setItem(storageKey, idempotencyKey);
      }
      checkoutKeysRef.current.set(storageKey, idempotencyKey);
      const order = await billingApi.createOrder(plan.id, idempotencyKey);
      // 只有服务端确认收到支付回调后才会发放权益；未配置支付渠道时由服务端明确返回提示。
      if (order.status !== "paid") await billingApi.payOrder(order.id);
      await refreshMe();
      // 保留编号，刷新或响应延迟时仍能认出原单；明确续费时应另开购买流程。
      setMsg(`${t("pages.subscription.activated")}：${plan.name}`);
    } catch (e: any) {
      setMsg(e.message || t("pages.subscription.activateFailed"));
    } finally {
      checkoutBusyRef.current = false;
      setLoading("");
    }
  };

  const now = Date.now();
  const memberActive = billingUser?.memberActive;
  const memberExpireText = billingUser?.memberExpireAt
    ? new Date(billingUser.memberExpireAt).toLocaleDateString()
    : "";

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-text">{t("pages.subscription.title")}</h1>
          <p className="text-sm text-text-muted mt-1">{t("pages.subscription.subtitle")}</p>
        </div>
        {billingUser && (
          <div className="text-right">
            <div className="text-xs text-text-muted">{t("pages.subscription.currentQuota")}</div>
            <div className="text-2xl font-bold text-accent">{billingUser.balance.toLocaleString()}</div>
            <div className="text-xs text-text-muted">
              {memberActive ? `${t("pages.subscription.validUntil")} ${memberExpireText}` : t("pages.subscription.free")}
            </div>
          </div>
        )}
      </div>

      {msg && (
        <div className="mb-6 rounded-lg bg-accent/10 border border-accent/30 px-4 py-3 text-sm text-text">
          {msg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => {
          const Icon = LEVEL_ICON[plan.level] || Zap;
          const isCurrent = memberActive && billingUser?.memberLevel === plan.id;
          return (
            <div
              key={plan.id}
              className={`p-6 rounded-2xl transition-colors ${
                isCurrent
                  ? "bg-accent/10 ring-1 ring-accent"
                  : "bg-card hover:bg-surface-hover"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon size={18} className="text-accent" />
                <h3 className="text-lg font-semibold text-text">{plan.name}</h3>
              </div>
              <p className="text-3xl font-bold text-text mt-2">
                ¥{(plan.priceCents / 100).toFixed(0)}
                {plan.durationDays > 0 && <span className="text-sm text-text-muted font-normal">{t("pages.subscription.perMonth")}</span>}
              </p>
              <p className="text-xs text-text-muted mt-1">{plan.description}</p>
              <ul className="mt-4 space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-text-secondary">
                    <Check size={15} className="text-accent shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              {isCurrent ? (
                <button disabled className="mt-6 w-full py-2.5 rounded-lg bg-secondary text-text-muted">
                  {t("pages.subscription.currentPlan")}
                </button>
              ) : (
                <button
                  onClick={() => buy(plan)}
                  disabled={!!loading || plan.priceCents === 0}
                  className="mt-6 w-full py-2.5 rounded-lg bg-accent text-accent-foreground hover:bg-accent-hover disabled:opacity-50 transition-colors"
                >
                  {loading === plan.id ? t("pages.subscription.activating") : plan.priceCents === 0 ? t("pages.subscription.currentFree") : t("pages.subscription.activateNow")}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-text-muted mt-8 text-center">
        {t("pages.subscription.paymentNote")}
      </p>
    </div>
  );
}
