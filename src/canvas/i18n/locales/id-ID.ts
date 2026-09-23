// Auto-generated partial translation: main-site strings. Canvas editor strings fall back to en-US.
import enUS from "@canvas/i18n/locales/en-US";
function dm(a, b) { const o = { ...a }; for (const k in b) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) o[k] = dm(a[k] || {}, b[k]); else o[k] = b[k]; } return o; }
const override = {
    nav: {
      home: "Beranda",
      chat: "Chat",
      image: "Gambar",
      video: "Video",
      canvas: "Kanvas",
      assets: "Aset",
      favorites: "Favorit",
      teams: "Tim",
      my: "Akun",
      darkMode: "Gelap",
      lightMode: "Terang",
      language: "Bahasa",
    },
    mainHome: {
      invite: "Undang dan dapatkan",
      points: "Poin",
      vip: "Keanggotaan",
      soon: "Segera",
      text2img: "Teks ke gambar",
      expand: "Perluas",
      style: "Gaya",
      works: "Karya saya",
      catAll: "Semua",
      catEcommerce: "E-commerce",
      catPoster: "Poster",
      catPhoto: "Foto",
      catIllustration: "Ilustrasi",
      recommend: "Rekomendasi",
      latest: "Terbaru",
      empty: "Tidak ada karya",
    },
    auth: {
      subtitleLogin: "Masuk atau daftar",
      useGoogle: "Lanjutkan dengan Google",
      useApple: "Lanjutkan dengan Apple",
      or: "atau",
      email: "Email",
      nickname: "Nama panggilan",
      password: "Kata sandi (min. 6)",
      forgot: "Lupa kata sandi?",
      continue: "Lanjutkan",
      login: "Masuk",
      register: "Daftar",
    },
    chat: {
      greeting: "Ada yang bisa saya bantu?",
      send: "Kirim",
    },
    pages: {
      settings: {
        api: "API",
        notify: "Notifikasi",
        security: "Keamanan",
        appearance: "Tampilan",
        team: "Tim",
        data: "Data",
        serverAddr: "URL server",
        save: "Simpan",
      },
      subscription: {
        title: "Paket",
        free: "Gratis",
      },
      wallet: {
        title: "Dompet saya",
        currentBalance: "Saldo",
      },
      feedback: {
        title: "Umpan balik",
        submit: "Kirim",
      },
      assets: {
        upload: "Unggah",
        all: "Semua",
        image: "Gambar",
        video: "Video",
      },
      favorites: {
        title: "Favorit",
      },
    },
};
export default dm(enUS, override);
