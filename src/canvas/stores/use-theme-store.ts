import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** 读取系统当前偏好：是否深色 */
export function getSystemTheme(): ResolvedTheme {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** 把用户偏好解析成实际生效的 light/dark */
function resolveTheme(mode: ThemeMode): ResolvedTheme {
    return mode === "system" ? getSystemTheme() : mode;
}

type ThemeStore = {
    /** 用户偏好：light / dark / system（默认跟随系统） */
    mode: ThemeMode;
    /** 解析后实际生效的主题；system 模式下会随系统偏好实时变化 */
    theme: ResolvedTheme;
    /** 切到显式浅色/深色，同时把偏好锁定为该值 */
    setTheme: (theme: ResolvedTheme) => void;
    /** 设置偏好；传 "system" 即恢复跟随系统 */
    setMode: (mode: ThemeMode) => void;
    /** 系统偏好变化时由外部 effect 调用：仅在跟随系统时刷新实际主题 */
    syncWithSystem: () => void;
};

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set, get) => ({
            mode: "system",
            theme: resolveTheme("system"),
            setTheme: (theme) => set({ mode: theme, theme }),
            setMode: (mode) => set({ mode, theme: resolveTheme(mode) }),
            syncWithSystem: () => {
                if (get().mode === "system") {
                    set({ theme: getSystemTheme() });
                }
            },
        }),
        {
            name: "infinite-canvas:theme_store",
            // 只持久化用户偏好；实际 theme 每次启动按偏好+系统重新解析
            partialize: (state) => ({ mode: state.mode }),
            // 兼容老版本：旧数据里只有 theme 字段，迁移成 mode
            merge: (persisted, current) => {
                const p = (persisted ?? {}) as Partial<{ mode?: ThemeMode; theme?: ResolvedTheme }>;
                const mode: ThemeMode =
                    p.mode === "light" || p.mode === "dark" || p.mode === "system"
                        ? p.mode
                        : p.theme === "light" || p.theme === "dark"
                          ? p.theme
                          : "system";
                return { ...current, mode, theme: resolveTheme(mode) };
            },
        },
    ),
);
