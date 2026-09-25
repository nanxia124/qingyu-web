import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { App, Empty, Input, Modal, Pagination, Tag } from "antd";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@canvas/lib/utils";
import { getImagePreviewRevision, resolveImageUrl, subscribeImagePreviews } from "@canvas/services/image-storage";
import { readMediaText, resolveMediaUrl } from "@canvas/services/file-storage";
import { api } from "@/lib/api";
import { assetCoverUrl, useAssetStore, type Asset, type ImageAsset, type TextAsset, type VideoAsset } from "@canvas/stores/use-asset-store";

type InsertableAsset = TextAsset | ImageAsset | VideoAsset;
type RemoteAsset = { id: string; name: string; type: string; createdAt: string; metadata?: Record<string, unknown> };

export type InsertAssetPayload = { kind: "text"; content: string; title: string } | { kind: "image"; dataUrl: string; title: string; storageKey?: string } | { kind: "video"; url: string; title: string; storageKey?: string; width?: number; height?: number };

type Props = {
    open: boolean;
    defaultTab?: string;
    onInsert: (payload: InsertAssetPayload) => void;
    onClose: () => void;
};

export function AssetPickerModal({ open, onInsert, onClose }: Props) {
    const { t } = useTranslation();
    return (
        <Modal title={t("canvas.assetPicker.title")} open={open} onCancel={onClose} footer={null} width={860} destroyOnHidden styles={{ body: { padding: "0 24px 24px", minHeight: 480 } }}>
            <MyAssetsTab onInsert={onInsert} />
        </Modal>
    );
}

const PAGE_SIZE = 8;

const kindOptions = ["all", "text", "image", "video"];

function remoteAssetForPicker(asset: RemoteAsset): InsertableAsset | null {
    const metadata = asset.metadata || {};
    const mimeType = typeof metadata.mimeType === "string" ? metadata.mimeType : "application/octet-stream";
    const storageKey = `${asset.type === "image" ? "image" : asset.type === "video" ? "video" : "text"}:${asset.id}`;
    const base = {
        id: asset.id,
        title: asset.name,
        coverUrl: "",
        tags: [],
        source: typeof metadata.sourceKind === "string" ? metadata.sourceKind : "",
        metadata,
        createdAt: asset.createdAt,
        updatedAt: asset.createdAt,
    };
    if (asset.type === "image") return { ...base, kind: "image", data: { dataUrl: "", storageKey, width: Number(metadata.width) || 0, height: Number(metadata.height) || 0, bytes: Number(metadata.sizeBytes) || 0, mimeType } };
    if (asset.type === "video") return { ...base, kind: "video", data: { url: "", storageKey, width: Number(metadata.width) || 0, height: Number(metadata.height) || 0, bytes: Number(metadata.sizeBytes) || 0, mimeType } };
    if ((asset.type === "file" || asset.type === "doc") && mimeType.startsWith("text/")) return { ...base, kind: "text", data: { content: "", storageKey } };
    return null;
}

function PickerCard({ title, kind, cover, onClick }: { title: string; kind: string; cover: string; onClick: () => void }) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            className="group relative cursor-pointer overflow-hidden rounded-lg border border-zinc-200 bg-white text-left transition hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-500"
            onClick={onClick}
        >
            {cover ? (
                <img src={cover} alt={title} className="aspect-[4/3] w-full object-cover" />
            ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-zinc-100 p-3 text-center text-xs leading-5 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{title}</div>
            )}
            <div className="p-2.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-xs font-medium text-zinc-800 dark:text-zinc-200">{title}</span>
                    <Tag className="m-0 shrink-0 text-[10px]">{t(`assets.kinds.${kind}`)}</Tag>
                </div>
            </div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-zinc-950/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-zinc-950/55 group-hover:opacity-100">{t("canvas.assetPicker.insert")}</div>
        </button>
    );
}

function MyAssetsTab({ onInsert }: { onInsert: (payload: InsertAssetPayload) => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const assets = useAssetStore((state) => state.assets);
    const [remoteAssets, setRemoteAssets] = useState<RemoteAsset[]>([]);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState("all");
    const [page, setPage] = useState(1);

    useEffect(() => {
        let cancelled = false;
        void api.get<RemoteAsset[]>("/assets", { type: "all" }).then((items) => {
            if (!cancelled) setRemoteAssets(items);
        }).catch(() => {
            if (!cancelled) setRemoteAssets([]);
        });
        return () => { cancelled = true; };
    }, []);

    const allAssets = useMemo(() => {
        const localIds = new Set(assets.map((asset) => asset.data.storageKey?.split(":").at(-1)).filter(Boolean));
        const remote = remoteAssets.map(remoteAssetForPicker).filter((asset): asset is InsertableAsset => Boolean(asset) && !localIds.has(asset.data.storageKey?.split(":").at(-1)));
        return [...assets, ...remote];
    }, [assets, remoteAssets]);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return allAssets
            .filter((a): a is InsertableAsset => a.kind === "text" || a.kind === "image" || a.kind === "video")
            .filter((a) => kindFilter === "all" || a.kind === kindFilter)
            .filter((a) => !query || [a.title, ...(a.tags || [])].join(" ").toLowerCase().includes(query));
    }, [allAssets, keyword, kindFilter]);

    const visible = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        setPage((v) => Math.min(v, maxPage));
    }, [filtered.length]);

    const handleInsert = async (asset: InsertableAsset) => {
        try {
            if (asset.kind === "text") {
                const content = asset.data.content || (asset.data.storageKey ? await readMediaText(asset.data.storageKey) : "");
                if (content === null) throw new Error("无法读取这份文本素材");
                onInsert({ kind: "text", content, title: asset.title });
            } else if (asset.kind === "video") {
                const url = asset.data.url || (asset.data.storageKey ? await resolveMediaUrl(asset.data.storageKey) : "");
                if (!url) throw new Error("无法读取这段视频素材");
                onInsert({ kind: "video", url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height });
            } else {
                const dataUrl = asset.data.dataUrl || (asset.data.storageKey ? await resolveImageUrl(asset.data.storageKey) : "");
                if (!dataUrl) throw new Error("无法读取这张图片素材");
                onInsert({ kind: "image", dataUrl, storageKey: asset.data.storageKey, title: asset.title });
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取素材失败，请重试");
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <Input
                    className="w-56"
                    size="small"
                    prefix={<Search className="size-3.5 text-zinc-400" />}
                    placeholder={t("canvas.assetPicker.search")}
                    value={keyword}
                    allowClear
                    onChange={(e) => {
                        setPage(1);
                        setKeyword(e.target.value);
                    }}
                />
                <div className="flex gap-1.5">
                    {kindOptions.map((option) => (
                        <Tag.CheckableTag
                            key={option}
                            checked={kindFilter === option}
                            className={cn("prompt-filter-tag", kindFilter === option && "is-active")}
                            onChange={() => {
                                setPage(1);
                                setKindFilter(option);
                            }}
                        >
                            {option === "all" ? t("common.all") : t(`assets.kinds.${option}`)}
                        </Tag.CheckableTag>
                    ))}
                </div>
            </div>

            {visible.length ? (
                <div className="grid grid-cols-4 gap-3">
                    {visible.map((asset) => (
                        <PickerCard key={asset.id} title={asset.title} kind={asset.kind} cover={assetCoverUrl(asset)} onClick={() => void handleInsert(asset)} />
                    ))}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.assetPicker.empty")} className="py-12" />
            )}

            {filtered.length > PAGE_SIZE && (
                <div className="flex justify-center">
                    <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} showSizeChanger={false} />
                </div>
            )}
        </div>
    );
}
