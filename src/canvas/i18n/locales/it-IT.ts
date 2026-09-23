// Auto-generated partial translation: main-site strings. Canvas editor strings fall back to en-US.
import enUS from "@canvas/i18n/locales/en-US";
function dm(a, b) { const o = { ...a }; for (const k in b) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) o[k] = dm(a[k] || {}, b[k]); else o[k] = b[k]; } return o; }
const override = {
    nav: {
      home: "Home",
      chat: "Chat",
      image: "Immagine",
      video: "Video",
      canvas: "Tela",
      assets: "Risorse",
      favorites: "Preferiti",
      teams: "Team",
      my: "Account",
      darkMode: "Scuro",
      lightMode: "Chiaro",
      language: "Lingua",
    },
    mainHome: {
      invite: "Invita e guadagna",
      points: "Punti",
      vip: "Abbonamento",
      soon: "Prossimamente",
      text2img: "Testo in immagine",
      expand: "Espandi",
      style: "Stili",
      works: "Le mie opere",
      catAll: "Tutti",
      catEcommerce: "E-commerce",
      catPoster: "Poster",
      catPhoto: "Foto",
      catIllustration: "Illustrazione",
      recommend: "Consigliati",
      latest: "Ultimi",
      empty: "Nessuna opera trovata",
    },
    auth: {
      subtitleLogin: "Accedi o registrati",
      useGoogle: "Continua con Google",
      useApple: "Continua con Apple",
      or: "o",
      email: "Email",
      nickname: "Nickname",
      password: "Password (min. 6)",
      forgot: "Password dimenticata?",
      continue: "Continua",
      login: "Accedi",
      register: "Registrati",
    },
    chat: {
      greeting: "Come posso aiutarti?",
      send: "Invia",
    },
    pages: {
      settings: {
        api: "API",
        notify: "Notifiche",
        security: "Sicurezza",
        appearance: "Aspetto",
        team: "Team",
        data: "Dati",
        serverAddr: "URL server",
        save: "Salva",
      },
      subscription: {
        title: "Piani",
        free: "Gratis",
      },
      wallet: {
        title: "Il mio portafoglio",
        currentBalance: "Saldo",
      },
      feedback: {
        title: "Feedback",
        submit: "Invia",
      },
      assets: {
        upload: "Carica",
        all: "Tutti",
        image: "Immagini",
        video: "Video",
      },
      favorites: {
        title: "Preferiti",
      },
    },
};
export default dm(enUS, override);
