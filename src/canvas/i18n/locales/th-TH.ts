// Auto-generated partial translation: main-site strings. Canvas editor strings fall back to en-US.
import enUS from "@canvas/i18n/locales/en-US";
function dm(a, b) { const o = { ...a }; for (const k in b) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) o[k] = dm(a[k] || {}, b[k]); else o[k] = b[k]; } return o; }
const override = {
    nav: {
      home: "หน้าแรก",
      chat: "แชท",
      image: "ภาพ",
      video: "วิดีโอ",
      canvas: "แคนวาส",
      assets: "เนื้อหา",
      favorites: "รายการโปรด",
      teams: "ทีม",
      my: "บัญชี",
      darkMode: "โหมดมืด",
      lightMode: "โหมดสว่าง",
      language: "ภาษา",
    },
    mainHome: {
      invite: "เชิญและรับรางวัล",
      points: "คะแนน",
      vip: "สมาชิก",
      soon: "เร็วๆ นี้",
      text2img: "ข้อความเป็นภาพ",
      expand: "ขยาย",
      style: "สไตล์",
      works: "ผลงานของฉัน",
      catAll: "ทั้งหมด",
      catEcommerce: "อีคอมเมิร์ซ",
      catPoster: "โปสเตอร์",
      catPhoto: "ภาพถ่าย",
      catIllustration: "ภาพประกอบ",
      recommend: "แนะนำ",
      latest: "ล่าสุด",
      empty: "ไม่พบผลงาน",
    },
    auth: {
      subtitleLogin: "เข้าสู่ระบบหรือสมัครสมาชิก",
      useGoogle: "ดำเนินการต่อด้วย Google",
      useApple: "ดำเนินการต่อด้วย Apple",
      or: "หรือ",
      email: "อีเมล",
      nickname: "ชื่อเล่น",
      password: "รหัสผ่าน (อย่างน้อย 6)",
      forgot: "ลืมรหัสผ่าน?",
      continue: "ดำเนินการต่อ",
      login: "เข้าสู่ระบบ",
      register: "สมัครสมาชิก",
    },
    chat: {
      greeting: "มีอะไรให้ช่วยไหม?",
      send: "ส่ง",
    },
    pages: {
      settings: {
        api: "API",
        notify: "การแจ้งเตือน",
        security: "ความปลอดภัย",
        appearance: "รูปลักษณ์",
        team: "ทีม",
        data: "ข้อมูล",
        serverAddr: "URL เซิร์ฟเวอร์",
        save: "บันทึก",
      },
      subscription: {
        title: "แผน",
        free: "ฟรี",
      },
      wallet: {
        title: "กระเป๋าเงิน",
        currentBalance: "ยอดเงิน",
      },
      feedback: {
        title: "ข้อเสนอแนะ",
        submit: "ส่ง",
      },
      assets: {
        upload: "อัปโหลด",
        all: "ทั้งหมด",
        image: "ภาพ",
        video: "วิดีโอ",
      },
      favorites: {
        title: "รายการโปรด",
      },
    },
};
export default dm(enUS, override);
