import { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next'
import { QingyuLogoIcon } from "@/components/layout/SidebarIcons";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/stores/useAuthStore";
import { AppwriteException } from "appwrite";

export default function ResetPasswordPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { resetPassword } = useAuthStore();

  const userId = searchParams.get("userId") || "";
  const secret = searchParams.get("secret") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 缺少参数时直接报错
  useEffect(() => {
    if (!userId || !secret) {
      setMessage({ type: "error", text: t("pages.resetPwd.invalid") });
    }
  }, [userId, secret]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!userId || !secret) {
      setMessage({ type: "error", text: t("pages.resetPwd.invalidOnly") });
      return;
    }
    if (password.length < 6) {
      setMessage({ type: "error", text: t("pages.resetPwd.pwdMin") });
      return;
    }
    if (password !== confirm) {
      setMessage({ type: "error", text: t("pages.resetPwd.mismatch") });
      return;
    }

    setSaving(true);
    try {
      await resetPassword(userId, secret, password);
      setMessage({ type: "success", text: t("pages.resetPwd.success") });
      setTimeout(() => navigate("/"), 2000);
    } catch (err: any) {
      if (err instanceof AppwriteException) {
        setMessage({ type: "error", text: err.message || t("pages.resetPwd.failed") });
      } else {
        setMessage({ type: "error", text: t("pages.resetPwd.failedRetry") });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4">
      <div className="w-full max-w-md rounded-[24px] bg-card p-8 shadow-2xl">
        <div className="flex justify-center mb-6">
          <QingyuLogoIcon className="w-[56px] h-[56px] text-text" />
        </div>
        <h1 className="text-2xl font-bold text-center text-white mb-2">{t("pages.resetPwd.title")}</h1>
        <p className="text-center text-gray-500 text-sm mb-8">{t("pages.resetPwd.subtitle")}</p>

        {message && (
          <div
            className={`mb-4 p-3 rounded-lg text-center ${
              message.type === "success"
                ? "bg-green-500/10 text-green-400"
                : "bg-red-500/10 text-red-400"
            }`}
          >
            {message.text}
          </div>
        )}

        {userId && secret && !message?.type.includes("success") && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <input
              type="password"
              placeholder={t("pages.resetPwd.newPwdPh")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              className="w-full px-4 py-3 rounded-[12px] bg-secondary border border-border text-gray-200 placeholder:text-gray-500 focus:border-accent outline-none"
            />
            <input
              type="password"
              placeholder={t("pages.resetPwd.confirmPh")}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-4 py-3 rounded-[12px] bg-secondary border border-border text-gray-200 placeholder:text-gray-500 focus:border-accent outline-none"
            />
            <button
              type="submit"
              disabled={saving}
              className="w-full py-3 rounded-[12px] bg-[#5051F8] text-white font-medium hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? t("pages.resetPwd.submitting") : t("pages.resetPwd.confirm")}
            </button>
          </form>
        )}

        <p className="text-center text-xs text-gray-500 mt-6">
          <span className="text-accent cursor-pointer hover:underline" onClick={() => navigate("/")}>
            {t("pages.resetPwd.backHome")}
          </span>
        </p>
      </div>
    </div>
  );
}
