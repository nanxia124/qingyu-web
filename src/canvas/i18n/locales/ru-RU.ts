// Auto-generated partial translation: main-site strings. Canvas editor strings fall back to en-US.
import enUS from "@canvas/i18n/locales/en-US";
function dm(a, b) { const o = { ...a }; for (const k in b) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) o[k] = dm(a[k] || {}, b[k]); else o[k] = b[k]; } return o; }
const override = {
    nav: {
      home: "Главная",
      chat: "Чат",
      image: "Изображения",
      video: "Видео",
      canvas: "Холст",
      assets: "Ассеты",
      favorites: "Избранное",
      teams: "Команды",
      my: "Аккаунт",
      darkMode: "Тёмная",
      lightMode: "Светлая",
      language: "Язык",
    },
    mainHome: {
      invite: "Пригласить и получить",
      points: "Баллы",
      vip: "Подписка",
      soon: "Скоро",
      text2img: "Текст в изображение",
      expand: "Расширить",
      style: "Стили",
      works: "Мои работы",
      catAll: "Все",
      catEcommerce: "Электронная коммерция",
      catPoster: "Плакат",
      catPhoto: "Фотография",
      catIllustration: "Иллюстрация",
      recommend: "Рекомендуем",
      latest: "Новое",
      empty: "Работы не найдены",
    },
    auth: {
      subtitleLogin: "Войдите или зарегистрируйтесь",
      useGoogle: "Продолжить с Google",
      useApple: "Продолжить с Apple",
      or: "или",
      email: "Почта",
      nickname: "Никнейм",
      password: "Пароль (мин. 6)",
      forgot: "Забыли пароль?",
      continue: "Продолжить",
      login: "Войти",
      register: "Зарегистрироваться",
    },
    chat: {
      greeting: "Чем могу помочь?",
      send: "Отправить",
    },
    pages: {
      settings: {
        api: "API",
        notify: "Уведомления",
        security: "Безопасность",
        appearance: "Оформление",
        team: "Команда",
        data: "Данные",
        serverAddr: "URL сервера",
        save: "Сохранить",
      },
      subscription: {
        title: "Тарифы",
        free: "Бесплатно",
      },
      wallet: {
        title: "Мой кошелёк",
        currentBalance: "Баланс",
      },
      feedback: {
        title: "Обратная связь",
        submit: "Отправить",
      },
      assets: {
        upload: "Загрузить",
        all: "Все",
        image: "Изображения",
        video: "Видео",
      },
      favorites: {
        title: "Избранное",
      },
    },
};
export default dm(enUS, override);
