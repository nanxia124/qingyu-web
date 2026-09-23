import { useState, useEffect } from "react";
import { useAuthStore } from "@/stores/useAuthStore";
import { api, ApiError } from "@/lib/api";
import { User, Crown, Shield, Mail, MoreHorizontal } from "lucide-react";

interface Member {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
}

export default function TeamMembersPage() {
  const { currentTeam } = useAuthStore();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (currentTeam) {
      fetchMembers();
    }
  }, [currentTeam]);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const data = await api.get<Member[]>(`/teams/${currentTeam?.id}/members`);
      setMembers(data);
    } catch (err) {
      console.error("获取成员列表失败", err);
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setInviting(true);
    setMessage(null);

    try {
      await api.post(`/teams/${currentTeam?.id}/invite`, { email: inviteEmail });
      setMessage({ type: "success", text: "邀请已发送" });
      setShowInvite(false);
      setInviteEmail("");
    } catch (err: any) {
      if (err instanceof ApiError) {
        setMessage({ type: "error", text: err.message });
      } else {
        setMessage({ type: "error", text: "邀请失败，请稍后重试" });
      }
    } finally {
      setInviting(false);
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "owner":
        return <Crown size={14} className="text-yellow-400" />;
      case "admin":
        return <Shield size={14} className="text-blue-400" />;
      default:
        return <User size={14} className="text-text-muted" />;
    }
  };

  const getRoleText = (role: string) => {
    switch (role) {
      case "owner":
        return "所有者";
      case "admin":
        return "管理员";
      default:
        return "成员";
    }
  };

  if (!currentTeam) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        请先选择一个团队
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text">团队成员</h1>
          <p className="text-sm text-text-muted mt-1">{currentTeam.name}</p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#5051F8] text-white hover:bg-accent-hover transition-colors"
        >
          <Mail size={16} />
          邀请成员
        </button>
      </div>

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

      {/* 邀请弹窗 */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowInvite(false)}>
          <div
            className="w-full max-w-md rounded-2xl bg-card p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-text mb-4">邀请成员</h2>
            <form onSubmit={handleInvite}>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="输入对方邮箱"
                autoFocus
                className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-text placeholder:text-text-muted focus:border-accent outline-none mb-4"
              />
              <p className="text-xs text-text-muted mb-4">
                对方将收到邀请邮件，接受后加入团队
              </p>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowInvite(false)}
                  className="px-4 py-2 rounded-lg text-text-muted hover:text-text transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="px-4 py-2 rounded-lg bg-[#5051F8] text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
                >
                  {inviting ? "发送中..." : "发送邀请"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 成员列表 */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-muted">加载中...</div>
        ) : (
          <table className="w-full">
            <thead className="bg-card">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">成员</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">角色</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">加入时间</th>
                <th className="text-right px-6 py-3 text-sm font-medium text-text-muted">操作</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className="border-t border-border">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-sm font-bold text-text">
                        {member.name?.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-text">{member.name}</div>
                        <div className="text-sm text-text-muted">{member.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-secondary text-text-muted">
                      {getRoleIcon(member.role)}
                      {getRoleText(member.role)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-text-muted">
                    {new Date(member.joinedAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-secondary transition-colors">
                      <MoreHorizontal size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
