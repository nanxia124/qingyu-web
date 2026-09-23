import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Search, MoreHorizontal, UserCheck, UserX } from "lucide-react";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  status: "active" | "disabled";
  createdAt: string;
  lastLoginAt?: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchUsers();
  }, [search]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await api.get<AdminUser[]>("/admin/users", { search });
      setUsers(data);
    } catch (err) {
      console.error("获取用户列表失败", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-text mb-6">用户管理</h1>

      {/* 搜索栏 */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索用户邮箱或昵称..."
            className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-card border border-border text-text placeholder:text-text-muted focus:border-accent outline-none"
          />
        </div>
      </div>

      {/* 用户列表 */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-muted">加载中...</div>
        ) : (
          <table className="w-full">
            <thead className="bg-card">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">用户</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">状态</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">注册时间</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">最后登录</th>
                <th className="text-right px-6 py-3 text-sm font-medium text-text-muted">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-border">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-sm font-bold text-text">
                        {user.name?.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-text">{user.name}</div>
                        <div className="text-sm text-text-muted">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-1 text-xs rounded-full ${
                      user.status === "active"
                        ? "bg-green-500/10 text-green-400"
                        : "bg-red-500/10 text-red-400"
                    }`}>
                      {user.status === "active" ? "正常" : "已禁用"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-text-muted">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-text-muted">
                    {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "-"}
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
