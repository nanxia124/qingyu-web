import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "./styles/globals.css";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "@canvas/components/layout/app-providers";
import "@canvas/i18n";
import { initAnalytics } from "@canvas/lib/analytics";
import { router } from "@canvas/router";
import { useConfigStore } from "@canvas/stores/use-config-store";

initAnalytics();

// 从服务器拉取 API 配置
async function fetchServerConfig() {
    try {
        const res = await fetch("/api/config/public");
        const configs = await res.json();
        if (configs.length > 0) {
            // 用第一个配置的 base_url
            const config = configs[0];
            useConfigStore.getState().updateConfig("baseUrl", config.base_url);
            useConfigStore.getState().updateConfig("apiKey", "proxy"); // 用代理，Key 在后端
            useConfigStore.getState().updateConfig("apiFormat", config.provider === "gemini" ? "gemini" : "openai");

            // 把服务器配置转换成 channels 格式
            const channels = configs.map((c: any) => ({
                id: String(c.id),
                name: c.name,
                baseUrl: c.base_url,
                apiKey: "proxy", // 用代理，Key 在后端
                apiFormat: c.provider === "gemini" ? "gemini" as const : "openai" as const,
                models: (c.model || "").split(",").filter(Boolean).map((m: string) => ({
                    name: m.trim(),
                    capability: "image" as const, // 默认都是 image
                })),
            }));

            // 收集所有模型
            const allModels: string[] = [];
            channels.forEach((ch: any) => {
                ch.models.forEach((m: any) => {
                    allModels.push(`${ch.id}::${m.name}`);
                });
            });

            // 一次性更新所有配置
            useConfigStore.setState({
                config: {
                    ...useConfigStore.getState().config,
                    channels,
                    models: allModels,
                    model: allModels[0] || "",
                    imageModel: allModels[0] || "",
                    videoModel: allModels[0] || "",
                    textModel: allModels[0] || "",
                    audioModel: allModels[0] || "",
                },
            });

            console.log("[Config] 从服务器拉取配置成功:", configs.length, "个配置,", allModels.length, "个模型");
            console.log("[Config] channels:", channels);
            console.log("[Config] models:", allModels);
        }
    } catch (err) {
        console.warn("[Config] 从服务器拉取配置失败，使用本地配置:", err);
    }
}

// 延迟执行，等 zustand persist 恢复完本地配置后再覆盖
setTimeout(fetchServerConfig, 100);

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);
