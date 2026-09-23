/**
 * 计费系统 API 客户端
 * 客户接口用 billing_token，管理端接口用 admin_token
 */
const API = import.meta.env.VITE_API_URL || "";

const BILLING_TOKEN_KEY = "billing_token";
const ADMIN_TOKEN_KEY = "admin_token";

export function getBillingToken(): string | null {
  return localStorage.getItem(BILLING_TOKEN_KEY);
}
export function setBillingToken(t: string) {
  localStorage.setItem(BILLING_TOKEN_KEY, t);
}
export function clearBillingToken() {
  localStorage.removeItem(BILLING_TOKEN_KEY);
}

export function getInstallationId() {
  const key = "qingyu-installation-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

async function request<T = any>(path: string, options: { method?: string; body?: any; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const tok = options.token || getBillingToken();
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const res = await fetch(`${API}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || `请求失败 (${res.status})`);
  return data;
}

// ---------------- 类型 ----------------
export interface BillingUser {
  id: string;
  email: string;
  balance: number;
  memberLevel: "free" | "pro" | "team" | string;
  memberExpireAt: number;
  memberActive: boolean;
  inviteCode: string;
  totalSpent: number;
  workspaceId?: string;
  createdAt: number;
}
export interface Plan {
  id: string;
  name: string;
  priceCents: number;
  durationDays: number;
  monthlyQuota: number;
  level: string;
  description: string;
  features: string[];
}
export interface Order {
  id: string;
  userId: string;
  type: string;
  planId: string;
  amountCents: number;
  status: "pending" | "paid" | "cancelled";
  paymentMethod: string;
  idempotencyKey?: string;
  createdAt: number;
  paidAt: number;
}
export interface Txn {
  id: string;
  userId: string;
  change: number;
  balanceAfter: number;
  type: string;
  orderId: string;
  note: string;
  createdAt: number;
}

// ---------------- 客户接口 ----------------
export const billingApi = {
  // 用 Appwrite 用户 ID 换计费 JWT
  login: (body: { userId: string; email?: string; inviteCode?: string; installationId?: string; displayName?: string; clientType?: string; osFamily?: string; browserFamily?: string }) =>
    request("/api/billing/login", { method: "POST", body: { ...body, installationId: body.installationId || getInstallationId(), clientType: body.clientType || "web", displayName: body.displayName || navigator.userAgent.slice(0, 100), osFamily: body.osFamily || navigator.platform || "unknown", browserFamily: body.browserFamily || navigator.userAgent.slice(0, 64) } }),
  me: () => request<{ user: BillingUser; settings: any }>("/api/billing/me"),
  plans: () => request<Plan[]>("/api/billing/plans"),
  createOrder: (planId: string, idempotencyKey: string) =>
    request<Order>("/api/billing/orders", { method: "POST", body: { planId, idempotencyKey } }),
  payOrder: (orderId: string) =>
    request<{ success: boolean; order: Order; user: BillingUser }>(`/api/billing/orders/${orderId}/pay`, { method: "POST", body: {} }),
  redeem: (code: string) =>
    request<{ success: boolean; user: BillingUser }>("/api/billing/redeem", { method: "POST", body: { code } }),
  orders: () => request<Order[]>("/api/billing/orders"),
  transactions: () => request<Txn[]>("/api/billing/transactions"),
  invite: () =>
    request<{ inviteCode: string; invitedCount: number; invitedList: any[]; rewardQuota: number }>("/api/billing/invite"),
};

// ---------------- 管理端接口 ----------------
export const adminBillingApi = {
  stats: () => request<any>("/api/admin/billing/stats", { token: localStorage.getItem(ADMIN_TOKEN_KEY) || "" }),
  users: () => request<BillingUser[]>("/api/admin/billing/users", { token: localStorage.getItem(ADMIN_TOKEN_KEY) || "" }),
  adjustUser: (id: string, delta: number, note: string) =>
    request<BillingUser>(`/api/admin/billing/users/${id}/adjust`, { method: "POST", token: localStorage.getItem(ADMIN_TOKEN_KEY) || "", body: { delta, note } }),
  orders: () => request<Order[]>("/api/admin/billing/orders", { token: localStorage.getItem(ADMIN_TOKEN_KEY) || "" }),
  completeOrder: (id: string) =>
    request<Order>(`/api/admin/billing/orders/${id}/complete`, { method: "POST", token: localStorage.getItem(ADMIN_TOKEN_KEY) || "" }),
  codes: () => request<any[]>("/api/admin/billing/codes", { token: localStorage.getItem(ADMIN_TOKEN_KEY) || "" }),
  genCodes: (body: any) =>
    request<{ count: number; batch: string; codes: string[] }>("/api/admin/billing/codes", { method: "POST", token: localStorage.getItem(ADMIN_TOKEN_KEY) || "", body }),
  plans: () => request<Plan[]>("/api/admin/billing/plans", { token: localStorage.getItem(ADMIN_TOKEN_KEY) || "" }),
};
