/**
 * 画布模块统一入口（被主站以 React.lazy 懒加载）。
 * - 画布源码整体位于 src/canvas，内部使用 @canvas/* 别名，自成模块。
 * - 复用画布自带的 AppProviders（antd ConfigProvider/Pro/App、react-query、ClientRootInit），
 *   但不再挂载独立 Router——路由由主站 react-router 提供，画布内部 useNavigate/useParams 直接生效。
 * - i18n、streamdown 和画布 shadcn/tailwind 主题样式在此一次性副作用引入。
 */
import "@canvas/i18n";
import "streamdown/styles.css";
import "@canvas/styles/globals.css";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { AppProviders } from "@canvas/components/layout/app-providers";
import { AgentPanel } from "@canvas/components/agent/agent-panel";
import { ensureServerConfig } from "@canvas/lib/server-config-bootstrap";
import CanvasLibraryPage from "@canvas/pages/canvas";
import NewCanvasPage from "@canvas/pages/canvas/new";
import CanvasProjectPage from "@canvas/pages/canvas/project";
import VideoPage from "@canvas/pages/video";

function CanvasShell({ children }: { children: ReactNode }) {
    useEffect(() => {
        // 首次进入画布时从主站后端拉取渠道/模型配置（仅一次）
        void ensureServerConfig();
    }, []);

    useEffect(() => {
        // 画布 app-providers 会把 document.title 改成画布标题；离开画布路由时恢复进入前的标题
        const originalTitle = document.title;
        return () => {
            document.title = originalTitle;
        };
    }, []);
    return (
        <AppProviders>
            {/*
              antd <App> 会包一层 block、无高度的 wrapper div，因此用 absolute inset-0 相对
              AppLayout 主区（relative）填满，为画布提供确定的宽高包含块。
              项目编辑器路由不经独立应用的 UserLayout，而 AgentPanel（右侧 Agent 侧栏，内含
              LocalAgentPanel）原本只挂在 UserLayout 里，集成后会缺失，导致顶部 Agent 按钮只改状态、
              无面板可开。这里按 UserLayout 的同构布局显式挂载：左侧内容区 flex-1，右侧 AgentPanel。
            */}
            <div className="absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-bg">
                <div className="relative min-h-0 flex-1 overflow-hidden">
                    <div className="absolute inset-0 min-h-0 min-w-0 overflow-hidden">{children}</div>
                </div>
                <AgentPanel />
            </div>
        </AppProviders>
    );
}

/** /canvas 画布库（?mode=new|recent 时自动进入对应项目） */
export function CanvasRoute() {
    return (
        <CanvasShell>
            <CanvasLibraryPage />
        </CanvasShell>
    );
}

/** /canvas/new 新建并进入画布 */
export function CanvasNewRoute() {
    return (
        <CanvasShell>
            <NewCanvasPage />
        </CanvasShell>
    );
}

/** /canvas/:id 具体画布项目 */
export function CanvasProjectRoute() {
    return (
        <CanvasShell>
            <CanvasProjectPage />
        </CanvasShell>
    );
}

/**
 * 视频创作台的原生集成壳：与 CanvasShell 一样提供 AppProviders 和后端配置引导，
 * 但视频页是全屏三栏工作台，不挂 UserLayout/AgentPanel（等价于独立应用的 /video 嵌入模式）。
 */
function VideoShell({ children }: { children: ReactNode }) {
    useEffect(() => {
        // 首次进入时从主站后端拉取渠道/模型配置（仅一次）
        void ensureServerConfig();
    }, []);

    useEffect(() => {
        const originalTitle = document.title;
        return () => {
            document.title = originalTitle;
        };
    }, []);

    return (
        <AppProviders>
            <div className="absolute inset-0 min-h-0 overflow-hidden">
                <div className="h-full min-h-0 min-w-0 overflow-hidden">{children}</div>
            </div>
        </AppProviders>
    );
}

/** /video 视频创作台（原生集成，替代 iframe） */
export function CanvasVideoRoute() {
    return (
        <VideoShell>
            <VideoPage />
        </VideoShell>
    );
}
