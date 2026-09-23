// Auto-generated partial translation: main-site strings. Canvas editor strings fall back to en-US.
import enUS from "@canvas/i18n/locales/en-US";
function dm(a, b) { const o = { ...a }; for (const k in b) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) o[k] = dm(a[k] || {}, b[k]); else o[k] = b[k]; } return o; }
const override = {
    nav: {
      home: "Trang chủ",
      chat: "Trò chuyện",
      image: "Ảnh",
      video: "Video",
      canvas: "Canvas",
      assets: "Tài sản",
      favorites: "Yêu thích",
      teams: "Nhóm",
      my: "Tài khoản",
      darkMode: "Tối",
      lightMode: "Sáng",
      language: "Ngôn ngữ",
    },
    mainHome: {
      invite: "Mời và nhận quà",
      points: "Điểm",
      vip: "Gói hội viên",
      soon: "Sắp có",
      text2img: "Văn bản thành ảnh",
      expand: "Mở rộng",
      style: "Phong cách",
      works: "Tác phẩm của tôi",
      catAll: "Tất cả",
      catEcommerce: "Thương mại điện tử",
      catPoster: "Áp phích",
      catPhoto: "Nhiếp ảnh",
      catIllustration: "Minh họa",
      recommend: "Đề xuất",
      latest: "Mới nhất",
      empty: "Không tìm thấy tác phẩm",
    },
    auth: {
      subtitleLogin: "Đăng nhập hoặc đăng ký",
      useGoogle: "Tiếp tục với Google",
      useApple: "Tiếp tục với Apple",
      or: "hoặc",
      email: "Email",
      nickname: "Biệt danh",
      password: "Mật khẩu (tối thiểu 6)",
      forgot: "Quên mật khẩu?",
      continue: "Tiếp tục",
      login: "Đăng nhập",
      register: "Đăng ký",
    },
    chat: {
      greeting: "Tôi có thể giúp gì cho bạn?",
      send: "Gửi",
    },
    pages: {
      settings: {
        api: "API",
        notify: "Thông báo",
        security: "Bảo mật",
        appearance: "Giao diện",
        team: "Nhóm",
        data: "Dữ liệu",
        serverAddr: "URL máy chủ",
        save: "Lưu",
      },
      subscription: {
        title: "Gói cước",
        free: "Miễn phí",
      },
      wallet: {
        title: "Ví của tôi",
        currentBalance: "Số dư",
      },
      feedback: {
        title: "Phản hồi",
        submit: "Gửi",
      },
      assets: {
        upload: "Tải lên",
        all: "Tất cả",
        image: "Ảnh",
        video: "Video",
      },
      favorites: {
        title: "Yêu thích",
      },
    },
};
export default dm(enUS, override);
