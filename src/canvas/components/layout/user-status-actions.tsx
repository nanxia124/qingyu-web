import type { CSSProperties } from "react";
import { Tooltip, Dropdown } from "antd";
import { BookOpen, Keyboard, Puzzle, Settings2, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AnimatedThemeToggler } from "@canvas/components/ui/animated-theme-toggler";
import { GitHubLink } from "@canvas/components/layout/github-link";
import { VersionReleaseModal } from "@canvas/components/layout/version-release-modal";
import { DOCS_URL } from "@canvas/constant/env";
import { changeAppLocale, SUPPORTED_LOCALES, type AppLocale } from "@canvas/i18n";
import { cn } from "@canvas/lib/utils";
import { canvasThemes } from "@canvas/lib/canvas-theme";
import { useConfigStore } from "@canvas/stores/use-config-store";
import { useThemeStore } from "@canvas/stores/use-theme-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

const LOCALE_LABELS: Record<AppLocale, string> = {
    "zh-CN": "简体中文",
    "zh-TW": "繁體中文",
    "en-US": "English",
    "ja-JP": "日本語",
    "ko-KR": "한국어",
    "es-ES": "Español",
    "fr-FR": "Français",
    "de-DE": "Deutsch",
    "ru-RU": "Русский",
    "pt-BR": "Português",
    "it-IT": "Italiano",
    "ar-SA": "العربية",
    "tr-TR": "Türkçe",
    "hi-IN": "हिन्दी",
    "th-TH": "ไทย",
    "vi-VN": "Tiếng Việt",
    "id-ID": "Bahasa Indonesia",
};

const LOCALE_SHORT_LABELS: Record<AppLocale, string> = {
    "zh-CN": "中",
    "zh-TW": "繁",
    "en-US": "EN",
    "ja-JP": "日",
    "ko-KR": "한",
    "es-ES": "ES",
    "fr-FR": "FR",
    "de-DE": "DE",
    "ru-RU": "RU",
    "pt-BR": "PT",
    "it-IT": "IT",
    "ar-SA": "ع",
    "tr-TR": "TR",
    "hi-IN": "हि",
    "th-TH": "TH",
    "vi-VN": "VI",
    "id-ID": "ID",
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const { i18n, t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass = "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-black/5 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const versionStyle = iconStyle;
    const gitHubClassName = "size-7 text-base";
    const gitHubStyle = iconStyle;
    const locale = (i18n.resolvedLanguage as AppLocale) || "zh-CN";

    const languageMenuItems = SUPPORTED_LOCALES.map((loc) => ({
        key: loc,
        label: (
            <div className="flex items-center justify-between min-w-[140px]">
                <span>{LOCALE_LABELS[loc]}</span>
                {loc === locale && <span className="text-xs text-blue-500">✓</span>}
            </div>
        ),
        onClick: () => void changeAppLocale(loc),
    }));

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {onOpenPlugins ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenPlugins} aria-label={t("topNav.plugins")} title={t("topNav.plugins")}>
                    <Puzzle className="size-4" />
                </button>
            ) : null}
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={naturalIconClass} style={iconStyle} aria-label={t("topNav.docs")} title={t("topNav.docs")}>
                <BookOpen className="size-4" />
            </a>
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label={t("navigation.config")} title={t("navigation.config")}>
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <Dropdown
                menu={{ items: languageMenuItems }}
                placement="bottomRight"
                trigger={["click"]}
            >
                <Tooltip title={t("topNav.switchLanguage", { language: LOCALE_LABELS[locale] })} mouseEnterDelay={0.2}>
                    <button
                        type="button"
                        className={`${naturalIconClass} text-[11px] font-semibold tracking-tight`}
                        style={iconStyle}
                        aria-label={t("topNav.switchLanguage", { language: LOCALE_LABELS[locale] })}
                    >
                        <span className="flex items-center gap-0.5">
                            <Globe className="size-3.5" />
                            {LOCALE_SHORT_LABELS[locale]}
                        </span>
                    </button>
                </Tooltip>
            </Dropdown>
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} title={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} />
            <VersionReleaseModal style={versionStyle} />
            <GitHubLink className={cn("bg-transparent hover:bg-transparent dark:hover:bg-transparent", gitHubClassName)} style={gitHubStyle} />
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label={t("topNav.shortcuts")} title={t("topNav.shortcuts")}>
                    <Keyboard className="size-4" />
                </button>
            ) : null}
        </div>
    );
}
