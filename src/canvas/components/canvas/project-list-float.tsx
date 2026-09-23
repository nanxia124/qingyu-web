import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { App } from "antd";
import { Check, Download, FolderOpen, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { useCanvasStore } from "@canvas/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@canvas/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@canvas/lib/canvas/canvas-export";
import { readZip } from "@canvas/lib/zip";
import { setMediaBlob } from "@canvas/services/file-storage";
import { setImageBlob } from "@canvas/services/image-storage";
import type { CanvasExportFile } from "@canvas/types/canvas-export";

export function ProjectListFloat() {
    const navigate = useNavigate();
    const { projectId } = useParams();
    const { message } = App.useApp();
    const [open, setOpen] = useState(false);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    const projects = useCanvasStore((s) => s.projects);
    const createProject = useCanvasStore((s) => s.createProject);
    const renameProject = useCanvasStore((s) => s.renameProject);
    const deleteProjects = useCanvasStore((s) => s.deleteProjects);
    const importProject = useCanvasStore((s) => s.importProject);

    const selectedIds = useCanvasUiStore((s) => s.selectedProjectIds);
    const toggleSelected = useCanvasUiStore((s) => s.toggleSelectedProjectId);

    const allSelected = projects.length > 0 && selectedIds.length === projects.length;
    const toggleAll = () => {
        const next = allSelected ? [] : projects.map((p) => p.id);
        // 用 toggleSelected 逐个同步到全局 store
        projects.forEach((p) => toggleSelected(p.id, next.includes(p.id)));
    };

    const handleCreate = () => {
        const id = createProject(`未命名画布 ${projects.length + 1}`);
        navigate(`/canvas/${id}`);
    };

    const openProject = (id: string) => {
        navigate(`/canvas/${id}`);
        setOpen(false);
    };

    const startRename = (id: string, title: string) => {
        setEditingId(id);
        setEditingTitle(title);
    };
    const saveRename = (id: string) => {
        const next = editingTitle.trim();
        if (next) renameProject(id, next);
        setEditingId(null);
    };
    const doDelete = (ids: string[]) => {
        if (!ids.length) return;
        deleteProjects(ids);
        if (projectId && ids.includes(projectId)) navigate("/canvas");
    };
    const deleteSelected = () => {
        if (!selectedIds.length) return;
        if (!window.confirm(`确定删除选中的 ${selectedIds.length} 个画布？`)) return;
        doDelete(selectedIds);
    };
    const exportSelected = () => {
        const list = projects.filter((p) => selectedIds.includes(p.id));
        if (!list.length) return;
        void exportCanvasProjects(list, `画布-${list.length}`);
    };
    const deleteOne = (id: string) => doDelete([id]);

    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            await Promise.all(
                data.projects.flatMap((project) =>
                    project.files.map(async (item) => {
                        const blob = zip.get(item.path);
                        if (!blob) return;
                        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
                        await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
                    }),
                ),
            );
            data.projects.forEach((item) => importProject(item.project));
            message.success(`已导入 ${data.projects.length} 个画布`);
        } catch {
            message.error("导入失败");
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
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
                        width: 300,
                        maxHeight: "calc(100vh - 140px)",
                        overflowY: "auto",
                        scrollbarWidth: "thin",
                        boxShadow: "0 8px 32px rgba(0,0,0,.4)",
                    }}
                >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <span style={{ color: "#fff", fontWeight: 600 }}>画布库</span>
                        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer" }}>
                            <X size={16} />
                        </button>
                    </div>

                    {/* 批量操作工具栏 */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#ccc", fontSize: 12, cursor: "pointer", marginRight: 2 }}>
                            <input type="checkbox" className="canvas-checkbox" checked={allSelected} onChange={toggleAll} />
                            全选
                        </label>
                        {selectedIds.length > 0 && (
                            <>
                                <button onClick={deleteSelected} style={toolBtnStyle(false, "#f87171")}>
                                    <Trash2 size={13} /> 删除{selectedIds.length > 1 ? `(${selectedIds.length})` : ""}
                                </button>
                                <button onClick={exportSelected} style={toolBtnStyle(false, "#ccc")}>
                                    <Download size={13} /> 导出
                                </button>
                            </>
                        )}
                        <button onClick={() => fileInputRef.current?.click()} style={toolBtnStyle(false, "#ccc")}>
                            <Upload size={13} /> 导入
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

                    {projects.map((p) => {
                        const isCurrent = p.id === projectId;
                        const editing = editingId === p.id;
                        const checked = selectedIds.includes(p.id);
                        return (
                            <div
                                key={p.id}
                                onMouseEnter={() => setHoveredId(p.id)}
                                onMouseLeave={() => setHoveredId(null)}
                                style={{
                                    padding: "10px",
                                    borderRadius: 8,
                                    cursor: "pointer",
                                    marginBottom: 4,
                                    background: isCurrent ? "rgba(80,81,248,.18)" : "rgba(255,255,255,.05)",
                                }}
                            >
                                {editing ? (
                                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                        <input
                                            autoFocus
                                            value={editingTitle}
                                            onChange={(e) => setEditingTitle(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") saveRename(p.id);
                                                if (e.key === "Escape") setEditingId(null);
                                            }}
                                            style={{
                                                flex: 1,
                                                background: "rgba(255,255,255,.1)",
                                                border: "none",
                                                borderRadius: 6,
                                                padding: "4px 8px",
                                                color: "#fff",
                                                fontSize: 14,
                                                outline: "none",
                                            }}
                                        />
                                        <button onClick={() => saveRename(p.id)} style={iconBtnStyle("#5051F8")}>
                                            <Check size={14} />
                                        </button>
                                        <button onClick={() => setEditingId(null)} style={iconBtnStyle("#888")}>
                                            <X size={14} />
                                        </button>
                                    </div>
                                ) : (
                                    <div onClick={() => openProject(p.id)}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <input
                                                type="checkbox"
                                                className="canvas-checkbox"
                                                checked={checked}
                                                onClick={(e) => e.stopPropagation()}
                                                onChange={(e) => toggleSelected(p.id, e.target.checked)}
                                                style={{ flexShrink: 0 }}
                                            />
                                            <span style={{ color: "#fff", fontSize: 14 }}>
                                                {p.title}
                                                {isCurrent && <span style={{ color: "#8b8cf5", fontSize: 11, marginLeft: 6 }}>当前</span>}
                                            </span>
                                        </div>
                                        <div style={{ color: "#888", fontSize: 12, marginTop: 4, paddingLeft: 22 }}>
                                            {p.nodes.length} 个节点 · 最近{" "}
                                            {new Date(p.updatedAt).toLocaleString(undefined, {
                                                month: "2-digit",
                                                day: "2-digit",
                                                hour: "2-digit",
                                                minute: "2-digit",
                                            })}
                                        </div>
                                    </div>
                                )}
                                {!editing && (
                                    <div
                                        style={{
                                            marginTop: 6,
                                            marginLeft: 22,
                                            display: "flex",
                                            gap: 4,
                                            opacity: hoveredId === p.id ? 1 : 0,
                                            transition: "opacity .15s ease",
                                        }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                    >
                                        <button title="重命名" onClick={() => startRename(p.id, p.title)} style={iconBtnStyle("#aaa")}>
                                            <Pencil size={13} />
                                        </button>
                                        <button title="导出" onClick={() => void exportCanvasProjects([p], p.title || "画布")} style={iconBtnStyle("#aaa")}>
                                            <Download size={13} />
                                        </button>
                                        <button title="删除" onClick={() => deleteOne(p.id)} style={iconBtnStyle("#f87171")}>
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    <input ref={fileInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(e) => void importCanvas(e.target.files?.[0])} />
                </div>
            )}
        </>
    );
}

function toolBtnStyle(disabled: boolean, color: string): React.CSSProperties {
    return {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 26,
        padding: "0 8px",
        borderRadius: 6,
        background: "rgba(255,255,255,.08)",
        border: "none",
        color: disabled ? "#555" : color,
        fontSize: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
    };
}

function iconBtnStyle(color: string): React.CSSProperties {
    return {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: 6,
        background: "rgba(255,255,255,.08)",
        border: "none",
        color,
        cursor: "pointer",
    };
}
