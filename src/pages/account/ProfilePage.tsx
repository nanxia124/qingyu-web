import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/useAuthStore";
import { ApiError } from "@/lib/api";

export default function ProfilePage() {
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
      setMessage({ type: "success", text: "资料已更新" });
      fetchProfile();
    } catch (err: any) {
      if (err instanceof ApiError) {
        setMessage({ type: "error", text: err.message });
      } else {
        setMessage({ type: "error", text: "更新失败，请稍后重试" });
      }
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        请先登录
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-text mb-6">个人资料</h1>

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
          <div className="w-16 h-16 rounded-full bg-[#e5e5ea] flex items-center justify-center text-2xl font-bold text-text">
            {user.name?.charAt(0).toUpperCase() || "U"}
          </div>
          <div>
            <button
              type="button"
              className="px-4 py-2 text-sm rounded-lg bg-[#e5e5ea] text-text hover:bg-[#e8e8ec] transition-colors"
            >
              上传头像
            </button>
            <p className="text-xs text-text-muted mt-1">支持 JPG、PNG，最大 2MB</p>
          </div>
        </div>

        {/* 昵称 */}
        <div>
          <label className="block text-sm font-medium text-text mb-2">昵称</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-[#e5e5ea] border border-[#e2e2e8] text-text placeholder:text-text-muted focus:border-[#5051F8] outline-none"
            placeholder="请输入昵称"
          />
        </div>

        {/* 邮箱 */}
        <div>
          <label className="block text-sm font-medium text-text mb-2">邮箱</label>
          <input
            type="email"
            value={email}
            disabled
            className="w-full px-4 py-3 rounded-lg bg-[#ffffff] border border-[#e2e2e8] text-text-muted cursor-not-allowed"
          />
          <p className="text-xs text-text-muted mt-1">邮箱用于登录，暂不支持修改</p>
        </div>

        {/* 提交 */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 rounded-lg bg-[#5051F8] text-white font-medium hover:bg-[#3f40e6] disabled:opacity-50 transition-colors"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </form>

      {/* 账号安全 */}
      <div className="mt-8 pt-6 border-t border-[#e2e2e8]">
        <h2 className="text-lg font-semibold text-text mb-4">账号安全</h2>
        <div className="flex items-center justify-between p-4 rounded-lg bg-[#e5e5ea]">
          <div>
            <p className="text-text font-medium">修改密码</p>
            <p className="text-xs text-text-muted mt-1">定期更换密码以保障账号安全</p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/account/security")}
            className="px-4 py-2 text-sm rounded-lg bg-[#5051F8] text-white hover:bg-[#3f40e6] transition-colors"
          >
            去修改
          </button>
        </div>
      </div>
    </div>
  );
}
