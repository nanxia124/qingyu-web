/**
 * 画布模块接入主站后的后端配置引导。
 * 原独立应用在 main.tsx 启动时拉取后端公开配置；原生集成后改由模块入口在首次挂载时调用，
 * 全程只拉一次。地址使用同源相对路径 /api/config/public（开发期 Vite 代理到 qingyu_server，生产同源反代）。
 */
import { guessCapability, useConfigStore, type ModelCapability } from "@canvas/stores/use-config-store";

// guessCapability 内置视频关键字未覆盖 seedance / gemini omni / minimax-h3 等视频模型，
// 这里补充，避免被错判成 image/text，导致视频页按 capability="video" 筛选时列表为空、默认模型落到图像模型。
// 与 use-config-store 的 VIDEO_KEYWORDS 保持一致的精确补充；不要用 imagine/flash 等泛词（会误伤图像/文本模型）。
const EXTRA_VIDEO_KEYWORDS = ["seedance", "omni", "h3"];
const resolveCapability = (name: string): ModelCapability => {
    const value = name.toLowerCase();
    if (EXTRA_VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    return guessCapability(name);
};

let inFlight: Promise<void> | null = null;

export function ensureServerConfig(): Promise<void> {
    if (inFlight) return inFlight;
    useConfigStore.getState().setServerConfigStatus("loading");
    let loaded = false;
    inFlight = (async () => {
        try {
            const res = await fetch("/api/config/public", {
                headers: { "X-Qingyu-Client": "web" },
                credentials: "include",
            });
            if (res.status === 401) {
                // 未登录是正常情况，静默退出，等登录后再次调用时重试。
                return;
            }
            if (!res.ok) return;
            const configs = await res.json();
            if (!Array.isArray(configs) || configs.length === 0) return;

            const config = configs[0];
            const { updateConfig } = useConfigStore.getState();
            updateConfig("baseUrl", config.base_url);
            updateConfig("apiKey", "proxy"); // 走后端代理，Key 不下发到前端
            updateConfig("apiFormat", config.provider === "gemini" ? "gemini" : "openai");

            const channels = configs.map((c: any) => ({
                id: String(c.id),
                name: c.name,
                baseUrl: c.base_url,
                apiKey: "proxy",
                apiFormat: c.provider === "gemini" ? ("gemini" as const) : ("openai" as const),
                models: (Array.isArray(c.models) ? c.models : (c.model || "").split(",").filter(Boolean))
                    .map((entry: string | { name: string; displayName?: string; capability?: ModelCapability }) => {
                        const model = typeof entry === "string" ? { name: entry } : entry;
                        const name = model.name.trim();
                        return { name, displayName: model.displayName, capability: model.capability || resolveCapability(name) };
                    })
                    .filter((model: { name: string }) => model.name),
            }));

            const allModels: string[] = [];
            channels.forEach((ch: any) => {
                ch.models.forEach((m: any) => allModels.push(`${ch.id}::${m.name}`));
            });

            // 各能力默认选第一个匹配模型（不能统一取 allModels[0]，后端首个模型通常是图像模型）
            const firstOfCapability = (capability: ModelCapability): string => {
                for (const ch of channels) {
                    const found = ch.models.find((m: any) => m.capability === capability);
                    if (found) return `${ch.id}::${found.name}`;
                }
                return "";
            };
            const firstImage = firstOfCapability("image");
            const firstVideo = firstOfCapability("video");
            const firstText = firstOfCapability("text");
            const firstAudio = firstOfCapability("audio");

            useConfigStore.setState({
                config: {
                    ...useConfigStore.getState().config,
                    channels,
                    models: allModels,
                    model: firstImage || allModels[0] || "",
                    imageModel: firstImage || allModels[0] || "",
                    videoModel: firstVideo || firstImage || allModels[0] || "",
                    textModel: firstText || firstImage || allModels[0] || "",
                    audioModel: firstAudio || "",
                },
            });
            console.info("[CanvasConfig] 已从后端加载渠道", channels.length, "个，模型", allModels.length, "个");
            loaded = true;
            useConfigStore.getState().setServerConfigStatus("ready");
        } catch (err) {
            console.warn("[CanvasConfig] 拉取后端配置失败，使用本地配置", err);
            useConfigStore.getState().setServerConfigStatus("failed");
        } finally {
            // 首次失败（含非 200 / 空配置）后清空 inFlight，允许后续再次调用时重试，避免一次失败整局不可用。
            if (!loaded) {
                useConfigStore.getState().setServerConfigStatus("failed");
                inFlight = null;
            }
        }
    })();
    return inFlight;
}
