import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@canvas/lib/localforage-storage";
import { cleanupUnusedImages, ensureImagePreview, previewUrlFor, resolveImageUrl, uploadImage } from "@canvas/services/image-storage";
import { cleanupUnusedMedia, readMediaText, resolveMediaUrl, uploadMediaFile } from "@canvas/services/file-storage";

export type AssetKind = "text" | "image" | "video" | "audio" | "file";
export type TextAsset = AssetBase<"text"> & { data: { content: string; storageKey?: string; textChecksum?: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type AudioAsset = AssetBase<"audio"> & { data: { url: string; storageKey: string; bytes: number; mimeType: string } };
export type FileAsset = AssetBase<"file"> & { data: { url: string; storageKey: string; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset | AudioAsset | FileAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => void;
};

// 卡片用缩略图渲染，自定义封面（远程地址或单独上传的封面）保持原样。
export function assetCoverUrl(asset: Asset) {
    const own = asset.kind === "image" ? asset.data.dataUrl : "";
    const cover = asset.coverUrl || own;
    return asset.kind === "image" && cover === own ? previewUrlFor(asset.data.storageKey) || cover : cover;
}

const ASSET_STORE_KEY = "infinite-canvas:asset_store";

function legacyAssetSourceKind(asset: Asset): "generated" | "reference_upload" | "manual_upload" {
    const metadata = asset.metadata || {};
    const explicit = String(metadata.sourceKind || "").toLowerCase();
    if (explicit === "generated" || explicit === "reference_upload" || explicit === "manual_upload") return explicit;
    const source = `${asset.source || ""} ${String(metadata.source || "")}`.toLowerCase();
    if (/(reference|reference-upload)/.test(source)) return "reference_upload";
    if (["generated", "image_generation", "video_generation", "audio_generation", "text_generation"].includes(source.trim()) || /agent|image-page|video-page/.test(source) || Boolean(metadata.model || metadata.generationType)) return "generated";
    // “来自画布”只能说明它在哪创建或整理，不能证明文件由 AI 生成。
    return "manual_upload";
}

export async function checksumTextAsset(value: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function externalizeTextAsset(asset: TextAsset): Promise<TextAsset> {
    const content = asset.data.content || "";
    if (!content) return { ...asset, data: { ...asset.data, content: "" } };
    const textChecksum = await checksumTextAsset(content);
    if (asset.data.storageKey && asset.data.textChecksum === textChecksum) return { ...asset, data: { ...asset.data, content: "" } };
    const sourceKind = legacyAssetSourceKind(asset);
    const file = await uploadMediaFile(new Blob([content], { type: "text/plain;charset=utf-8" }), "text", {
        sourceKind,
        originalFilename: `${asset.title || "text-asset"}.txt`,
        completeness: "complete",
    });
    return { ...asset, data: { content: "", storageKey: file.storageKey, textChecksum } };
}

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        const hydratedAssets: Asset[] = await Promise.all(
            parsed.state.assets.map(async (asset): Promise<Asset> => {
                if (asset.kind === "text") {
                    const remoteText = asset.data.storageKey ? await readMediaText(asset.data.storageKey).catch(() => null) : null;
                    const content = remoteText ?? asset.data.content ?? "";
                    if (!content) return { ...asset, data: { ...asset.data, content: "" } };
                    const hydrated = { ...asset, data: { ...asset.data, content } };
                    return hydrated;
                }
                if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind === "audio") return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind === "file") return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind !== "image") return asset;
                if (asset.data.storageKey) {
                    void ensureImagePreview(asset.data.storageKey);
                    return {
                        ...asset,
                        coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.coverUrl) : asset.coverUrl,
                        data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) },
                    };
                }
                if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
                const sourceKind = legacyAssetSourceKind(asset);
                const image = await uploadImage(asset.data.dataUrl, { sourceKind, originalFilename: `${asset.title || "asset-image"}.png` });
                return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } };
            }),
        );
        parsed.state.assets = await Promise.all(hydratedAssets.map(async (asset) => {
            if (asset.kind !== "text") return asset;
            try { return await externalizeTextAsset(asset); }
            catch { return asset; }
        }));
        try { await localForageStorage.setItem(name, JSON.stringify(parsed)); } catch { /* 保留已读取的内存资产 */ }
        return { ...parsed, state: { ...parsed.state, assets: hydratedAssets } };
    },
    setItem: async (name, value) => {
        try {
            const assets = await Promise.all(value.state.assets.map((asset) => asset.kind === "text" ? externalizeTextAsset(asset) : asset));
            await localForageStorage.setItem(name, JSON.stringify({ ...value, state: { ...value.state, assets } }));
        } catch (error) {
            console.error("[asset-storage] COS 文本保存失败，保留本机草稿", error);
            try { await localForageStorage.setItem(name, JSON.stringify(value)); } catch { /* 本机草稿缓存不可用时保留内存状态 */ }
        }
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            assets: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                return id;
            },
            updateAsset: (id, patch) =>
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                })),
            removeAsset: (id) =>
                set((state) => {
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    get().cleanupImages({ assets });
                    return { assets };
                }),
            replaceAssets: (assets) => set({ assets }),
            cleanupImages: (extra) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@canvas/stores/canvas/use-canvas-store");
                    await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => () => {
                useAssetStore.setState({ hydrated: true });
            },
        },
    ),
);
