import { useCallback, useEffect, useState } from "react";

export type Shortcut = {
    id: string;
    name: string;
    prompt: string;
};

const STORAGE_KEY = "chat-shortcuts";

const DEFAULT_SHORTCUTS: Shortcut[] = [
    { id: "default-1", name: "继续", prompt: "继续" },
    { id: "default-2", name: "解释一下", prompt: "用大白话解释一下刚才的内容" },
    { id: "default-3", name: "换个思路", prompt: "换个思路，重新做一遍" },
];

function loadShortcuts(): Shortcut[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_SHORTCUTS;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        return DEFAULT_SHORTCUTS;
    } catch {
        return DEFAULT_SHORTCUTS;
    }
}

function saveShortcuts(shortcuts: Shortcut[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts));
    } catch {
        // 存储失败静默忽略
    }
}

export function useShortcuts() {
    const [shortcuts, setShortcuts] = useState<Shortcut[]>(() => loadShortcuts());

    useEffect(() => {
        saveShortcuts(shortcuts);
    }, [shortcuts]);

    const addShortcut = useCallback((name: string, prompt: string) => {
        const item: Shortcut = { id: `sc-${Date.now()}`, name: name.trim(), prompt: prompt.trim() };
        setShortcuts((prev) => [...prev, item]);
    }, []);

    const removeShortcut = useCallback((id: string) => {
        setShortcuts((prev) => prev.filter((s) => s.id !== id));
    }, []);

    return { shortcuts, addShortcut, removeShortcut };
}
