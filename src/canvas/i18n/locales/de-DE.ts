// Auto-generated partial translation: main-site strings. Canvas editor strings fall back to en-US.
import enUS from "@canvas/i18n/locales/en-US";
function dm(a, b) { const o = { ...a }; for (const k in b) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) o[k] = dm(a[k] || {}, b[k]); else o[k] = b[k]; } return o; }
const override = {
    nav: {
      home: "Start",
      chat: "Chat",
      image: "Bild",
      video: "Video",
      canvas: "Canvas",
      assets: "Assets",
      favorites: "Favoriten",
      teams: "Teams",
      my: "Konto",
      darkMode: "Dunkel",
      lightMode: "Hell",
      language: "Sprache",
    },
    mainHome: {
      invite: "Einladen & verdienen",
      points: "Punkte",
      vip: "Mitgliedschaft",
      soon: "Demnächst",
      text2img: "Text zu Bild",
      expand: "Erweitern",
      style: "Stil",
      works: "Meine Werke",
      catAll: "Alle",
      catEcommerce: "E-Commerce",
      catPoster: "Poster",
      catPhoto: "Foto",
      catIllustration: "Illustration",
      recommend: "Empfohlen",
      latest: "Neueste",
      empty: "Keine Werke gefunden",
    },
    auth: {
      subtitleLogin: "Anmelden oder registrieren",
      useGoogle: "Weiter mit Google",
      useApple: "Weiter mit Apple",
      or: "oder",
      email: "E-Mail",
      nickname: "Spitzname",
      password: "Passwort (min. 6)",
      forgot: "Passwort vergessen?",
      continue: "Weiter",
      login: "Anmelden",
      register: "Registrieren",
    },
    chat: {
      greeting: "Wie kann ich helfen?",
      send: "Senden",
    },
    pages: {
      settings: {
        api: "API",
        notify: "Benachrichtigungen",
        security: "Sicherheit",
        appearance: "Darstellung",
        team: "Team",
        data: "Daten",
        serverAddr: "Server-URL",
        save: "Speichern",
      },
      subscription: {
        title: "Tarife",
        free: "Kostenlos",
      },
      wallet: {
        title: "Mein Wallet",
        currentBalance: "Guthaben",
      },
      feedback: {
        title: "Feedback",
        submit: "Senden",
      },
      assets: {
        upload: "Hochladen",
        all: "Alle",
        image: "Bilder",
        video: "Videos",
      },
      favorites: {
        title: "Favoriten",
      },
    },
};
export default dm(enUS, override);
