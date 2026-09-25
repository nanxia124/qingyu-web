import { create } from "zustand";
import {
  billingApi,
  clearBillingToken,
  type BillingUser,
  type Plan,
} from "@/lib/billing";

const BILLING_TOKEN_USER_KEY = "billing_token_user";

interface BillingState {
  user: BillingUser | null;
  plans: Plan[];
  loading: boolean;
  // 用当前已有的计费会话读取用户信息，不负责登录或接管在线设备
  initFromAuth: (authUser: { id: string; email?: string }) => Promise<void>;
  refreshMe: () => Promise<void>;
  refreshPlans: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useBillingStore = create<BillingState>((set) => ({
  user: null,
  plans: [],
  loading: false,

  initFromAuth: async (authUser) => {
    if (!authUser?.id) {
      set({ user: null });
      return;
    }
    set({ loading: true });
    try {
      // 只允许读取当前 Appwrite 账号对应的服务端会话，避免切换账号后展示旧账号资料。
      if (localStorage.getItem(BILLING_TOKEN_USER_KEY) !== authUser.id) {
        await billingApi.logout().catch(() => undefined);
        clearBillingToken();
        set({ user: null });
        return;
      }
      const res = await billingApi.me();
      set({ user: res.user });
    } catch (e) {
      console.error("[billing] 读取当前会话失败", e);
      await billingApi.logout().catch(() => undefined);
      clearBillingToken();
      localStorage.removeItem(BILLING_TOKEN_USER_KEY);
      set({ user: null });
    } finally {
      set({ loading: false });
    }
  },

  refreshMe: async () => {
    try {
      const res = await billingApi.me();
      set({ user: res.user });
    } catch (e) {
      // token 失效则清掉
      await billingApi.logout().catch(() => undefined);
      clearBillingToken();
      localStorage.removeItem(BILLING_TOKEN_USER_KEY);
      set({ user: null });
    }
  },

  refreshPlans: async () => {
    try {
      const plans = await billingApi.plans();
      set({ plans });
    } catch (e) {
      console.error("[billing] 拉取套餐失败，使用本地兜底套餐", e);
      // 后端不可用时使用本地默认套餐，保证页面可预览
      set({
        plans: [
          {
            id: "free",
            name: "免费版",
            priceCents: 0,
            durationDays: 0,
            monthlyQuota: 0,
            level: "free",
            description: "注册即用",
            features: ["每日 20 次对话", "3 个画布", "基础模型"],
          },
          {
            id: "pro",
            name: "Pro",
            priceCents: 2900,
            durationDays: 30,
            monthlyQuota: 50000,
            level: "pro",
            description: "个人创作者首选",
            features: ["每月 5 万积分", "全部模型", "50 个画布", "优先响应"],
          },
          {
            id: "team",
            name: "团队版",
            priceCents: 9900,
            durationDays: 30,
            monthlyQuota: 300000,
            level: "team",
            description: "多人协作",
            features: ["每月 30 万积分", "无限画布", "团队协作", "专属支持"],
          },
        ],
      });
    }
  },

  logout: async () => {
    await billingApi.logout().catch(() => undefined);
    clearBillingToken();
    localStorage.removeItem(BILLING_TOKEN_USER_KEY);
    set({ user: null, plans: [] });
  },
}));
