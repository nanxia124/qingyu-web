import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import Tooltip from '@/components/ui/Tooltip'

import { LocalAgentPanel } from "./local-agent-panel";
import { canvasThemes } from "@canvas/lib/canvas-theme";
import { useAgentStore } from "@canvas/stores/use-agent-store";
import { useThemeStore } from "@canvas/stores/use-theme-store";

class AgentErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
    state = { hasError: false };
    static getDerivedStateFromError() { return { hasError: true }; }
    componentDidCatch(error: Error) { console.error("[AgentPanel] error:", error); }
    render() {
        if (this.state.hasError) {
            return (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                    <div className="text-sm font-medium">Agent 面板出错</div>
                    <div className="text-xs opacity-60">请关闭后重新打开</div>
                </div>
            );
        }
        return this.props.children;
    }
}

export function AgentPanel() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const panelMounted = useAgentStore((state) => state.panelMounted);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const containerRef = useRef<HTMLDivElement>(null);

    const [collapsed, setCollapsed] = useState(true);

    // Esc 折叠
    useEffect(() => {
        if (!panelOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setCollapsed(true);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [panelOpen]);

    // 展开时自动聚焦输入框
    useEffect(() => {
        if (!panelOpen || collapsed) return;
        const frame = requestAnimationFrame(() => {
            const textarea = containerRef.current?.querySelector("textarea");
            if (textarea) (textarea as HTMLTextAreaElement).focus();
        });
        return () => cancelAnimationFrame(frame);
    }, [panelOpen, collapsed]);

    if (!panelMounted) return null;

    return (
        <AnimatePresence>
            {panelOpen && (
                <>
                    {/* 展开面板 */}
                    {!collapsed && (
                        <motion.div
                            key="agent-panel"
                            ref={containerRef}
                            data-agent-floating
                            role="dialog"
                            aria-label="Agent 对话面板"
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 12 }}
                            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                            className="absolute z-[100] flex w-[420px] max-w-[calc(100vw-40px)] flex-col overflow-hidden rounded-2xl"
                            style={{
                                right: 16,
                                bottom: 96,
                                height: "calc(100vh - 256px)",
                                background: theme.node.panel,
                                borderColor: "transparent",
                                color: theme.node.text,
                                boxShadow: "none",
                            }}
                            data-canvas-shortcuts-ignore
                        >
                            <div className="flex min-h-0 flex-1 flex-col">
                                <AgentErrorBoundary>
                                    <LocalAgentPanel embedded autoConnect />
                                </AgentErrorBoundary>
                            </div>
                        </motion.div>
                    )}

                    {/* 小怪兽常驻入口 */}
                    <motion.div
                        key="agent-mascot"
                        className="absolute z-[101]"
                        style={{ right: 16, bottom: 16, width: 64, height: 64 }}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.18 }}
                    >
                        <Tooltip title={collapsed ? "Agent" : "收起"} placement="left">
                            <button
                                type="button"
                                className="flex h-16 w-16 items-center justify-center rounded-full"
                                onClick={() => setCollapsed((v) => !v)}
                                aria-label={collapsed ? "展开 Agent 面板" : "折叠 Agent 面板"}
                            >
                                <img src="/icons/mascot.svg" alt="Agent" className="size-12 transition-transform duration-200 hover:scale-110" />
                            </button>
                        </Tooltip>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
