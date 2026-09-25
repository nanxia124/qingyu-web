/**
 * API 请求封装
 * 统一处理：baseURL、token、超时、错误处理
 */

import { uploadMediaFile } from "@canvas/services/file-storage";

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
  // 普通用户票不再由脚本读取；此封装只为管理后台保留管理员令牌。
  try {
    localStorage.removeItem("billing_token");
    localStorage.removeItem("token");
    return localStorage.getItem("admin_token");
  } catch {
    return null;
  }
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
      credentials: token ? "omit" : "include",
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

  uploadAsset: async <T = any>(file: File, metadata?: Record<string, unknown>): Promise<T> => {
    const uploaded = await uploadMediaFile(file, "asset", {
      originalFilename: file.name,
      assetMetadata: metadata,
      uploadBatchId: typeof metadata?.uploadBatchId === "string" ? metadata.uploadBatchId : undefined,
      completeness: metadata?.completeness === "partial" ? "partial" : "complete",
    });
    const assetId = uploaded.storageKey.slice(uploaded.storageKey.indexOf(":") + 1);
    if (!assetId) throw new Error("云端没有返回文件编号，无法确认保存结果");
    return { id: assetId } as T;
  },

  /**
   * 读取受保护的资产文件。
   * 文件不会把 token 放到 URL 里，而是通过请求头发送，避免分享链接时泄露登录凭证。
   */
  fetchAssetBlob: async (assetId: string): Promise<Blob> => {
    const token = getToken();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(`${BASE_URL}/assets/${encodeURIComponent(assetId)}/content`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
        credentials: token ? "omit" : "include",
      });
      if (!res.ok) {
        let message = `文件读取失败 (${res.status})`;
        try {
          const data = await res.json();
          message = data?.error || message;
        } catch {
          // 非 JSON 错误响应使用默认提示。
        }
        throw new ApiError(res.status, message);
      }
      return await res.blob();
    } catch (err: any) {
      if (err.name === "AbortError") throw new ApiError(408, "文件读取超时，请检查网络");
      if (err.message === "Failed to fetch") throw new ApiError(0, "文件读取失败，请检查网络");
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  },
};
