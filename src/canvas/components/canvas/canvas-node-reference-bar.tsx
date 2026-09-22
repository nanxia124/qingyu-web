import { FileText, Image as ImageIcon, Music2, Plus, Puzzle, Video, X } from "lucide-react";
import { Popover } from "antd";
import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@canvas/lib/canvas-theme";
import { getNodeDefinition } from "@canvas/lib/canvas/node-registry";
import { getGroupResourceNodes } from "@canvas/lib/canvas/canvas-resource-references";
import { getImagePreviewRevision, previewUrlFor, subscribeImagePreviews } from "@canvas/services/image-storage";
import { useThemeStore } from "@canvas/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@canvas/types/canvas";

export function CanvasNodeReferenceBar({ nodeId, nodes, connectedNodes, uploadedImages = [], onRemoveUploadedImage, onDisconnect, onStartSelection }: { nodeId: string; nodes: CanvasNodeData[]; connectedNodes: CanvasNodeData[]; uploadedImages?: string[]; onRemoveUploadedImage?: (index: number) => void; onDisconnect?: (fromNodeId: string, toNodeId: string) => void; onStartSelection?: (nodeId: string) => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewZoom, setPreviewZoom] = useState(1);
    const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const references = connectedNodes.flatMap((sourceNode) => (sourceNode.type === CanvasNodeType.Group ? getGroupResourceNodes(sourceNode.id, nodes) : [sourceNode]).map((node) => ({ node, sourceNodeId: sourceNode.id })));
    return (
        <div className="mb-2">
            <div className="mb-1.5 text-[11px] font-medium" style={{ color: theme.node.muted }}>{t("canvas.references.title")}</div>
            <div className="thin-scrollbar flex min-h-12 gap-2 overflow-x-auto pb-1">
                {references.map(({ node, sourceNodeId }) => <ReferenceItem key={`${sourceNodeId}:${node.id}`} node={node} onRemove={() => onDisconnect?.(sourceNodeId, nodeId)} />)}
                {uploadedImages.map((url, index) => (
                    <div key={`uploaded-${index}`} className="group relative grid size-12 shrink-0 place-items-center rounded-xl border cursor-zoom-in" style={{ background: theme.toolbar.activeBg, borderColor: theme.toolbar.border }} onClick={() => setPreviewUrl(url)}>
                        <img src={url} alt="" className="size-full rounded-[inherit] object-cover" />
                        <button type="button" className="absolute right-0 top-0 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} aria-label={t("canvas.references.disconnect")} title={t("canvas.references.disconnect")} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemoveUploadedImage?.(index); }}><X className="size-3" /></button>
                    </div>
                ))}
                <button type="button" className="grid size-12 shrink-0 place-items-center rounded-xl border bg-transparent transition hover:opacity-70" style={{ borderColor: theme.toolbar.border, color: theme.node.muted }} title={t("canvas.references.select")} onClick={() => onStartSelection?.(nodeId)}>
                    <Plus className="size-4" />
                </button>
            </div>
            {previewUrl && createPortal(
                <div 
                    className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-black/80" 
                    onClick={() => { setPreviewUrl(null); setPreviewZoom(1); setPreviewPan({x:0,y:0}); }}
                    onWheel={(e) => {
                        e.stopPropagation();
                        setPreviewZoom((z) => Math.min(8, Math.max(0.5, z + (e.deltaY < 0 ? 0.2 : -0.2))));
                    }}
                >
                    <img 
                        src={previewUrl} 
                        alt="" 
                        draggable={false}
                        className="select-none rounded-lg object-contain"
                        style={{
                            transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${previewZoom})`,
                            cursor: previewZoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
                            transition: 'transform 0.05s',
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => {
                            if (previewZoom <= 1) return;
                            e.stopPropagation();
                            setIsDragging(true);
                            const startX = e.clientX - previewPan.x;
                            const startY = e.clientY - previewPan.y;
                            const onMove = (ev: MouseEvent) => {
                                setPreviewPan({ x: ev.clientX - startX, y: ev.clientY - startY });
                            };
                            const onUp = () => {
                                setIsDragging(false);
                                window.removeEventListener('mousemove', onMove);
                                window.removeEventListener('mouseup', onUp);
                            };
                            window.addEventListener('mousemove', onMove);
                            window.addEventListener('mouseup', onUp);
                        }}
                    />
                </div>,
                document.body
            )}
        </div>
    );
}

function ReferenceItem({ node, onRemove }: { node: CanvasNodeData; onRemove: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    const content = node.metadata?.content || resource?.url;
    const thumbnail = previewUrlFor(node.metadata?.storageKey) || content;
    const Icon = resource?.kind === "image" || node.type === CanvasNodeType.Image ? ImageIcon : resource?.kind === "video" || node.type === CanvasNodeType.Video ? Video : resource?.kind === "audio" || node.type === CanvasNodeType.Audio ? Music2 : resource?.kind === "text" || node.type === CanvasNodeType.Text ? FileText : Puzzle;
    return (
        <Popover placement="topLeft" mouseEnterDelay={0.15} content={<ReferencePreview node={node} content={content} />}>
            <div className="group relative grid size-12 shrink-0 place-items-center rounded-xl border" style={{ background: theme.toolbar.activeBg, borderColor: theme.toolbar.border }}>
                <span className="grid size-full place-items-center overflow-hidden rounded-[inherit]">
                    {(resource?.kind === "image" || node.type === CanvasNodeType.Image) && thumbnail ? <img src={thumbnail} alt="" className="size-full object-cover" /> : (resource?.kind === "video" || node.type === CanvasNodeType.Video) && content ? <video src={content} className="size-full object-cover" muted /> : <Icon className="size-4 opacity-65" />}
                </span>
                <button type="button" className="absolute right-0 top-0 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} aria-label={t("canvas.references.disconnect")} title={t("canvas.references.disconnect")} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(); }}><X className="size-3" /></button>
            </div>
        </Popover>
    );
}

function ReferencePreview({ node, content }: { node: CanvasNodeData; content?: string }) {
    const { t } = useTranslation();
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    if ((resource?.kind === "image" || node.type === CanvasNodeType.Image) && content) return <img src={content} alt={node.title} className="max-h-52 w-72 rounded-lg object-contain" />;
    if ((resource?.kind === "video" || node.type === CanvasNodeType.Video) && content) return <video src={content} className="max-h-52 w-72 rounded-lg" muted controls />;
    if ((resource?.kind === "audio" || node.type === CanvasNodeType.Audio) && content) return <audio src={content} className="w-72" controls />;
    return <div className="max-h-52 w-72 overflow-auto whitespace-pre-wrap text-sm">{resource?.text || node.metadata?.content || node.metadata?.prompt || node.title || t("canvas.references.empty")}</div>;
}
