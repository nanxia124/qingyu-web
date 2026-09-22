import { create } from "zustand";
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
      const res = await billingApi.login({ userId: authUser.id, email: authUser.email, inviteCode: code });
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
      console.error("[billing] 拉取套餐失败", e);
    }
  },

  logout: () => {
    clearBillingToken();
    set({ user: null, plans: [] });
  },
}));
