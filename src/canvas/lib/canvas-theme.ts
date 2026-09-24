export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#fafafa",
            dot: "rgba(0,0,0,.13)",
            line: "rgba(0,0,0,.07)",
            selectionStroke: "#1d1d1f",
            selectionFill: "rgba(0,0,0,.05)",
        },
        node: {
            label: "#3f3f46",
            fill: "#f0f0f2",
            panel: "#ffffff",
            stroke: "#ececf0",
            activeStroke: "#5051F8",
            placeholder: "#6b6b73",
            text: "#1d1d1f",
            muted: "#6b6b73",
            faint: "#8a8a91",
        },
        toolbar: {
            panel: "rgba(255,255,255,.95)",
            border: "#ececf0",
            item: "#3f3f46",
            itemHover: "#f0f0f2",
            activeBg: "#f0f0f2",
            activeText: "#1d1d1f",
        },
    },
    dark: {
        canvas: {
            background: "#202020",
            dot: "rgba(236,236,236,.24)",
            line: "rgba(236,236,236,.10)",
            selectionStroke: "#ececec",
            selectionFill: "rgba(236,236,236,.10)",
        },
        node: {
            label: "#bebebe",
            fill: "#1c1c1c",
            panel: "#1c1c1c",
            stroke: "#262626",
            activeStroke: "#5051F8",
            placeholder: "#8e8e8e",
            text: "#ececec",
            muted: "#bebebe",
            faint: "#8a8a8a",
        },
        toolbar: {
            panel: "rgba(28,28,28,.98)",
            border: "#262626",
            item: "#bebebe",
            itemHover: "#282828",
            activeBg: "#333333",
            activeText: "#ececec",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
