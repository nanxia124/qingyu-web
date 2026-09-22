import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Shield, Search } from "lucide-react";

interface AuditLog {
  id: string;
  action: string;
  resource: string;
  userId: string;
  userName: string;
  detail: string;
  ip: string;
  createdAt: string;
}

export default function AdminAuditsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchLogs();
  }, [search]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const data = await api.get<AuditLog[]>("/admin/audits", { search });
      setLogs(data);
    } catch (err) {
      console.error("获取审计日志失败", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-text mb-6">审计日志</h1>

      {/* 搜索栏 */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索操作或用户..."
            className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[#ffffff] border border-[#e2e2e8] text-text placeholder:text-text-muted focus:border-[#5051F8] outline-none"
          />
        </div>
      </div>

      {/* 日志列表 */}
      <div className="bg-[#ffffff] rounded-xl border border-[#e2e2e8] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-muted">加载中...</div>
        ) : (
          <div className="divide-y divide-[#e5e5ea]">
            {logs.map((log) => (
              <div key={log.id} className="px-6 py-4 flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg bg-[#e5e5ea] flex items-center justify-center shrink-0">
                  <Shield size={16} className="text-text-muted" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text">{log.userName}</span>
                    <span className="text-text-muted">执行了</span>
                    <span className="font-medium text-text">{log.action}</span>
                    <span className="text-text-muted">{log.resource}</span>
                  </div>
                  <p className="text-sm text-text-muted mt-1">{log.detail}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-text-muted">
                    <span>{new Date(log.createdAt).toLocaleString()}</span>
                    <span>IP: {log.ip}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
