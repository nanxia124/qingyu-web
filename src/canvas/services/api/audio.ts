import axios from "axios";
import { nanoid } from "nanoid";

import i18n from "@canvas/i18n";
import { audioMimeType, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@canvas/lib/audio-generation";
import { uploadMediaFile, type UploadedFile } from "@canvas/services/file-storage";
import { billingProxyHeaders, buildApiUrl, resolveModelRequestConfig, resolveModelScript, withLocalProxy, type AiConfig } from "@canvas/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";
import { billingApi } from "@/lib/billing";
import { useBillingStore } from "@/stores/useBillingStore";

type RequestOptions = { signal?: AbortSignal };
const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);
export type AudioGenerationResult = { blob: Blob } | { generationOutput: { taskId: string; index: number } };

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...billingProxyHeaders(),
        "Content-Type": "application/json",
    };
}

export async function requestAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<AudioGenerationResult> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.audioModel);
    const model = requestConfig.model.trim();
    const format = normalizeAudioFormatValue(config.audioFormat);
    const script = resolveModelScript(config, config.model || config.audioModel);
    if (script) {
        if (!model) throw new Error(apiText("audioModelRequired"));
        if (!requestConfig.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
        if (!requestConfig.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
        try {
            const result = await runModelPlugin({
                capability: "audio",
                script,
                config: requestConfig,
                prompt,
                params: { voice: normalizeAudioVoiceValue(config.audioVoice), format, speed: normalizeAudioSpeedValue(config.audioSpeed), instructions: config.audioInstructions.trim() },
                signal: options?.signal,
            });
            return { blob: await audioPluginBlob(result, format) };
        } catch (error) {
            throw new Error(readAxiosError(error, apiText("audioGenerationFailed")));
        }
    }
    assertAudioConfig(requestConfig, model);
    const instructions = config.audioInstructions.trim();
    const parameters = { voice: normalizeAudioVoiceValue(config.audioVoice), format,
        speed: Number(normalizeAudioSpeedValue(config.audioSpeed)), instructions };
    const selectedModel = config.model || config.audioModel;
    const quote = await billingApi.quote({ model: selectedModel, taskType: "audio", prompt, parameters, quantity: 1 });
    const createdResponse = await fetch("/api/generation-tasks/media", {
        method: "POST", credentials: "include", signal: options?.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskType: "audio", model: selectedModel, prompt, idempotencyKey: `audio-task:${nanoid()}`,
            creditQuoteId: quote.id, parameters }),
    });
    const created = await createdResponse.json().catch(() => ({})) as { taskId?: string; error?: string };
    if (!createdResponse.ok || !created.taskId) throw new Error(created.error || apiText("audioGenerationFailed"));
    void useBillingStore.getState().refreshMe();
    return await pollServerAudioTask(created.taskId, options?.signal);
}

async function pollServerAudioTask(taskId: string, signal: AbortSignal | undefined): Promise<AudioGenerationResult> {
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const response = await fetch(`/api/generation-tasks/${encodeURIComponent(taskId)}`, { credentials: "include", signal, cache: "no-store" });
        const task = await response.json().catch(() => ({})) as { status?: string; errorMessage?: string; outputs?: Array<{ index?: number }> };
        if (!response.ok) throw new Error(apiText("audioGenerationFailed"));
        if (task.status === "succeeded") {
            void useBillingStore.getState().refreshMe();
            const index = Number(task.outputs?.[0]?.index ?? 0);
            return { generationOutput: { taskId, index } };
        }
        if (["failed", "refunded"].includes(task.status || "")) { void useBillingStore.getState().refreshMe(); throw new Error(task.errorMessage || apiText("audioGenerationFailed")); }
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve, 1500);
            signal?.addEventListener("abort", () => { clearTimeout(timeout); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
        });
    }
    throw new Error(apiText("audioGenerationFailed"));
}

async function audioPluginBlob(result: unknown, format: string): Promise<Blob> {
    if (result instanceof Blob) return result.type.startsWith("audio/") ? result : new Blob([result], { type: audioMimeType(format) });
    let source = "";
    if (typeof result === "string") source = result;
    else if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        source = typeof record.b64_json === "string" ? record.b64_json : typeof record.data === "string" ? record.data : typeof record.url === "string" ? record.url : "";
    }
    if (!source) throw new Error(apiText("scriptNoAudio"));
    const url = source.startsWith("data:") || /^https?:/i.test(source) ? source : `data:${audioMimeType(format)};base64,${source}`;
    const blob = await (await fetch(withLocalProxy(url))).blob();
    return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
}

export async function storeGeneratedAudio(result: AudioGenerationResult, format = "mp3", assetMetadata: Record<string, unknown> = {}): Promise<UploadedFile> {
    if ("generationOutput" in result) {
        const response = await fetch(`/api/generation-tasks/${encodeURIComponent(result.generationOutput.taskId)}/outputs/${result.generationOutput.index}/asset`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "生成音频", metadata: assetMetadata }),
        });
        const asset = await response.json().catch(() => ({})) as { id?: string; sizeBytes?: number; mimeType?: string; durationMs?: number; error?: string };
        if (!response.ok || !asset.id) throw new Error(asset.error || apiText("audioGenerationFailed"));
        const mimeType = asset.mimeType || "audio/mpeg";
        return { url: `/api/assets/${encodeURIComponent(asset.id)}/content`, storageKey: `audio:${asset.id}`,
            bytes: Number(asset.sizeBytes || 0), mimeType, ...(asset.durationMs != null ? { durationMs: asset.durationMs } : {}) };
    }
    const blob = result.blob;
    const audio = blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
    return uploadMediaFile(audio, "audio", { sourceKind: "generated", originalFilename: `generated-audio.${format}`, assetMetadata });
}

function assertAudioConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(apiText("audioModelRequired"));
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    if (config.apiFormat === "gemini") throw new Error(apiText("geminiAudioUnsupported"));
}

async function assertAudioBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || apiText("audioGenerationFailed"));
    if (payload.error?.message) throw new Error(payload.error.message);
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return apiText("htmlError", { preview: `${value.slice(0, 80)}...` });
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    const errorMsg =
        typeof payload.error === "string"
            ? payload.error
            : (payload.error as { message?: unknown })?.message;
    return (
        readApiErrorMessage(payload.msg) ||
        readApiErrorMessage(payload.message) ||
        readApiErrorMessage(errorMsg) ||
        readApiErrorMessage(payload.detail) ||
        ""
    );
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return apiText("requestCanceled");
    if (axios.isAxiosError(error)) {
        if (!error.response && error.code === "ERR_NETWORK") return apiText("requestFailed");
        const responseData = error.response?.data;
        const apiMsg = readApiErrorMessage(responseData);
        if (apiMsg) return apiMsg;
        const statusMsg = statusMessage(error.response?.status, fallback);
        if (statusMsg) return statusMsg;
        return error.message || fallback;
    }
    if (error instanceof DOMException && error.name === "AbortError") return apiText("requestCanceled");
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return apiText("authenticationFailed");
    if (status === 429) return apiText("rateLimited");
    if (status === 404) return apiText("notFound");
    if (status === 502) return apiText("badGateway");
    if (status === 503) return apiText("serviceBusy");
    return status ? apiText("httpFailed", { status }) : fallback;
}
