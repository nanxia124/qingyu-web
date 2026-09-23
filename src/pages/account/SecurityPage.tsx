import { useState } from "react";
import { useAuthStore } from "@/stores/useAuthStore";
import { ApiError } from "@/lib/api";

export default function SecurityPage() {
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
      setMessage({ type: "error", text: "请输入当前密码" });
      return;
    }
    if (newPassword.length < 6) {
      setMessage({ type: "error", text: "新密码至少 6 位" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "两次输入的密码不一致" });
      return;
    }

    setSaving(true);
    try {
      await changePassword(oldPassword, newPassword);
      setMessage({ type: "success", text: "密码修改成功" });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      if (err instanceof ApiError) {
        setMessage({ type: "error", text: err.message });
      } else {
        setMessage({ type: "error", text: "修改失败，请稍后重试" });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-text mb-6">安全设置</h1>

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
          <label className="block text-sm font-medium text-text mb-2">当前密码</label>
          <input
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-text placeholder:text-text-muted focus:border-accent outline-none"
            placeholder="请输入当前密码"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text mb-2">新密码</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-text placeholder:text-text-muted focus:border-accent outline-none"
            placeholder="至少 6 位"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text mb-2">确认新密码</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-text placeholder:text-text-muted focus:border-accent outline-none"
            placeholder="再次输入新密码"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 rounded-lg bg-[#5051F8] text-white font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {saving ? "修改中..." : "修改密码"}
          </button>
        </div>
      </form>
    </div>
  );
}
