// Auto-generated partial translation: main-site strings. Canvas editor strings fall back to en-US.
import enUS from "@canvas/i18n/locales/en-US";
function dm(a, b) { const o = { ...a }; for (const k in b) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) o[k] = dm(a[k] || {}, b[k]); else o[k] = b[k]; } return o; }
const override = {
    nav: {
      home: "होम",
      chat: "चैट",
      image: "इमेज",
      video: "वीडियो",
      canvas: "कैनवस",
      assets: "एसेट",
      favorites: "पसंदीदा",
      teams: "टीम",
      my: "अकाउंट",
      darkMode: "डार्क",
      lightMode: "लाइट",
      language: "भाषा",
    },
    mainHome: {
      invite: "आमंत्रित करें और कमाएं",
      points: "पॉइंट्स",
      vip: "सदस्यता",
      soon: "जल्द",
      text2img: "टेक्स्ट से इमेज",
      expand: "विस्तार",
      style: "स्टाइल",
      works: "मेरे काम",
      catAll: "सभी",
      catEcommerce: "ई-कॉमर्स",
      catPoster: "पोस्टर",
      catPhoto: "फ़ोटो",
      catIllustration: "चित्र",
      recommend: "अनुशंसित",
      latest: "नवीनतम",
      empty: "कोई काम नहीं",
    },
    auth: {
      subtitleLogin: "साइन इन करें या रजिस्टर करें",
      useGoogle: "Google से जारी रखें",
      useApple: "Apple से जारी रखें",
      or: "या",
      email: "ईमेल",
      nickname: "उपनाम",
      password: "पासवर्ड (कम से कम 6)",
      forgot: "पासवर्ड भूल गए?",
      continue: "जारी रखें",
      login: "साइन इन",
      register: "रजिस्टर",
    },
    chat: {
      greeting: "मैं आपकी कैसे मदद कर सकता हूँ?",
      send: "भेजें",
    },
    pages: {
      settings: {
        api: "API",
        notify: "सूचनाएं",
        security: "सुरक्षा",
        appearance: "दिखावा",
        team: "टीम",
        data: "डेटा",
        serverAddr: "सर्वर URL",
        save: "सहेजें",
      },
      subscription: {
        title: "प्लान",
        free: "मुफ़्त",
      },
      wallet: {
        title: "मेरा वॉलेट",
        currentBalance: "बैलेंस",
      },
      feedback: {
        title: "प्रतिक्रिया",
        submit: "सबमिट करें",
      },
      assets: {
        upload: "अपलोड",
        all: "सभी",
        image: "इमेज",
        video: "वीडियो",
      },
      favorites: {
        title: "पसंदीदा",
      },
    },
};
export default dm(enUS, override);
