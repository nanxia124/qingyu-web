import axios from "axios";

import i18n from "@canvas/i18n";
import { resolveModelRequestConfig, type AiConfig, type ModelChannel } from "@canvas/stores/use-config-store";
import { billingApi } from "@/lib/billing";
import { nanoid } from "nanoid";
import { buildImageReferencePromptText } from "@canvas/lib/image-reference-prompt";
import { imageSizePresets, inferMediaScale } from "@canvas/lib/media-size";
import type { ReferenceImage } from "@canvas/types/image";
import { pollImageTask, submitImageTask, type GenTask } from "@/lib/generationTasks";
import { uploadMediaFile } from "@canvas/services/file-storage";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

type ResponseInputMessage = AiTextMessage;
type ResponseInputContent = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };
type ResponseInputItem = { role: "system" | "user" | "assistant"; content: string | ResponseInputContent[] };
type ResponseApiPayload = { models?: Array<{ name?: string }>; error?: { message?: string } };
type GeminiPart = { text?: string };
type GeminiContent = { role?: "user" | "model"; parts: GeminiPart[] };
type GeminiPayload = { models?: Array<{ name?: string }>; error?: { message?: string } };






type RequestOptions = { signal?: AbortSignal };

function withSystemMessage(config: AiConfig, messages: AiTextMessage[]) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
}

function toResponseInput(messages: ResponseInputMessage[]): ResponseInputItem[] {
    return messages.map((message) => ({ role: message.role, content: toResponseContent(message.content || "") }));
}

function toResponseContent(content: AiTextMessage["content"]): string | ResponseInputContent[] {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => item.type === "text" ? { type: "input_text", text: item.text } : { type: "input_image", image_url: item.image_url.url });
}

function toGeminiBody(config: AiConfig, messages: AiTextMessage[]) {
    const systemText = [config.systemPrompt.trim(), ...messages.filter((message) => message.role === "system").map((message) => String(message.content))].filter(Boolean).join("\n\n");
    const contents: GeminiContent[] = messages.filter((message) => message.role !== "system").map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: Array.isArray(message.content) ? message.content.map((part) => part.type === "text" ? part.text : part.image_url.url).join("\n") : message.content }],
    }));
    return { contents, ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}) };
}

function validateGeminiPayload(payload: GeminiPayload) {
    if (payload.error?.message) throw new Error(payload.error.message);
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isAxiosError(error)) return error.message || fallback;
    return error instanceof Error ? error.message : fallback;
}

export function buildImageTaskRequest(config: AiConfig, prompt: string, count: number, references: ReferenceImage[]) {
    const selectedModel = (config.imageModel || config.model).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    if (!selectedModel) return null;
    const referenceAssetIds = references.map((reference) => {
        const match = reference.storageKey?.match(/^image:([0-9a-f-]{36})$/i);
        return match?.[1] || "";
    });
    if (referenceAssetIds.some((id) => !id)) return null;
    const quality = normalizeQuality(config.quality);
    const size = resolveRequestSize(quality, config.size);
    const background = normalizeBackground(config.background);
    const requestPrompt = buildImageReferencePromptText(prompt, references);
    return {
        model: selectedModel,
        prompt: withSystemPrompt(requestConfig, requestPrompt),
        n: Math.max(1, Math.min(15, Math.floor(Number(count) || 1))),
        ...(quality ? { quality } : {}),
        ...(size ? { size } : {}),
        ...(background ? { background } : {}),
        ...(/gpt-image/.test(requestConfig.model) ? {} : { response_format: "b64_json" }),
        output_format: IMAGE_OUTPUT_FORMAT,
        referenceAssetIds,
    };
}

const QUALITY_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 2880,
    standard: 1024,
    hd: 2048,
};
const QUALITY_ALIASES: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
};
const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 8294400;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
const IMAGE_OUTPUT_FORMAT = "png";
// 与 image-storage 的下载超时保持一致，避免接口挂起时节点一直停在生成中。
const IMAGE_REQUEST_TIMEOUT_MS = 10 * 60_000;


function normalizeQuality(quality: string) {
    const value = quality.trim().toLowerCase();
    const normalized = QUALITY_ALIASES[value] || value;
    return QUALITY_BASE[normalized] ? normalized : undefined;
}

/** Only "transparent" is forwarded; any other value (incl. empty) means keep the default opaque background. */
function normalizeBackground(background: string | undefined) {
    return background?.trim().toLowerCase() === "transparent" ? "transparent" : undefined;
}

/** Map "quality + ratio" to an explicit pixel dimension like "3840x2160". */
function resolveSize(quality: string | undefined, ratio: string): string {
    const parsedRatio = parseImageRatio(ratio);
    const scale = quality === "high" ? "4k" : quality === "medium" || quality === "hd" ? "2k" : "1k";
    const preset = imageSizePresets[scale][ratio];
    if (preset) return preset;
    const basePixels = quality ? QUALITY_BASE[quality] : undefined;
    const isLandscape = parsedRatio.width >= parsedRatio.height;
    const longRatio = isLandscape ? parsedRatio.width / parsedRatio.height : parsedRatio.height / parsedRatio.width;
    let longSide: number;
    let shortSide: number;

    if (basePixels) {
        const targetPixels = basePixels * basePixels;
        const longSideRaw = Math.sqrt(targetPixels * longRatio);
        longSide = Math.floor(longSideRaw / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
        shortSide = Math.round(longSide / longRatio / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    } else {
        shortSide = DEFAULT_IMAGE_SHORT_SIDE;
        longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    }

    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;
    validateImageSize(width, height);
    return `${width}x${height}`;
}

function parseRatioValue(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error(apiText("invalidImageSizeFormat"));
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error(apiText("positiveImageRatio"));
    return { width: w, height: h };
}

function parseImageRatio(value: string) {
    const ratio = parseRatioValue(value);
    if (Math.max(ratio.width, ratio.height) / Math.min(ratio.width, ratio.height) > IMAGE_MAX_RATIO) throw new Error(apiText("imageRatioLimit"));
    return ratio;
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function validateImageSize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error(apiText("positiveImageDimensions"));
    if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) throw new Error(apiText("imageDimensionStep"));
    if (Math.max(width, height) > IMAGE_MAX_EDGE) throw new Error(apiText("imageEdgeLimit"));
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error(apiText("imageRatioLimit"));
    const pixels = width * height;
    if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) throw new Error(apiText("imagePixelLimit"));
}

function resolveRequestSize(quality: string | undefined, size: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        validateImageSize(dimensions.width, dimensions.height);
        return `${dimensions.width}x${dimensions.height}`;
    }
    if (value.includes(":")) return resolveSize(quality, value);
    throw new Error(apiText("invalidImageSizeFormat"));
}




function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function geminiBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

function geminiModelName(model: string) {
    return model.trim().replace(/^models\//, "");
}

function geminiApiUrl(config: Pick<AiConfig, "baseUrl">) {
    const baseUrl = geminiBaseUrl(config);
    return `${baseUrl}/models`;
}

function geminiHeaders(config: Pick<AiConfig, "apiKey">) {
    return {
        "x-goog-api-key": config.apiKey,
        "Content-Type": "application/json",
    };
}



export async function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(quality, config.size);
    const background = normalizeBackground(config.background);
    const body = {
        model: config.model || config.imageModel,
        prompt: withSystemPrompt(requestConfig, prompt), n,
        ...(quality ? { quality } : {}), ...(requestSize ? { size: requestSize } : {}),
        ...(background ? { background } : {}),
        ...(/gpt-image/.test(requestConfig.model) ? {} : { response_format: "b64_json" }),
        output_format: IMAGE_OUTPUT_FORMAT,
    };
    return runBilledImageTask(body, [], options);
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const requestPrompt = buildImageReferencePromptText(prompt, references);
    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(quality, config.size);
    const background = normalizeBackground(config.background);
    const referenceAssetIds = await Promise.all(references.map((reference) => ensureImageReferenceAsset(reference, options?.signal)));
    return runBilledImageTask({
        model: config.model || config.imageModel, prompt: withSystemPrompt(requestConfig, requestPrompt), n,
        ...(quality ? { quality } : {}), ...(requestSize ? { size: requestSize } : {}),
        ...(background ? { background } : {}), ...(/gpt-image/.test(requestConfig.model) ? {} : { response_format: "b64_json" }),
        output_format: IMAGE_OUTPUT_FORMAT,
    }, referenceAssetIds, options);
}

export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    const requestMessages = withSystemMessage(requestConfig, messages);
    const parameters = requestConfig.apiFormat === "gemini"
        ? { body: toGeminiBody(requestConfig, requestMessages) }
        : { body: {
            model: requestConfig.model,
            input: toResponseInput(requestMessages),
            ...(requestConfig.reasoningEffort === "auto" ? {} : { reasoning: { effort: requestConfig.reasoningEffort } }),
        } };
    const model = config.model || config.textModel;
    const prompt = JSON.stringify(messages);
    const quote = await billingApi.quote({ model, taskType: "text", prompt, parameters, quantity: 1 });
    const response = await fetch("/api/generation-tasks/media", {
        method: "POST", credentials: "include", signal: options?.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskType: "text", model, prompt, parameters, creditQuoteId: quote.id, idempotencyKey: `canvas-text:${nanoid()}` }),
    });
    const created = await response.json().catch(() => ({})) as { taskId?: string; error?: string };
    if (!response.ok || !created.taskId) throw new Error(created.error || apiText("requestFailed"));
    const task = await pollImageTask(created.taskId, { intervalMs: 1000, timeoutMs: 10 * 60_000, onTick: (value) => {
        const answer = taskTextOutput(value);
        if (answer) onDelta(answer);
    }, signal: options?.signal });
    if (task.status !== "succeeded") throw new Error(task.errorMessage || apiText("requestFailed"));
    const answer = taskTextOutput(task).trim();
    if (!answer) throw new Error(apiText("noContent"));
    onDelta(answer);
    return answer;
}

async function runBilledImageTask(body: Record<string, unknown>, referenceAssetIds: string[], options?: RequestOptions) {
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const submitted = await submitImageTask({ ...body, ...(referenceAssetIds.length ? { referenceAssetIds } : {}) });
    const task = await pollImageTask(submitted.taskId, { intervalMs: 1200, timeoutMs: IMAGE_REQUEST_TIMEOUT_MS, signal: options?.signal });
    if (task.status !== "succeeded") throw new Error(task.errorMessage || apiText("requestFailed"));
    return (task.outputs || []).filter((output) => output.fileId || output.url || output.b64_json).map((output) => ({
        id: output.fileId || nanoid(),
        dataUrl: output.fileId ? `/api/generation-tasks/${encodeURIComponent(task.id)}/outputs/${output.index}/content` : output.url || `data:image/png;base64,${output.b64_json}`,
    }));
}

async function ensureImageReferenceAsset(reference: ReferenceImage, signal?: AbortSignal) {
    const savedId = reference.storageKey?.match(/^image:([0-9a-f-]{36})$/i)?.[1];
    if (savedId) return savedId;
    const source = reference.dataUrl || reference.storageKey || "";
    const response = await fetch(source, { signal });
    if (!response.ok) throw new Error(apiText("referenceImageReadFailed"));
    const blob = await response.blob();
    const uploaded = await uploadMediaFile(blob, "image", { signal, sourceKind: "reference_upload", originalFilename: reference.name || "canvas-reference.png" });
    const id = uploaded.storageKey.match(/^[^:]+:([0-9a-f-]{36})$/i)?.[1];
    if (!id) throw new Error(apiText("referenceImageReadFailed"));
    return id;
}

function taskTextOutput(task: GenTask) {
    const output = task.outputs?.[0] as (GenTask["outputs"][number] & { text?: string; content?: string }) | undefined;
    return String(output?.text || output?.content || "");
}

export async function fetchImageModels(config: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat">) {
    try {
        if (config.apiFormat === "gemini") {
            const response = await axios.get<GeminiPayload>(geminiApiUrl({ ...defaultGeminiConfig, ...config }), { headers: geminiHeaders({ ...defaultGeminiConfig, ...config }) });
            validateGeminiPayload(response.data);
            return (response.data.models || [])
                .map((model) => model.name?.replace(/^models\//, ""))
                .filter((id): id is string => Boolean(id))
                .sort((a, b) => a.localeCompare(b));
        }
        const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
        if (!/^https?:\/\//i.test(baseUrl)) throw new Error(apiText("modelReadFailed"));
        const response = await axios.get<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(`${baseUrl}/models`, {
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
            },
        });
        return (response.data.data || [])
            .map((model) => model.id)
            .filter((id): id is string => Boolean(id))
            .sort((a, b) => a.localeCompare(b));
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("modelReadFailed")));
    }
}

export async function fetchChannelModels(channel: ModelChannel) {
    return fetchImageModels({ baseUrl: channel.baseUrl, apiKey: channel.apiKey, apiFormat: channel.apiFormat });
}

const defaultGeminiConfig: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat" | "systemPrompt"> = {
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "",
    apiFormat: "gemini",
    systemPrompt: "",
};
