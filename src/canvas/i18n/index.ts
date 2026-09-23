import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "@canvas/i18n/locales/en-US";
import zhCN from "@canvas/i18n/locales/zh-CN";
import zhTW from "@canvas/i18n/locales/zh-TW";
import jaJP from "@canvas/i18n/locales/ja-JP";
import koKR from "@canvas/i18n/locales/ko-KR";
import esES from "@canvas/i18n/locales/es-ES";
import frFR from "@canvas/i18n/locales/fr-FR";
import deDE from "@canvas/i18n/locales/de-DE";
import ruRU from "@canvas/i18n/locales/ru-RU";
import ptBR from "@canvas/i18n/locales/pt-BR";
import itIT from "@canvas/i18n/locales/it-IT";
import arSA from "@canvas/i18n/locales/ar-SA";
import trTR from "@canvas/i18n/locales/tr-TR";
import hiIN from "@canvas/i18n/locales/hi-IN";
import thTH from "@canvas/i18n/locales/th-TH";
import viVN from "@canvas/i18n/locales/vi-VN";
import idID from "@canvas/i18n/locales/id-ID";

export type AppLocale =
    | "zh-CN"
    | "zh-TW"
    | "en-US"
    | "ja-JP"
    | "ko-KR"
    | "es-ES"
    | "fr-FR"
    | "de-DE"
    | "ru-RU"
    | "pt-BR"
    | "it-IT"
    | "ar-SA"
    | "tr-TR"
    | "hi-IN"
    | "th-TH"
    | "vi-VN"
    | "id-ID";

const LOCALE_STORAGE_KEY = "infinite-canvas:locale";

// 语言建议回调：检测到与当前不同的语言时，通知 UI 询问用户（不自动切换）
type LanguageSuggestionListener = (detected: { locale: AppLocale; country?: string }) => void;
let languageSuggestionListener: LanguageSuggestionListener | null = null;
export function onLanguageSuggestion(cb: LanguageSuggestionListener) {
    languageSuggestionListener = cb;
    return () => {
        if (languageSuggestionListener === cb) {
            languageSuggestionListener = null;
        }
    };
}
const MANUAL_SELECT_KEY = "infinite-canvas:locale-manual";

export const SUPPORTED_LOCALES: AppLocale[] = [
    "zh-CN",
    "zh-TW",
    "en-US",
    "ja-JP",
    "ko-KR",
    "es-ES",
    "fr-FR",
    "de-DE",
    "ru-RU",
    "pt-BR",
    "it-IT",
    "ar-SA",
    "tr-TR",
    "hi-IN",
    "th-TH",
    "vi-VN",
    "id-ID",
];

/**
 * 从浏览器/系统语言检测应该使用的语言
 */
function detectBrowserLanguage(): AppLocale {
    if (typeof navigator === "undefined") {
        return "zh-CN";
    }

    const langs = navigator.languages || [navigator.language];

    for (const lang of langs) {
        const normalized = lang.toLowerCase().replace("_", "-");

        // 中文区分简体繁体
        if (normalized === "zh-tw" || normalized === "zh-hk" || normalized === "zh-hant") {
            return "zh-TW";
        }
        if (normalized.startsWith("zh")) {
            return "zh-CN";
        }
        if (normalized.startsWith("en")) return "en-US";
        if (normalized.startsWith("ja")) return "ja-JP";
        if (normalized.startsWith("ko")) return "ko-KR";
        if (normalized.startsWith("es")) return "es-ES";
        if (normalized.startsWith("fr")) return "fr-FR";
        if (normalized.startsWith("de")) return "de-DE";
        if (normalized.startsWith("ru")) return "ru-RU";
        if (normalized.startsWith("pt")) return "pt-BR";
        if (normalized.startsWith("it")) return "it-IT";
        if (normalized.startsWith("ar")) return "ar-SA";
        if (normalized.startsWith("tr")) return "tr-TR";
        if (normalized.startsWith("hi")) return "hi-IN";
        if (normalized.startsWith("th")) return "th-TH";
        if (normalized.startsWith("vi")) return "vi-VN";
        if (normalized.startsWith("id")) return "id-ID";
    }

    return "zh-CN";
}

/**
 * 根据 IP 地理位置自动检测语言
 * 使用免费公开 API，失败时静默降级
 */
async function detectLanguageByIP(): Promise<{ locale: AppLocale; country?: string } | null> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const res = await fetch("https://ipapi.co/json/", {
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) return null;

        const data = await res.json();
        const countryCode: string = (data.country_code || "").toUpperCase();
        const countryName: string = data.country_name || data.country || "";

        // 国家代码到语言的映射
        const countryToLocale: Record<string, AppLocale> = {
            CN: "zh-CN",
            TW: "zh-TW",
            HK: "zh-TW",
            MO: "zh-TW",
            US: "en-US",
            GB: "en-US",
            CA: "en-US",
            AU: "en-US",
            NZ: "en-US",
            JP: "ja-JP",
            KR: "ko-KR",
            ES: "es-ES",
            MX: "es-ES",
            AR: "es-ES",
            CO: "es-ES",
            PE: "es-ES",
            CL: "es-ES",
            FR: "fr-FR",
            BE: "fr-FR",
            CH: "de-DE",
            DE: "de-DE",
            AT: "de-DE",
            RU: "ru-RU",
            UA: "ru-RU",
            BY: "ru-RU",
            BR: "pt-BR",
            PT: "pt-BR",
            IT: "it-IT",
            SA: "ar-SA",
            AE: "ar-SA",
            EG: "ar-SA",
            TR: "tr-TR",
            IN: "hi-IN",
            TH: "th-TH",
            VN: "vi-VN",
            ID: "id-ID",
        };

        const locale = countryToLocale[countryCode] || null;
        return locale ? { locale, country: countryName || undefined } : null;
    } catch {
        return null;
    }
}

/**
 * 获取初始语言：优先用户手动选择，其次浏览器语言，最后默认中文
 */
function getInitialLanguage(): AppLocale {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY) as AppLocale | null;
    if (saved && SUPPORTED_LOCALES.includes(saved)) {
        return saved;
    }
    return detectBrowserLanguage();
}

/**
 * 异步根据 IP 检测语言，仅在用户未手动选择时生效
 */
export async function autoDetectLanguageByIP() {
    // 已手动选择过语言：始终保持，不做任何自动切换
    if (localStorage.getItem(MANUAL_SELECT_KEY) === "true") {
        return;
    }

    const detected = await detectLanguageByIP();
    if (detected && detected.locale !== i18n.resolvedLanguage) {
        // 不自动切换，通知 UI 弹 toast 询问用户是否切换
        languageSuggestionListener?.(detected);
    }
}

const initialLng = getInitialLanguage();

i18n.use(initReactI18next).init({
    resources: {
        "zh-CN": { translation: zhCN },
        "zh-TW": { translation: zhTW },
        "en-US": { translation: enUS },
        "ja-JP": { translation: jaJP },
        "ko-KR": { translation: koKR },
        "es-ES": { translation: esES },
        "fr-FR": { translation: frFR },
        "de-DE": { translation: deDE },
        "ru-RU": { translation: ruRU },
        "pt-BR": { translation: ptBR },
        "it-IT": { translation: itIT },
        "ar-SA": { translation: arSA },
        "tr-TR": { translation: trTR },
        "hi-IN": { translation: hiIN },
        "th-TH": { translation: thTH },
        "vi-VN": { translation: viVN },
        "id-ID": { translation: idID },
    },
    lng: initialLng,
    fallbackLng: "zh-CN",
    supportedLngs: SUPPORTED_LOCALES,
    initAsync: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

export function changeAppLocale(locale: AppLocale) {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    localStorage.setItem(MANUAL_SELECT_KEY, "true");
    return i18n.changeLanguage(locale);
}

// 初始化后异步执行 IP 语言检测
void autoDetectLanguageByIP();

export default i18n;
