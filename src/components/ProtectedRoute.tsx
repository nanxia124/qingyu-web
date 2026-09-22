import type { ReactNode } from "react";

// 解析JWT payload，检查是否过期
function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1]));
    if (!payload.exp) return false; // 没有exp字段就认为不过期
    // exp是Unix时间戳（秒），和当前时间比较
    return Date.now() / 1000 > payload.exp;
  } catch {
    return true; // 解析失败就认为过期
  }
}

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const rawToken = localStorage.getItem("token");
  const token = rawToken && !isTokenExpired(rawToken) ? rawToken : null;

  // token不存在或已过期，清理
  if (!token) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  }

  // 不自动弹登录框，未登录也能浏览页面，只有点击需要登录的操作时才弹
  return <>{children}</>;
}