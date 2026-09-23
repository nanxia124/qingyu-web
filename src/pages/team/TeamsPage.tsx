import { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next'
import { useAuthStore } from "@/stores/useAuthStore";
import { api, ApiError } from "@/lib/api";
import { Plus, Users, Crown, Settings } from "lucide-react";

export default function TeamsPage() {
  const { t } = useTranslation()
  const { teams, fetchTeams, currentTeam, switchTeam } = useAuthStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetchTeams();
  }, []);

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;

    setCreating(true);
    setMessage(null);

    try {
      const team = await api.post("/teams", { name: newTeamName });
      await fetchTeams();
      setShowCreate(false);
      setNewTeamName("");
      setMessage({ type: "success", text: t("pages.team.teams.created") });
    } catch (err: any) {
      if (err instanceof ApiError) {
        setMessage({ type: "error", text: err.message });
      } else {
        setMessage({ type: "error", text: t("pages.team.teams.createFailed") });
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text">{t("pages.team.teams.title")}</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#5051F8] text-white hover:bg-accent-hover transition-colors"
        >
          <Plus size={16} />
          创建团队
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

      {/* 创建团队弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowCreate(false)}>
          <div
            className="w-full max-w-md rounded-2xl bg-card p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-text mb-4">{t("pages.team.teams.createTitle")}</h2>
            <form onSubmit={handleCreateTeam}>
              <input
                type="text"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder={t("pages.team.teams.namePh")}
                autoFocus
                className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-text placeholder:text-text-muted focus:border-accent outline-none mb-4"
              />
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 rounded-lg text-text-muted hover:text-text transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 rounded-lg bg-[#5051F8] text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
                >
                  {creating ? t("pages.team.teams.creating") : t("pages.team.teams.create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 团队列表 */}
      <div className="grid gap-4">
        {teams.map((team) => (
          <div
            key={team.id}
            className={`p-5 rounded-xl border transition-all cursor-pointer ${
              currentTeam?.id === team.id
                ? "border-accent bg-[#5051F8]/5"
                : "border-border bg-card hover:border-accent/50"
            }`}
            onClick={() => switchTeam(team.id)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center">
                  <Users size={24} className="text-text-muted" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-text">{team.name}</h3>
                  <p className="text-sm text-text-muted">
                    {team.plan} 计划 · 创建于 {new Date(team.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {team.role === "owner" && (
                  <span className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-yellow-500/10 text-yellow-400">
                    <Crown size={12} />
                    所有者
                  </span>
                )}
                {team.role === "admin" && (
                  <span className="px-2 py-1 text-xs rounded-full bg-blue-500/10 text-blue-400">
                    管理员
                  </span>
                )}
                <button
                  className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-secondary transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    // 跳转设置
                  }}
                >
                  <Settings size={18} />
                </button>
              </div>
            </div>
          </div>
        ))}

        {teams.length === 0 && (
          <div className="text-center py-12 text-text-muted">
            {t("pages.team.teams.empty")}
          </div>
        )}
      </div>
    </div>
  );
}
