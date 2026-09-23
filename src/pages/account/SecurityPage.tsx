import { useState } from "react";
import { useTranslation } from 'react-i18next'
import { useAuthStore } from "@/stores/useAuthStore";
import { ApiError } from "@/lib/api";

export default function SecurityPage() {
  const { t } = useTranslation()
  const { changePassword } = useAuthStore();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    // 校验
    if (!oldPassword) {
      setMessage({ type: "error", text: t("pages.account.security.curPwdRequired") });
      return;
    }
    if (newPassword.length < 6) {
      setMessage({ type: "error", text: t("pages.account.security.newPwdMin") });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: t("pages.account.security.mismatch") });
      return;
    }

    setSaving(true);
    try {
      await changePassword(oldPassword, newPassword);
      setMessage({ type: "success", text: t("pages.account.security.changed") });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      if (err instanceof ApiError) {
        setMessage({ type: "error", text: err.message });
      } else {
        setMessage({ type: "error", text: t("pages.account.security.changeFailed") });
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
          <input
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-text placeholder:text-text-muted focus:border-accent outline-none"
            placeholder={t("pages.account.security.curPwdPh")}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text mb-2">{t("pages.account.security.newPwd")}</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-text placeholder:text-text-muted focus:border-accent outline-none"
            placeholder={t("pages.account.security.newPwdPh")}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text mb-2">{t("pages.account.security.confirmPwd")}</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-text placeholder:text-text-muted focus:border-accent outline-none"
            placeholder={t("pages.account.security.confirmPwdPh")}
          />
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
