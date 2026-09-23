export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#f4f2ed",
            dot: "rgba(68,64,60,.28)",
            line: "rgba(68,64,60,.12)",
            selectionStroke: "#1c1917",
            selectionFill: "rgba(28,25,23,.06)",
        },
        node: {
            label: "#57534e",
            fill: "#e7e5df",
            panel: "#ffffff",
            stroke: "#d6d3ca",
            activeStroke: "#1c1917",
            placeholder: "#8a8479",
            text: "#292524",
            muted: "#78716c",
            faint: "#a8a29e",
        },
        toolbar: {
            panel: "rgba(255,255,255,.95)",
            border: "#d6d3ca",
            item: "#57534e",
            itemHover: "#e7e5df",
            activeBg: "#e7e5df",
            activeText: "#292524",
        },
    },
    dark: {
        canvas: {
            background: "#151515",
            dot: "rgba(236,236,236,.24)",
            line: "rgba(236,236,236,.10)",
            selectionStroke: "#ececec",
            selectionFill: "rgba(236,236,236,.10)",
        },
        node: {
            label: "#bebebe",
            fill: "#1c1c1c",
            panel: "#1c1c1c",
            stroke: "#2a2a2a",
            activeStroke: "#5051F8",
            placeholder: "#8e8e8e",
            text: "#ececec",
            muted: "#bebebe",
            faint: "#8a8a8a",
        },
        toolbar: {
            panel: "rgba(28,28,28,.98)",
            border: "#2a2a2a",
            item: "#bebebe",
            itemHover: "#282828",
            activeBg: "#333333",
            activeText: "#ececec",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
