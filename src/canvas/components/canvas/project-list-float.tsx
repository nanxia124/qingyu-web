import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderOpen, Plus, X } from "lucide-react";
import { useCanvasStore } from "@canvas/stores/canvas/use-canvas-store";
import { useTranslation } from "react-i18next";

export function ProjectListFloat() {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const projects = useCanvasStore((s) => s.projects);
    const createProject = useCanvasStore((s) => s.createProject);

    const handleCreate = () => {
        const id = createProject(t("canvas.defaultTitle", { count: projects.length + 1 }));
        navigate(`/canvas/${id}`);
    };

    return (
        <>
            <button
                onClick={() => setOpen(!open)}
                style={{
                    background: "transparent",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "6px 10px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 14,
                    marginRight: 8,
                }}
            >
                <FolderOpen size={16} />
            </button>
            {open && (
                <div
                    className="thin-scrollbar"
                    style={{
                        position: "absolute",
                        top: 56,
                        left: 16,
                        zIndex: 100,
                        background: "#1c1c1c",
                        borderRadius: 16,
                        padding: 16,
                        width: 280,
                        maxHeight: "calc(100vh - 140px)",
                        overflowY: "auto",
                        scrollbarWidth: "thin",
                        boxShadow: "0 8px 32px rgba(0,0,0,.4)",
                    }}
                >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                        <span style={{ color: "#fff", fontWeight: 600 }}>画布库</span>
                        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer" }}>
                            <X size={16} />
                        </button>
                    </div>
                    <button
                        onClick={handleCreate}
                        style={{
                            width: "100%",
                            background: "#5051F8",
                            color: "#fff",
                            border: "none",
                            borderRadius: 8,
                            padding: "8px",
                            cursor: "pointer",
                            marginBottom: 12,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                        }}
                    >
                        <Plus size={16} />
                        新建画布
                    </button>
                    {projects.map((p) => (
                        <div
                            key={p.id}
                            onClick={() => { navigate(`/canvas/${p.id}`); setOpen(false); }}
                            style={{
                                padding: "10px",
                                borderRadius: 8,
                                cursor: "pointer",
                                marginBottom: 4,
                                background: "rgba(255,255,255,.05)",
                            }}
                        >
                            <div style={{ color: "#fff", fontSize: 14 }}>{p.title}</div>
                            <div style={{ color: "#888", fontSize: 12, marginTop: 4 }}>
                                {p.nodes.length} 个节点
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}
