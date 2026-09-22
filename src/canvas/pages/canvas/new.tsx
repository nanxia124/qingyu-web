import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCanvasStore } from "@canvas/stores/canvas/use-canvas-store";
import { hasAgentUrlBootstrap } from "@canvas/lib/agent/agent-url-bootstrap";

/**
 * 直接创建新项目并跳转，不经过列表页
 */
export default function NewCanvasPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const doneRef = useRef(false);

    useEffect(() => {
        if (!hydrated || doneRef.current) return;
        doneRef.current = true;
        const id = createProject(t("canvas.defaultTitle", { count: projects.length + 1 }));
        const agentHash = hasAgentUrlBootstrap(window.location.hash) ? window.location.hash : "";
        navigate(`/canvas/${id}${agentHash}`, { replace: true });
    }, [hydrated, createProject, navigate, projects.length, t]);

    return <main className="h-full" style={{ background: "#171717" }}></main>;
}
