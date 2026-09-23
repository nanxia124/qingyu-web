// Auto-generated partial translation: main-site strings. Canvas editor strings fall back to en-US.
import enUS from "@canvas/i18n/locales/en-US";
function dm(a, b) { const o = { ...a }; for (const k in b) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) o[k] = dm(a[k] || {}, b[k]); else o[k] = b[k]; } return o; }
const override = {
    nav: {
      home: "Início",
      chat: "Chat",
      image: "Imagem",
      video: "Vídeo",
      canvas: "Canvas",
      assets: "Recursos",
      favorites: "Favoritos",
      teams: "Equipes",
      my: "Conta",
      darkMode: "Escuro",
      lightMode: "Claro",
      language: "Idioma",
    },
    mainHome: {
      invite: "Convide e ganhe",
      points: "Pontos",
      vip: "Assinatura",
      soon: "Em breve",
      text2img: "Texto para imagem",
      expand: "Expandir",
      style: "Estilos",
      works: "Minhas obras",
      catAll: "Tudo",
      catEcommerce: "E-commerce",
      catPoster: "Pôster",
      catPhoto: "Foto",
      catIllustration: "Ilustração",
      recommend: "Recomendados",
      latest: "Recentes",
      empty: "Nenhuma obra encontrada",
    },
    auth: {
      subtitleLogin: "Entre ou cadastre-se",
      useGoogle: "Continuar com Google",
      useApple: "Continuar com Apple",
      or: "ou",
      email: "E-mail",
      nickname: "Apelido",
      password: "Senha (mín. 6)",
      forgot: "Esqueceu a senha?",
      continue: "Continuar",
      login: "Entrar",
      register: "Cadastrar",
    },
    chat: {
      greeting: "Como posso ajudar?",
      send: "Enviar",
    },
    pages: {
      settings: {
        api: "API",
        notify: "Notificações",
        security: "Segurança",
        appearance: "Aparência",
        team: "Equipe",
        data: "Dados",
        serverAddr: "URL do servidor",
        save: "Salvar",
      },
      subscription: {
        title: "Planos",
        free: "Grátis",
      },
      wallet: {
        title: "Minha carteira",
        currentBalance: "Saldo",
      },
      feedback: {
        title: "Feedback",
        submit: "Enviar",
      },
      assets: {
        upload: "Enviar",
        all: "Tudo",
        image: "Imagens",
        video: "Vídeos",
      },
      favorites: {
        title: "Favoritos",
      },
    },
};
export default dm(enUS, override);
