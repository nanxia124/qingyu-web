// Auto-generated partial translation: main-site strings. Canvas editor strings fall back to en-US.
import enUS from "@canvas/i18n/locales/en-US";
function dm(a, b) { const o = { ...a }; for (const k in b) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) o[k] = dm(a[k] || {}, b[k]); else o[k] = b[k]; } return o; }
const override = {
    nav: {
      home: "الرئيسية",
      chat: "محادثة",
      image: "الصور",
      video: "فيديو",
      canvas: "لوحة",
      assets: "الأصول",
      favorites: "المفضلة",
      teams: "الفرق",
      my: "الحساب",
      darkMode: "داكن",
      lightMode: "فاتح",
      language: "اللغة",
    },
    mainHome: {
      invite: "ادعُ واكسب",
      points: "النقاط",
      vip: "العضوية",
      soon: "قريباً",
      text2img: "نص إلى صورة",
      expand: "توسيع",
      style: "الأنماط",
      works: "أعمالي",
      catAll: "الكل",
      catEcommerce: "التجارة الإلكترونية",
      catPoster: "ملصق",
      catPhoto: "التصوير",
      catIllustration: "رسم توضيحي",
      recommend: "موصى به",
      latest: "الأحدث",
      empty: "لا توجد أعمال",
    },
    auth: {
      subtitleLogin: "سجّل الدخول أو اشترك",
      useGoogle: "المتابعة باستخدام Google",
      useApple: "المتابعة باستخدام Apple",
      or: "أو",
      email: "البريد الإلكتروني",
      nickname: "اللقب",
      password: "كلمة المرور (6 أحرف على الأقل)",
      forgot: "هل نسيت كلمة المرور?",
      continue: "متابعة",
      login: "تسجيل الدخول",
      register: "اشتراك",
    },
    chat: {
      greeting: "كيف يمكنني مساعدتك?",
      send: "إرسال",
    },
    pages: {
      settings: {
        api: "API",
        notify: "الإشعارات",
        security: "الأمان",
        appearance: "المظهر",
        team: "الفريق",
        data: "البيانات",
        serverAddr: "رابط الخادم",
        save: "حفظ",
      },
      subscription: {
        title: "الباقات",
        free: "مجاني",
      },
      wallet: {
        title: "محفظتي",
        currentBalance: "الرصيد",
      },
      feedback: {
        title: "الملاحظات",
        submit: "إرسال",
      },
      assets: {
        upload: "رفع",
        all: "الكل",
        image: "الصور",
        video: "الفيديوهات",
      },
      favorites: {
        title: "المفضلة",
      },
    },
};
export default dm(enUS, override);
