import { create } from "zustand";
import { account } from "@/lib/appwrite";
import {
  billingApi,
  setBillingToken,
  clearBillingToken,
  type BillingUser,
  type Plan,
} from "@/lib/billing";

interface BillingState {
  user: BillingUser | null;
  plans: Plan[];
  loading: boolean;
  // 用 Appwrite 登录态初始化计费会话
  initFromAuth: (authUser: { id: string; email?: string }, inviteCode?: string) => Promise<void>;
  refreshMe: () => Promise<void>;
  refreshPlans: () => Promise<void>;
  logout: () => void;
}

export const useBillingStore = create<BillingState>((set) => ({
  user: null,
  plans: [],
  loading: false,

  initFromAuth: async (authUser, inviteCode) => {
    if (!authUser?.id) return;
    set({ loading: true });
    try {
      // 未显式传入时，从链接 ?invite= 读取一次
      let code = inviteCode;
      if (!code) {
        const m = window.location.search.match(/[?&]invite=([^&]+)/);
        if (m) code = decodeURIComponent(m[1]);
      }
      const appwriteJwt = await account.createJWT();
      const res = await billingApi.login({ userId: authUser.id, email: authUser.email, inviteCode: code, appwriteJwt: appwriteJwt.jwt });
      setBillingToken(res.token);
      set({ user: res.user });
    } catch (e) {
      console.error("[billing] 初始化失败", e);
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
      clearBillingToken();
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

  logout: () => {
    clearBillingToken();
    set({ user: null, plans: [] });
  },
}));
