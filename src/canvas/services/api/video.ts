import axios from "axios";
import { nanoid } from "nanoid";

import i18n from "@canvas/i18n";
import { readFileAsDataUrl } from "@canvas/lib/image-utils";
import { clampVideoSecondsToModel, computeVideoSize, getVideoMaxReferenceImages, inferVideoRatio, normalizeVideoResolutionToModel, VIDEO_FRAMES_MODE_LIMIT } from "@canvas/lib/media-size";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@canvas/services/file-storage";
import { imageToDataUrl } from "@canvas/services/image-storage";
import { boolConfig, buildApiUrl, modelOptionName, resolveModelRequestConfig, resolveModelScript, withLocalProxy, type AiConfig } from "@canvas/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";
import type { ReferenceImage } from "@canvas/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@canvas/types/media";

type VideoResponse = { id: string; status?: string; error?: { message?: string }; error_msg?: unknown; url?: string; result_url?: string; video_url?: string; result_urls?: string[]; progress?: number; progress_percent?: number; percent?: number; content?: { video_url?: string; url?: string } | null };
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
type RequestOptions = { signal?: AbortSignal };
type VideoMediaOptions = RequestOptions & { videos?: ReferenceVideo[]; audios?: ReferenceAudio[] };
const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string; sourceUrl?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "gemini" | "plugin"; model: string; channelId?: string };
type GeminiInlineData = { bytesBase64Encoded: string; mimeType: string };
type GeminiVideoOperation = {
    name?: string;
    done?: boolean;
    error?: { message?: string };
    response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } };
};
export type VideoGenerationTaskState = { status: "pending"; progress?: number; transient?: boolean } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

/** Results for scripted (plugin) video models, which run their own create+poll in one shot at task creation. */
const pluginVideoResults = new Map<string, { result: VideoGenerationResult; at: number }>();
/** 插件结果只在短时间内保留，刷新/超时后即失效，避免 Map 无限增长。 */
const PLUGIN_RESULT_TTL_MS = 2 * 60 * 60 * 1000;

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationResult> {
    return waitForVideoGenerationTask(config, await createVideoGenerationTask(config, prompt, references, options), options);
}

export async function waitForVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    // 退避间隔：前 30s 每 2.5s，之后 5s，2 分钟后 8s；总等待约 10 分钟，覆盖 30s/1080p 长视频。
    const intervalFor = (attempt: number) => (attempt < 12 ? 2500 : attempt < 40 ? 5000 : 8000);
    for (let attempt = 0; attempt < 150; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw videoTaskFailed(state.error);
        await delay(intervalFor(attempt), options?.signal);
    }
    throw new Error(apiText("videoTimeout", { provider: "" }));
}

export function isVideoTaskFailed(error: unknown) {
    return error instanceof Error && error.name === "VideoTaskFailed";
}

function videoTaskFailed(message: string) {
    const error = new Error(message);
    error.name = "VideoTaskFailed";
    return error;
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const script = resolveModelScript(config, selectedModel);
    if (script) return createPluginVideoTask(requestConfig, selectedModel, script, prompt, references, options);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (requestConfig.apiFormat === "gemini") return createGeminiVideoTask(requestConfig, selectedModel, prompt, references, options);
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const entry = pluginVideoResults.get(task.id);
        if (entry && Date.now() - entry.at < PLUGIN_RESULT_TTL_MS) {
            pluginVideoResults.delete(task.id); // 结果一次性取走，避免 Map 长期堆积
            return { status: "completed", result: entry.result };
        }
        if (entry) pluginVideoResults.delete(task.id);
        return { status: "failed", error: apiText("pluginVideoExpired") };
    }
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "gemini") return pollGeminiVideoTask(requestConfig, task, options);
    return pollOpenAIVideoTask(requestConfig, task, options);
}

async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    const mode = resolveVideoMode(config.videoMode, references.length);
    const limitedReferences = limitReferencesByMode(references, mode, model);
    const refs = await Promise.all(limitedReferences.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const seconds = Number(clampVideoSecondsToModel(config.videoSeconds, model));
    const result = videoPluginResult(
        await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images: refs,
            videos,
            audios,
            params: {
                seconds,
                size: normalizeVideoSize(config.size, config.vquality),
                resolution: normalizeVideoResolutionToModel(config.vquality, model, seconds),
                ratio: videoAspectRatio(config.size),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
                mode,
            },
            signal: options?.signal,
        }),
    );
    const id = nanoid();
    pluginVideoResults.set(id, { result, at: Date.now() });
    return { id, provider: "plugin", model, channelId: channelIdOf(model) };
}

function videoPluginResult(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string") return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new Error(apiText("scriptNoVideo"));
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile & { sourceUrl?: string }> {
    const sourceUrl = result.sourceUrl || result.url;
    if (result.blob) {
        const stored = await uploadMediaFile(result.blob, "video");
        return { ...stored, sourceUrl };
    }
    if (result.url) {
        try {
            const stored = await uploadMediaFile(result.url, "video");
            return { ...stored, sourceUrl };
        } catch {
            return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4", sourceUrl };
        }
    }
    throw new Error(apiText("noPlayableVideo"));
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const mode = resolveVideoMode(config.videoMode, references.length);
    const limitedReferences = limitReferencesByMode(references, mode, model);
    const imageDataUrls = await Promise.all(limitedReferences.map((image) => imageToDataUrl(image)));
    const duration = Number(clampVideoSecondsToModel(config.videoSeconds, model));
    // OpenAI 兼容视频网关协议（已实测）：POST videos/generations，JSON 体。
    // 固定字段 model/prompt/ratio/resolution/duration/generate_audio/watermark；
    // 首尾帧用 first_frame/last_frame（data:URL），全能参考用 reference_images（data:URL 数组）。
    // model 保留「渠道ID::模型名」前缀，本地代理据此选择渠道并在转发前剥离；
    // 不发送 seconds/size/resolution_name/mode 等网关不识别字段，否则会被 400/422 拒绝。
    // 该网关不接收像素宽高（只认 ratio+resolution），因此前端不再提供自定义 W/H，避免“填了不生效”。
    const payload: Record<string, unknown> = {
        model,
        prompt,
        ratio: inferVideoRatio(config.size),
        resolution: normalizeVideoResolutionToModel(config.vquality, model, duration),
        duration,
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        watermark: boolConfig(config.videoWatermark, false),
    };
    if (mode === "frames") {
        if (imageDataUrls[0]) payload.first_frame = imageDataUrls[0];
        if (imageDataUrls[1]) payload.last_frame = imageDataUrls[1];
    } else if (imageDataUrls.length > 0) {
        payload.reference_images = imageDataUrls;
    }
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos/generations"), payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        if (!created.id) throw new Error(apiText("noVideoTaskId"));
        return { id: created.id, provider: "openai", model, channelId: channelIdOf(model) };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        // 网关任务查询：GET tasks/{id}；status=pending/processing/completed/failed，成片地址在 result_urls[]。
        // 任务查询没有请求体，需显式带上提交时的渠道，避免代理把查询转发到其它同 provider 渠道而 404。
        const channelId = task.channelId || channelIdOf(task.model) || "";
        const channelQuery = channelId ? `?channelId=${encodeURIComponent(channelId)}` : "";
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/tasks/${encodeURIComponent(task.id)}${channelQuery}`), { headers: aiHeaders(config), signal: options?.signal })).data);
        const status = String(video.status || "").toLowerCase();
        const failStates = ["failed", "error", "violation", "cancelled", "canceled", "failure", "timeout", "timed_out", "expired", "rejected"];
        if (failStates.includes(status)) {
            return { status: "failed", error: readApiErrorMessage(video.error_msg ?? video.error?.message) || apiText("videoGenerationFailed") };
        }
        const url = videoResultUrl(video);
        if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        // pending/processing/queued/in_progress/submitted/success（地址尚未回传）等均继续轮询。
        return { status: "pending", progress: readTaskProgress(video) };
    } catch (error) {
        if (isTransientPollError(error)) return { status: "pending", transient: true };
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

function readTaskProgress(video: VideoResponse): number | undefined {
    const raw = video.progress ?? video.progress_percent ?? video.percent;
    const numeric = Number(raw);
    return Number.isFinite(numeric) && numeric > 0 ? Math.min(100, numeric) : undefined;
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(withLocalProxy(url), { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data, sourceUrl: url, mimeType: response.data.type || "video/mp4" };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        return { url, sourceUrl: url, mimeType: "video/mp4" };
    }
}

async function createGeminiVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const mode = resolveVideoMode(config.videoMode, references.length);
    const limitedReferences = limitReferencesByMode(references, mode, model);
    const images = await Promise.all(limitedReferences.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const seconds = Number(clampVideoSecondsToModel(config.videoSeconds, model));
    const instance: Record<string, unknown> = { prompt };
    if (mode === "frames") {
        if (images[0]) instance.image = parseDataUrlInline(images[0]);
        if (images[1]) instance.lastFrame = parseDataUrlInline(images[1]);
    } else {
        instance.referenceImages = images.map((dataUrl) => ({ image: parseDataUrlInline(dataUrl), referenceType: "asset" }));
    }
    if (videos[0]) instance.video = await fileToGeminiInline(videos[0]);
    if (audios[0]) instance.audio = await fileToGeminiInline(audios[0]);
    try {
        const created = unwrapEnvelope((await axios.post<ApiEnvelope<GeminiVideoOperation>>(geminiVideoUrl(config, model, "predictLongRunning"), {
            instances: [instance],
            parameters: {
                aspectRatio: videoAspectRatio(config.size),
                durationSeconds: seconds || 8,
                resolution: normalizeVideoResolutionToModel(config.vquality, model, seconds),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                addWatermark: boolConfig(config.videoWatermark, false),
            },
        }, { headers: geminiVideoHeaders(config), signal: options?.signal })).data, apiText("noVideoTask"));
        if (!created.name) throw new Error(apiText("noVideoTaskId"));
        return { id: created.name, provider: "gemini", model, channelId: channelIdOf(model) };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollGeminiVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapEnvelope((await axios.get<ApiEnvelope<GeminiVideoOperation>>(geminiOperationUrl(config, task.id), { headers: geminiVideoHeaders(config), signal: options?.signal })).data, apiText("videoTaskQueryFailed"));
        if (state.error) return { status: "failed", error: readApiErrorMessage(state.error.message) || apiText("videoGenerationFailed") };
        if (!state.done) return { status: "pending" };
        const uri = state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri) return { status: "failed", error: apiText("noPlayableVideo") };
        const url = uri.includes("key=") ? uri : `${uri}${uri.includes("?") ? "&" : "?"}key=${config.apiKey}`;
        return { status: "completed", result: await videoResultFromUrl(url, options) };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(apiText("videoModelRequired"));
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
}

function geminiVideoBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

function geminiVideoUrl(config: Pick<AiConfig, "baseUrl">, model: string, action: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/models/${encodeURIComponent(modelOptionName(model).replace(/^models\//, ""))}:${action}`);
}

function geminiOperationUrl(config: Pick<AiConfig, "baseUrl">, name: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/${name.replace(/^\//, "")}`);
}

function geminiVideoHeaders(config: Pick<AiConfig, "apiKey">) {
    return { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" };
}

function videoAspectRatio(size: string) {
    const ratio = inferVideoRatio(size);
    return ratio === "auto" ? "16:9" : ratio;
}

function channelIdOf(model: string): string | undefined {
    return model.includes("::") ? model.split("::")[0] : undefined;
}

// 首尾帧模式最多取首/尾 2 张；全能参考模式按模型能力取上限。多余图片在提交前截掉，不静默改判模式。
function limitReferencesByMode(references: ReferenceImage[], mode: "frames" | "reference", model: string): ReferenceImage[] {
    const max = mode === "frames" ? VIDEO_FRAMES_MODE_LIMIT : getVideoMaxReferenceImages(model);
    return references.slice(0, max);
}

function parseDataUrlInline(dataUrl: string, fallbackType = "image/png"): GeminiInlineData {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    return { bytesBase64Encoded: match?.[2] || "", mimeType: match?.[1] || fallbackType };
}

async function fileToGeminiInline(file: File): Promise<GeminiInlineData> {
    return parseDataUrlInline(await readFileAsDataUrl(file), file.type || "application/octet-stream");
}

async function referenceMediaToFile(item: { name: string; type?: string; url?: string; storageKey?: string }, fallbackName: string, errorKey: "invalidReferenceVideo" | "invalidReferenceAudio", options?: RequestOptions) {
    let blob = item.storageKey ? await getMediaBlob(item.storageKey) : null;
    if (!blob) {
        const url = item.storageKey ? await resolveMediaUrl(item.storageKey, item.url || "") : item.url || "";
        if (!url) throw new Error(apiText(errorKey));
        try {
            blob = await (await fetch(url, { signal: options?.signal })).blob();
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            throw new Error(apiText(errorKey));
        }
    }
    if (!blob.size) throw new Error(apiText(errorKey));
    return new File([blob], item.name || fallbackName, { type: item.type || blob.type || "application/octet-stream" });
}

function resolveVideoMode(mode: string | undefined, imageCount: number): "frames" | "reference" {
    // 尊重用户显式选择：首尾帧恒为 frames（多余图片由 limitReferencesByMode 截到 2），不再静默改成 reference；
    // 仅当调用方未指定模式时，才按图片数量推断。
    if (mode === "reference") return "reference";
    if (mode === "frames") return "frames";
    return imageCount > VIDEO_FRAMES_MODE_LIMIT ? "reference" : "frames";
}

function normalizeVideoSize(value: string, resolution?: string) {
    if (value === "auto") return null;
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value || "16:9");
    if (ratio === "auto") return null;
    return computeVideoSize(resolution || "720", ratio);
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, apiText("noVideoTask"));
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || apiText("requestFailed"));
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function videoResultUrl(payload: VideoResponse) {
    // result_urls 是网关明确给出的成片列表，直接信任其中的 http(s) 地址（CDN 签名链接可能没有扩展名）。
    const fromList = payload.result_urls?.find((url) => typeof url === "string" && isPublicMediaUrl(url));
    if (fromList) return fromList;
    // 其它散字段可能混入封面图/网页，要求看起来像媒体地址，避免把非视频当视频。
    return [payload.video_url, payload.result_url, payload.url, payload.content?.video_url, payload.content?.url].find(
        (url): url is string => typeof url === "string" && isLikelyMediaUrl(url),
    );
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
    // error may be a string or an object containing a message.
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

function isTransientPollError(error: unknown): boolean {
    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (!status) return true; // 无响应：网络中断 / 连接重置 / 超时
        if (status === 429 || status === 408 || status >= 500) return true; // 限流 / 请求超时 / 网关 5xx 可重试
        return false; // 其余 4xx 为确定性错误
    }
    const message = error instanceof Error ? error.message : String(error);
    return /渠道|channel|gateway|timeout|timed out|网络|ECONN|ERR_NETWORK|CONNECTION/i.test(message);
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return apiText("requestCanceled");
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; message?: string; code?: number | string }>(error)) {
        if (!error.response && error.code === "ERR_NETWORK") return apiText("requestFailed");
        const responseData = error.response?.data;
        return readApiErrorMessage(responseData) || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return apiText("requestCanceled");
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return apiText("authenticationFailed");
    if (status === 429) return apiText("rateLimited");
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (blob.type.includes("html")) throw new Error(apiText("videoDownloadFailed"));
    if (!blob.type.includes("json")) {
        // 无类型 / octet-stream 时嗅探开头，避免把“200 + HTML 错误页”当成 mp4 存成损坏视频。
        if (blob.type === "" || blob.type.includes("octet-stream")) {
            const head = (await blob.slice(0, 200).text()).trimStart().slice(0, 60).toLowerCase();
            if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<?xml")) throw new Error(apiText("videoDownloadFailed"));
        }
        return;
    }
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(readApiErrorMessage(payload) || apiText("videoDownloadFailed"));
    if (payload.error?.message) throw new Error(readApiErrorMessage(payload.error.message) || payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

// 散字段（video_url/url/content 等）可能混入封面图或网页，要求带视频扩展名或常见媒体/CDN 路径（不接受图片扩展名）。
function isLikelyMediaUrl(url: string): boolean {
    if (!isPublicMediaUrl(url)) return false;
    if (/\.(mp4|webm|mov|m4v|mkv)(\?|#|$)/i.test(url)) return true;
    return /(vultrcdn|b-cdn|cdn[.-])|\/(videos?|media|result|render|output|files?)\//i.test(url);
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
