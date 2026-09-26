import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import i18n from "@canvas/i18n";
import { localForageStorage } from "@canvas/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@canvas/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@canvas/types/canvas";
import { readMediaText, resolveMediaUrl, uploadMediaFile } from "@canvas/services/file-storage";

export type CanvasProject = {
    id: string;
    serverVersion?: number;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

export type CanvasDeletedProject = {
    id: string;
    deletedAt: string;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    deletedProjects: CanvasDeletedProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects" | "deletedProjects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;
let canvasWriteQueue: Promise<void> = Promise.resolve();
const canvasServerVersions = new Map<string, number>();
const canvasSyncedSnapshots = new Map<string, string>();
const pendingConflictRemotes = new Map<string, CanvasProject>();
export type CanvasSyncIssue = { id: string; kind: "VERSION_CONFLICT" | "SYNC_FAILED"; projectId: string; title: string };
const pendingCanvasSyncIssues = new Map<string, CanvasSyncIssue>();
const canvasSyncIssueListeners = new Set<(issue: CanvasSyncIssue) => void>();

function publishCanvasSyncIssue(issue: Omit<CanvasSyncIssue, "id">) {
    const id = `${issue.kind}:${issue.projectId}`;
    const completeIssue = { ...issue, id };
    pendingCanvasSyncIssues.set(id, completeIssue);
    canvasSyncIssueListeners.forEach((listener) => listener(completeIssue));
}

export function subscribeCanvasSyncIssues(listener: (issue: CanvasSyncIssue) => void) {
    canvasSyncIssueListeners.add(listener);
    pendingCanvasSyncIssues.forEach(listener);
    return () => { canvasSyncIssueListeners.delete(listener); };
}

export function acknowledgeCanvasSyncIssue(id: string) {
    pendingCanvasSyncIssues.delete(id);
}

async function fetchRemoteCanvasState(): Promise<PersistedCanvasState | null> {
    if (typeof window === "undefined") return null;
    try {
        const response = await fetch("/api/canvas/projects", { cache: "no-store", credentials: "include" });
        if (!response.ok) return null;
        const data = await response.json() as PersistedCanvasState;
        return Array.isArray(data.projects) ? data : null;
    } catch {
        return null;
    }
}

async function syncCanvasState(value: PersistedCanvasState, storageName: string) {
    const projects = value.projects.map((project) => ({
        ...project,
        serverVersion: canvasServerVersions.get(project.id) ?? project.serverVersion,
    }));
    const response = await fetch("/api/canvas/projects/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...value, projects }),
        credentials: "include",
    });
    const result = await response.json().catch(() => ({})) as {
        code?: string;
        error?: string;
        conflicts?: Array<{ projectId: string; serverVersion: number | null }>;
        versions?: Array<{ id: string; serverVersion: number }>;
    };
    if (response.status === 409 && result.code === "VERSION_CONFLICT") {
        const byId = new Map(value.projects.map((project) => [project.id, project]));
        for (const conflict of result.conflicts || []) {
            const project = byId.get(conflict.projectId);
            publishCanvasSyncIssue({ kind: "VERSION_CONFLICT", projectId: conflict.projectId, title: project?.title || "画布" });
        }
        return;
    }
    if (!response.ok) throw new Error(result.error || "云端保存失败");
    for (const saved of result.versions || []) {
        canvasServerVersions.set(saved.id, saved.serverVersion);
        const syncedProject = value.projects.find((project) => project.id === saved.id);
        if (syncedProject) canvasSyncedSnapshots.set(saved.id, canvasProjectContent(syncedProject));
    }
    await localForageStorage.setItem(`${storageName}:synced_snapshots`, JSON.stringify(Object.fromEntries(canvasSyncedSnapshots)));
    const stored = await localForageStorage.getItem(storageName);
    if (stored) {
        try {
            const persisted = JSON.parse(stored) as StorageValue<CanvasStore>;
            const state = persisted.state as PersistedCanvasState;
            const versionedState = {
                ...state,
                projects: state.projects.map((project) => {
                    const serverVersion = canvasServerVersions.get(project.id);
                    return serverVersion ? { ...project, serverVersion } : project;
                }),
            };
            await localForageStorage.setItem(storageName, JSON.stringify({ ...persisted, state: versionedState }));
        } catch (error) {
            console.warn("[canvas-storage] 云端版本号已更新，但本机版本标记暂未写入", error);
        }
    }
}

async function checksumText(value: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function storeCanvasText(value: string, storageKey: string | undefined, previousChecksum: string | undefined, filename: string, sourceKind: "generated" | "reference_upload" | "manual_upload" = "generated") {
    const textChecksum = await checksumText(value);
    if (storageKey && previousChecksum === textChecksum) return { storageKey, textChecksum };
    const file = await uploadMediaFile(new Blob([value], { type: "text/plain;charset=utf-8" }), "text", {
        sourceKind,
        originalFilename: filename,
        completeness: "complete",
        writeIdempotencyKey: `canvas-text:${filename.slice(0, 80)}:${textChecksum}`,
    });
    return { storageKey: file.storageKey, textChecksum };
}

function hasGeneratingCanvasContent(state: PersistedCanvasState) {
    return state.projects.some((project) => project.nodes.some((node) => {
        const metadata = node.metadata;
        return metadata?.status === "loading"
            || metadata?.texts?.some((item) => item.status === "loading")
            || metadata?.images?.some((item) => item.status === "loading");
    }));
}

async function externalizeAssistantMessages(sessions: CanvasProject["chatSessions"]) {
    return Promise.all(sessions.map(async (session) => ({
        ...session,
        messages: await Promise.all(session.messages.map(async (message) => {
            let nextMessage = message;
            if (message.text) {
                const reference = await storeCanvasText(message.text, message.textStorageKey, message.textChecksum, `canvas-chat-${message.id}.txt`, message.role === "user" ? "manual_upload" : "generated");
                nextMessage = { ...nextMessage, text: "", textStorageKey: reference.storageKey, textChecksum: reference.textChecksum };
            }
            if (Array.isArray(message.references)) {
                nextMessage = {
                    ...nextMessage,
                    references: await Promise.all(message.references.map(async (reference) => {
                        if (reference.type === "text" && reference.text) {
                            const stored = await storeCanvasText(reference.text, reference.storageKey, reference.textChecksum, `canvas-chat-reference-${reference.id}.txt`, "reference_upload");
                            return { ...reference, ...stored, text: undefined, dataUrl: undefined };
                        }
                        if (reference.storageKey) return { ...reference, dataUrl: undefined };
                        if (!reference.dataUrl) return reference;
                        const prefix = reference.type === "video" ? "video" : reference.type === "audio" ? "audio" : "image";
                        const ext = prefix === "video" ? "mp4" : prefix === "audio" ? "mp3" : "png";
                        const stored = await uploadMediaFile(reference.dataUrl, prefix, { sourceKind: "reference_upload", originalFilename: `canvas-reference-${reference.id}.${ext}` });
                        return { ...reference, storageKey: stored.storageKey, dataUrl: undefined };
                    })),
                };
            }
            return nextMessage;
        })),
    })));
}

async function hydrateAssistantMessages(sessions: CanvasProject["chatSessions"]) {
    return Promise.all(sessions.map(async (session) => ({
        ...session,
        messages: await Promise.all(session.messages.map(async (message) => {
            let nextMessage = message;
            if (!message.text && message.textStorageKey) {
                const text = await readMediaText(message.textStorageKey).catch(() => null);
                if (text !== null) nextMessage = { ...nextMessage, text };
            }
            if (Array.isArray(message.references)) {
                nextMessage = {
                    ...nextMessage,
                    references: await Promise.all(message.references.map(async (reference) => {
                        if (reference.type === "text" && !reference.text && reference.storageKey) {
                            const text = await readMediaText(reference.storageKey).catch(() => null);
                            return text === null ? reference : { ...reference, text };
                        }
                        if (reference.storageKey && !reference.dataUrl && reference.type !== "text") {
                            const url = await resolveMediaUrl(reference.storageKey).catch(() => "");
                            if (url) return { ...reference, dataUrl: url };
                        }
                        return reference;
                    })),
                };
            }
            return nextMessage;
        })),
    })));
}

async function externalizeCanvasText(state: PersistedCanvasState): Promise<PersistedCanvasState> {
    const projects = await Promise.all(state.projects.map(async (project) => ({
        ...project,
        chatSessions: await externalizeAssistantMessages(project.chatSessions),
        nodes: await Promise.all(project.nodes.map(async (node) => {
            const metadata = node.metadata;
            if (!metadata) return node;
            let nextMetadata = metadata;
            if (node.type === "text" && typeof metadata.content === "string" && metadata.content.length > 0) {
                const reference = await storeCanvasText(metadata.content, metadata.storageKey, metadata.textChecksum, `canvas-text-${node.id}.txt`);
                nextMetadata = { ...nextMetadata, ...reference };
                delete nextMetadata.content;
            } else if (["image", "video", "audio"].includes(node.type) && typeof metadata.content === "string" && metadata.content) {
                const prefix = node.type;
                if (!metadata.storageKey) {
                    const stored = await uploadMediaFile(metadata.content, prefix, { sourceKind: "generated", originalFilename: `${node.title || node.id}.${prefix === "image" ? "png" : prefix === "video" ? "mp4" : "mp3"}` });
                    nextMetadata = { ...nextMetadata, storageKey: stored.storageKey };
                }
                delete nextMetadata.content;
            }
            if (Array.isArray(metadata.texts)) {
                nextMetadata = {
                    ...nextMetadata,
                    texts: await Promise.all(metadata.texts.map(async (item) => {
                        if (!item.content) {
                            const { content: _content, ...withoutContent } = item;
                            return withoutContent;
                        }
                        const reference = await storeCanvasText(item.content, item.storageKey, item.textChecksum, `canvas-text-${node.id}-${item.id}.txt`);
                        const { content: _content, ...withoutContent } = item;
                        return { ...withoutContent, ...reference };
                    })),
                };
            }
            if (Array.isArray(metadata.images)) {
                nextMetadata = {
                    ...nextMetadata,
                    images: await Promise.all(metadata.images.map(async (image) => {
                        if (image.storageKey) return { ...image, content: "" };
                        if (!image.content) return image;
                        const stored = await uploadMediaFile(image.content, "image", { sourceKind: "generated", originalFilename: `canvas-image-${node.id}-${image.id}.png`, width: image.naturalWidth, height: image.naturalHeight });
                        return { ...image, content: "", storageKey: stored.storageKey };
                    })),
                };
            }
            if (Array.isArray(metadata.references)) {
                nextMetadata = {
                    ...nextMetadata,
                    references: await Promise.all(metadata.references.map(async (reference, index) => {
                        if (/^(image|video|audio|text):/.test(reference)) return reference;
                        if (!/^(?:data:|blob:|https?:\/\/)/i.test(reference)) return reference;
                        const stored = await uploadMediaFile(reference, "image", { sourceKind: "reference_upload", originalFilename: `canvas-reference-${node.id}-${index + 1}.png` });
                        return stored.storageKey;
                    })),
                };
            }
            if (Array.isArray(metadata.uploadedImages)) {
                const uploadedImages: string[] = [];
                const uploadedImageStorageKeys: string[] = [];
                for (const [index, imageUrl] of metadata.uploadedImages.entries()) {
                    const existingKey = metadata.uploadedImageStorageKeys?.[index];
                    if (existingKey) {
                        uploadedImages.push(existingKey);
                        uploadedImageStorageKeys.push(existingKey);
                    } else {
                        const stored = await uploadMediaFile(imageUrl, "image", { sourceKind: "reference_upload", originalFilename: `canvas-reference-${node.id}-${index + 1}.png` });
                        uploadedImages.push(stored.storageKey);
                        uploadedImageStorageKeys.push(stored.storageKey);
                    }
                }
                nextMetadata = { ...nextMetadata, uploadedImages, uploadedImageStorageKeys };
            }
            return nextMetadata === metadata ? node : { ...node, metadata: nextMetadata };
        })),
    })));
    return { ...state, projects };
}

async function hydrateCanvasText(state: PersistedCanvasState): Promise<PersistedCanvasState> {
    const projects = await Promise.all(state.projects.map(async (project) => ({
        ...project,
        chatSessions: await hydrateAssistantMessages(project.chatSessions),
        nodes: await Promise.all(project.nodes.map(async (node) => {
            const metadata = node.metadata;
            if (!metadata) return node;
            let nextMetadata = metadata;
            if (node.type === "text" && metadata.storageKey && typeof metadata.content !== "string") {
                const content = await readMediaText(metadata.storageKey).catch(() => null);
                if (content !== null) nextMetadata = { ...nextMetadata, content };
            } else if (["image", "video", "audio"].includes(node.type) && metadata.storageKey && !metadata.content) {
                const content = await resolveMediaUrl(metadata.storageKey).catch(() => "");
                if (content) nextMetadata = { ...nextMetadata, content };
            }
            if (Array.isArray(metadata.texts)) {
                nextMetadata = {
                    ...nextMetadata,
                    texts: await Promise.all(metadata.texts.map(async (item) => {
                        if (typeof item.content === "string" || !item.storageKey) return item;
                        const content = await readMediaText(item.storageKey).catch(() => null);
                        return content === null ? item : { ...item, content };
                    })),
                };
            }
            if (Array.isArray(metadata.images)) {
                nextMetadata = {
                    ...nextMetadata,
                    images: await Promise.all(metadata.images.map(async (image) => {
                        if (image.content || !image.storageKey) return image;
                        const content = await resolveMediaUrl(image.storageKey).catch(() => "");
                        return content ? { ...image, content } : image;
                    })),
                };
            }
            if (Array.isArray(metadata.uploadedImages)) {
                const uploadedImages = await Promise.all(metadata.uploadedImages.map(async (value, index) => {
                    const storageKey = metadata.uploadedImageStorageKeys?.[index] || (/^(image|video|audio):/.test(value) ? value : "");
                    if (!storageKey) return value;
                    return (await resolveMediaUrl(storageKey).catch(() => "")) || value;
                }));
                nextMetadata = { ...nextMetadata, uploadedImages };
            }
            return nextMetadata === metadata ? node : { ...node, metadata: nextMetadata };
        })),
    })));
    return { ...state, projects };
}

async function migrateCanvasState(name: string, value: StorageValue<CanvasStore> | null, state: PersistedCanvasState, syncRemote: boolean) {
    const externalized = await externalizeCanvasText(state);
    await localForageStorage.setItem(name, JSON.stringify({ ...(value || { version: 0 }), state: externalized }));
    if (syncRemote) await syncCanvasState(externalized, name);
    return hydrateCanvasText(externalized);
}

function canvasProjectContent(project: CanvasProject) {
    return JSON.stringify({
        title: project.title,
        nodes: project.nodes,
        connections: project.connections,
        chatSessions: project.chatSessions.map(({ id, title, messages }) => ({ id, title, messages })),
        backgroundMode: project.backgroundMode,
        showImageInfo: project.showImageInfo,
        viewport: project.viewport,
    });
}

function mergeRemoteCanvasState(local: PersistedCanvasState, remote: PersistedCanvasState): { state: PersistedCanvasState; shouldSync: boolean } {
    let shouldSync = false;
    const remoteById = new Map(remote.projects.map((project) => [project.id, project]));
    const mergedProjects = local.projects.map((localProject) => {
        const remoteProject = remoteById.get(localProject.id);
        if (!remoteProject) { shouldSync = true; return localProject; }
        remoteById.delete(localProject.id);
        const localContent = canvasProjectContent(localProject);
        const remoteContent = canvasProjectContent(remoteProject);
        if (localContent === remoteContent) {
            canvasServerVersions.set(remoteProject.id, remoteProject.serverVersion || 1);
            canvasSyncedSnapshots.set(remoteProject.id, remoteContent);
            return remoteProject;
        }
        const lastSyncedContent = canvasSyncedSnapshots.get(localProject.id);
        if (lastSyncedContent !== undefined && localContent === lastSyncedContent) {
            canvasServerVersions.set(remoteProject.id, remoteProject.serverVersion || 1);
            canvasSyncedSnapshots.set(remoteProject.id, remoteContent);
            return remoteProject;
        }
        if (localProject.serverVersion === remoteProject.serverVersion) {
            canvasServerVersions.set(remoteProject.id, remoteProject.serverVersion || 1);
            shouldSync = true;
            return localProject;
        }
        pendingConflictRemotes.set(localProject.id, remoteProject);
        publishCanvasSyncIssue({ kind: "VERSION_CONFLICT", projectId: localProject.id, title: localProject.title || "画布" });
        return localProject;
    });
    return { state: { ...local, projects: [...mergedProjects, ...remoteById.values()] }, shouldSync };
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const snapshotsRaw = await Promise.resolve(localForageStorage.getItem(`${name}:synced_snapshots`)).catch(() => null);
        if (snapshotsRaw) {
            try {
                const parsed = JSON.parse(snapshotsRaw) as Record<string, string>;
                for (const [key, value] of Object.entries(parsed)) canvasSyncedSnapshots.set(key, value);
            } catch { /* 忽略损坏的指纹缓存 */ }
        }
        const value = await localForageStorage.getItem(name);
        if (!value) {
            const remote = await fetchRemoteCanvasState();
            if (!remote) return null;
            remote.projects.forEach((project) => canvasServerVersions.set(project.id, project.serverVersion || 1));
            let state: PersistedCanvasState;
            try {
                state = await migrateCanvasState(name, null, remote, false);
            } catch (error) {
                console.warn("[canvas-storage] 云端文本迁移暂不可用，保留现有画布状态", error);
                state = remote;
            }
            return { state: state as CanvasStore, version: 0 };
        }
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        const remote = await fetchRemoteCanvasState();
        const merged = remote ? mergeRemoteCanvasState(parsed.state as PersistedCanvasState, remote) : null;
        const state = merged?.state || parsed.state as PersistedCanvasState;
        state.projects.forEach((project) => {
            if (project.serverVersion && !canvasServerVersions.has(project.id)) canvasServerVersions.set(project.id, project.serverVersion);
        });
        let hydrated: PersistedCanvasState;
        try {
            hydrated = await migrateCanvasState(name, parsed, state, merged ? merged.shouldSync : true);
        } catch (error) {
            console.warn("[canvas-storage] 云端文本迁移暂不可用，保留本机画布状态", error);
            hydrated = state;
        }
        queuedPersistState = hydrated;
        return { ...parsed, state: hydrated as CanvasStore };
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects && queuedPersistState.deletedProjects === nextState.deletedProjects) return;
        queuedPersistState = nextState;
        if (saveTimer) clearTimeout(saveTimer);
        if (hasGeneratingCanvasContent(nextState)) {
            void Promise.resolve(localForageStorage.setItem(name, JSON.stringify(value))).catch((error) => {
                console.error("[canvas-storage] 生成中的本机草稿保存失败", error);
            });
            return;
        }
        saveTimer = setTimeout(() => {
            saveTimer = null;
            canvasWriteQueue = canvasWriteQueue.then(async () => {
                const externalized = await externalizeCanvasText(nextState);
                await localForageStorage.setItem(name, JSON.stringify({ ...value, state: externalized }));
                try {
                    await syncCanvasState(externalized, name);
                } catch (error) {
                    console.error("[canvas-storage] 云端画布同步失败，本机草稿已保留", error);
                    for (const project of externalized.projects) {
                        publishCanvasSyncIssue({ kind: "SYNC_FAILED", projectId: project.id, title: project.title || "画布" });
                    }
                }
            }).catch((error) => {
                console.error("[canvas-storage] COS 文本保存失败，跳过本次画布快照", error);
                void Promise.resolve(localForageStorage.setItem(name, JSON.stringify(value))).then(() => {
                    for (const project of nextState.projects) {
                        publishCanvasSyncIssue({ kind: "SYNC_FAILED", projectId: project.id, title: project.title || "画布" });
                    }
                }).catch((draftError) => {
                    console.error("[canvas-storage] COS 保存失败后，本机草稿也未能保存", draftError);
                });
            });
        }, 400);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export async function acceptRemoteCanvasVersion(projectId: string) {
    const remoteProject = pendingConflictRemotes.get(projectId);
    if (!remoteProject) return;
    pendingConflictRemotes.delete(projectId);
    canvasServerVersions.set(projectId, remoteProject.serverVersion || 1);
    canvasSyncedSnapshots.set(projectId, canvasProjectContent(remoteProject));
    const hydrated = await hydrateCanvasText({ projects: [remoteProject], deletedProjects: [] });
    const hydratedProject = hydrated.projects[0];
    const current = useCanvasStore.getState().projects;
    const nextProjects = current.map((project) => (project.id === projectId ? hydratedProject : project));
    useCanvasStore.setState({ projects: nextProjects });
}

export async function forcePushLocalCanvas(projectId: string) {
    const remoteProject = pendingConflictRemotes.get(projectId);
    if (!remoteProject) return;
    pendingConflictRemotes.delete(projectId);
    const remoteVersion = remoteProject.serverVersion || 1;
    canvasServerVersions.set(projectId, remoteVersion);
    const current = useCanvasStore.getState().projects;
    const nextProjects = current.map((project) => (project.id === projectId ? { ...project, serverVersion: remoteVersion } : project));
    useCanvasStore.setState({ projects: nextProjects });
}

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            deletedProjects: [],
            createProject: (title = i18n.t("canvas.project.untitled")) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || i18n.t("canvas.project.imported"),
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const now = new Date().toISOString();
                    const removing = new Set(ids);
                    const projects = state.projects.filter((project) => !removing.has(project.id));
                    const deletedProjects = [...state.deletedProjects.filter((item) => !removing.has(item.id)), ...ids.map((id) => ({ id, deletedAt: now }))];
                    return { projects, deletedProjects };
                }),
            replaceProjects: (projects, deletedProjects = []) => set({ projects, deletedProjects }),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                    deletedProjects: state.deletedProjects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);
