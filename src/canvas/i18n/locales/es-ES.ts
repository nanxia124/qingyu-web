// Auto-generated partial translation: main-site strings. Canvas editor strings fall back to en-US.
import enUS from "@canvas/i18n/locales/en-US";
function dm(a, b) { const o = { ...a }; for (const k in b) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) o[k] = dm(a[k] || {}, b[k]); else o[k] = b[k]; } return o; }
const override = {
    nav: {
      home: "Inicio",
      chat: "Chat",
      image: "Imagen",
      video: "Vídeo",
      canvas: "Lienzo",
      assets: "Recursos",
      favorites: "Favoritos",
      teams: "Equipos",
      my: "Cuenta",
      darkMode: "Oscuro",
      lightMode: "Claro",
      language: "Idioma",
    },
    mainHome: {
      invite: "Invita y gana",
      points: "Puntos",
      vip: "Membresía",
      soon: "Próximamente",
      text2img: "Texto a imagen",
      expand: "Expandir",
      style: "Estilos",
      works: "Mis obras",
      catAll: "Todo",
      catEcommerce: "E-commerce",
      catPoster: "Póster",
      catPhoto: "Fotografía",
      catIllustration: "Ilustración",
      recommend: "Recomendado",
      latest: "Reciente",
      empty: "No se encontraron obras",
    },
    auth: {
      subtitleLogin: "Inicia sesión o regístrate",
      useGoogle: "Continuar con Google",
      useApple: "Continuar con Apple",
      or: "o",
      email: "Correo",
      nickname: "Apodo",
      password: "Contraseña (mín. 6)",
      forgot: "¿Olvidaste tu contraseña?",
      continue: "Continuar",
      login: "Iniciar sesión",
      register: "Registrarse",
    },
    chat: {
      greeting: "¿En qué puedo ayudarte?",
      send: "Enviar",
    },
    pages: {
      settings: {
        api: "API",
        notify: "Notificaciones",
        security: "Seguridad",
        appearance: "Apariencia",
        team: "Equipo",
        data: "Datos",
        serverAddr: "URL del servidor",
        save: "Guardar",
      },
      subscription: {
        title: "Planes",
        free: "Gratis",
      },
      wallet: {
        title: "Mi cartera",
        currentBalance: "Saldo",
      },
      feedback: {
        title: "Comentarios",
        submit: "Enviar",
      },
      assets: {
        upload: "Subir",
        all: "Todo",
        image: "Imágenes",
        video: "Vídeos",
      },
      favorites: {
        title: "Favoritos",
      },
    },
};
export default dm(enUS, override);
