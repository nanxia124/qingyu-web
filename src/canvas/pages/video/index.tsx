import { ArrowLeft, ArrowRight, BookOpen, CheckSquare, ClipboardPaste, Download, FolderPlus, History, LoaderCircle, Plus, SlidersHorizontal, Sparkles, Trash2, Upload, VideoIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type DragEvent } from "react";
import { App, Button, Checkbox, Drawer, Empty, Input, Modal, Tag, Typography } from "antd";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { AssetPickerModal, type InsertAssetPayload } from "@canvas/components/canvas/asset-picker-modal";
import { ModelPicker } from "@canvas/components/model-picker";
import { PromptSelectDialog } from "@canvas/components/prompts/prompt-select-dialog";
import { VideoSettingsPanel, normalizeVideoResolutionValue, normalizeVideoSizeValue, videoModeLabel, videoSizeLabel } from "@canvas/components/video-settings-panel";
import { canvasThemes } from "@canvas/lib/canvas-theme";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio, parseVideoResolution, readVideoDimensions, videoRatioOptions, VIDEO_SECONDS_MIN, VIDEO_SECONDS_MAX } from "@canvas/lib/media-size";
import { formatBytes, formatDuration } from "@canvas/lib/image-utils";
import { deleteStoredMedia, resolveMediaUrl } from "@canvas/services/file-storage";
import { resolveImageUrl, ensureImagePreview, getImagePreviewRevision, previewUrlFor, subscribeImagePreviews, uploadImage } from "@canvas/services/image-storage";
import { createVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo, type VideoGenerationTask } from "@canvas/services/api/video";
import { useAssetStore } from "@canvas/stores/use-asset-store";
import { useWorkbenchAgentStore } from "@canvas/stores/use-workbench-agent-store";
import { boolConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@canvas/stores/use-config-store";
import { useThemeStore } from "@canvas/stores/use-theme-store";
import type { ReferenceImage } from "@canvas/types/image";
import i18n from "@canvas/i18n";
import { useAuthStore } from "@/stores/useAuthStore";

type GeneratedVideo = {
    id: string;
    url: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    video?: GeneratedVideo;
    error?: string;
};

type GenerationLog = {
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    size: string;
    resolution: string;
    seconds: string;
    status: "pending" | "success" | "failed";
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
};

type GenerationLogConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

const LOG_STORE_KEY = "infinite-canvas:video_generation_logs";
const logStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });

export default function VideoPage() {
    const { message } = App.useApp();
    const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
    const openAuthModal = useAuthStore((s) => s.openAuthModal);
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const activeLogIdsRef = useRef<Set<string>>(new Set());
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [running, setRunning] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [referenceDragTarget, setReferenceDragTarget] = useState(false);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const videoCommand = useWorkbenchAgentStore((state) => state.videoCommand);
    const clearVideoCommand = useWorkbenchAgentStore((state) => state.clearVideoCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);

    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const canGenerate = Boolean(prompt.trim());

    // 从 GenerationSettings 搬过来的变量
    const resolution = parseVideoResolution(effectiveConfig.vquality);
    const seconds = Number(clampVideoSeconds(effectiveConfig.videoSeconds || "6"));
    const selectedRatio = inferVideoRatio(effectiveConfig.size || "auto");
    const dimensions = readVideoDimensions(effectiveConfig.size || "auto", resolution, selectedRatio);

    const applySize = (nextResolution: string, ratio: string) => {
        updateConfig("vquality", nextResolution);
        updateConfig("size", computeVideoSize(nextResolution, ratio));
    };

    const selectRatio = (ratio: string) => {
        if (ratio === "auto") {
            updateConfig("size", "auto");
        } else {
            applySize(resolution, ratio);
        }
    };

    // 自定义清晰度允许范围与预设档对齐（240P 下限、1080P 上限）；非数字回落 720，防止超大值透传后端
    const selectResolution = (nextResolution: string) => {
        const parsed = Number(parseVideoResolution(nextResolution)) || 720;
        const clamped = String(Math.max(240, Math.min(1080, parsed)));
        if (selectedRatio === "auto") updateConfig("vquality", clamped);
        else applySize(clamped, selectedRatio);
    };

    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
        updateConfig("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
    };

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        void refreshLogs();
    }, []);

    const addReferences = async (files?: FileList | null) => {
        const selectedFiles = Array.from(files || []);
        const unsupported = selectedFiles.filter((file) => !file.type.startsWith("image/"));
        if (unsupported.length) message.warning(t("videoWorkbench.unsupportedFiles"));
        const imageFiles = selectedFiles.filter((file) => file.type.startsWith("image/")).slice(0, 7 - references.length);
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const image = await uploadImage(file);
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
            }),
        );
        setReferences((value) => [...value, ...nextReferences].slice(0, 7));
    };

    const handleReferenceDragEnter = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current += 1;
        if (event.dataTransfer.types.includes("Files")) setReferenceDragTarget(true);
    };

    const handleReferenceDragLeave = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (!dragDepthRef.current) setReferenceDragTarget(false);
    };

    const handleReferenceDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setReferenceDragTarget(false);
        void addReferences(event.dataTransfer.files);
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error(t("videoWorkbench.clipboardEmpty"));
                return;
            }
            const nextReferences = await Promise.all(
                blobs.slice(0, 7 - references.length).map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences].slice(0, 7));
            message.success(t("videoWorkbench.clipboardAdded", { count: nextReferences.length }));
        } catch {
            message.error(t("videoWorkbench.clipboardEmpty"));
        }
    };
    const generate = async () => {
        if (!isLoggedIn) { openAuthModal(); return; }
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("videoWorkbench.invalidParams") });
            return;
        }
        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        setResults([{ id: nanoid(), status: "pending" }]);
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);
        try {
            const task = await createVideoGenerationTask(snapshot.config, snapshot.text, snapshot.references);
            const log = buildLog({ prompt: snapshot.text, model, config: snapshot.config, references: snapshot.references, durationMs: 0, status: "pending", task });
            await saveLog(log, false);
            void pollGenerationLog(log, snapshot.config, agentTaskId);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : t("workbench.generationFailed");
            setResults([{ id: nanoid(), status: "failed", error: errorMessage }]);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
            await saveLog(buildLog({ prompt: snapshot.text, model, config: snapshot.config, references: snapshot.references, durationMs: performance.now() - batchStartedAt, status: "failed", error: errorMessage }));
            message.error(errorMessage);
            setRunning(false);
        }
    };

    // Handle video-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!videoCommand || videoCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = videoCommand.nonce;
        clearVideoCommand();
        if (typeof videoCommand.prompt === "string") setPrompt(videoCommand.prompt);
        if (videoCommand.run && running) {
            if (videoCommand.taskId) updateAgentTask(videoCommand.taskId, { status: "failed", error: t("videoWorkbench.busy") });
            return;
        }
        if (videoCommand.run) {
            agentTaskIdRef.current = videoCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [videoCommand, clearVideoCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error(t("videoWorkbench.promptRequired"));
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            return null;
        }
        return { text, config: buildVideoConfig(effectiveConfig, model), references: [...references] };
    };

    const retryResult = () => {
        void generate();
    };

    const downloadVideo = (video: GeneratedVideo) => {
        saveAs(video.url, "video.mp4");
    };

    const saveResultToAssets = (video: GeneratedVideo) => {
        addAsset({
            kind: "video",
            title: t("videoWorkbench.resultTitle"),
            coverUrl: "",
            tags: [],
            source: t("videoWorkbench.source"),
            data: { url: video.url, storageKey: video.storageKey, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType },
            metadata: { source: "video-page", prompt },
        });
        message.success(t("common.addedToAssets"));
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }].slice(0, 7));
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        setPrompt("");
        setReferences([]);
        setResults([]);
        setElapsedMs(0);
        setStartedAt(0);
        setSelectedLogIds([]);
        setPreviewLog(null);
    };

    const deleteSelectedLogs = () => {
        const mediaKeys = logs
            .filter((log) => selectedLogIds.includes(log.id))
            .map((log) => log.video?.storageKey)
            .filter((key): key is string => Boolean(key));
        void Promise.all([deleteStoredMedia(mediaKeys), ...selectedLogIds.map((id) => logStore.removeItem(id))]).then(() => refreshLogs());
        if (previewLog && selectedLogIds.includes(previewLog.id)) {
            setPreviewLog(null);
            setResults([]);
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
    };

    const saveLog = async (log: GenerationLog, resumePending = true) => {
        await logStore.setItem(log.id, serializeLog(log));
        await refreshLogs(resumePending);
    };

    const refreshLogs = async (resumePending = true) => {
        const nextLogs = await readStoredLogs();
        setLogs(nextLogs);
        if (resumePending) resumePendingLogs(nextLogs);
        return nextLogs;
    };

    const resumePendingLogs = (items: GenerationLog[]) => {
        for (const log of items) {
            if (log.status === "pending" && log.task) void pollGenerationLog(log);
        }
    };

    const pollGenerationLog = async (log: GenerationLog, configOverride?: AiConfig, agentTaskId?: string) => {
        if (!log.task || activeLogIdsRef.current.has(log.id)) return;
        activeLogIdsRef.current.add(log.id);
        setRunning(true);
        setStartedAt((value) => value || performance.now());
        setResults((value) => (value.length ? value : [{ id: log.id, status: "pending" }]));
        const taskConfig = buildVideoConfig({ ...effectiveConfig, ...log.config }, log.task.model || log.model);
        try {
            for (let attempt = 0; attempt < 120; attempt += 1) {
                const state = await pollVideoGenerationTask(configOverride || taskConfig, log.task);
                if (state.status === "completed") {
                    const stored = await storeGeneratedVideo(state.result);
                    const nextVideo: GeneratedVideo = {
                        id: nanoid(),
                        url: stored.url,
                        storageKey: stored.storageKey,
                        durationMs: Date.now() - log.createdAt,
                        width: stored.width || 1280,
                        height: stored.height || 720,
                        bytes: stored.bytes,
                        mimeType: stored.mimeType,
                    };
                    setResults([{ id: nextVideo.id, status: "success", video: nextVideo }]);
                    if (agentTaskId) updateAgentTask(agentTaskId, { status: "succeeded", successCount: 1, failCount: 0, error: undefined });
                    await saveLog({ ...log, status: "success", durationMs: nextVideo.durationMs, video: nextVideo, error: undefined });
                    message.success(t("videoWorkbench.generated"));
                    return;
                }
                if (state.status === "failed") throw new Error(state.error);
                if (attempt === 119) throw new Error(t("videoWorkbench.timeout"));
                await delay(2500);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : t("workbench.generationFailed");
            setResults([{ id: log.id, status: "failed", error: errorMessage }]);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
            await saveLog({ ...log, status: "failed", durationMs: Date.now() - log.createdAt, error: errorMessage });
            message.error(errorMessage);
        } finally {
            activeLogIdsRef.current.delete(log.id);
            if (!activeLogIdsRef.current.size) {
                setRunning(false);
                setStartedAt(0);
            }
        }
    };

    const previewGenerationLog = (log: GenerationLog) => {
        setPreviewLog(log);
        setLogsOpen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        if (log.config.videoModel || log.model) updateConfig("videoModel", log.config.videoModel || log.model);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.vquality) updateConfig("vquality", log.config.vquality);
        if (log.config.videoSeconds) updateConfig("videoSeconds", log.config.videoSeconds);
        if (log.config.videoGenerateAudio) updateConfig("videoGenerateAudio", log.config.videoGenerateAudio);
        if (log.config.videoWatermark) updateConfig("videoWatermark", log.config.videoWatermark);
        if (log.config.videoMode) updateConfig("videoMode", log.config.videoMode);
        setResults(log.status === "pending" ? [{ id: log.id, status: "pending" }] : log.video ? [{ id: log.video.id, status: "success", video: log.video }] : [{ id: log.id, status: "failed", error: log.error || t("workbench.generationFailed") }]);
    };

    return (
        <div
            className="video-page-root flex h-full gap-2 bg-background p-3"
            style={{ "--accent": "#5051F8", "--accent-foreground": "#ffffff" } as CSSProperties}
        >
            {/* ── 左栏 配置区 520px ── */}
            <div className="flex w-[520px] shrink-0 flex-col overflow-hidden rounded-xl bg-popover">
                <div className="flex-1 overflow-y-auto px-5 pt-4 pb-2">
                    {/* 模型选择 */}
                    <div className="mb-6">
                        <label className="mb-2 block text-[14px] text-foreground">模型</label>
                        <ModelPicker
                            config={effectiveConfig}
                            value={model}
                            onChange={(value) => updateConfig("videoModel", value)}
                            capability="video"
                            fullWidth
                            onMissingConfig={() => openConfigDialog(false)}
                            className="video-model-picker"
                        />
                    </div>

                    {/* 提示词 */}
                    <div className="mb-6">
                        <label className="mb-2 block text-[14px] text-foreground">提示词</label>
                        <div className="relative rounded-xl bg-muted">
                            <textarea
                                value={prompt}
                                onChange={(event) => setPrompt(event.target.value)}
                                rows={5}
                                placeholder=""
                                className="w-full resize-none overflow-hidden rounded-xl bg-transparent px-3 py-2 text-[14px] leading-[22px] text-foreground outline-none placeholder:text-muted-foreground"
                            />
                            <div className="absolute bottom-2 right-2 flex items-center gap-1">
                                <button
                                    onClick={() => setPromptDialogOpen(true)}
                                    className="flex size-6 items-center justify-center rounded text-[#5f5f66] hover:bg-muted"
                                    title="提示词模板"
                                >
                                    <BookOpen className="size-[13px]" />
                                </button>
                                <button
                                    onClick={() => setAssetPickerOpen(true)}
                                    className="flex size-6 items-center justify-center rounded text-[#5f5f66] hover:bg-muted"
                                    title="从资产库选"
                                >
                                    <FolderPlus className="size-[13px]" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* 比例 */}
                    <div className="mb-6">
                        <label className="mb-2 block text-[14px] text-foreground">比例</label>
                        <div className="grid grid-cols-7 gap-1.5">
                            {videoRatioOptions.map((item) => {
                                const selected = selectedRatio === item.value;
                                const isAuto = item.value === "auto";
                                let icon: number[] | null = null;
                                if (!isAuto) {
                                    const long = Math.max(item.width, item.height);
                                    icon = [Math.max(6, Math.round((item.width / long) * 12)), Math.max(6, Math.round((item.height / long) * 12))];
                                }
                                return (
                                    <button
                                        key={item.value}
                                        onClick={() => selectRatio(item.value)}
                                        className={`flex h-[30px] items-center justify-center gap-1 rounded-md text-[12px] transition-colors ${selected ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                                    >
                                        {icon && <span className="inline-block rounded-[2px] bg-current opacity-60" style={{ width: icon[0], height: icon[1] }} />}
                                        {isAuto ? "自动" : item.value}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* 清晰度 */}
                    <div className="mb-6">
                        <label className="mb-2 block text-[14px] text-foreground">清晰度</label>
                        <div className="grid grid-cols-4 gap-1.5">
                            {["480", "720", "1080"].map((q) => (
                                <button
                                    key={q}
                                    onClick={() => selectResolution(q)}
                                    className={`h-[30px] rounded-md text-[12px] transition-colors ${resolution === q ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                                >
                                    {q}P
                                </button>
                            ))}
                            <div className="flex h-[30px] items-center rounded-md bg-muted px-2">
                                <input
                                    type="number"
                                    min={240}
                                    max={1080}
                                    defaultValue={resolution}
                                    key={resolution}
                                    onBlur={(e) => { const v = e.target.value.trim(); if (v) selectResolution(v); }}
                                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                                    className="w-full min-w-0 bg-transparent text-center text-[12px] text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                />
                                <span className="shrink-0 text-[12px] text-muted-foreground">P</span>
                            </div>
                        </div>
                    </div>

                    {/* 尺寸（自定义宽高） */}
                    <div className="mb-6">
                        <label className="mb-2 block text-[14px] text-foreground">尺寸</label>
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                            <div className={`flex h-[30px] items-center rounded-md bg-muted px-2 ${selectedRatio === "auto" ? "opacity-50" : ""}`}>
                                <span className="mr-1 text-[12px] text-muted-foreground">W</span>
                                <input
                                    type="number"
                                    min={1}
                                    value={dimensions.width || ""}
                                    disabled={selectedRatio === "auto"}
                                    onChange={(e) => updateDimension("width", Number(e.target.value) || null)}
                                    className="w-full min-w-0 bg-transparent text-[12px] text-foreground outline-none disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                />
                            </div>
                            <span className="text-[14px] text-muted-foreground">×</span>
                            <div className={`flex h-[30px] items-center rounded-md bg-muted px-2 ${selectedRatio === "auto" ? "opacity-50" : ""}`}>
                                <span className="mr-1 text-[12px] text-muted-foreground">H</span>
                                <input
                                    type="number"
                                    min={1}
                                    value={dimensions.height || ""}
                                    disabled={selectedRatio === "auto"}
                                    onChange={(e) => updateDimension("height", Number(e.target.value) || null)}
                                    className="w-full min-w-0 bg-transparent text-[12px] text-foreground outline-none disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                />
                            </div>
                        </div>
                    </div>

                    {/* 时长（滑动条） */}
                    <div className="mb-6">
                        <label className="mb-2 block text-[14px] text-foreground">时长</label>
                        <div className="flex items-center gap-3">
                            <input
                                type="range"
                                min={VIDEO_SECONDS_MIN}
                                max={VIDEO_SECONDS_MAX}
                                step={1}
                                value={seconds}
                                onChange={(e) => updateConfig("videoSeconds", e.target.value)}
                                className="video-range min-w-0 flex-1"
                                style={{ background: `linear-gradient(to right, #5051F8 ${((seconds - VIDEO_SECONDS_MIN) / (VIDEO_SECONDS_MAX - VIDEO_SECONDS_MIN)) * 100}%, #d4d4da ${((seconds - VIDEO_SECONDS_MIN) / (VIDEO_SECONDS_MAX - VIDEO_SECONDS_MIN)) * 100}%)` }}
                            />
                            <div className="flex h-[30px] w-[64px] shrink-0 items-center rounded-md bg-muted px-2">
                                <input
                                    type="number"
                                    min={VIDEO_SECONDS_MIN}
                                    max={VIDEO_SECONDS_MAX}
                                    value={seconds}
                                    onChange={(e) => updateConfig("videoSeconds", clampVideoSeconds(e.target.value))}
                                    className="w-full min-w-0 bg-transparent text-center text-[12px] text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                />
                            </div>
                            <span className="shrink-0 text-[12px] text-muted-foreground">s</span>
                        </div>
                    </div>

                    {/* 生成模式 */}
                    <div className="mb-6">
                        <label className="mb-2 block text-[14px] text-foreground">生成模式</label>
                        <div className="grid grid-cols-2 gap-1.5">
                            <button
                                onClick={() => updateConfig("videoMode", "frames")}
                                className={`h-[30px] rounded-md text-[12px] transition-colors ${effectiveConfig.videoMode !== "reference" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                            >
                                首尾帧模式
                            </button>
                            <button
                                onClick={() => updateConfig("videoMode", "reference")}
                                className={`h-[30px] rounded-md text-[12px] transition-colors ${effectiveConfig.videoMode === "reference" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                            >
                                全能参考模式
                            </button>
                        </div>
                    </div>

                    {/* 参考图 */}
                    <div className="mb-6">
                        <div className="mb-2 flex items-center">
                            <label className="block text-[14px] text-foreground">参考图 <span className="ml-1 text-[12px] font-normal text-muted-foreground">最多7张</span></label>
                            {references.length > 0 && (
                                <button onClick={() => setReferences([])} className="ml-auto text-[12px] text-muted-foreground hover:text-red-400">清空</button>
                            )}
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                            {references.map((item, index) => (
                                <div key={item.id} className="group relative size-[96px] shrink-0 rounded-lg bg-muted">
                                    <img src={previewUrlFor(item.storageKey) || item.dataUrl} alt="" className="h-full w-full rounded-lg object-cover" />
                                    <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 rounded-lg opacity-0 transition-opacity group-hover:opacity-100">
                                        <button
                                            onClick={() => setReferences((value) => moveListItem(value, index, -1))}
                                            disabled={index <= 0}
                                            className="flex items-center justify-center bg-black/40 text-white hover:text-white"
                                            title="上移"
                                        >
                                            <ArrowLeft className="size-4" />
                                        </button>
                                        <button
                                            onClick={() => setReferences((value) => moveListItem(value, index, 1))}
                                            disabled={index >= references.length - 1}
                                            className="flex items-center justify-center bg-black/40 text-white hover:text-white"
                                            title="下移"
                                        >
                                            <ArrowRight className="size-4" />
                                        </button>
                                        <div className="flex items-center justify-center bg-black/40 text-white text-[10px]">{index + 1}</div>
                                        <button
                                            onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                            className="flex items-center justify-center bg-black/40 text-white hover:text-red-400"
                                            title="删除"
                                        >
                                            <Trash2 className="size-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {references.length < 7 && (
                                <div
                                    className="group relative size-[96px] shrink-0 rounded-lg border-2 border-dashed border-border transition-colors hover:border-[#5051F8]"
                                    onDragEnter={handleReferenceDragEnter}
                                    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
                                    onDragLeave={handleReferenceDragLeave}
                                    onDrop={handleReferenceDrop}
                                >
                                    <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground transition-opacity group-hover:opacity-0">
                                        <Plus className="mb-1 size-5" />
                                        <span className="text-[11px]">上传</span>
                                    </div>
                                    <div className="absolute inset-0 grid grid-rows-2 opacity-0 transition-opacity group-hover:opacity-100">
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            className="flex flex-col items-center justify-end pb-2 text-muted-foreground hover:text-accent"
                                            title="上传图片"
                                        >
                                            <Upload className="size-4" />
                                        </button>
                                        <button
                                            onClick={() => void addReferencesFromClipboard()}
                                            className="flex flex-col items-center justify-start pt-2 text-muted-foreground hover:text-accent"
                                            title="粘贴图片"
                                        >
                                            <ClipboardPaste className="size-4" />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* 底部生成按钮 */}
                <div className="shrink-0 px-5 pb-4 pt-1">
                    <button
                        onClick={() => void generate()}
                        disabled={!canGenerate || running}
                        className="flex h-[58px] w-full items-center justify-center rounded-lg bg-accent text-[16px] text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-45"
                    >
                        {running ? (
                            <>
                                <LoaderCircle className="mr-2 size-5 animate-spin" />
                                生成中…
                            </>
                        ) : (
                            <>
                                <Sparkles className="mr-2 size-5" />
                                {prompt.trim() ? "开始生成" : "输入提示词后生成"}
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* ── 中栏：生成结果 ── */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-popover">
                {/* 顶部工具栏 */}
                <div className="flex h-[44px] shrink-0 items-center gap-2 px-4 pt-3">
                    <span className="text-[14px] text-foreground">生成结果</span>
                    {running ? (
                        <span className="flex h-[30px] items-center rounded-lg bg-muted px-3 text-[12px] text-muted-foreground">
                            {t("workbench.waiting", { time: formatDuration(elapsedMs) })}
                        </span>
                    ) : null}
                </div>

                {/* 结果列表 */}
                <div className="flex-1 overflow-y-auto p-4 pt-2">
                    {results.length ? (
                        <div className="grid gap-4">
                            {results.map((result) =>
                                result.status === "success" && result.video ? (
                                    <ResultVideoCard key={result.id} video={result.video} onDownload={downloadVideo} onSaveAsset={saveResultToAssets} />
                                ) : result.status === "failed" ? (
                                    <FailedVideoCard key={result.id} error={result.error || t("workbench.generationFailed")} onRetry={retryResult} />
                                ) : (
                                    <PendingVideoCard key={result.id} />
                                ),
                            )}
                        </div>
                    ) : (
                        <div className="flex h-full items-center justify-center">
                            <div className="flex flex-col items-center text-muted-foreground">
                                <VideoIcon className="mb-3 size-12" />
                                <span className="text-[14px]">生成的视频将显示在这里</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>


            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title={t("workbench.deleteLogs")} open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("workbench.deleteLogsConfirm", { count: selectedLogIds.length })}
            </Modal>
        </div>
    );
}

function GenerationSettings({ config, model: _model, updateConfig, openConfigDialog: _openConfigDialog }: { config: AiConfig; model: string; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean) => void }) {
    const { t } = useTranslation();
    const resolution = parseVideoResolution(config.vquality);
    const seconds = Number(clampVideoSeconds(config.videoSeconds || "6"));
    const selectedRatio = inferVideoRatio(config.size || "auto");

    const ratios = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "2:3", "3:2", "4:5", "5:4"];
    const qualities = ["480", "720", "1080"];
    const durations = [3, 5, 6, 8, 10];

    const selectRatio = (ratio: string) => {
        if (ratio === "auto") {
            updateConfig("size", "auto");
        } else {
            updateConfig("size", computeVideoSize(resolution, ratio));
        }
    };

    return (
        <>
            {/* 比例 */}
            <div className="mb-4">
                <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">比例</label>
                <div className="flex flex-wrap gap-1.5">
                    {ratios.map((ratio) => (
                        <button
                            key={ratio}
                            onClick={() => selectRatio(ratio)}
                            className={`h-[32px] rounded-lg px-3 text-[12px] transition-colors ${selectedRatio === ratio ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-accent/20"}`}
                        >
                            {ratio === "auto" ? "原图" : ratio}
                        </button>
                    ))}
                </div>
            </div>

            {/* 画质 */}
            <div className="mb-4">
                <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">画质</label>
                <div className="flex flex-wrap gap-1.5">
                    {qualities.map((q) => (
                        <button
                            key={q}
                            onClick={() => updateConfig("vquality", q)}
                            className={`h-[36px] rounded-lg px-4 text-[13px] transition-colors ${resolution === q ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-accent/20"}`}
                        >
                            {q}p
                        </button>
                    ))}
                </div>
            </div>

            {/* 时长 */}
            <div className="mb-4">
                <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">时长</label>
                <div className="flex flex-wrap gap-1.5">
                    {durations.map((d) => (
                        <button
                            key={d}
                            onClick={() => updateConfig("videoSeconds", String(d))}
                            className={`h-[36px] rounded-lg px-4 text-[13px] transition-colors ${seconds === d ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-accent/20"}`}
                        >
                            {d}s
                        </button>
                    ))}
                </div>
            </div>

            {/* 生成模式 */}
            <div className="mb-4">
                <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">生成模式</label>
                <div className="flex flex-wrap gap-1.5">
                    <button
                        onClick={() => updateConfig("videoMode", "frames")}
                        className={`h-[36px] rounded-lg px-4 text-[13px] transition-colors ${config.videoMode !== "reference" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-accent/20"}`}
                    >
                        帧模式
                    </button>
                    <button
                        onClick={() => updateConfig("videoMode", "reference")}
                        className={`h-[36px] rounded-lg px-4 text-[13px] transition-colors ${config.videoMode === "reference" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-accent/20"}`}
                    >
                        参考图模式
                    </button>
                </div>
            </div>
        </>
    );
}

function ResultVideoCard({ video, onDownload, onSaveAsset }: { video: GeneratedVideo; onDownload: (video: GeneratedVideo) => void; onSaveAsset: (video: GeneratedVideo) => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg bg-background">
            <video src={video.url} controls className="aspect-video w-full bg-black object-contain" />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2.5">
                <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                    <span>
                        {video.width}x{video.height}
                    </span>
                    <span>{formatBytes(video.bytes)}</span>
                    <span>{formatDuration(video.durationMs)}</span>
                </div>
                <div className="flex shrink-0 gap-1.5">
                    <button
                        onClick={() => onSaveAsset(video)}
                        className="flex h-[28px] items-center gap-1 rounded-md bg-muted px-3 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                        <FolderPlus className="size-3.5" />
                        存资产
                    </button>
                    <button
                        onClick={() => onDownload(video)}
                        className="flex h-[28px] items-center gap-1 rounded-md bg-muted px-3 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                        <Download className="size-3.5" />
                        下载
                    </button>
                </div>
            </div>
        </div>
    );
}

function PendingVideoCard() {
    const { t } = useTranslation();
    return (
        <div className="relative aspect-video overflow-hidden rounded-lg bg-background">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[14px] text-muted-foreground">
                <LoaderCircle className="size-6 animate-spin text-[#5051F8]" />
                <span>{t("workbench.generating")}</span>
            </div>
        </div>
    );
}

function FailedVideoCard({ error, onRetry }: { error: string; onRetry: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg bg-red-500/10">
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-[14px] font-medium text-red-400">{t("workbench.failed")}</div>
                <div className="line-clamp-4 max-w-full text-[12px] text-red-300/80">
                    {error}
                </div>
            </div>
            <div className="flex justify-end p-3">
                <button
                    onClick={onRetry}
                    className="flex h-[30px] items-center rounded-md bg-red-500/20 px-4 text-[12px] text-red-400 hover:bg-red-500/30"
                >
                    {t("workbench.retry")}
                </button>
            </div>
        </div>
    );
}

function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
}) {
    const { t } = useTranslation();
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">{t("workbench.logs")}</h2>
                <Tag className="m-0">{logs.length}</Tag>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    {t("workbench.new")}
                </Button>
                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={toggleAll}>
                    {allSelected ? t("common.cancel") : t("workbench.selectAll")}
                </Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
                    {t("common.delete")}
                </Button>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <LogCard key={log.id} log={log} selected={selectedLogIds.includes(log.id)} active={activeLogId === log.id} onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))} onClick={() => onPreviewLog(log)} />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-lg text-center text-sm text-muted-foreground">{t("workbench.noLogs")}</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, onSelectedChange, onClick }: { log: GenerationLog; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
    const { t } = useTranslation();
    const statusText = log.status === "success" ? t("workbench.success") : log.status === "pending" ? t("workbench.generating") : t("workbench.failed");
    const statusColor = log.status === "success" ? "text-[#4f8ff7]" : log.status === "pending" ? "text-[#f0a040]" : "text-red-400";
    return (
        <div
            className={`w-full cursor-pointer rounded-lg p-3 transition-colors ${active ? "bg-accent/20" : "bg-background hover:bg-muted"}`}
            onClick={onClick}
        >
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
                <input
                    type="checkbox"
                    checked={selected}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onSelectedChange(e.target.checked)}
                    className="mt-0.5 size-4 accent-[#5051F8]"
                />
                <div className="min-w-0">
                    <div className="truncate text-[14px] leading-5 text-foreground">{log.title}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                        <span className="text-[12px] text-muted-foreground">{log.size}</span>
                        <span className="text-[12px] text-muted-foreground">{log.resolution}p</span>
                        <span className="text-[12px] text-muted-foreground">{log.seconds}s</span>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                    <span className={`text-[12px] ${statusColor}`}>{statusText}</span>
                    <span className="text-[12px] text-muted-foreground">{formatDuration(log.durationMs)}</span>
                </div>
            </div>
        </div>
    );
}

async function readStoredLogs() {
    if (typeof window === "undefined") return [];
    try {
        const logs: GenerationLog[] = [];
        await logStore.iterate<GenerationLog, void>((value) => {
            logs.push(value);
        });
        return (await Promise.all(logs.map(normalizeLog))).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const video = log.video?.storageKey ? { ...log.video, url: await resolveMediaUrl(log.video.storageKey, log.video.url) } : log.video;
    const references = await Promise.all(
        (log.references || []).map(async (item) => {
            void ensureImagePreview(item.storageKey);
            return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        }),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || i18n.t("workbench.untitled"),
        prompt: log.prompt || "",
        time: log.time || new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model: log.model || config.videoModel || "",
        config,
        references,
        durationMs: log.durationMs || 0,
        size: log.size || config.size || "",
        resolution: normalizeResolution(log.resolution || config.vquality || ""),
        seconds: log.seconds || config.videoSeconds || "",
        status: log.status || "success",
        task: log.task,
        video,
        error: log.error,
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        video: log.video?.storageKey ? { ...log.video, url: "" } : log.video,
    };
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowRight className="size-3" />} disabled={index >= total - 1} onClick={() => onMove(1)} />
        </div>
    );
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        videoModel: log.config?.videoModel || log.model || "",
        size: log.config?.size || log.size || "",
        vquality: normalizeResolution(log.config?.vquality || log.resolution || ""),
        videoSeconds: log.config?.videoSeconds || log.seconds || "",
        videoGenerateAudio: log.config?.videoGenerateAudio || "true",
        videoWatermark: log.config?.videoWatermark || "false",
        videoMode: log.config?.videoMode === "reference" ? "reference" : "frames",
    };
}

function buildLog({ prompt, model, config, references, durationMs, status, task, video, error }: { prompt: string; model: string; config: AiConfig; references: ReferenceImage[]; durationMs: number; status: GenerationLog["status"]; task?: VideoGenerationTask; video?: GeneratedVideo; error?: string }): GenerationLog {
    const logConfig = {
        model: config.model,
        videoModel: config.videoModel,
        size: config.size,
        vquality: normalizeResolution(config.vquality),
        videoSeconds: config.videoSeconds,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
        videoMode: config.videoMode === "reference" ? "reference" : "frames",
    };
    return {
        id: nanoid(),
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || i18n.t("workbench.untitled"),
        prompt,
        time: new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model,
        config: logConfig,
        references,
        durationMs,
        size: logConfig.size,
        resolution: logConfig.vquality,
        seconds: logConfig.videoSeconds,
        status,
        task,
        video,
        error,
    };
}

function buildVideoConfig(config: AiConfig, model: string): AiConfig {
    return {
        ...config,
        model,
        videoModel: model,
        size: normalizeVideoSize(config.size),
        videoSeconds: normalizeVideoSeconds(config.videoSeconds),
        vquality: normalizeResolution(config.vquality),
        videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, true)),
        videoWatermark: String(boolConfig(config.videoWatermark, false)),
        videoMode: config.videoMode === "reference" ? "reference" : "frames",
    };
}

function normalizeVideoSeconds(value: string) {
    if (String(value).trim() === "-1") return "-1";
    return clampVideoSeconds(value);
}

function normalizeVideoSize(value: string) {
    return normalizeVideoSizeValue(value);
}

function normalizeResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
