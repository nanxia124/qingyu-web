import type { ReactNode } from "react";

// base64url 解码（JWT 用 base64url，atob 只支持标准 base64）
function base64UrlDecode(str: string): string {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}

// 解析JWT payload，检查是否过期
function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return true;
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    if (!payload.exp) return false;
    return Date.now() / 1000 > payload.exp;
  } catch {
    return true;
  }
}

export default function AdminRoute({ children }: { children: ReactNode }) {
  const token = localStorage.getItem("admin_token");

  // token 过期则清除（AdminPage 会自行显示登录页，不在这里强制跳转）
  if (token && isTokenExpired(token)) {
    localStorage.removeItem("admin_token");
  }

  return <>{children}</>;
}