import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface ImageViewerProps {
    images: string[];
    index: number;
    onIndexChange: (index: number) => void;
    onClose: () => void;
}

export function ImageViewer({ images, index, onIndexChange, onClose }: ImageViewerProps) {
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);

    const resetView = useCallback(() => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    }, []);

    const handleClose = useCallback(() => {
        resetView();
        onClose();
    }, [resetView, onClose]);

    const showArrows = images.length > 1;

    const goPrev = useCallback(() => {
        resetView();
        onIndexChange(index <= 0 ? images.length - 1 : index - 1);
    }, [index, images.length, onIndexChange, resetView]);

    const goNext = useCallback(() => {
        resetView();
        onIndexChange(index >= images.length - 1 ? 0 : index + 1);
    }, [index, images.length, onIndexChange, resetView]);

    // 键盘左右切换 + ESC 关闭
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") handleClose();
            if (e.key === "ArrowLeft" && showArrows) goPrev();
            if (e.key === "ArrowRight" && showArrows) goNext();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [handleClose, goPrev, goNext, showArrows]);

    const currentSrc = images[index];
    if (!currentSrc) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-black/80"
            onClick={handleClose}
            onWheel={(e) => {
                e.stopPropagation();
                setZoom((z) => Math.min(8, Math.max(0.5, z + (e.deltaY < 0 ? 0.2 : -0.2))));
            }}
        >
            <img
                src={currentSrc}
                alt=""
                draggable={false}
                className="max-h-[90vh] max-w-[90vw] select-none rounded-lg object-contain"
                style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    cursor: zoom > 1 ? (isDragging ? "grabbing" : "grab") : "default",
                    transition: "transform 0.05s",
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => {
                    if (zoom <= 1) return;
                    e.stopPropagation();
                    setIsDragging(true);
                    let lastX = e.clientX;
                    let lastY = e.clientY;
                    let vx = 0;
                    let vy = 0;
                    const startX = e.clientX - pan.x;
                    const startY = e.clientY - pan.y;
                    const onMove = (ev: MouseEvent) => {
                        vx = ev.clientX - lastX;
                        vy = ev.clientY - lastY;
                        lastX = ev.clientX;
                        lastY = ev.clientY;
                        setPan({ x: ev.clientX - startX, y: ev.clientY - startY });
                    };
                    const onUp = () => {
                        setIsDragging(false);
                        window.removeEventListener("mousemove", onMove);
                        window.removeEventListener("mouseup", onUp);
                        const decay = 0.92;
                        const step = () => {
                            vx *= decay;
                            vy *= decay;
                            if (Math.abs(vx) < 0.5 && Math.abs(vy) < 0.5) return;
                            setPan((p) => ({ x: p.x + vx, y: p.y + vy }));
                            requestAnimationFrame(step);
                        };
                        requestAnimationFrame(step);
                    };
                    window.addEventListener("mousemove", onMove);
                    window.addEventListener("mouseup", onUp);
                }}
            />

            {/* 关闭按钮 */}
            <button
                className="absolute right-5 top-5 flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                onClick={handleClose}
            >
                <X className="size-5" />
            </button>

            {/* 左右切换 */}
            {showArrows && (
                <>
                    <button
                        className="absolute left-5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                        onClick={(e) => {
                            e.stopPropagation();
                            goPrev();
                        }}
                    >
                        <ChevronLeft className="size-6" />
                    </button>
                    <button
                        className="absolute right-5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                        onClick={(e) => {
                            e.stopPropagation();
                            goNext();
                        }}
                    >
                        <ChevronRight className="size-6" />
                    </button>
                </>
            )}

            {/* 缩放百分比 */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-4 py-1.5 text-[13px] text-white">
                {Math.round(zoom * 100)}%
            </div>
        </div>,
        document.body
    );
}
