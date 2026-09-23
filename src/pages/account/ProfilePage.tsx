import { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next'
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/useAuthStore";
import { ApiError } from "@/lib/api";

export default function ProfilePage() {
  const { t } = useTranslation()
  const navigate = useNavigate();
  const { user, updateProfile, fetchProfile } = useAuthStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email);
    }
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      await updateProfile({ name });
      setMessage({ type: "success", text: t("pages.account.profile.updated") });
      fetchProfile();
    } catch (err: any) {
      if (err instanceof ApiError) {
        setMessage({ type: "error", text: err.message });
      } else {
        setMessage({ type: "error", text: t("pages.account.profile.updateFailed") });
      }
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        t("pages.account.profile.loginFirst")
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-text mb-6">{t("pages.account.profile.title")}</h1>

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

      <form onSubmit={handleSave} className="space-y-6">
        {/* 头像 */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center text-2xl font-bold text-text">
            {user.name?.charAt(0).toUpperCase() || "U"}
          </div>
          <div>
            <button
              type="button"
              className="px-4 py-2 text-sm rounded-lg bg-secondary text-text hover:bg-surface-hover transition-colors"
            >
              {t("pages.account.profile.uploadAvatar")}
            </button>
            <p className="text-xs text-text-muted mt-1">{t("pages.account.profile.avatarHint")}</p>
          </div>
        </div>

        {/* 昵称 */}
        <div>
          <label className="block text-sm font-medium text-text mb-2">{t("pages.account.profile.nickname")}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-text placeholder:text-text-muted focus:border-accent outline-none"
            placeholder={t("pages.account.profile.nicknamePh")}
          />
        </div>

        {/* 邮箱 */}
        <div>
          <label className="block text-sm font-medium text-text mb-2">{t("pages.account.profile.email")}</label>
          <input
            type="email"
            value={email}
            disabled
            className="w-full px-4 py-3 rounded-lg bg-card border border-border text-text-muted cursor-not-allowed"
          />
          <p className="text-xs text-text-muted mt-1">{t("pages.account.profile.emailHint")}</p>
        </div>

        {/* 提交 */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 rounded-lg bg-[#5051F8] text-white font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {saving ? t("pages.account.profile.saving") : t("pages.account.profile.save")}
          </button>
        </div>
      </form>

      {/* 账号安全 */}
      <div className="mt-8 pt-6 border-t border-border">
        <h2 className="text-lg font-semibold text-text mb-4">{t("pages.account.profile.security")}</h2>
        <div className="flex items-center justify-between p-4 rounded-lg bg-secondary">
          <div>
            <p className="text-text font-medium">{t("pages.account.profile.changePassword")}</p>
            <p className="text-xs text-text-muted mt-1">{t("pages.account.profile.passwordHint")}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/account/security")}
            className="px-4 py-2 text-sm rounded-lg bg-[#5051F8] text-white hover:bg-accent-hover transition-colors"
          >
            {t("pages.account.profile.goChange")}
          </button>
        </div>
      </div>
    </div>
  );
}
