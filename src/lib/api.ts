/**
 * API 请求封装
 * 统一处理：baseURL、token、超时、错误处理
 */

const BASE_URL = "/api";
const DEFAULT_TIMEOUT = 30000;

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function getToken(): string | null {
  // 管理后台和普通站点共用请求封装。管理员登录后使用 admin_token，
  // 普通用户继续使用 token；管理员 token 优先，避免后台页面请求被当成匿名请求。
  return localStorage.getItem("admin_token") || localStorage.getItem("token") || localStorage.getItem("billing_token");
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: any;
  params?: Record<string, string>;
  timeout?: number;
  headers?: Record<string, string>;
}

export async function apiRequest<T = any>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const {
    method = "GET",
    body,
    params,
    timeout = DEFAULT_TIMEOUT,
    headers: customHeaders = {},
  } = options;

  // 拼接 query 参数
  let url = path;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += (url.includes("?") ? "&" : "?") + searchParams.toString();
  }

  // 构建请求头
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...customHeaders,
  };

  // 带上 token
  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // 超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${BASE_URL}${url}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // 解析响应
    let data: any;
    const contentType = res.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    // 错误处理
    if (!res.ok) {
      const message =
        typeof data === "string"
          ? data
          : data?.error?.message || data?.error || `请求失败 (${res.status})`;
      throw new ApiError(res.status, message, data);
    }

    return data;
  } catch (err: any) {
    clearTimeout(timeoutId);

    if (err.name === "AbortError") {
      throw new ApiError(408, "请求超时，请检查网络");
    }
    if (err.message === "Failed to fetch") {
      throw new ApiError(0, "网络连接失败，请检查网络");
    }

    throw err;
  }
}

// 便捷方法
export const api = {
  get: <T = any>(path: string, params?: Record<string, string>) =>
    apiRequest<T>(path, { method: "GET", params }),

  post: <T = any>(path: string, body?: any) =>
    apiRequest<T>(path, { method: "POST", body }),

  put: <T = any>(path: string, body?: any) =>
    apiRequest<T>(path, { method: "PUT", body }),

  patch: <T = any>(path: string, body?: any) =>
    apiRequest<T>(path, { method: "PATCH", body }),

  delete: <T = any>(path: string) =>
    apiRequest<T>(path, { method: "DELETE" }),
};
