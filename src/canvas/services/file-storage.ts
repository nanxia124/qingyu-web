import localforage from "localforage";
import { nanoid } from "nanoid";

import { withLocalProxy } from "@canvas/stores/use-config-store";

export type UploadSourceKind = "generated" | "reference_upload" | "manual_upload" | "edited" | "derived";
export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };
export type MediaUploadOptions = {
    signal?: AbortSignal;
    sourceKind?: UploadSourceKind;
    sourceFileId?: string;
    previewVariant?: "thumbnail" | "video-cover";
    uploadBatchId?: string;
    originalFilename?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    writeIdempotencyKey?: string;
    completeness?: "complete" | "partial";
    assetMetadata?: Record<string, unknown>;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const uploadSessionStore = localforage.createInstance({ name: "infinite-canvas", storeName: "upload_sessions" });
const objectUrls = new Map<string, string>();

function assetIdFromStorageKey(storageKey: string) {
    const separator = storageKey.indexOf(":");
    if (separator < 0) return "";
    const id = storageKey.slice(separator + 1);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : "";
}

async function readResponseError(response: Response) {
    try {
        const payload = await response.json() as { error?: string };
        return payload.error || `文件操作失败（${response.status}）`;
    } catch {
        return `文件操作失败（${response.status}）`;
    }
}

function normalizedSourceKind(options: MediaUploadOptions): UploadSourceKind {
    const source = String(options.sourceKind || options.assetMetadata?.sourceKind || options.assetMetadata?.source || "");
    if (["generated", "image_generation", "video_generation", "audio_generation", "text_generation"].includes(source)) return "generated";
    if (["reference_upload", "reference"].includes(source)) return "reference_upload";
    if (source === "derived") return "derived";
    if (source === "edited") return "edited";
    return "manual_upload";
}

async function uploadViaSession(blob: Blob, title: string, metadata: Record<string, unknown>, signal?: AbortSignal, uploadBatchId?: string) {
    const fingerprintSize = Math.min(blob.size, 1024 * 1024);
    const firstChunk = await blob.slice(0, fingerprintSize).arrayBuffer();
    const lastChunk = await blob.slice(Math.max(0, blob.size - fingerprintSize)).arrayBuffer();
    const fingerprint = await crypto.subtle.digest("SHA-256", await new Blob([firstChunk, lastChunk]).arrayBuffer());
    const fingerprintText = Array.from(new Uint8Array(fingerprint), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const fileIdentity = `${title}:${blob.type}:${blob.size}:${typeof File !== "undefined" && blob instanceof File ? blob.lastModified : 0}:${metadata.sourceKind || ""}:${metadata.editId || ""}:${metadata.sourceFileId || ""}:${metadata.previewVariant || ""}:${metadata.writeIdempotencyKey || ""}:${fingerprintText}`;
    const sessionKey = `session:${btoa(unescape(encodeURIComponent(fileIdentity)))}`;
    let sessionId = await uploadSessionStore.getItem<string>(sessionKey).catch(() => null);
    let session: { sessionId?: string; fileId?: string; assetId?: string; sourceKind?: UploadSourceKind; partSizeBytes?: number; status?: string; parts?: Array<{ partNumber: number; sizeBytes: number }> };
    if (sessionId) {
        const response = await fetch(`/api/assets/upload-sessions/${sessionId}`, { cache: "no-store", signal, credentials: "include" });
        if (!response.ok) {
            await uploadSessionStore.removeItem(sessionKey).catch(() => undefined);
            sessionId = null;
        } else {
            session = await response.json();
            if (session.status === "completed" && (session.assetId || session.sourceKind === "derived")) {
                await uploadSessionStore.removeItem(sessionKey).catch(() => undefined);
                return session.sourceKind === "derived" ? session.fileId || "" : session.assetId || "";
            }
            if (!["uploading", "completing"].includes(session.status || "")) {
                await uploadSessionStore.removeItem(sessionKey).catch(() => undefined);
                sessionId = null;
            }
        }
    }
    if (!sessionId) {
        const response = await fetch("/api/assets/upload-sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title,
                mimeType: blob.type || "application/octet-stream",
                sizeBytes: blob.size,
                sourceKind: normalizedSourceKind({ assetMetadata: metadata }),
                mediaType: blob.type.startsWith("image/") ? "image" : blob.type.startsWith("video/") ? "video" : blob.type.startsWith("audio/") ? "audio" : blob.type.startsWith("text/") ? "text" : /pdf|document/i.test(blob.type) ? "document" : "other",
                width: metadata.width,
                height: metadata.height,
                durationMs: metadata.durationMs,
                completeness: metadata.completeness,
                sourceGenerationTaskId: metadata.sourceGenerationTaskId,
                editId: metadata.editId,
                sourceFileId: metadata.sourceFileId,
                previewVariant: metadata.previewVariant,
                writeIdempotencyKey: metadata.writeIdempotencyKey,
                uploadBatchId,
            }),
            signal,
            credentials: "include",
        });
        if (!response.ok) throw new Error(await readResponseError(response));
        session = await response.json();
        sessionId = session.sessionId || "";
        if (!sessionId) throw new Error("云端没有返回分片上传编号");
        await uploadSessionStore.setItem(sessionKey, sessionId);
    }

    const chunkSize = session.partSizeBytes || 16 * 1024 * 1024;
    const count = Math.ceil(blob.size / chunkSize);
    const uploaded = new Map((session.parts || []).map((part) => [part.partNumber, part.sizeBytes]));
    if (session.status !== "completing") {
        for (let partNumber = 1; partNumber <= count; partNumber += 1) {
            if (uploaded.get(partNumber) === Math.min(chunkSize, blob.size - (partNumber - 1) * chunkSize)) continue;
            const start = (partNumber - 1) * chunkSize;
            const chunk = blob.slice(start, Math.min(blob.size, start + chunkSize));
            let response: Response | null = null;
            for (let attempt = 0; attempt < 3; attempt += 1) {
                response = await fetch(`/api/assets/upload-sessions/${sessionId}/parts/${partNumber}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/octet-stream" },
                    body: chunk,
                    signal,
                    credentials: "include",
                });
                if (response.ok) break;
                if (response.status < 500 && response.status !== 429) throw new Error(await readResponseError(response));
                await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
            }
            if (!response?.ok) throw new Error(response ? await readResponseError(response) : "分片上传失败");
        }
    }
    const complete = await fetch(`/api/assets/upload-sessions/${sessionId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: { ...metadata, sourceKind: normalizedSourceKind({ assetMetadata: metadata }) } }),
        signal,
        credentials: "include",
    });
    if (!complete.ok) throw new Error(await readResponseError(complete));
    const asset = await complete.json() as { id?: string };
    if (!asset.id) throw new Error("云端没有返回文件编号，无法确认保存结果");
    await uploadSessionStore.removeItem(sessionKey).catch(() => undefined);
    return asset.id;
}

async function readRemoteFile(storageKey: string, signal?: AbortSignal) {
    const generatedOutput = storageKey.match(/^generation:([0-9a-f-]{36}):(\d+)$/i);
    const assetId = assetIdFromStorageKey(storageKey);
    if (!generatedOutput && !assetId) return null;
    const contentUrl = generatedOutput
        ? `/api/generation-tasks/${encodeURIComponent(generatedOutput[1])}/outputs/${generatedOutput[2]}/content`
        : storageKey.startsWith("file:")
            ? `/api/files/${assetId}/content`
            : `/api/assets/${assetId}/content`;
    const response = await fetch(contentUrl, { cache: "no-store", signal, credentials: "include" });
    if (!response.ok) throw new Error(await readResponseError(response));
    return response.blob();
}

async function cacheBlob(storageKey: string, blob: Blob) {
    // IndexedDB is only a local cache; COS remains the durable copy.
    await store.setItem(storageKey, blob).catch(() => undefined);
    const oldUrl = objectUrls.get(storageKey);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function uploadMediaFile(input: string | Blob, prefix = "file", options: MediaUploadOptions = {}): Promise<UploadedFile> {
    let blob: Blob;
    if (typeof input === "string") {
        const source = await fetch(withLocalProxy(input), { signal: options.signal });
        if (!source.ok) throw new Error(`读取待保存文件失败（${source.status}）`);
        blob = await source.blob();
    } else {
        blob = input;
    }
    const extension = blob.type.split("/")[1]?.split(";")[0]?.replace(/[^a-z0-9.+-]/gi, "") || "bin";
    const inputFilename = typeof File !== "undefined" && input instanceof File ? input.name : "";
    const originalFilename = (options.originalFilename?.trim() || inputFilename || `${prefix}-${nanoid()}.${extension}`).slice(0, 240);
    const sourceKind = normalizedSourceKind(options);
    if (sourceKind === "derived" && (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.sourceFileId || "")
        || !options.previewVariant || !["thumbnail", "video-cover"].includes(options.previewVariant) || !blob.type.startsWith("image/"))) {
        throw new Error("预览文件必须是图片，并提供有效的原文件编号和预览规格");
    }
    const metadata = {
        ...(options.assetMetadata || {}),
        sourceKind,
        ...(sourceKind === "derived" ? { sourceFileId: options.sourceFileId, previewVariant: options.previewVariant } : {}),
        ...(options.writeIdempotencyKey ? { writeIdempotencyKey: options.writeIdempotencyKey } : {}),
        ...(options.width ? { width: options.width } : {}),
        ...(options.height ? { height: options.height } : {}),
        ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
        ...(blob.type.startsWith("text/") ? { completeness: options.completeness || "complete" } : {}),
    };
    const assetId = await uploadViaSession(blob, originalFilename, metadata, options.signal, options.uploadBatchId);

    const storageKey = sourceKind === "derived" ? `file:${assetId}` : `${prefix}:${assetId}`;
    const url = await cacheBlob(storageKey, blob);
    const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
    return {
        url,
        storageKey,
        bytes: blob.size,
        mimeType: blob.type || "application/octet-stream",
        ...(options.width ? { width: options.width } : {}),
        ...(options.height ? { height: options.height } : {}),
        ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
        ...meta,
    };
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey).catch(() => null) || await readRemoteFile(storageKey);
    if (!blob) return fallback;
    return cacheBlob(storageKey, blob);
}

export async function getMediaBlob(storageKey: string) {
    const cached = await store.getItem<Blob>(storageKey).catch(() => null);
    if (cached) return cached;
    const remote = await readRemoteFile(storageKey);
    if (remote) await cacheBlob(storageKey, remote);
    return remote;
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    return cacheBlob(storageKey, blob);
}

export async function readMediaText(storageKey: string) {
    const blob = await getMediaBlob(storageKey);
    if (!blob) return null;
    return blob.text();
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            // COS is the permanent copy. This only evicts the browser cache.
            await store.removeItem(key).catch(() => undefined);
        }),
    );
}

export async function cleanupUnusedMedia(usedData: unknown) {
    const usedKeys = collectMediaStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredMedia(unused);
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}
