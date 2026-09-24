import { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next'
import { useAuthStore } from "@/stores/useAuthStore";
import { api, ApiError } from "@/lib/api";
import { User, Crown, Shield, Mail, MoreHorizontal, ShieldCheck, ShieldOff, UserMinus } from "lucide-react";

interface Member {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  status: string;
  joinedAt: string | null;
}

type ConfirmAction =
  | { kind: "setAdmin"; member: Member }
  | { kind: "unsetAdmin"; member: Member }
  | { kind: "remove"; member: Member };

export default function TeamMembersPage() {
  const { t } = useTranslation()
  const { currentTeam } = useAuthStore();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const myRole = currentTeam?.role;
  const canManage = myRole === "owner" || myRole === "admin";

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
      setMessage({ type: "success", text: t("pages.team.members.inviteSent") });
      setShowInvite(false);
      setInviteEmail("");
    } catch (err: any) {
      if (err instanceof ApiError) {
        setMessage({ type: "error", text: err.message });
      } else {
        setMessage({ type: "error", text: t("pages.team.members.inviteFailed") });
      }
    } finally {
      setInviting(false);
    }
  };

  const runConfirm = async () => {
    if (!confirm || !currentTeam) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const body =
        confirm.kind === "remove"
          ? { status: "left" }
          : { role: confirm.kind === "setAdmin" ? "admin" : "member" };
      await api.patch(`/teams/${currentTeam.id}/members/${confirm.member.id}`, body);
      await fetchMembers();
      setMessage({
        type: "success",
        text:
          confirm.kind === "remove"
            ? `已移除 ${confirm.member.name}`
            : confirm.kind === "setAdmin"
              ? `已将 ${confirm.member.name} 设为管理员`
              : `已取消 ${confirm.member.name} 的管理员身份`,
      });
    } catch (err: any) {
      if (err instanceof ApiError) {
        setMessage({ type: "error", text: err.message });
      } else {
        setMessage({ type: "error", text: "操作失败，请稍后重试" });
      }
    } finally {
      setSubmitting(false);
      setConfirm(null);
      setMenuFor(null);
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
        return t("pages.team.members.owner");
      case "admin":
        return t("pages.team.members.admin");
      default:
        return t("pages.team.members.member");
    }
  };

  if (!currentTeam) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        {t("pages.team.members.selectFirst")}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text">{t("pages.team.members.title")}</h1>
          <p className="text-sm text-text-muted mt-1">{currentTeam.name}</p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#5051F8] text-white hover:bg-accent-hover transition-colors"
        >
          <Mail size={16} />
          邀请{t("pages.team.members.member")}
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
            <h2 className="text-lg font-bold text-text mb-4">{t("pages.team.members.inviteTitle")}</h2>
            <form onSubmit={handleInvite}>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={t("pages.team.members.emailPh")}
                autoFocus
                className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-text placeholder:text-text-muted focus:border-accent outline-none mb-4"
              />
              <p className="text-xs text-text-muted mb-4">
                {t("pages.team.members.inviteHint")}
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
                  {inviting ? t("pages.team.members.sending") : t("pages.team.members.sendInvite")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 成员列表 */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-muted">{t("pages.team.members.loading")}</div>
        ) : (
          <table className="w-full">
            <thead className="bg-card">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">{t("pages.team.members.member")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">{t("pages.team.members.role")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">{t("pages.team.members.joinedAt")}</th>
                <th className="text-right px-6 py-3 text-sm font-medium text-text-muted">{t("pages.team.members.action")}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isOwner = member.role === "owner";
                const canAct = canManage && !isOwner;
                return (
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
                      {member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-6 py-4 text-right relative">
                      {canAct ? (
                        <>
                          <button
                            className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-secondary transition-colors"
                            onClick={() => setMenuFor(menuFor === member.id ? null : member.id)}
                          >
                            <MoreHorizontal size={18} />
                          </button>
                          {menuFor === member.id && (
                            <>
                              <div className="fixed inset-0 z-30" onClick={() => setMenuFor(null)} />
                              <div className="absolute right-6 top-10 z-40 w-44 rounded-xl bg-card shadow-xl overflow-hidden py-1">
                                {member.role === "admin" ? (
                                  <button
                                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-secondary transition-colors"
                                    onClick={() => { setMenuFor(null); setConfirm({ kind: "unsetAdmin", member }); }}
                                  >
                                    <ShieldOff size={14} className="text-text-muted" />
                                    取消管理员
                                  </button>
                                ) : (
                                  <button
                                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-secondary transition-colors"
                                    onClick={() => { setMenuFor(null); setConfirm({ kind: "setAdmin", member }); }}
                                  >
                                    <ShieldCheck size={14} className="text-text-muted" />
                                    设为管理员
                                  </button>
                                )}
                                <button
                                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-secondary transition-colors"
                                  onClick={() => { setMenuFor(null); setConfirm({ kind: "remove", member }); }}
                                >
                                  <UserMinus size={14} />
                                  移除成员
                                </button>
                              </div>
                            </>
                          )}
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 确认弹窗 */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => !submitting && setConfirm(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-card p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-text mb-2">
              {confirm.kind === "remove"
                ? "移除成员"
                : confirm.kind === "setAdmin"
                  ? "设为管理员"
                  : "取消管理员"}
            </h2>
            <p className="text-sm text-text-muted mb-6">
              {confirm.kind === "remove"
                ? `确定将 ${confirm.member.name}（${confirm.member.email}）移出团队吗？移除后其将失去团队内所有资源访问权限。`
                : confirm.kind === "setAdmin"
                  ? `确定将 ${confirm.member.name} 设为团队管理员吗？管理员可邀请、移除成员并修改成员角色。`
                  : `确定取消 ${confirm.member.name} 的管理员身份吗？其将变为普通成员。`}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirm(null)}
                disabled={submitting}
                className="px-4 py-2 rounded-lg text-text-muted hover:text-text transition-colors"
              >
                取消
              </button>
              <button
                onClick={runConfirm}
                disabled={submitting}
                className={`px-4 py-2 rounded-lg text-white transition-colors disabled:opacity-50 ${
                  confirm.kind === "remove"
                    ? "bg-red-500 hover:bg-red-600"
                    : "bg-[#5051F8] hover:bg-accent-hover"
                }`}
              >
                {submitting ? "处理中..." : "确认"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
