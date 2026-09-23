// Auto-generated partial translation: main-site strings. Canvas editor strings fall back to en-US.
import enUS from "@canvas/i18n/locales/en-US";
function dm(a, b) { const o = { ...a }; for (const k in b) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) o[k] = dm(a[k] || {}, b[k]); else o[k] = b[k]; } return o; }
const override = {
    nav: {
      home: "Ana sayfa",
      chat: "Sohbet",
      image: "Görsel",
      video: "Video",
      canvas: "Tuval",
      assets: "Varlıklar",
      favorites: "Favoriler",
      teams: "Ekipler",
      my: "Hesap",
      darkMode: "Koyu",
      lightMode: "Açık",
      language: "Dil",
    },
    mainHome: {
      invite: "Davet et kazan",
      points: "Puanlar",
      vip: "Üyelik",
      soon: "Yakında",
      text2img: "Metinden görsele",
      expand: "Genişlet",
      style: "Stil",
      works: "Çalışmalarım",
      catAll: "Tümü",
      catEcommerce: "E-ticaret",
      catPoster: "Poster",
      catPhoto: "Foto",
      catIllustration: "İllüstrasyon",
      recommend: "Önerilen",
      latest: "En son",
      empty: "Çalışma bulunamadı",
    },
    auth: {
      subtitleLogin: "Giriş yap veya kaydol",
      useGoogle: "Google ile devam et",
      useApple: "Apple ile devam et",
      or: "veya",
      email: "E-posta",
      nickname: "Takma ad",
      password: "Şifre (min. 6)",
      forgot: "Şifrenizi mi unuttunuz?",
      continue: "Devam",
      login: "Giriş",
      register: "Kayıt ol",
    },
    chat: {
      greeting: "Size nasıl yardım edebilirim?",
      send: "Gönder",
    },
    pages: {
      settings: {
        api: "API",
        notify: "Bildirimler",
        security: "Güvenlik",
        appearance: "Görünüm",
        team: "Ekip",
        data: "Veriler",
        serverAddr: "Sunucu URL",
        save: "Kaydet",
      },
      subscription: {
        title: "Paketler",
        free: "Ücretsiz",
      },
      wallet: {
        title: "Cüzdanım",
        currentBalance: "Bakiye",
      },
      feedback: {
        title: "Geri bildirim",
        submit: "Gönder",
      },
      assets: {
        upload: "Yükle",
        all: "Tümü",
        image: "Görseller",
        video: "Videolar",
      },
      favorites: {
        title: "Favoriler",
      },
    },
};
export default dm(enUS, override);
