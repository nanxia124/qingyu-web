import { create } from "zustand";
import { persist } from "zustand/middleware";
import { account, teams } from "@/lib/appwrite";
import { ID, AppwriteException } from "appwrite";
import { trackEvent, AnalyticsEvent } from "@/lib/analytics";
import { api } from "@/lib/api";
import { billingApi, setBillingToken } from "@/lib/billing";

// 类型定义
export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  workspaceId?: string;
  plan: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
}

interface AuthState {
  // 状态
  user: User | null;
  isLoggedIn: boolean;
  teams: Team[];
  currentTeam: Team | null;
  isLoading: boolean;
  // 全局登录弹窗：任何组件都可以调用 openAuthModal() 唤起登录
  authModalOpen: boolean;

  // 操作
  openAuthModal: () => void;
  closeAuthModal: () => void;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchProfile: () => Promise<void>;
  fetchTeams: () => Promise<void>;
  switchTeam: (teamId: string) => void;
  updateProfile: (data: { name?: string }) => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (userId: string, secret: string, password: string) => Promise<void>;
  loginWithOAuth: (provider: "google" | "apple") => Promise<void>;
  checkSession: () => Promise<void>;
}

// Appwrite 用户对象转成我们的格式
function mapAppwriteUser(user: any): User {
  return {
    id: user.$id,
    email: user.email,
    name: user.name,
    avatar: user.prefs?.avatar,
    emailVerified: user.emailVerification,
    createdAt: user.registration,
  };
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isLoggedIn: false,
      teams: [],
      currentTeam: null,
      isLoading: false,
      authModalOpen: false,

      openAuthModal: () => set({ authModalOpen: true }),
      closeAuthModal: () => set({ authModalOpen: false }),

      // 检查当前会话是否有效
      checkSession: async () => {
        try {
          const user = await account.get();
          set({
            user: mapAppwriteUser(user),
            isLoggedIn: true,
          });
          await get().fetchTeams();
        } catch {
          // 没有有效会话
          set({
            user: null,
            isLoggedIn: false,
            teams: [],
            currentTeam: null,
          });
        }
      },

      login: async (email, password) => {
        set({ isLoading: true });
        try {
          // 创建邮箱密码会话
          await account.createEmailPasswordSession(email, password);
          const user = await account.get();
          set({
            user: mapAppwriteUser(user),
            isLoggedIn: true,
          });
          await get().fetchTeams();
          trackEvent(AnalyticsEvent.LoginSuccess, { method: "email" });
        } finally {
          set({ isLoading: false });
        }
      },

      register: async (name, email, password) => {
        set({ isLoading: true });
        try {
          // 创建用户
          await account.create(ID.unique(), email, password, name);
          // 注册后自动登录
          await account.createEmailPasswordSession(email, password);
          const user = await account.get();
          set({
            user: mapAppwriteUser(user),
            isLoggedIn: true,
          });
          // 创建默认团队
          await get().fetchTeams();
          trackEvent(AnalyticsEvent.RegisterSuccess, { method: "email" });
        } finally {
          set({ isLoading: false });
        }
      },

      logout: async () => {
        try {
          await account.deleteSession("current");
        } catch {
          // 忽略错误
        }
        set({
          user: null,
          isLoggedIn: false,
          teams: [],
          currentTeam: null,
        });
      },

      fetchProfile: async () => {
        try {
          const user = await account.get();
          set({ user: mapAppwriteUser(user) });
        } catch {
          get().logout();
        }
      },

      fetchTeams: async () => {
        // 业务团队以 PostgreSQL 为准；登录后先建立计费/业务会话，再读取团队。
        // 失败时保留 Appwrite 兜底，避免后端短暂不可用导致前台没有团队列表。
        try {
          const authUser = get().user;
          if (authUser) {
            const appwriteJwt = await account.createJWT();
            const billingSession = await billingApi.login({ userId: authUser.id, email: authUser.email, appwriteJwt: appwriteJwt.jwt });
            setBillingToken(billingSession.token);
            const postgresTeams = await api.get<Team[]>("/teams");
            set({ teams: postgresTeams, currentTeam: postgresTeams[0] || null });
            return;
          }
        } catch {
          // 继续使用 Appwrite 旧数据作为短暂兜底。
        }
        try {
          const teamList = await teams.list();
          // 转换格式
          const formattedTeams: Team[] = teamList.teams.map((t) => ({
            id: t.$id,
            name: t.name,
            plan: (t.prefs as any)?.plan || "free",
            role: (t.prefs as any)?.role || "member",
            createdAt: t.$createdAt,
          }));
          set({
            teams: formattedTeams,
            currentTeam: formattedTeams[0] || null,
          });
        } catch {
          // 静默失败
        }
      },

      switchTeam: (teamId) => {
        const team = get().teams.find((t) => t.id === teamId);
        if (team) {
          set({ currentTeam: team });
        }
      },

      updateProfile: async (data) => {
        const user = await account.updateName(data.name || "");
        set({ user: mapAppwriteUser(user) });
      },

      changePassword: async (oldPassword, newPassword) => {
        await account.updatePassword(newPassword, oldPassword);
      },

      // 发送密码重置邮件
      forgotPassword: async (email) => {
        const resetUrl = `${window.location.origin}/reset-password`;
        await account.createRecovery(email, resetUrl);
      },

      // 用邮件里的 token 完成密码重置
      resetPassword: async (userId, secret, password) => {
        await account.updateRecovery(userId, secret, password);
      },

      // 第三方 OAuth 登录：跳转 Appwrite OAuth 页面，成功后重定向回本站
      loginWithOAuth: async (provider) => {
        const origin = window.location.origin;
        const successUrl = `${origin}/`;
        const failureUrl = `${origin}/?oauth_error=1`;
        trackEvent(AnalyticsEvent.LoginSuccess, { method: provider });
        // createOAuth2Session 会跳出当前页走授权流程，完成后浏览器自动跳回 successUrl
        await account.createOAuth2Session(provider as any, successUrl, failureUrl);
      },
    }),
    {
      name: "auth-store",
      partialize: (state) => ({
        user: state.user,
        isLoggedIn: state.isLoggedIn,
        teams: state.teams,
        currentTeam: state.currentTeam,
      }),
    }
  )
);

// 工具函数
export const useIsLoggedIn = () => useAuthStore((s) => s.isLoggedIn);
