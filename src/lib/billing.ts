/**
 * 计费系统 API 客户端
 * 客户身份由服务端 HttpOnly Cookie 管理；管理端仍使用 admin_token。
 */
const API = import.meta.env.VITE_API_URL || "";

const ADMIN_TOKEN_KEY = "admin_token";

export function clearBillingToken() {
  if (typeof window === "undefined") return;
  try {
    // 清除旧版本可被网页脚本读取的客户票；管理员令牌和 Agent 本地令牌不在此范围。
    localStorage.removeItem("billing_token");
    localStorage.removeItem("token");
  } catch {
    // 浏览器禁用本地存储时，Cookie 登录仍可正常工作。
  }
}

clearBillingToken();

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
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
  const res = await fetch(`${API}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: options.token ? "omit" : "include",
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
export interface ModelCreditQuote {
  id: string;
  modelCatalogId: number;
  taskType: "image" | "video" | "audio" | "text";
  priceVersion: number;
  priceUnit: string;
  unitCount: number;
  creditPrice: number;
  totalCredits: number;
  balance: number;
  expiresAt: string;
}
export interface Plan {
  id: string;
  name: string;
  priceCents: number;
  durationDays: number;
  billingInterval?: "none" | "month" | "year";
  monthlyQuota: number;
  level: string;
  description: string;
  features: string[];
}
export interface RenewalStatus {
  automaticRenewalEnabled: boolean;
  collectionMode: "manual" | "provider_managed" | "merchant_managed";
  mandateStatus: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: number | null;
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
export interface InvoiceOrderItem {
  orderId: string;
  orderNo: string;
  amountCents: number;
}
export interface InvoiceRequest {
  id: string;
  titleType: "personal" | "company";
  titleName: string;
  taxNo: string;
  email: string;
  totalCents: number;
  status: "pending" | "processing" | "completed" | "failed";
  pdfUrl: string;
  rejectReason: string;
  createdAt: number;
  completedAt: number | null;
  orders: InvoiceOrderItem[];
}
export interface SignupGiftPolicy {
  amount: number;
  effectiveAt: string | null;
}

// ---------------- 客户接口 ----------------
// 从完整浏览器信息生成设备名称，避免截断后丢失浏览器标识。
export function getBrowserDeviceInfo(userAgent: string, platform: string) {
  const osFamily = /iPhone|iPad|iPod/i.test(userAgent) ? 'iOS'
    : /Android/i.test(userAgent) ? 'Android'
    : /Windows|Win32|Win64/i.test(`${userAgent} ${platform}`) ? 'Windows'
    : /Mac/i.test(`${userAgent} ${platform}`) ? 'macOS'
    : /Linux/i.test(`${userAgent} ${platform}`) ? 'Linux' : '未知系统';
  const browserFamily = /Edg(?:e|A|iOS)?\//i.test(userAgent) ? 'Edge'
    : /OPR\/|Opera\//i.test(userAgent) ? 'Opera'
    : /Firefox\/|FxiOS\//i.test(userAgent) ? 'Firefox'
    : /Chrome\/|CriOS\//i.test(userAgent) ? 'Chrome'
    : /Version\/.*Safari\//i.test(userAgent) ? 'Safari' : '浏览器';
  return { displayName: `${osFamily} · ${browserFamily}`, osFamily, browserFamily };
}

export const billingApi = {
  // 用 Appwrite 用户 ID 登录；服务端通过 HttpOnly Cookie 保存客户会话。
  login: (body: { userId: string; email?: string; inviteCode?: string; appwriteJwt?: string; installationId?: string; displayName?: string; clientType?: string; osFamily?: string; browserFamily?: string }) =>
    request("/api/billing/login", { method: "POST", body: { ...getBrowserDeviceInfo(navigator.userAgent, navigator.platform), ...body, installationId: body.installationId || getInstallationId(), clientType: body.clientType || "web" } }),
  logout: () => request<{ success: boolean }>("/api/billing/logout", { method: "POST", body: {} }),
  me: () => request<{ user: BillingUser; settings: any }>("/api/billing/me"),
  quote: (body: { model: string; taskType: ModelCreditQuote["taskType"]; prompt?: string; parameters?: Record<string, unknown>; quantity?: number }) =>
    request<ModelCreditQuote>("/api/billing/quote", { method: "POST", body }),
  renewalStatus: () => request<RenewalStatus>("/api/billing/renewal-status"),
  plans: () => request<Plan[]>("/api/billing/plans"),
  createOrder: (planId: string, idempotencyKey: string) =>
    request<Order>("/api/billing/orders", { method: "POST", body: { planId, idempotencyKey } }),
  payOrder: (orderId: string) =>
    request<{ success: boolean; order: Order; user: BillingUser }>(`/api/billing/orders/${orderId}/pay`, { method: "POST", body: {} }),
  redeem: (code: string) =>
    request<{ success: boolean; user: BillingUser }>("/api/billing/redeem", { method: "POST", body: { code } }),
  orders: () => request<Order[]>("/api/billing/orders"),
  transactions: () => request<Txn[]>("/api/billing/transactions"),
  listInvoiceRequests: () => request<InvoiceRequest[]>("/api/billing/invoices"),
  createInvoiceRequest: (body: { titleType: "personal" | "company"; titleName: string; taxNo?: string; email: string; orderIds: string[] }) =>
    request<InvoiceRequest>("/api/billing/invoices", { method: "POST", body }),
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
  updatePlan: (plan: Partial<Plan> & { id: string }) =>
    request<Plan>("/api/admin/billing/plans", { method: "PUT", token: localStorage.getItem(ADMIN_TOKEN_KEY) || "", body: plan }),
  getSettings: () => request<any>("/api/admin/billing/settings", { token: localStorage.getItem(ADMIN_TOKEN_KEY) || "" }),
  updateSettings: (settings: any) =>
    request<any>("/api/admin/billing/settings", { method: "PUT", token: localStorage.getItem(ADMIN_TOKEN_KEY) || "", body: settings }),
  signupGift: () => request<SignupGiftPolicy>("/api/admin/billing/signup-gift", { token: localStorage.getItem(ADMIN_TOKEN_KEY) || "" }),
  updateSignupGift: (amount: number) =>
    request<SignupGiftPolicy>("/api/admin/billing/signup-gift", { method: "PUT", token: localStorage.getItem(ADMIN_TOKEN_KEY) || "", body: { amount } }),
  supplierBalance: () => request<any>("/api/admin/billing/supplier/balance", { token: localStorage.getItem(ADMIN_TOKEN_KEY) || "" }),
  supplierKeyLimits: () => request<any>("/api/admin/billing/supplier/key-limits", { token: localStorage.getItem(ADMIN_TOKEN_KEY) || "" }),
  supplierModels: () => request<any>("/api/admin/billing/supplier/models", { token: localStorage.getItem(ADMIN_TOKEN_KEY) || "" }),
  supplierAnnouncements: () => request<any>("/api/admin/billing/supplier/announcements", { token: localStorage.getItem(ADMIN_TOKEN_KEY) || "" }),
  invoices: () => request<InvoiceRequest[] & { userEmail?: string }[]>("/api/admin/billing/invoices", { token: localStorage.getItem(ADMIN_TOKEN_KEY) || "" }),
  updateInvoice: (id: string, body: { status: "processing" | "completed" | "failed"; pdfUrl?: string; rejectReason?: string }) =>
    request<{ id: string; status: string }>(`/api/admin/billing/invoices/${id}/${body.status}`, {
      method: "POST",
      token: localStorage.getItem(ADMIN_TOKEN_KEY) || "",
      body: { pdfUrl: body.pdfUrl, rejectReason: body.rejectReason },
    }),
};
