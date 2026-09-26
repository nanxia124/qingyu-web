import { useRef, useState, useEffect } from "react";
import { useTranslation } from 'react-i18next'
import { QingyuLogoIcon } from "@/components/layout/SidebarIcons";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/stores/useAuthStore";
import { AppwriteException } from "appwrite";
import { PasswordInput } from "@/components/PasswordInput";

export default function ResetPasswordPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { resetPassword } = useAuthStore();

  const userId = searchParams.get("userId") || "";
  const secret = searchParams.get("secret") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!userId || !secret) {
      setMessage({ type: "error", text: t("pages.resetPwd.invalid") });
    }
  }, [userId, secret]);

  const validatePassword = (pw: string): string => {
    if (pw.length < 8) return t("pages.resetPwd.pwdMin");
    if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return t("pages.resetPwd.pwdNeedLetterAndDigit");
    return "";
  };

  const handlePasswordChange = (v: string) => {
    setPassword(v);
    if (passwordError) setPasswordError("");
    if (confirm) {
      setConfirmError(v !== confirm ? t("pages.resetPwd.mismatch") : "");
    }
  };

  const handleConfirmChange = (v: string) => {
    setConfirm(v);
    if (!v) { setConfirmError(""); return; }
    setConfirmError(v !== password ? t("pages.resetPwd.mismatch") : "");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!userId || !secret) {
      setMessage({ type: "error", text: t("pages.resetPwd.invalidOnly") });
      return;
    }
    let firstError: "password" | "confirm" | null = null;
    const pwErr = validatePassword(password);
    if (pwErr) { setPasswordError(pwErr); firstError = "password"; }
    if (password && confirm !== password) {
      setConfirmError(t("pages.resetPwd.mismatch"));
      if (!firstError) firstError = "confirm";
    }
    if (firstError) {
      if (firstError === "password") passwordRef.current?.focus();
      else confirmRef.current?.focus();
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
            <div>
              <PasswordInput
                value={password}
                onChange={handlePasswordChange}
                error={!!passwordError}
                inputRef={passwordRef}
                autoFocus
                placeholder={t("pages.resetPwd.newPwdPh")}
              />
              {passwordError && <p className="mt-1 text-xs text-red-400">{passwordError}</p>}
            </div>
            <div>
              <PasswordInput
                value={confirm}
                onChange={handleConfirmChange}
                error={!!confirmError}
                inputRef={confirmRef}
                placeholder={t("pages.resetPwd.confirmPh")}
              />
              {confirmError
                ? <p className="mt-1 text-xs text-red-400">{confirmError}</p>
                : (password && confirm === password)
                  ? <p className="mt-1 text-xs text-green-400">{t("pages.resetPwd.pwMatch")}</p>
                  : null}
            </div>
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
