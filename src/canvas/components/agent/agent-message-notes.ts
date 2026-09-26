const NOTE_PREFIX = "agent-msg-note:";
const HIGHLIGHT_PREFIX = "agent-msg-highlight:";

export function getMessageNote(messageId: string): string {
    try {
        return localStorage.getItem(NOTE_PREFIX + messageId) || "";
    } catch {
        return "";
    }
}

export function setMessageNote(messageId: string, note: string): void {
    try {
        if (note) {
            localStorage.setItem(NOTE_PREFIX + messageId, note);
        } else {
            localStorage.removeItem(NOTE_PREFIX + messageId);
        }
    } catch {
        // ignore
    }
}

export function getMessageHighlight(messageId: string): string {
    try {
        return localStorage.getItem(HIGHLIGHT_PREFIX + messageId) || "";
    } catch {
        return "";
    }
}

export function setMessageHighlight(messageId: string, color: string): void {
    try {
        if (color) {
            localStorage.setItem(HIGHLIGHT_PREFIX + messageId, color);
        } else {
            localStorage.removeItem(HIGHLIGHT_PREFIX + messageId);
        }
    } catch {
        // ignore
    }
}
