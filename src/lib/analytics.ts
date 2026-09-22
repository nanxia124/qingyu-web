/**
 * Umami 埋点封装。
 *
 * 在 index.html 中通过 <script defer src="/umami/script.js" data-website-id="...">
 * 加载 Umami 后，window.umami 会被自动注入。这里做一层防御性封装，
 * 即使 Umami 还没加载、或被 adblock 拦截，调用 trackEvent 也不会报错。
 *
 * 页面 PV/UV 由 Umami script 自动采集，无需手动调用。
 * 这里只负责“业务事件”：登录、注册、升级点击、支付成功等。
 */

declare global {
  interface Window {
    umami?: {
      track: (event: string, data?: Record<string, unknown>) => void;
    };
  }
}

/** 业务事件名常量，避免拼写不一致导致漏斗对不上。 */
export const AnalyticsEvent = {
  /** 注册成功 */
  RegisterSuccess: "register_success",
  /** 登录成功 */
  LoginSuccess: "login_success",
  /** 点击“升级计划/订阅”按钮（下单意向） */
  ClickUpgradePlan: "click_upgrade_plan",
  /** 检测到一笔新的已支付发票（支付成功） */
  PaymentSuccess: "payment_success",
} as const;

/**
 * 上报一个业务事件。Umami 未就绪时静默忽略。
 * @param event 事件名，建议用 AnalyticsEvent 里的常量
 * @param payload 额外维度，例如 { plan: "pro", amount: 9900 }
 */
export function trackEvent(
  event: string,
  payload?: Record<string, unknown>
): void {
  if (typeof window === "undefined") return;
  if (!window.umami || typeof window.umami.track !== "function") return;
  try {
    window.umami.track(event, payload ?? {});
  } catch {
    // 埋点失败绝不影响主流程
  }
}
