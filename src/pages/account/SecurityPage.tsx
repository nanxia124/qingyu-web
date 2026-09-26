import { useRef, useState } from "react";
import { useTranslation } from 'react-i18next'
import { useAuthStore } from "@/stores/useAuthStore";
import { ApiError } from "@/lib/api";
import { PasswordInput } from "@/components/PasswordInput";

export default function SecurityPage() {
  const { t } = useTranslation()
  const { changePassword } = useAuthStore();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [oldError, setOldError] = useState("");
  const [newError, setNewError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const oldRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const validateNewPassword = (pw: string): string => {
    if (pw.length < 8) return t("pages.account.security.newPwdMin");
    if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return t("pages.account.security.pwdNeedLetterAndDigit");
    return "";
  };

  const handleOldChange = (v: string) => {
    setOldPassword(v);
    if (oldError) setOldError("");
  };

  const handleNewChange = (v: string) => {
    setNewPassword(v);
    if (newError) setNewError("");
    if (confirmPassword) {
      setConfirmError(v !== confirmPassword ? t("pages.account.security.mismatch") : "");
    }
  };

  const handleConfirmChange = (v: string) => {
    setConfirmPassword(v);
    if (!v) { setConfirmError(""); return; }
    setConfirmError(v !== newPassword ? t("pages.account.security.mismatch") : "");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    let firstError: "old" | "new" | "confirm" | null = null;
    if (!oldPassword) { setOldError(t("pages.account.security.curPwdRequired")); firstError = "old"; }
    const newErr = validateNewPassword(newPassword);
    if (newErr) { setNewError(newErr); if (!firstError) firstError = "new"; }
    if (newPassword && confirmPassword !== newPassword) {
      setConfirmError(t("pages.account.security.mismatch"));
      if (!firstError) firstError = "confirm";
    }
    if (firstError) {
      if (firstError === "old") oldRef.current?.focus();
      else if (firstError === "new") newRef.current?.focus();
      else confirmRef.current?.focus();
      return;
    }

    setSaving(true);
    try {
      await changePassword(oldPassword, newPassword);
      setMessage({ type: "success", text: t("pages.account.security.changed") });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setOldError("");
      setNewError("");
      setConfirmError("");
    } catch (err: any) {
      const msg = err instanceof ApiError ? err.message : (err?.message || t("pages.account.security.changeFailed"));
      if (typeof msg === "string" && /password|密码|current|old/i.test(msg)) {
        setOldError(msg);
        oldRef.current?.focus();
      } else {
        setMessage({ type: "error", text: msg });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-text mb-6">{t("pages.account.security.title")}</h1>

      {message && (
        <div
          className={`mb-4 p-3 rounded-lg ${
            message.type === "success"
              ? "bg-green-500/10 text-green-400"
              : "bg-red-500/10 text-red-400"
          }`}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-text mb-2">{t("pages.account.security.curPwd")}</label>
          <PasswordInput
            value={oldPassword}
            onChange={handleOldChange}
            error={!!oldError}
            inputRef={oldRef}
            placeholder={t("pages.account.security.curPwdPh")}
          />
          {oldError && <p className="mt-1 text-xs text-red-400">{oldError}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-text mb-2">{t("pages.account.security.newPwd")}</label>
          <PasswordInput
            value={newPassword}
            onChange={handleNewChange}
            error={!!newError}
            inputRef={newRef}
            placeholder={t("pages.account.security.newPwdPh")}
          />
          {newError && <p className="mt-1 text-xs text-red-400">{newError}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-text mb-2">{t("pages.account.security.confirmPwd")}</label>
          <PasswordInput
            value={confirmPassword}
            onChange={handleConfirmChange}
            error={!!confirmError}
            inputRef={confirmRef}
            placeholder={t("pages.account.security.confirmPwdPh")}
          />
          {confirmError
            ? <p className="mt-1 text-xs text-red-400">{confirmError}</p>
            : (newPassword && confirmPassword === newPassword)
              ? <p className="mt-1 text-xs text-green-400">{t("pages.account.security.pwMatch")}</p>
              : null}
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 rounded-lg bg-[#5051F8] text-white font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {saving ? t("pages.account.security.changing") : t("pages.account.security.change")}
          </button>
        </div>
      </form>
    </div>
  );
}
