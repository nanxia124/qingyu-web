import { useState, useEffect } from "react";
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
  const { user: authUser, isLoggedIn } = useAuthStore();
  const { user: billingUser, plans, initFromAuth, refreshMe, refreshPlans } = useBillingStore();
  const [loading, setLoading] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (isLoggedIn && authUser) {
      initFromAuth({ id: authUser.id, email: authUser.email });
    }
    refreshPlans();
  }, [isLoggedIn, authUser?.id]);

  const buy = async (plan: Plan) => {
    if (!isLoggedIn) {
      setMsg("请先登录");
      return;
    }
    setLoading(plan.id);
    setMsg("");
    try {
      const order = await billingApi.createOrder(plan.id);
      // v1：模拟支付直接成功；接微信/支付宝后这里改为跳转收银台
      await billingApi.payOrder(order.id);
      await refreshMe();
      setMsg(`已开通 ${plan.name}，额度已到账`);
    } catch (e: any) {
      setMsg(e.message || "开通失败");
    } finally {
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
          <h1 className="text-2xl font-bold text-white">订阅套餐</h1>
          <p className="text-sm text-gray-400 mt-1">选择适合你的套餐，解锁全部能力</p>
        </div>
        {billingUser && (
          <div className="text-right">
            <div className="text-xs text-gray-400">当前额度</div>
            <div className="text-2xl font-bold text-[#5051F8]">{billingUser.balance.toLocaleString()}</div>
            <div className="text-xs text-gray-500">
              {memberActive ? `会员有效期至 ${memberExpireText}` : "免费版"}
            </div>
          </div>
        )}
      </div>

      {msg && (
        <div className="mb-6 rounded-lg bg-[#5051F8]/10 border border-[#5051F8]/30 px-4 py-3 text-sm text-white">
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
              className={`p-6 rounded-2xl border transition-colors ${
                isCurrent
                  ? "border-[#5051F8] bg-[#1d1d2b]"
                  : "border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#3a3a3a]"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon size={18} className="text-[#5051F8]" />
                <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
              </div>
              <p className="text-3xl font-bold text-white mt-2">
                ¥{(plan.priceCents / 100).toFixed(0)}
                {plan.durationDays > 0 && <span className="text-sm text-gray-500 font-normal">/月</span>}
              </p>
              <p className="text-xs text-gray-500 mt-1">{plan.description}</p>
              <ul className="mt-4 space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-300">
                    <Check size={15} className="text-[#5051F8] shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              {isCurrent ? (
                <button disabled className="mt-6 w-full py-2.5 rounded-lg bg-[#2a2a2a] text-gray-400">
                  当前套餐
                </button>
              ) : (
                <button
                  onClick={() => buy(plan)}
                  disabled={!!loading || plan.priceCents === 0}
                  className="mt-6 w-full py-2.5 rounded-lg bg-[#5051F8] text-white hover:bg-[#3f40e6] disabled:opacity-50 transition-colors"
                >
                  {loading === plan.id ? "开通中..." : plan.priceCents === 0 ? "当前免费" : "立即开通"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-600 mt-8 text-center">
        支付方式：当前为演示支付，微信支付 / 支付宝将在后续接入
      </p>
    </div>
  );
}
