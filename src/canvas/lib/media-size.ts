export const mediaScaleOptions = ["1k", "2k", "4k", "auto"] as const;
export const mediaRatioOptions = [
    { value: "1:1", width: 1, height: 1 },
    { value: "2:3", width: 2, height: 3 },
    { value: "3:2", width: 3, height: 2 },
    { value: "4:3", width: 4, height: 3 },
    { value: "3:4", width: 3, height: 4 },
    { value: "16:9", width: 16, height: 9 },
    { value: "9:16", width: 9, height: 16 },
    { value: "21:9", width: 21, height: 9 },
    { value: "9:21", width: 9, height: 21 },
    { value: "auto", width: 0, height: 0 },
] as const;

export const imageSizePresets: Record<string, Record<string, string>> = {
    "1k": { "1:1": "1024x1024", "2:3": "1024x1536", "3:2": "1536x1024", "4:3": "1024x768", "3:4": "768x1024", "16:9": "1536x864", "9:16": "864x1536", "21:9": "2016x864", "9:21": "864x2016" },
    "2k": { "1:1": "2048x2048", "2:3": "1360x2048", "3:2": "2048x1360", "4:3": "2048x1536", "3:4": "1536x2048", "16:9": "2048x1152", "9:16": "1152x2048", "21:9": "2688x1152", "9:21": "1152x2688" },
    "4k": { "1:1": "2880x2880", "2:3": "2336x3520", "3:2": "3520x2336", "4:3": "3312x2480", "3:4": "2480x3312", "16:9": "3840x2160", "9:16": "2160x3840", "21:9": "3840x1648", "9:21": "1648x3840" },
};

export function parsePixelSize(value: string) {
    const match = String(value || "").match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

export function parseAspectRatio(value: string) {
    const match = String(value || "").match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return null;
    return { width, height };
}

export const videoRatioOptions = [
    { value: "1:1", width: 1, height: 1 },
    { value: "3:4", width: 3, height: 4 },
    { value: "4:3", width: 4, height: 3 },
    { value: "16:9", width: 16, height: 9 },
    { value: "9:16", width: 9, height: 16 },
    { value: "21:9", width: 21, height: 9 },
    { value: "auto", width: 0, height: 0 },
] as const;

export const VIDEO_SECONDS_MIN = 4;
export const VIDEO_SECONDS_MAX = 30;

/**
 * 视频模型时长能力：连续范围用 min/max（步长 1 秒）；只接受固定档位的模型用 presets。
 * 数据来源：麦子网关模型规格（maizitech.xyz）+ 各模型官方文档，目的是让滑条只停在合法秒数，避免提交后被上游 422。
 */
export type VideoDurationRule = { min: number; max: number; presets?: number[] };

const VIDEO_DURATION_RULES: Array<{ test: (name: string) => boolean; rule: VideoDurationRule }> = [
    { test: (name) => name.includes("grok-imagine-video"), rule: { min: 6, max: 15 } },
    { test: (name) => name.includes("seedance-2.5"), rule: { min: 4, max: 30 } },
    { test: (name) => name.includes("seedance"), rule: { min: 4, max: 15 } },
    { test: (name) => name.includes("h3-office") || name.includes("h3_office"), rule: { min: 4, max: 15 } },
    { test: (name) => name.includes("minimax-h3") || name.includes("minimax_h3"), rule: { min: 1, max: 15 } },
    { test: (name) => name.includes("veo"), rule: { min: 4, max: 8, presets: [4, 6, 8] } },
    { test: (name) => name.includes("sora"), rule: { min: 4, max: 20, presets: [4, 8, 12, 16, 20] } },
    { test: (name) => name.includes("omni"), rule: { min: 3, max: 10 } },
];

const DEFAULT_VIDEO_DURATION_RULE: VideoDurationRule = { min: VIDEO_SECONDS_MIN, max: VIDEO_SECONDS_MAX };

export function getVideoDurationRule(model: string | null | undefined): VideoDurationRule {
    const name = String(model || "").toLowerCase();
    if (!name) return DEFAULT_VIDEO_DURATION_RULE;
    return VIDEO_DURATION_RULES.find((item) => item.test(name))?.rule || DEFAULT_VIDEO_DURATION_RULE;
}

/** 当前模型允许选择的全部秒数（固定档位模型返回档位，连续模型返回逐秒序列）。 */
export function getVideoDurationOptions(model: string | null | undefined): number[] {
    const rule = getVideoDurationRule(model);
    if (rule.presets?.length) return [...rule.presets];
    const options: number[] = [];
    for (let value = rule.min; value <= rule.max; value += 1) options.push(value);
    return options;
}

/** 把任意秒数吸附到该模型最近的合法秒数。 */
export function nearestVideoSeconds(value: number, model: string | null | undefined): number {
    const options = getVideoDurationOptions(model);
    return options.reduce((best, item) => (Math.abs(item - value) < Math.abs(best - value) ? item : best), options[0]);
}

/** 解析用户输入/历史值并钳制到该模型的合法秒数（返回字符串）。 */
export function clampVideoSecondsToModel(value: string, model: string | null | undefined): string {
    const numeric = Math.floor(Number(value) || NaN);
    if (!Number.isFinite(numeric)) return String(getVideoDurationOptions(model)[0]);
    return String(nearestVideoSeconds(numeric, model));
}

// ── 视频清晰度（分辨率）能力 ──────────────────────────────────────────────
// 网关只认 480p/720p/1080p 三档；不同模型档位不同，且部分模型 1080p 有时长约束。
// 数据来源：麦子网关模型规格 + 各模型官方文档，目的是在 UI/提交前收窄，避免选了模型不支持的档位被 422。
export const VIDEO_RESOLUTION_PRESETS = [480, 720, 1080] as const;

export type VideoResolutionRule = {
    resolutions: number[];
    /** 1080p 允许的最大秒数（含），超过则该档不可选。 */
    maxSecondsFor1080?: number;
    /** 1080p 仅允许的秒数白名单（如 Veo 仅 8s）。 */
    secondsRequiredFor1080?: number[];
};

const VIDEO_RESOLUTION_RULES: Array<{ test: (name: string) => boolean; rule: VideoResolutionRule }> = [
    { test: (name) => name.includes("grok-imagine-video"), rule: { resolutions: [480, 720] } },
    { test: (name) => name.includes("seedance-2.0-mini") || name.includes("seedance-2.0-fast") || name.includes("seedance-2.0_fast") || name.includes("seedance-2.0_mini"), rule: { resolutions: [480, 720] } },
    { test: (name) => name.includes("omni"), rule: { resolutions: [480, 720] } },
    { test: (name) => name.includes("h3-office") || name.includes("h3_office"), rule: { resolutions: [480, 720, 1080] } },
    { test: (name) => name.includes("veo"), rule: { resolutions: [480, 720, 1080], secondsRequiredFor1080: [8] } },
    { test: (name) => name.includes("minimax-h3") || name.includes("minimax_h3"), rule: { resolutions: [480, 720, 1080], maxSecondsFor1080: 10 } },
    { test: (name) => name.includes("sora"), rule: { resolutions: [480, 720, 1080] } },
    { test: (name) => name.includes("seedance"), rule: { resolutions: [480, 720, 1080] } },
];

const DEFAULT_VIDEO_RESOLUTION_RULE: VideoResolutionRule = { resolutions: [480, 720, 1080] };

export function getVideoResolutionRule(model: string | null | undefined): VideoResolutionRule {
    const name = String(model || "").toLowerCase();
    if (!name) return DEFAULT_VIDEO_RESOLUTION_RULE;
    return VIDEO_RESOLUTION_RULES.find((item) => item.test(name))?.rule || DEFAULT_VIDEO_RESOLUTION_RULE;
}

/** 当前模型 + 当前秒数下实际可选的清晰度档位（数字数组，如 [480,720]）。 */
export function getVideoResolutionOptions(model: string | null | undefined, seconds?: number): number[] {
    const rule = getVideoResolutionRule(model);
    return rule.resolutions.filter((res) => {
        if (res !== 1080) return true;
        if (rule.secondsRequiredFor1080?.length) return seconds !== undefined && rule.secondsRequiredFor1080.includes(nearestVideoSeconds(seconds, model));
        if (rule.maxSecondsFor1080 !== undefined) return seconds !== undefined && nearestVideoSeconds(seconds, model) <= rule.maxSecondsFor1080;
        return true;
    });
}

export function isVideoResolutionAllowed(model: string | null | undefined, seconds: number | undefined, resolution: number): boolean {
    return getVideoResolutionOptions(model, seconds).includes(resolution);
}

/** 把任意清晰度（数字或 "720p"）吸附到该模型+秒数下最近的合法档，返回数字（如 720）。 */
export function nearestVideoResolution(model: string | null | undefined, seconds: number | undefined, value: number): number {
    const options = getVideoResolutionOptions(model, seconds);
    if (options.includes(value)) return value;
    return options.reduce((best, item) => (Math.abs(item - value) < Math.abs(best - value) ? item : best), options[0] ?? 720);
}

/** 提交前规范化清晰度：非标准档（如 500）吸附到最近合法档，返回网关需要的 "720p" 形式。 */
export function normalizeVideoResolutionToModel(value: string | number | undefined, model: string | null | undefined, seconds?: number): string {
    const raw = String(value ?? "").trim().toLowerCase().replace(/p$/i, "");
    const numeric = Number(raw);
    const fallback = getVideoResolutionOptions(model, seconds)[0] ?? 720;
    if (!Number.isFinite(numeric) || numeric <= 0) return `${fallback}p`;
    return `${nearestVideoResolution(model, seconds, numeric)}p`;
}

// ── 视频参考图数量上限 ────────────────────────────────────────────────────
// 首尾帧模式恒为 2（首帧/尾帧）；全能参考模式按模型能力给上限。
const VIDEO_REFERENCE_LIMIT_RULES: Array<{ test: (name: string) => boolean; limit: number }> = [
    { test: (name) => name.includes("minimax-h3") || name.includes("minimax_h3") || name.includes("h3-office"), limit: 9 },
    { test: (name) => name.includes("seedance"), limit: 9 },
    { test: (name) => name.includes("grok-imagine-video"), limit: 7 },
];

/** 全能参考模式下该模型允许的参考图上限；首尾帧模式调用方应固定为 2。 */
export function getVideoMaxReferenceImages(model: string | null | undefined): number {
    const name = String(model || "").toLowerCase();
    if (!name) return 7;
    return VIDEO_REFERENCE_LIMIT_RULES.find((item) => item.test(name))?.limit ?? 7;
}

export const VIDEO_FRAMES_MODE_LIMIT = 2;

export function normalizeMediaScale(value: string | undefined) {
    const scale = String(value || "").trim().toLowerCase();
    if (scale === "2k" || scale === "2048") return "2k";
    if (scale === "4k" || scale === "3840") return "4k";
    if (scale === "auto") return "auto";
    if (mediaScaleOptions.includes(scale as (typeof mediaScaleOptions)[number])) return scale;
    return "1k";
}

export function inferMediaScale(size: string, storedScale?: string) {
    if (storedScale) return normalizeMediaScale(storedScale);
    if (!size || size === "auto") return "auto";
    if (parseAspectRatio(size)) return "auto";
    const pixels = parsePixelSize(size);
    if (!pixels) return "auto";
    const presetScale = Object.keys(imageSizePresets).find((scale) => Object.values(imageSizePresets[scale]).includes(`${pixels.width}x${pixels.height}`));
    if (presetScale) return presetScale;
    const longSide = Math.max(pixels.width, pixels.height);
    if (longSide >= 3072) return "4k";
    if (longSide >= 1536) return "2k";
    return "1k";
}

export function inferMediaRatio(size: string, fallback = "1:1") {
    if (!size || size === "auto") return "auto";
    if (mediaRatioOptions.some((item) => item.value === size)) return size;
    const pixels = parsePixelSize(size) || parseAspectRatio(size);
    if (!pixels) return fallback;
    const target = pixels.width / pixels.height;
    return mediaRatioOptions
        .filter((item) => item.value !== "auto")
        .reduce((best, item) => {
            const current = item.width / item.height;
            const bestOption = mediaRatioOptions.find((option) => option.value === best);
            const bestRatio = (bestOption?.width || 1) / Math.max(1, bestOption?.height || 1);
            return Math.abs(current - target) < Math.abs(bestRatio - target) ? item.value : best;
        }, fallback);
}

export function computeMediaSize(scale: string, ratio: string) {
    if (ratio === "auto" || !ratio) return "auto";
    const normalizedScale = normalizeMediaScale(scale);
    if (normalizedScale === "auto") return ratio;
    return imageSizePresets[normalizedScale][ratio];
}

export function readMediaDimensions(size: string, scale: string, ratio: string) {
    const pixels = parsePixelSize(size);
    if (pixels) return pixels;
    const computed = computeMediaSize(scale === "auto" ? "1k" : scale, ratio === "auto" ? "1:1" : ratio);
    return parsePixelSize(computed) || { width: 0, height: 0 };
}

export function clampVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(VIDEO_SECONDS_MIN, Math.min(VIDEO_SECONDS_MAX, seconds)));
}

export function parseVideoResolution(value: string | undefined) {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "low") return "480";
    if (raw === "auto" || raw === "high" || raw === "medium") return "720";
    const number = raw.replace(/p$/i, "");
    return /^\d+$/.test(number) && Number(number) > 0 ? number : "720";
}

export function inferVideoRatio(size: string) {
    if (!size || size === "auto") return "auto";
    if (videoRatioOptions.some((item) => item.value === size)) return size;
    const pixels = parsePixelSize(size) || parseAspectRatio(size);
    if (!pixels) return "16:9";
    const target = pixels.width / pixels.height;
    return videoRatioOptions
        .filter((item) => item.value !== "auto")
        .reduce((best, item) => {
            const current = item.width / item.height;
            const bestOption = videoRatioOptions.find((option) => option.value === best);
            const bestRatio = (bestOption?.width || 16) / (bestOption?.height || 9);
            return Math.abs(current - target) < Math.abs(bestRatio - target) ? item.value : best;
        }, "16:9");
}

export function computeVideoSize(resolution: string, ratio: string) {
    if (ratio === "auto" || !ratio) return "auto";
    const parsed = parseAspectRatio(ratio);
    if (!parsed) return "auto";
    const p = Math.max(1, Math.floor(Number(parseVideoResolution(resolution)) || 720));
    const landscape = parsed.width >= parsed.height;
    const width = evenRound(landscape ? (p * parsed.width) / parsed.height : p);
    const height = evenRound(landscape ? p : (p * parsed.height) / parsed.width);
    return `${width}x${height}`;
}

export function readVideoDimensions(size: string, resolution: string, ratio: string) {
    const pixels = parsePixelSize(size);
    if (pixels) return pixels;
    const computed = computeVideoSize(resolution, ratio === "auto" ? "16:9" : ratio);
    return parsePixelSize(computed) || { width: 0, height: 0 };
}

function evenRound(value: number) {
    return Math.max(2, Math.round(value / 2) * 2);
}
