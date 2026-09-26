import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useSpring, useTransform } from "motion/react";
import { useTranslation } from "react-i18next";
import { Bot, Copy } from "lucide-react";

import { canvasThemes } from "@canvas/lib/canvas-theme";
import { summarizeCanvasAgentOps } from "@canvas/lib/canvas/canvas-agent-ops";
import { useAgentStore, type AgentChatItem, type AgentPendingApproval, type AgentPendingToolCall, type AgentTokenUsage } from "@canvas/stores/use-agent-store";
import { useCopyText } from "@canvas/hooks/use-copy-text";
import { AgentApprovalCard, AgentChatMessage, AgentCommandGroup, AgentPendingToolCard, AgentToolCard, AgentWorkingMessage } from "./agent-chat-message";
import { agentMessageToChatMessage, currentPlanMessage, isPlanMessage, latestPlanMessage, toolCallDetail, toolName, workingActivity } from "./agent-event-formatters";
import { AgentScrollToBottom } from "./agent-scroll-to-bottom";
import { speakText } from "./agent-tts";

const SCROLL_BOTTOM_THRESHOLD = 48;
const historyMessageStyle = { contentVisibility: "auto", containIntrinsicSize: "0 80px" } as const;

export function AgentChatTimeline({
    theme,
    pendingTool,
    pendingApprovals,
    sending,
    waiting,
    onRejectTool,
    onApproveTool,
    onApprovalDecision,
    onRegenerate,
    onEditMessage,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    pendingTool: AgentPendingToolCall | null;
    pendingApprovals: AgentPendingApproval[];
    sending: boolean;
    waiting: boolean;
    onRejectTool: () => void;
    onApproveTool: () => void;
    onApprovalDecision: (approval: AgentPendingApproval, decision: "accept" | "acceptForSession" | "decline") => void;
    onRegenerate?: (messageId: string) => void;
    onEditMessage?: (messageId: string) => void;
}) {
    const { t } = useTranslation();
    const messages = useAgentStore((state) => state.messages);
    const connected = useAgentStore((state) => state.connected);
    const enabled = useAgentStore((state) => state.enabled);
    const timeline = useMemo(() => groupTimelineMessages(messages), [messages]);
    const listRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const followMessagesRef = useRef(true);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const [selectionToolbar, setSelectionToolbar] = useState<{ x: number; y: number; text: string } | null>(null);
    const copyText = useCopyText();
    const streaming = messages.some((message) => message.streamId);
    const working = workingActivity(messages.at(-1));
    const updateScrollState = useCallback(() => {
        const list = listRef.current;
        if (!list) return;
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= SCROLL_BOTTOM_THRESHOLD;
        followMessagesRef.current = atBottom;
        setShowScrollToBottom(!atBottom);
        setSelectionToolbar(null);
    }, []);
    const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
        const list = listRef.current;
        if (!list) return;
        followMessagesRef.current = true;
        list.scrollTo({ top: list.scrollHeight, behavior });
        setShowScrollToBottom(false);
    }, []);
    const handleMouseUp = useCallback(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim() || "";
        if (!text || !selection || selection.rangeCount === 0) {
            setSelectionToolbar(null);
            return;
        }
        const list = listRef.current;
        if (!list) return;
        const range = selection.getRangeAt(0);
        if (!list.contains(range.commonAncestorContainer)) {
            setSelectionToolbar(null);
            return;
        }
        const rect = range.getBoundingClientRect();
        setSelectionToolbar({ x: rect.left + rect.width / 2, y: rect.top, text });
    }, []);
    useEffect(() => {
        const frame = requestAnimationFrame(() => (followMessagesRef.current ? scrollToBottom("auto") : updateScrollState()));
        return () => cancelAnimationFrame(frame);
    }, [messages, pendingApprovals, pendingTool, scrollToBottom, updateScrollState, waiting]);
    useEffect(() => {
        const content = contentRef.current;
        if (!content) return;
        let frame = 0;
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => (followMessagesRef.current ? scrollToBottom("auto") : updateScrollState()));
        });
        observer.observe(content);
        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
        };
    }, [scrollToBottom, updateScrollState]);
    const lastNotifiedRef = useRef<string>('');
    useEffect(() => {
        const last = messages[messages.length - 1];
        if (!last || last.role !== 'assistant' || last.streamId) return;
        if (last.id === lastNotifiedRef.current) return;
        lastNotifiedRef.current = last.id;
        if (!document.hidden) return;
        if (localStorage.getItem('agent-notify-muted') === '1') return;
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        try {
            new Notification('AI 回复完成', { body: last.text.slice(0, 100) });
        } catch { }
        try {
            const audio = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=');
            void audio.play();
        } catch { }
    }, [messages]);
    const lastAutoSpokenRef = useRef<string>('');
    useEffect(() => {
        const last = messages[messages.length - 1];
        if (!last || last.role !== 'assistant' || last.streamId) return;
        if (last.id === lastAutoSpokenRef.current) return;
        lastAutoSpokenRef.current = last.id;
        if (!('speechSynthesis' in window)) return;
        try {
            const auto = localStorage.getItem('agent-tts-auto') === '1';
            if (auto && last.text.trim()) speakText(last.text);
        } catch { }
    }, [messages]);
    return (
        <div className="relative min-h-0 flex-1">
            <div ref={listRef} className="thin-scrollbar h-full select-text overflow-y-auto" onScroll={updateScrollState} onMouseUp={handleMouseUp}>
                <div ref={contentRef} className="space-y-4 px-4 pt-4">
                    {enabled && !connected ? (
                        <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: "rgba(234, 88, 12, .12)", color: "#ea580c" }}>
                            <span className="inline-block size-2 animate-pulse rounded-full" style={{ background: "#ea580c" }} />
                            网络已断开，正在尝试重连…
                        </div>
                    ) : null}
                    {timeline.length === 0 && !sending && !waiting && !pendingTool && !pendingApprovals.length ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                            <div className="grid size-14 place-items-center rounded-2xl" style={{ background: theme.node.fill }}>
                                <Bot className="size-7" style={{ color: theme.node.muted }} />
                            </div>
                            <div>
                                <div className="text-sm font-medium" style={{ color: theme.node.text }}>{t("agent.chat.emptyTitle")}</div>
                                <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>{t("agent.chat.emptyHint")}</div>
                            </div>
                        </div>
                    ) : null}
                    {timeline.map((entry) => {
                        if (entry.type === "timestamp") return <AgentTimestampDivider key={entry.id} time={entry.time} theme={theme} />;
                        if (entry.type === "commands") return <AgentCommandGroupRow key={entry.id} items={entry.items} theme={theme} />;
                        return <AgentChatMessageRow key={entry.item.id} item={entry.item} theme={theme} onRegenerate={onRegenerate} onEditMessage={onEditMessage} />;
                    })}
                    {pendingTool ? (
                        <AgentPendingToolCard
                            summary={summarizeCanvasAgentOps(pendingTool.input?.ops || []) || toolName(pendingTool.name)}
                            detail={toolCallDetail(pendingTool.name, pendingTool.input, "pending")}
                            theme={theme}
                            onReject={onRejectTool}
                            onApprove={onApproveTool}
                        />
                    ) : null}
                    {pendingApprovals.map((approval) => <AgentApprovalCard key={approval.requestId} approval={approval} theme={theme} onDecision={(decision) => onApprovalDecision(approval, decision)} />)}
                    {(sending || waiting) && !streaming && !pendingTool && !pendingApprovals.length ? <AgentWorkingMessage text={working.text} detail={"detail" in working && typeof working.detail === "string" ? working.detail : undefined} activityKey={working.key} theme={theme} /> : null}
                </div>
            </div>
            {showScrollToBottom ? (
                <AgentScrollToBottom theme={theme} title={t("agent.chat.latestMessages")} onClick={() => scrollToBottom()} />
            ) : null}
            {selectionToolbar ? (
                <button
                    type="button"
                    className="fixed z-50 grid size-8 place-items-center rounded-lg shadow-lg canvas-float"
                    style={{ left: selectionToolbar.x, top: Math.max(8, selectionToolbar.y - 44), transform: "translateX(-50%)", background: theme.toolbar.panel, color: theme.node.text }}
                    onMouseDown={(event) => {
                        event.preventDefault();
                        copyText(selectionToolbar.text);
                        setSelectionToolbar(null);
                        window.getSelection()?.removeAllRanges();
                    }}
                    aria-label={t("copy")}
                >
                    <Copy className="size-4" />
                </button>
            ) : null}
        </div>
    );
}

export function AgentTaskProgress({ theme, busy }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; busy: boolean }) {
    const { t } = useTranslation();
    const plan = useAgentStore((state) => busy ? currentPlanMessage(state.messages) : latestPlanMessage(state.messages));
    if (!plan) return null;
    return (
        <div className="shrink-0 px-4 pt-2">
            <AgentToolCard key={plan.id} title={plan.title || t("agent.events.progress")} text={plan.text} detail={plan.detail} theme={theme} />
        </div>
    );
}

const AgentChatMessageRow = memo(function AgentChatMessageRow({ item, theme, onRegenerate, onEditMessage }: { item: AgentChatItem; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onRegenerate?: (messageId: string) => void; onEditMessage?: (messageId: string) => void }) {
    const endpoint = useAgentStore((state) => state.url);
    const token = useAgentStore((state) => state.token);
    return (
        <div style={item.streamId ? undefined : historyMessageStyle}>
            <AgentChatMessage
                item={agentMessageToChatMessage(item, endpoint, token)}
                theme={theme}
                onRegenerate={item.role === "assistant" && onRegenerate ? () => onRegenerate(item.id) : undefined}
                onEditMessage={item.role === "user" && onEditMessage ? () => onEditMessage(item.id) : undefined}
            />
        </div>
    );
});

const AgentCommandGroupRow = memo(function AgentCommandGroupRow({ items, theme }: { items: AgentChatItem[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <div style={items.some((item) => item.streamId) ? undefined : historyMessageStyle}>
            <AgentCommandGroup items={items} theme={theme} />
        </div>
    );
});

type AgentTimelineEntry = { type: "timestamp"; id: string; time: number } | { type: "message"; item: AgentChatItem } | { type: "commands"; id: string; items: AgentChatItem[] };

const TIMESTAMP_THRESHOLD_MS = 30 * 60 * 1000;

function groupTimelineMessages(messages: AgentChatItem[]) {
    const timeline: AgentTimelineEntry[] = [];
    let commands: AgentChatItem[] = [];
    let commandScope = "";
    let lastTime = 0;
    const flushCommands = () => {
        if (!commands.length) return;
        timeline.push({ type: "commands", id: `commands:${commands[0].id}`, items: commands });
        commands = [];
        commandScope = "";
    };
    const maybeInsertTimestamp = (currentTime: number) => {
        if (lastTime && currentTime - lastTime > TIMESTAMP_THRESHOLD_MS) {
            timeline.push({ type: "timestamp", id: `ts:${currentTime}`, time: currentTime });
        }
        if (currentTime) lastTime = currentTime;
    };
    messages.forEach((item) => {
        if (isPlanMessage(item)) return;
        const itemTime = item.timestamp || 0;
        if (isCommandMessage(item)) {
            const scope = item.threadId && item.turnId ? `${item.threadId}\0${item.turnId}` : item.id;
            if (commands.length && scope !== commandScope) flushCommands();
            commands.push(item);
            commandScope = scope;
            return;
        }
        flushCommands();
        maybeInsertTimestamp(itemTime);
        timeline.push({ type: "message", item });
    });
    flushCommands();
    return timeline;
}

function isCommandMessage(item: AgentChatItem) {
    return item.role === "tool" && item.detail && typeof item.detail === "object" && (item.detail as { kind?: unknown }).kind === "command";
}

export function AgentUsageBar({ usage, theme }: { usage: AgentTokenUsage; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const messages = useAgentStore((state) => state.messages);
    const turnCount = messages.filter((m) => m.role === "user").length;
    return (
        <div className="flex items-center justify-center gap-4 px-4 pt-1 text-[11px] tabular-nums" style={{ color: theme.node.muted }}>
            <span className="opacity-70">已聊 {turnCount} 轮</span>
            <span className="opacity-70">{t("agent.chat.latestCall")}</span>
            <UsageNumber label={t("agent.chat.input")} value={usage.input} color={theme.node.text} />
            <UsageNumber label={t("agent.chat.cached")} value={usage.cached} color={theme.node.text} />
            <UsageNumber label={t("agent.chat.output")} value={usage.output} color={theme.node.text} />
        </div>
    );
}

function UsageNumber({ label, value, color }: { label: string; value: number; color: string }) {
    const spring = useSpring(value, { stiffness: 110, damping: 24, mass: 0.7 });
    const text = useTransform(spring, (current) => Math.round(current).toLocaleString());
    useEffect(() => spring.set(value), [spring, value]);
    return (
        <span className="inline-flex items-baseline gap-1" aria-label={`${label} ${value.toLocaleString()}`}>
            <span>{label}</span>
            <motion.span aria-hidden className="font-medium" style={{ color }}>
                {text}
            </motion.span>
        </span>
    );
}

function AgentTimestampDivider({ time, theme }: { time: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const label = new Date(time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return (
        <div className="flex items-center gap-3 py-0.5">
            <div className="h-px flex-1" style={{ background: theme.node.stroke }} />
            <span className="shrink-0 text-[10px] tabular-nums" style={{ color: theme.node.muted }}>{label}</span>
            <div className="h-px flex-1" style={{ background: theme.node.stroke }} />
        </div>
    );
}
