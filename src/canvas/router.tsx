import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@canvas/components/layout/analytics-tracker";
import UserLayout from "@canvas/layouts/user-layout";
import AssetsPage from "@canvas/pages/assets";
import CanvasPage from "@canvas/pages/canvas";
import NewCanvasPage from "@canvas/pages/canvas/new";
import CanvasProjectPage from "@canvas/pages/canvas/project";
import ConfigPage from "@canvas/pages/config";
import HomePage from "@canvas/pages/home";
import ImagePage from "@canvas/pages/image";
import NotFound from "@canvas/pages/not-found";
import PromptsPage from "@canvas/pages/prompts";
import VideoPage from "@canvas/pages/video";

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/new", element: <NewCanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/config", element: <ConfigPage /> },
        ],
    },
    // 嵌入模式：不带顶部导航和 Agent 面板，供外部 iframe 嵌入
    {
        path: "/video",
        element: (
            <div className="flex h-dvh overflow-hidden bg-background text-foreground">
                <div className="min-w-0 flex-1 overflow-hidden">
                    <VideoPage />
                </div>
            </div>
        ),
    },
    { path: "*", element: <NotFound /> },
]);
