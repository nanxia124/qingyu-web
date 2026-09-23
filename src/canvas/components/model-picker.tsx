import { useEffect, useId, useMemo, useState } from "react";
import { Clapperboard, Cpu, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@canvas/i18n";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger } from "@canvas/components/ui/select";
import { cn } from "@canvas/lib/utils";
import { modelOptionLabel, modelOptionName, selectableModelsByCapability, useConfigStore, guessCapability, type AiConfig, type ModelCapability, type ModelChannel } from "@canvas/stores/use-config-store";
import { fetchChannelModels } from "@canvas/services/api/image";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
};

export function ModelPicker({ config, value, onChange, capability, className: _className, fullWidth = false, placeholder, onMissingConfig }: ModelPickerProps) {
    const { t } = useTranslation();
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const options = useMemo(() => Array.from(new Set([...(config.channelMode === "local" && !capability ? [value] : []), ...selectableModelsByCapability(config, capability)].filter((model): model is string => Boolean(model)))), [capability, config, value]);
    const current = value || "";

    // 按模型品牌分组
    const groupedOptions = useMemo(() => {
        const groups: Record<string, string[]> = {};
        for (const model of options) {
            const lower = model.toLowerCase();
            let group = "其他";
            if (lower.includes("gpt")) group = "GPT";
            else if (lower.includes("grok")) group = "Grok";
            else if (lower.includes("doubao") || lower.includes("seedance")) group = "豆包 Doubao";
            else if (lower.includes("minimax")) group = "MiniMax";
            else if (lower.includes("dalle")) group = "DALL-E";
            else if (lower.includes("veo")) group = "Veo";
            else if (lower.includes("sora")) group = "Sora";
            if (!groups[group]) groups[group] = [];
            groups[group].push(model);
        }
        return groups;
    }, [options]);
    const pickerPlaceholder = placeholder || t("settingsPanels.model.select");

    const refreshModels = async () => {
        if (refreshing) return;
        if (config.channelMode === "local" || !config.channels.length) {
            onMissingConfig?.();
            return;
        }
        setRefreshing(true);
        try {
            // 从第一个远程渠道拉取最新模型列表
            const channel = config.channels[0];
            const models = await fetchChannelModels(channel);
            
            // 更新渠道里的模型列表
            const updatedChannels = config.channels.map((ch, idx) => {
                if (idx === 0) {
                    return {
                        ...ch,
                        models: models.map((name) => ({
                            name,
                            capability: guessCapability(name),
                        })),
                    };
                }
                return ch;
            });
            
            // 更新 config
            updateConfig("channels", updatedChannels);
            updateConfig("models", updatedChannels.flatMap((ch) => ch.models.map((m) => `${ch.id}::${m.name}`)));
        } catch (error) {
            console.error("Failed to refresh models:", error);
        } finally {
            setRefreshing(false);
        }
    };
    
    // 自动同步：打开下拉时自动刷新（可选，先注释掉，避免每次打开都请求）
    // useEffect(() => {
    //     if (open) refreshModels();
    // }, [open]);

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    return (
        <div className={cn("inline-flex items-center gap-1", fullWidth && "w-full")}>
            <Select
                open={open}
                value={current}
                onOpenChange={(nextOpen) => {
                    if (nextOpen && !options.length && config.channelMode === "local") onMissingConfig?.();
                    if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                    setOpen(nextOpen);
                }}
                onValueChange={onChange}
            >
                <SelectTrigger
                    className={cn(
                        "canvas-composer-model-picker !h-[34px] w-fit max-w-full gap-2 !rounded-[6px] !border-0 !bg-secondary px-3 text-[13px] font-normal !shadow-none transition-colors",
                        fullWidth ? "w-full min-w-0 justify-between" : "min-w-[9rem] justify-start",
                        "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    )}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    title={current ? modelOptionLabel(config, current) : pickerPlaceholder}
                >
                    <ModelIcon model={current} />
                    <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? modelOptionLabel(config, current) : pickerPlaceholder}</span>
                </SelectTrigger>
                <SelectContent
                    data-canvas-no-zoom
                    className="z-[1200] min-w-[var(--radix-select-trigger-width, 320px)] max-w-[calc(100vw-24px)] rounded-xl bg-popover p-1 shadow-xl ring-0 border-0"
                    position="popper"
                    align="start"
                    side="bottom"
                    sideOffset={6}
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    {options.length ? (
                        Object.entries(groupedOptions).map(([group, models]) => (
                            <SelectGroup key={group}>
                                <SelectLabel className="px-2 py-1.5 text-xs font-normal text-[#6a6a6a]">{group}</SelectLabel>
                                {models.map((model) => (
                                    <SelectItem key={model} value={model} textValue={modelOptionLabel(config, model)} title={modelOptionLabel(config, model)}>
                                        <ModelLabel config={config} model={model} />
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        ))
                    ) : (
                        <SelectItem value="__empty__" disabled>
                            {emptyModelLabel(config, capability)}
                        </SelectItem>
                    )}
                </SelectContent>
            </Select>
            <button
                type="button"
                onClick={() => void refreshModels()}
                disabled={refreshing}
                className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-[6px] text-zinc-500 transition-colors hover:bg-secondary hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-secondary dark:hover:text-zinc-100"
                title={t("settingsPanels.model.refresh")}
                aria-label={t("settingsPanels.model.refresh")}
            >
                <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
            </button>
        </div>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability ? i18n.t(`settingsPanels.model.capabilities.${capability}`) : "";
    if (capability && config.models.length) return i18n.t("settingsPanels.model.assign", { capability: label });
    return config.models.length ? i18n.t("settingsPanels.model.noMatch", { capability: label }) : i18n.t("settingsPanels.model.addFirst");
}

function ModelLabel({ config, model }: { config: AiConfig; model: string }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ModelIcon model={model} />
            <span className="truncate">{modelOptionLabel(config, model)}</span>
        </span>
    );
}

function ModelIcon({ model }: { model: string }) {
    const name = modelOptionName(model).toLowerCase();
    const icon = resolveModelIcon(name);
    if (icon) return <img src={icon} alt="" className="size-4 shrink-0 dark:invert" />;
    // 视频类模型没有专属 logo 时统一用视频图标，避免豆包 / Veo / Sora / MiniMax / Omni 全部退化成同一个芯片图标。
    if (/seedance|veo|sora|minimax|h3|omni|imagine|kling|wan|hailuo|video/.test(name)) {
        return <Clapperboard className="size-4 shrink-0 opacity-80" />;
    }
    return <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(name: string) {
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm")) return "/icons/glm.svg";
    return "";
}
