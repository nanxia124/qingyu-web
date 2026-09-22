import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Search, Building2, MoreHorizontal } from "lucide-react";

interface Tenant {
  id: string;
  name: string;
  plan: string;
  status: "active" | "disabled";
  memberCount: number;
  createdAt: string;
}

export default function AdminTenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchTenants();
  }, [search]);

  const fetchTenants = async () => {
    setLoading(true);
    try {
      const data = await api.get<Tenant[]>("/admin/tenants", { search });
      setTenants(data);
    } catch (err) {
      console.error("获取租户列表失败", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-text mb-6">租户管理</h1>

      {/* 搜索栏 */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索租户名称..."
            className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[#ffffff] border border-[#e2e2e8] text-text placeholder:text-text-muted focus:border-[#5051F8] outline-none"
          />
        </div>
      </div>

      {/* 租户列表 */}
      <div className="bg-[#ffffff] rounded-xl border border-[#e2e2e8] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-muted">加载中...</div>
        ) : (
          <table className="w-full">
            <thead className="bg-[#ffffff]">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">租户</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">计划</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">成员数</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">状态</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">创建时间</th>
                <th className="text-right px-6 py-3 text-sm font-medium text-text-muted">操作</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="border-t border-[#e5e5ea]">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[#e5e5ea] flex items-center justify-center">
                        <Building2 size={20} className="text-text-muted" />
                      </div>
                      <span className="font-medium text-text">{tenant.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-text">{tenant.plan}</td>
                  <td className="px-6 py-4 text-text-muted">{tenant.memberCount} 人</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-1 text-xs rounded-full ${
                      tenant.status === "active"
                        ? "bg-green-500/10 text-green-400"
                        : "bg-red-500/10 text-red-400"
                    }`}>
                      {tenant.status === "active" ? "正常" : "已禁用"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-text-muted">
                    {new Date(tenant.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-[#e5e5ea] transition-colors">
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
